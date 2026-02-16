// JeetoPlay — VIP Premium Membership
// Premium card in Earn tab with purchase, status, and countdown

// ─── VIP Badge Utility (used across all sections) ───

/**
 * Returns premium gold VIP badge HTML.
 * @param {boolean} small — use smaller variant
 * @returns {string} HTML string or empty string
 */
window.getVipBadgeHtml = function (small = false) {
    const cls = small ? 'vip-badge vip-badge-sm' : 'vip-badge';
    return `<span class="${cls}">👑 VIP</span>`;
};

/**
 * Check if the currently logged-in user has active VIP.
 * Reads from state.userData which is kept fresh by Firebase listener.
 */
window.isCurrentUserVip = function () {
    if (!state.userData) return false;
    const vip = state.userData.vip;
    if (!vip || !vip.active) return false;
    return vip.expiresAt > Date.now();
};

/**
 * Load VIP status when Earn tab opens
 */
window.loadVipStatus = async function () {
    if (!state.user) return;

    try {
        // Load config + user VIP data in parallel
        const [configSnap, vipSnap] = await Promise.all([
            db.ref('platform_config/vip').once('value'),
            db.ref(`users/${state.user.uid}/vip`).once('value')
        ]);

        const config = configSnap.val() || {};
        const vipData = vipSnap.val() || {};

        if (config.enabled === false) {
            const section = document.getElementById('vip-section');
            if (section) section.style.display = 'none';
            return;
        }

        const section = document.getElementById('vip-section');
        if (section) section.style.display = 'block';

        renderVipCard(config, vipData);
    } catch (err) {
        console.error('[VIP] Load error:', err);
    }
};

/**
 * Render VIP card based on status
 */
