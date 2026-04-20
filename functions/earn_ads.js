/**
 * earn_ads.js — Cloud Function for Watch & Earn ad rewards
 * Exports: claimAdReward
 *
 * Handles two ad reward types:
 *   - "coins" → credits depositBalance + tracks daily limit
 *   - "spin"  → tracks progress toward free extra spin
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertNotBanned
} = require('./helpers');

/**
 * Get today's date string in IST
 */
function getTodayIST() {
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return istDate.toISOString().split('T')[0];
}

// ─── User: Claim Ad Reward ─────────────────────────────────

exports.claimAdReward = onCall(async (request) => {
    const uid = assertAuth(request);
    const userData = await assertNotBanned(uid);

    const adType = request.data?.adType;
    if (!adType || !['coins', 'spin'].includes(adType)) {
        throw new HttpsError('invalid-argument', 'Invalid ad type');
    }

    // Load Watch & Earn config
    const configSnap = await db.ref('platform_config/watch_earn').once('value');
    const config = configSnap.val() || {};

    // Check if Watch & Earn is enabled
    const sectionSnap = await db.ref('platform_config/earn_sections/watch_earn/enabled').once('value');
    if (sectionSnap.val() !== true) {
        throw new HttpsError('failed-precondition', 'Watch & Earn is currently disabled');
    }

    const today = getTodayIST();

    if (adType === 'coins') {
        // ── Watch & Earn: credit coins to deposit balance ──
        const coinsPerAd = config.coins_per_ad || 2;
        const dailyLimit = config.daily_limit || 5;

        // Atomic: check daily limit + increment + credit balance
        const adRef = db.ref(`users/${uid}/adData`);
        const adTxn = await adRef.transaction(current => {
            if (!current) current = {};

            // Reset daily count if new day
            const todayCount = (current.lastDate === today) ? (current.adsToday || 0) : 0;

            if (todayCount >= dailyLimit) {
                return; // Abort — limit reached
            }

            current.adsToday = todayCount + 1;
            current.lastDate = today;
            current.totalAdsWatched = (current.totalAdsWatched || 0) + 1;
            return current;
        }, undefined, false);

        if (!adTxn.committed) {
            throw new HttpsError('resource-exhausted',
                'Daily ad limit reached! Come back tomorrow 🕐');
        }

        // Credit coins to DEPOSIT balance
        const balTxn = await db.ref(`users/${uid}`).transaction(user => {
            if (!user) return null;
            user.depositBalance = (user.depositBalance || 0) + coinsPerAd;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        }, undefined, false);

        if (!balTxn.committed) {
            // Rollback ad tracking
            await adRef.transaction(current => {
                if (!current) return current;
                current.adsToday = Math.max(0, (current.adsToday || 1) - 1);
                current.totalAdsWatched = Math.max(0, (current.totalAdsWatched || 1) - 1);
                return current;
            });
            throw new HttpsError('internal', 'Failed to credit reward — please try again');
        }

        // Record wallet transaction
        const txnKey = db.ref('wallet_transactions').push().key;
        await db.ref(`wallet_transactions/${txnKey}`).set({
            userId: uid,
            userName: userData.fullName || userData.username || 'User',
            amount: coinsPerAd,
            type: 'CREDIT',
            isCredit: true,
            reason: 'Watch & Earn',
            description: `Ad reward — earned 🪙 ${coinsPerAd}`,
            walletType: 'DEPOSIT',
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // Get updated counts for response
        const updatedAd = adTxn.snapshot.val() || {};
        const remaining = dailyLimit - (updatedAd.adsToday || 0);

        functions.logger.info(`[claimAdReward] ${uid} earned ${coinsPerAd} coins (${updatedAd.adsToday}/${dailyLimit} today)`);

        return {
            success: true,
            adType: 'coins',
            coinsEarned: coinsPerAd,
            adsToday: updatedAd.adsToday || 0,
            dailyLimit,
            remaining,
            totalAdsWatched: updatedAd.totalAdsWatched || 0,
            message: `+🪙 ${coinsPerAd} earned! (${remaining} ads left today)`
        };

    } else if (adType === 'spin') {
        // ── Ads for Spin: track progress toward free extra spin ──
        const adsNeeded = config.ads_for_spin || 3;
        const spinAdDailyLimit = config.spin_ad_daily_limit || 6;

        let grantedSpin = false;
        let newProgress = 0;

        // Atomic: check daily limit + increment progress + grant spin if threshold
        const adRef = db.ref(`users/${uid}/adData`);
        const txn = await adRef.transaction(current => {
            if (!current) current = {};

            // Check daily limit for spin ads
            const todaySpinCount = (current.spinLastDate === today) ? (current.spinAdsToday || 0) : 0;
            if (todaySpinCount >= spinAdDailyLimit) {
                return; // Abort — daily spin ad limit reached
            }

            // Track daily spin ad count
            current.spinAdsToday = todaySpinCount + 1;
            current.spinLastDate = today;

            // Track progress toward spin
            let progress = (current.spinAdProgress || 0) + 1;

            if (progress >= adsNeeded) {
                current.spinAdProgress = 0;
                grantedSpin = true;
                newProgress = 0;
            } else {
                current.spinAdProgress = progress;
                newProgress = progress;
            }
            return current;
        }, undefined, false);

        if (!txn.committed) {
            throw new HttpsError('resource-exhausted',
                'Daily spin ad limit reached! Come back tomorrow 🕐');
        }

        // If threshold reached, grant extra spin
        if (grantedSpin) {
            await db.ref(`users/${uid}/spinData/extraSpins`).transaction(
                current => (current || 0) + 1
            );
            functions.logger.info(`[claimAdReward] ${uid} earned extra spin via ads`);
        }

        const updatedAd = txn.snapshot.val() || {};
        const spinAdsRemaining = spinAdDailyLimit - (updatedAd.spinAdsToday || 0);

        return {
            success: true,
            adType: 'spin',
            progress: newProgress,
            adsNeeded,
            grantedSpin,
            spinAdsToday: updatedAd.spinAdsToday || 0,
            spinAdDailyLimit,
            spinAdsRemaining,
            message: grantedSpin
                ? '🎰 +1 Extra Spin earned!'
                : `Ad ${newProgress}/${adsNeeded} watched. Keep going! 🎬`
        };
    }
});
