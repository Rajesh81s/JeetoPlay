// JeetoPlay — Smart Notifications on Home Screen
// Contextual, dismissible notification cards shown between slider and mode toggle

const _snDismissed = new Set(); // session-only dismiss tracking

/**
 * Load and render smart notification cards on home screen
 */
window.loadSmartNotifications = async function () {
    if (!state.user) return;
    const container = document.getElementById('smart-notifications');
    if (!container) return;

    try {
        const uid = state.user.uid;

        // Fetch all needed data from Supabase in parallel
        const [profileRes, vipConfigRes] = await Promise.all([
            supa.from('profiles').select('daily_reward, spin_data, is_vip, vip_data, deposit_balance').eq('uid', uid).single(),
            supa.from('platform_config').select('value').eq('key', 'vip').single()
        ]);

        const profileData = profileRes.data || {};
        const dailyReward = profileData.daily_reward || {};
        const spinData = profileData.spin_data || {};
        const vipRaw = profileData.vip_data || {};
        const vipData = { active: profileData.is_vip, expiresAt: vipRaw.expiresAt || 0 };
        const vipConfig = vipConfigRes.data?.value || {};
        const depositBalance = parseFloat(profileData.deposit_balance) || 0;

        const cards = [];
        const now = Date.now();

        // ─── 1. Daily Reward Unclaimed ───
        if (!_snDismissed.has('daily')) {
            const todayIST = _snGetTodayIST();
            const lastClaimed = dailyReward.lastClaimedDate || '';
            if (lastClaimed !== todayIST) {
                cards.push({
                    id: 'daily',
                    icon: '🎁',
                    title: 'Daily Reward Ready!',
                    desc: 'Claim your daily bonus now',
                    action: 'Claim',
                    color: '#10b981',
                    onClick: "switchTab('earn');"
                });
            }
        }

        // ─── 2. Free Spin Available ───
        if (!_snDismissed.has('spin')) {
            const todayIST = _snGetTodayIST();
            const freeUsed = spinData.freeSpinUsedDate === todayIST;
            const extraSpins = spinData.extraSpins || 0;
            const totalAvail = (freeUsed ? 0 : 1) + extraSpins;
            if (totalAvail > 0) {
                cards.push({
                    id: 'spin',
                    icon: '🎰',
                    title: `${totalAvail} Spin${totalAvail > 1 ? 's' : ''} Available!`,
                    desc: 'Try your luck on the wheel',
                    action: 'Spin Now',
                    color: '#ec4899',
                    onClick: "switchTab('earn'); setTimeout(()=>openEarnCategory('lucky'),100);"
                });
            }
        }

        // ─── 3. VIP Expiring (≤5 days) ───
        if (!_snDismissed.has('vip-expiry')) {
            if (vipData.active && vipData.expiresAt) {
                const daysLeft = Math.ceil((vipData.expiresAt - now) / (24 * 60 * 60 * 1000));
                if (daysLeft > 0 && daysLeft <= 5) {
                    cards.push({
                        id: 'vip-expiry',
                        icon: '👑',
                        title: `VIP Expires in ${daysLeft} Day${daysLeft > 1 ? 's' : ''}`,
                        desc: 'Renew to keep your deposit bonus',
                        action: 'Renew',
                        color: '#facc15',
                        onClick: "switchTab('earn'); setTimeout(()=>openEarnCategory('vip'),100);"
                    });
                }
            }
        }

        // ─── 4. VIP Upsell (non-VIP users) ───
        if (!_snDismissed.has('vip-upsell')) {
            const isVip = vipData.active && vipData.expiresAt && vipData.expiresAt > now;
            if (!isVip && vipConfig.enabled !== false) {
                const pct = vipConfig.bonusPercent || 5;
                cards.push({
                    id: 'vip-upsell',
                    icon: '👑',
                    title: `Get ${pct}% Deposit Bonus`,
                    desc: `Go VIP for 🪙 ${vipConfig.price || 99} / ${vipConfig.durationDays || 30} days`,
                    action: 'Go VIP',
                    color: '#facc15',
                    onClick: "switchTab('earn'); setTimeout(()=>openEarnCategory('vip'),100);"
                });
            }
        }

        // ─── 5. Low Balance ───
        if (!_snDismissed.has('low-balance')) {
            if (depositBalance < 10 && depositBalance >= 0) {
                cards.push({
                    id: 'low-balance',
                    icon: '💰',
                    title: 'Balance Running Low',
                    desc: 'Add funds to keep playing',
                    action: 'Add Money',
                    color: '#f59e0b',
                    onClick: "if(typeof openDepositModal==='function') openDepositModal();"
                });
            }
        }

        // Show max 2 cards
        const visibleCards = cards.slice(0, 2);

        if (visibleCards.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = visibleCards.map(card => `
            <div id="sn-card-${card.id}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:8px;background:rgba(${_snHexToRgb(card.color)},0.08);border:1px solid rgba(${_snHexToRgb(card.color)},0.2);border-radius:14px;position:relative;animation:sn-slide-in 0.3s ease-out;">
                <div style="font-size:1.3rem;flex-shrink:0;">${card.icon}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.85rem;font-weight:700;color:${card.color};line-height:1.2;">${card.title}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${card.desc}</div>
                </div>
                <button onclick="${card.onClick}" style="padding:6px 14px;border-radius:10px;border:none;background:${card.color};color:#000;font-weight:700;font-size:0.75rem;cursor:pointer;white-space:nowrap;flex-shrink:0;">${card.action}</button>
                <button onclick="dismissSmartNotification('${card.id}')" style="position:absolute;top:4px;right:6px;background:none;border:none;color:var(--text-muted);font-size:0.7rem;cursor:pointer;padding:2px 4px;opacity:0.5;">✕</button>
            </div>
        `).join('');

    } catch (err) {
        console.error('[SmartNotifications] Error:', err);
    }
};

/**
 * Dismiss a notification card (session only)
 */
window.dismissSmartNotification = function (id) {
    _snDismissed.add(id);
    const card = document.getElementById('sn-card-' + id);
    if (card) {
        card.style.transition = 'opacity 0.2s, transform 0.2s';
        card.style.opacity = '0';
        card.style.transform = 'translateX(20px)';
        setTimeout(() => {
            card.remove();
            // Hide container if empty
            const container = document.getElementById('smart-notifications');
            if (container && container.children.length === 0) {
                container.style.display = 'none';
            }
        }, 200);
    }
};

// ─── Helpers ───

function _snGetTodayIST() {
    const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
}

function _snHexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
}