function renderVipCard(config, vipData) {
    const card = document.getElementById('vip-card-content');
    if (!card) return;

    const price = config.price || 99;
    const bonusPct = config.bonusPercent || 5;
    const durationDays = config.durationDays || 30;
    const isActive = vipData.active && vipData.expiresAt && vipData.expiresAt > Date.now();

    if (isActive) {
        // ─── ACTIVE VIP ───
        const storedDuration = vipData.durationDays || durationDays;
        const daysLeft = Math.max(0, Math.ceil((vipData.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
        const progressPct = Math.round(((storedDuration - daysLeft) / storedDuration) * 100);
        const expiryDate = new Date(vipData.expiresAt).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric'
        });

        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#facc15,#f59e0b);display:flex;align-items:center;justify-content:center;font-size:1.2rem;box-shadow:0 0 16px rgba(250,204,21,0.3);">👑</div>
                <div style="flex:1;">
                    <div style="font-size:0.95rem;font-weight:700;color:#facc15;">VIP Active</div>
                    <div style="font-size:0.72rem;color:rgba(255,255,255,0.5);">Expires ${expiryDate}</div>
                </div>
                <div style="background:rgba(250,204,21,0.15);padding:4px 10px;border-radius:8px;">
                    <span style="font-size:0.8rem;font-weight:700;color:#facc15;">${daysLeft}d left</span>
                </div>
            </div>

            <!-- Progress bar -->
            <div style="background:rgba(255,255,255,0.08);border-radius:6px;height:6px;overflow:hidden;margin-bottom:14px;">
                <div style="width:${100 - progressPct}%;height:100%;background:linear-gradient(90deg,#facc15,#f59e0b);border-radius:6px;transition:width 0.5s ease;"></div>
            </div>

            <!-- Benefits -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div style="background:rgba(250,204,21,0.08);padding:10px;border-radius:10px;text-align:center;border:1px solid rgba(250,204,21,0.15);">
                    <div style="font-size:1.1rem;font-weight:700;color:#facc15;">${bonusPct}%</div>
                    <div style="font-size:0.68rem;color:rgba(255,255,255,0.5);">Deposit Bonus</div>
                </div>
                <div style="background:rgba(250,204,21,0.08);padding:10px;border-radius:10px;text-align:center;border:1px solid rgba(250,204,21,0.15);">
                    <div style="font-size:1.1rem;">👑</div>
                    <div style="font-size:0.68rem;color:rgba(255,255,255,0.5);">VIP Badge</div>
                </div>
            </div>

            ${daysLeft <= 3 ? `
                <button id="vip-purchase-btn" onclick="purchaseVipUI()" style="margin-top:14px;width:100%;padding:12px;border-radius:12px;border:2px solid rgba(250,204,21,0.4);background:transparent;color:#facc15;font-weight:700;font-size:0.9rem;cursor:pointer;transition:all 0.3s;">
                    <i class="fa-solid fa-rotate"></i> Renew for 🪙 ${price}
                </button>
            ` : ''}
        `;
    } else {
        // ─── NOT VIP ───
        card.innerHTML = `
            <div style="text-align:center;margin-bottom:14px;">
                <div style="font-size:2.5rem;margin-bottom:6px;filter:grayscale(0.3);">👑</div>
                <h4 style="color:#facc15;margin:0 0 4px;font-size:1.1rem;">Get VIP Premium</h4>
                <p style="color:rgba(255,255,255,0.5);font-size:0.78rem;margin:0;">Unlock exclusive benefits for 🪙 ${price} / ${durationDays} days</p>
            </div>

            <!-- Benefits list -->
            <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <span style="color:#10b981;font-size:0.85rem;">✓</span>
                    <span style="color:rgba(255,255,255,0.8);font-size:0.82rem;"><strong style="color:#facc15;">${bonusPct}% bonus</strong> on every deposit</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <span style="color:#10b981;font-size:0.85rem;">✓</span>
                    <span style="color:rgba(255,255,255,0.8);font-size:0.82rem;">Exclusive <strong style="color:#facc15;">VIP badge</strong></span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
                    <span style="color:#10b981;font-size:0.85rem;">✓</span>
                    <span style="color:rgba(255,255,255,0.8);font-size:0.82rem;"><strong style="color:#facc15;">Priority</strong> customer support</span>
                </div>
            </div>

            <!-- Example savings -->
            <div style="background:rgba(250,204,21,0.06);padding:10px 12px;border-radius:10px;margin-bottom:16px;border:1px solid rgba(250,204,21,0.1);">
                <p style="color:rgba(255,255,255,0.6);font-size:0.72rem;margin:0;text-align:center;">
                    💡 Deposit 🪙 500 → Get <strong style="color:#facc15;">🪙 ${Math.round(500 * bonusPct / 100)} extra</strong> = 🪙 ${500 + Math.round(500 * bonusPct / 100)} total
                </p>
            </div>

            <!-- Purchase button -->
            <button id="vip-purchase-btn" onclick="purchaseVipUI()" style="width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#facc15,#f59e0b);color:#000;font-weight:700;font-size:1rem;cursor:pointer;box-shadow:0 4px 20px rgba(250,204,21,0.3);transition:all 0.3s ease;">
                <i class="fa-solid fa-crown"></i> Get VIP — 🪙 ${price} / ${durationDays} days
            </button>
        `;
    }
}

/**
 * Purchase VIP membership
 */
window.purchaseVipUI = async function () {
    const btn = document.getElementById('vip-purchase-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    }

    try {
        const purchaseFn = functions.httpsCallable('purchaseVip');
        const result = await purchaseFn({});
        const data = result.data;

        // Show success
        if (typeof showToast === 'function') {
            showToast(data.message, 'success');
        }

        // Refresh balance header
        if (typeof updateUIHeader === 'function') {
            updateUIHeader();
        }

        // Reload VIP card
        loadVipStatus();

    } catch (err) {
        console.error('[VIP] Purchase error:', err);
        if (typeof showToast === 'function') {
            showToast(err.message || 'Purchase failed', 'error');
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-crown"></i> Get VIP — Try Again';
        }
    }
};
