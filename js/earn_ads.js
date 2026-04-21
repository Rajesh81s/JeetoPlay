// JeetoPlay — Earn Ads (Watch & Earn + Ads for Spins)
// Bridges to native Android ad SDK via AndroidNative JS interface
// All reward crediting goes through Cloud Function (claimAdReward)

const _isNativeApp = typeof AndroidNative !== 'undefined' &&
    typeof AndroidNative.isNativeApp === 'function' &&
    AndroidNative.isNativeApp();

// ─── Helper: Update ALL spin ad progress UI elements ───
// Both the Spin Wheel page and Watch & Earn sub-view show progress
function _updateSpinAdProgressUI(progress, adsNeeded, spinAdsToday, spinAdDailyLimit) {
    const pct = (progress / adsNeeded) * 100;

    // 1. Watch & Earn sub-view (spin-ad-progress, spin-ad-bar)
    const progText = document.getElementById('spin-ad-progress');
    if (progText) progText.textContent = `${progress}/${adsNeeded}`;
    const progBar = document.getElementById('spin-ad-bar');
    if (progBar) progBar.style.width = `${pct}%`;

    // 2. Spin Wheel page (ads-spin-progress-text, ads-spin-progress-bar)
    const spinProgText = document.getElementById('ads-spin-progress-text');
    if (spinProgText) spinProgText.textContent = `${progress} / ${adsNeeded} ads`;
    const spinProgBar = document.getElementById('ads-spin-progress-bar');
    if (spinProgBar) spinProgBar.style.width = `${pct}%`;

    // 3. Spin Wheel page button text (ads-spin-watch-btn)
    const spinBtn = document.getElementById('ads-spin-watch-btn');
    if (spinBtn) {
        if (spinAdsToday !== undefined && spinAdDailyLimit !== undefined && spinAdsToday >= spinAdDailyLimit) {
            spinBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Daily Limit Reached';
            spinBtn.disabled = true;
            spinBtn.style.opacity = '0.5';
        } else {
            spinBtn.innerHTML = `<i class="fa-solid fa-play"></i> Watch Ad (${progress}/${adsNeeded})`;
            spinBtn.disabled = false;
            spinBtn.style.opacity = '1';
        }
    }
}

// ─── Helper: Update ALL coins ad progress UI elements ───
function _updateCoinsAdProgressUI(adsToday, dailyLimit, coinsPerAd, totalAdsWatched) {
    const pct = (adsToday / dailyLimit) * 100;

    // Today's count
    const countEl = document.getElementById('watch-earn-today-count');
    if (countEl) countEl.textContent = adsToday;

    // Daily limit
    const limitEl = document.getElementById('watch-earn-daily-limit');
    if (limitEl) limitEl.textContent = dailyLimit;

    // Total watched
    const totalEl = document.getElementById('watch-earn-total');
    if (totalEl) totalEl.textContent = totalAdsWatched;

    // Today's coins earned
    const todayCoins = document.getElementById('watch-earn-today-coins');
    if (todayCoins) todayCoins.textContent = adsToday * coinsPerAd;

    // Daily progress bar
    const bar = document.getElementById('watch-earn-daily-bar');
    if (bar) bar.style.width = `${pct}%`;

    // Button state
    if (adsToday >= dailyLimit) {
        const btn = document.getElementById('watch-earn-btn');
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            const lbl = document.getElementById('watch-earn-btn-label');
            if (lbl) lbl.textContent = 'Daily Limit Reached';
        }
    } else {
        const btn = document.getElementById('watch-earn-btn');
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            const lbl = document.getElementById('watch-earn-btn-label');
            if (lbl) lbl.textContent = `Watch Ad — Earn 🪙 ${coinsPerAd}`;
        }
    }
}

// ─── Ad Reward Callbacks (called from Android native via evaluateJavascript) ───

window._onAdRewarded = async function (adType) {
    if (!state.user) return;

    try {
        // Call Cloud Function — handles balance credit, daily limits, audit trail
        const claimFn = functions.httpsCallable('claimAdReward');
        const result = await claimFn({ adType });
        const data = result.data;

        if (!data.success) {
            showToast(data.message || 'Reward failed', 'error');
            return;
        }

        // Show success toast
        showToast(data.message, 'success');

        if (adType === 'coins') {
            // Update ALL coins ad UI elements
            _updateCoinsAdProgressUI(
                data.adsToday,
                data.dailyLimit,
                data.coinsEarned,
                data.totalAdsWatched
            );

            // Refresh wallet header
            if (typeof updateUIHeader === 'function') updateUIHeader();

        } else if (adType === 'spin') {
            // Update ALL spin ad progress UI elements (both pages)
            _updateSpinAdProgressUI(
                data.progress,
                data.adsNeeded,
                data.spinAdsToday,
                data.spinAdDailyLimit
            );

            // Refresh spin wheel if extra spin was granted
            if (data.grantedSpin && typeof loadSpinWheel === 'function') {
                loadSpinWheel();
            }
        }
    } catch (err) {
        console.error('[EarnAds] Reward error:', err);
        const msg = err.message || 'Failed to credit reward';
        // Extract Firebase error message if available
        const cleanMsg = msg.includes('claimAdReward')
            ? msg.split(': ').pop()
            : msg;
        showToast(cleanMsg, 'error');
    }
};

window._onAdError = function (msg) {
    showToast(msg || 'Ad not available right now. Try again later.', 'error');
};

window._onAdReady = function () {
    console.log('[EarnAds] Ad pre-loaded and ready');
};

// ─── Public Functions (called from HTML onclick buttons) ───

window.watchAdForCoins = function () {
    if (!_isNativeApp) {
        showToast('Ads are only available in the JeetoPlay app 📱', 'error');
        return;
    }
    if (!state.user) {
        showToast('Please log in first', 'error');
        return;
    }
    AndroidNative.showRewardedAd('coins');
};

window.watchAdForSpin = function () {
    if (!_isNativeApp) {
        showToast('Ads are only available in the JeetoPlay app 📱', 'error');
        return;
    }
    if (!state.user) {
        showToast('Please log in first', 'error');
        return;
    }
    AndroidNative.showRewardedAd('spin');
};

// ─── Load ad data when Watch & Earn sub-view opens ───

window.loadWatchEarnData = async function () {
    if (!state.user) return;
    const uid = state.user.uid;

    try {
        const [configSnap, adDataSnap] = await Promise.all([
            db.ref('platform_config/watch_earn').once('value'),
            db.ref(`users/${uid}/adData`).once('value')
        ]);

        const config = configSnap.val() || {};
        const adData = adDataSnap.val() || {};
        const coinsPerAd = config.coins_per_ad || 2;
        const dailyLimit = config.daily_limit || 5;
        const adsForSpin = config.ads_for_spin || 3;
        const spinAdDailyLimit = config.spin_ad_daily_limit || 6;

        // Daily ad count (IST) — reset check
        const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const todayCount = (adData.lastDate === todayIST) ? (adData.adsToday || 0) : 0;
        const spinAdsToday = (adData.spinLastDate === todayIST) ? (adData.spinAdsToday || 0) : 0;

        // Update coins per ad display
        const coinEl = document.getElementById('watch-earn-coins-per-ad');
        if (coinEl) coinEl.textContent = coinsPerAd;

        // Update ALL coins progress UI
        _updateCoinsAdProgressUI(todayCount, dailyLimit, coinsPerAd, adData.totalAdsWatched || 0);

        // Update ALL spin ad progress UI (both pages)
        const spinProgress = adData.spinAdProgress || 0;
        _updateSpinAdProgressUI(spinProgress, adsForSpin, spinAdsToday, spinAdDailyLimit);

    } catch (err) {
        console.error('[EarnAds] Load data error:', err);
    }
};
