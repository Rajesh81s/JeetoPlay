// JeetoPlay — Home & Navigation
// Auto-extracted from app.html

// --- NAVIGATION ---
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const tab = item.dataset.tab;
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.getElementById('view-' + tab).classList.remove('hidden');

        // Detach tournament real-time listener when leaving home section
        if (tab !== 'home' && typeof stopTournamentListener === 'function') stopTournamentListener();

        // Load content based on tab
        if (tab === 'home') {
            resetToGamesGrid(); // Level 1: Show games list only
        } else if (tab === 'earn') {
            loadEarnView();
        } else if (tab === 'ludo') {
            // Ludo tab removed — challenges load via home toggle (loadLudoHome)
            if (typeof loadLudoHome === 'function') loadLudoHome();
        } else if (tab === 'mygames') {
            loadMyGames();
        } else if (tab === 'leaderboard') {
            loadLeaderboard();
        } else if (tab === 'profile') {
            loadProfile();
        }
    });
});

// Open wallet from header click
window.openWalletFromHeader = function () {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-wallet').classList.remove('hidden');
    updateUIHeader(); // Refresh balance display
    loadWalletTransactions(); // Load transaction history
};

// Open Contact Us Modal
window.openContactModal = async function () {
    document.getElementById('contact-modal').classList.remove('hidden');
    const container = document.getElementById('contact-options');
    container.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">Loading...</div>';

    try {
        const { data: cfgRows } = await supa.from('platform_config').select('value').eq('key', 'contact').single();
        const contact = cfgRows?.value || {};

        container.innerHTML = '';

        // Email (mailto: works natively on all platforms — no change needed)
        if (contact.email) {
            container.innerHTML += `
                <a href="mailto:${contact.email}" class="btn btn-outline" style="display: flex; align-items: center; gap: 12px; justify-content: flex-start; text-decoration: none;">
                    <i class="fa-solid fa-envelope" style="color: #ea4335; font-size: 1.2rem;"></i>
                    <span>Email: ${contact.email}</span>
                </a>`;
        }

        // Telegram — opens in Telegram app externally
        if (contact.telegram) {
            const telegramUrl = contact.telegram.startsWith('http') ? contact.telegram : 'https://t.me/' + contact.telegram;
            container.innerHTML += `
                <div onclick="openExternalUrl('${telegramUrl}')" class="btn btn-outline" style="display: flex; align-items: center; gap: 12px; justify-content: flex-start; cursor: pointer;">
                    <i class="fa-brands fa-telegram" style="color: #0088cc; font-size: 1.2rem;"></i>
                    <span>Telegram</span>
                </div>`;
        }

        // Instagram — opens in Instagram app externally
        if (contact.instagram) {
            const instaHandle = contact.instagram.replace('@', '');
            container.innerHTML += `
                <div onclick="openExternalUrl('https://instagram.com/${instaHandle}')" class="btn btn-outline" style="display: flex; align-items: center; gap: 12px; justify-content: flex-start; cursor: pointer;">
                    <i class="fa-brands fa-instagram" style="color: #e1306c; font-size: 1.2rem;"></i>
                    <span>Instagram: @${instaHandle}</span>
                </div>`;
        }

        // WhatsApp — opens in WhatsApp app externally
        if (contact.whatsapp) {
            const waNumber = contact.whatsapp.replace(/[^0-9]/g, '');
            container.innerHTML += `
                <div onclick="openExternalUrl('https://wa.me/${waNumber}')" class="btn btn-outline" style="display: flex; align-items: center; gap: 12px; justify-content: flex-start; cursor: pointer;">
                    <i class="fa-brands fa-whatsapp" style="color: #25d366; font-size: 1.2rem;"></i>
                    <span>WhatsApp</span>
                </div>`;
        }

        // If no contact options configured
        if (!contact.email && !contact.telegram && !contact.instagram && !contact.whatsapp) {
            container.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">Contact information not available yet.</div>';
        }

    } catch (err) {
        container.innerHTML = '<div style="padding: 20px; color: var(--danger);">Failed to load contact info</div>';
    }
};

// ==========================================
//  EARN HUB & SUB-VIEW NAVIGATION
// ==========================================

// Track which earn category is currently open (on window for logout reset)
window._earnCurrentCategory = null;

async function loadEarnView() {
    if (!state.user) return;
    const uid = state.user.uid;

    // If a sub-view is already open, refresh its content and ensure DOM state
    if (window._earnCurrentCategory) {
        // Ensure DOM matches expected state (hub hidden, sub shown)
        const hub = document.getElementById('earn-hub');
        const sub = document.getElementById('earn-subview');
        if (hub) hub.classList.add('hidden');
        if (sub) sub.classList.remove('hidden');
        _loadEarnSubContent(window._earnCurrentCategory);
        return;
    }

    // Show hub, hide sub-views
    const hub = document.getElementById('earn-hub');
    const sub = document.getElementById('earn-subview');
    if (hub) hub.classList.remove('hidden');
    if (sub) sub.classList.add('hidden');

    // Load hub summary data
    try {
        const [profileRes, statsRes] = await Promise.all([
            supa.from('profiles').select('spin_data, is_vip, vip_data').eq('uid', uid).single(),
            supa.from('referral_stats').select('*').eq('uid', uid).single()
        ]);

        const spinData = profileRes.data?.spin_data || {};
        const stats = statsRes.data || {};
        const vipRaw = profileRes.data?.vip_data || {};
        const vipData = { active: profileRes.data?.is_vip, expiresAt: vipRaw.expiresAt || 0 };

        // Spin count
        const today = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
        const freeAvail = spinData.freeSpinUsedDate !== today;
        const spinsLeft = (freeAvail ? 1 : 0) + (spinData.extraSpins || 0);

        // Update hub summary
        const totalEarned = (stats.totalEarnings || 0) + (spinData.totalWon || 0);
        const hubTotal = document.getElementById('earn-hub-total');
        if (hubTotal) hubTotal.textContent = '🪙 ' + totalEarned;
        const hubSpins = document.getElementById('earn-hub-spins');
        if (hubSpins) hubSpins.textContent = spinsLeft;
        const hubRefs = document.getElementById('earn-hub-refs');
        if (hubRefs) hubRefs.textContent = stats.totalReferrals || 0;

        // Update category badges
        const luckyBadge = document.getElementById('earn-badge-lucky');
        if (luckyBadge) luckyBadge.textContent = spinsLeft + ' spin' + (spinsLeft !== 1 ? 's' : '');
        const refBadge = document.getElementById('earn-badge-ref');
        if (refBadge) refBadge.textContent = (stats.totalReferrals || 0) + ' friends';
        const vipBadge = document.getElementById('earn-badge-vip');
        if (vipBadge) {
            const isActive = vipData.active && vipData.expiresAt && vipData.expiresAt > Date.now();
            vipBadge.style.display = isActive ? 'inline-block' : 'none';
        }

        // Apply section visibility from admin config
        const { data: visRow } = await supa.from('platform_config').select('value').eq('key', 'earn_sections').single();
        const vis = visRow?.value || {};
        const visMap = {
            lucky: vis.lucky_rewards?.enabled !== false,
            vip: vis.vip_club?.enabled !== false,
            referral: vis.referral?.enabled !== false,
            ads: vis.watch_earn?.enabled === true
        };
        document.querySelectorAll('.earn-category-card[data-category]').forEach(card => {
            const cat = card.getAttribute('data-category');
            card.style.display = visMap[cat] ? '' : 'none';
        });
    } catch (err) {
        console.error('[EarnHub] Load error:', err);
    }
}

/**
 * Open a specific earn category sub-view
 */
window.openEarnCategory = function (category) {
    window._earnCurrentCategory = category;
    const hub = document.getElementById('earn-hub');
    const sub = document.getElementById('earn-subview');

    if (hub) hub.classList.add('hidden');
    if (sub) sub.classList.remove('hidden');

    // Hide all sub-views
    document.querySelectorAll('.earn-sub').forEach(el => el.classList.add('hidden'));

    // Show target sub-view
    const target = document.getElementById('earn-sub-' + category);
    if (target) target.classList.remove('hidden');

    // Load content for the selected category
    _loadEarnSubContent(category);

    // Scroll to top
    const earnView = document.getElementById('view-earn');
    if (earnView) earnView.scrollTop = 0;
};

/**
 * Load content for a specific earn sub-view
 */
async function _loadEarnSubContent(category) {
    if (!state.user) return;
    const uid = state.user.uid;

    if (category === 'lucky') {
        if (typeof loadSpinWheel === 'function') loadSpinWheel();
    } else if (category === 'vip') {
        if (typeof loadVipStatus === 'function') loadVipStatus();
    } else if (category === 'referral') {
        _loadReferralContent(uid);
    } else if (category === 'ads') {
        if (typeof loadWatchEarnData === 'function') loadWatchEarnData();
    }
}

/**
 * Load referral content (extracted from old loadEarnView)
 */
async function _loadReferralContent(uid) {
    // Load user's referral code from Supabase
    const { data: profileData } = await supa.from('profiles').select('referral_code').eq('uid', uid).single();
    const myCode = profileData?.referral_code || 'N/A';
    document.getElementById('my-referral-code').textContent = myCode;

    // Load referral stats from Supabase
    const { data: statsData } = await supa.from('referral_stats').select('*').eq('uid', uid).single();
    const stats = statsData || { total_referrals: 0, total_earnings: 0, pending_referrals: 0 };
    document.getElementById('referral-count').textContent = stats.total_referrals || 0;
    const earnedText = '🪙 ' + (stats.total_earnings || 0);
    document.getElementById('referral-earnings').textContent = earnedText;

    // Load referral config from Supabase
    const { data: cfgRow } = await supa.from('platform_config').select('value').eq('key', 'referral').single();
    const config = cfgRow?.value || {};
    const rewardAmount = config.rewardAmount || 5;
    const requiredGames = config.requiredGames || 3;
    document.getElementById('referral-reward-amount').textContent = '🪙 ' + rewardAmount;

    // Load my referrals list with PENDING/COMPLETED status
    const referralsSnap = await db.ref('referrals/' + uid).once('value');
    const listEl = document.getElementById('my-referrals-list');
    if (referralsSnap.exists()) {
        listEl.innerHTML = '';
        referralsSnap.forEach(child => {
            const ref = child.val();
            const date = ref.joinedAt ? new Date(ref.joinedAt).toLocaleDateString() : '';
            const isPending = ref.status === 'PENDING';
            const gamesCompleted = ref.gamesCompleted || 0;
            const gamesNeeded = ref.gamesRequired || requiredGames;

            const statusBadge = isPending
                ? `<span style="font-size: 0.65rem; padding: 2px 8px; border-radius: 10px; background: #ff9f43; color: #000; font-weight: 600;">⏳ PENDING</span>`
                : `<span style="font-size: 0.65rem; padding: 2px 8px; border-radius: 10px; background: var(--success); color: #fff; font-weight: 600;">✅ COMPLETED</span>`;

            const progressText = isPending
                ? `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">🎮 ${gamesCompleted}/${gamesNeeded} games played</div>`
                : '';

            const rewardText = isPending
                ? `<span style="color: #ff9f43; font-weight: 600; font-size: 0.85rem;">🪙 ${ref.rewardAmount || rewardAmount} pending</span>`
                : `<span style="color: var(--success); font-weight: 600;">+🪙 ${ref.rewardAmount || rewardAmount}</span>`;

            listEl.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border);">
                    <div>
                        <div style="font-weight: 500; display: flex; align-items: center; gap: 8px;">${ref.username || 'User'} ${statusBadge}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${date}</div>
                        ${progressText}
                    </div>
                    ${rewardText}
                </div>`;
        });
    } else {
        listEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 0.9rem;">No referrals yet. Share your code!</p>';
    }

    // Load Leaderboard
    loadReferralLeaderboard();
}

/**
 * Navigate back to the earn hub from a sub-view
 */
window.backToEarnHub = function () {
    window._earnCurrentCategory = null;
    const hub = document.getElementById('earn-hub');
    const sub = document.getElementById('earn-subview');

    if (sub) sub.classList.add('hidden');
    if (hub) {
        hub.classList.remove('hidden');
        hub.style.animation = 'none';
        hub.offsetHeight; // trigger reflow
        hub.style.animation = 'fadeSlideIn 0.3s ease';
    }

    // Refresh hub summary
    loadEarnView();
};

/**
 * Allow deep-linking to a specific earn category
 * Used by smart notifications and profile links
 */
window.switchToEarnCategory = function (category) {
    // First switch to earn tab
    if (typeof switchTab === 'function') {
        switchTab('earn');
    }
    // Then open the category
    setTimeout(() => openEarnCategory(category), 100);
};


async function loadReferralLeaderboard() {
    const podiumEl = document.getElementById('ref-podium');
    const rankListEl = document.getElementById('ref-rank-list');
    const emptyEl = document.getElementById('ref-empty');
    const myRankEl = document.getElementById('ref-my-rank');

    podiumEl.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); width: 100; font-size: 0.8rem;"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    rankListEl.innerHTML = '';
    emptyEl.classList.add('hidden');
    myRankEl.style.display = 'none';

    try {
        const { data: statsRows } = await supa.from('referral_stats')
            .select('*')
            .order('total_referrals', { ascending: false })
            .limit(15);

        if (!statsRows || statsRows.length === 0) {
            podiumEl.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        const entries = statsRows.map(r => ({ uid: r.uid, totalReferrals: r.total_referrals || 0, totalEarnings: r.total_earnings || 0 }));
        entries.sort((a, b) => (b.totalReferrals || 0) - (a.totalReferrals || 0));
        const top10 = entries.slice(0, 10);

        // Fetch only the needed user profiles from Supabase
        const uniqueUids = [...new Set(top10.map(e => e.uid))];
        const { data: profileRows } = await supa.from('profiles')
            .select('uid, full_name, username')
            .in('uid', uniqueUids);
        const usersData = {};
        (profileRows || []).forEach(p => {
            usersData[p.uid] = { fullName: p.full_name || p.username };
        });
        const getName = (uid) => usersData[uid]?.fullName || 'Player';
        const getPhoto = (uid) => null;

        // ── My Rank ──
        const myUid = state.user?.uid;
        if (myUid) {
            const myIdx = entries.findIndex(e => e.uid === myUid);
            if (myIdx >= 0) {
                const myEntry = entries[myIdx];
                myRankEl.style.display = 'block';
                document.getElementById('ref-my-rank-num').textContent = '#' + (myIdx + 1);
                document.getElementById('ref-my-count').textContent = myEntry.totalReferrals || 0;
                document.getElementById('ref-my-earned').innerHTML = '🪙 ' + (myEntry.totalEarnings || 0);
            }
        }

        // ── Podium (Top 3) ──
        const top3 = top10.slice(0, 3);
        const medalStyles = {
            0: { bg: 'linear-gradient(135deg, #FFD700, #FFA500)', border: '#FFD700', shadow: 'rgba(255,215,0,0.35)', size: 52, barH: 70 },
            1: { bg: 'linear-gradient(135deg, #C0C0C0, #A8A8A8)', border: '#C0C0C0', shadow: 'rgba(192,192,192,0.25)', size: 44, barH: 50 },
            2: { bg: 'linear-gradient(135deg, #CD7F32, #B87333)', border: '#CD7F32', shadow: 'rgba(205,127,50,0.25)', size: 40, barH: 38 }
        };

        // Display order: 2nd, 1st, 3rd
        const displayOrder = [];
        if (top3[1]) displayOrder.push({ ...top3[1], rank: 2, mi: 1 });
        if (top3[0]) displayOrder.push({ ...top3[0], rank: 1, mi: 0 });
        if (top3[2]) displayOrder.push({ ...top3[2], rank: 3, mi: 2 });

        podiumEl.innerHTML = displayOrder.map(entry => {
            const m = medalStyles[entry.mi];
            const name = getName(entry.uid);
            const initial = (name || 'P').charAt(0).toUpperCase();
            const photo = getPhoto(entry.uid);
            const isMe = entry.uid === myUid;
            const isFirst = entry.rank === 1;

            const avatarHtml = photo
                ? `<img src="${photo}" alt="${initial}" style="width:${m.size}px; height:${m.size}px; border-radius:50%; object-fit:cover; box-shadow: 0 3px 14px ${m.shadow}; border: 2.5px solid ${m.border};" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div style="width:${m.size}px; height:${m.size}px; border-radius:50%; background:${m.bg}; display:none; align-items:center; justify-content:center; font-size:${isFirst ? '1.3' : '1'}rem; font-weight:800; color:#fff; box-shadow: 0 3px 14px ${m.shadow}; border: 2.5px solid ${m.border};">${initial}</div>`
                : `<div style="width:${m.size}px; height:${m.size}px; border-radius:50%; background:${m.bg}; display:flex; align-items:center; justify-content:center; font-size:${isFirst ? '1.3' : '1'}rem; font-weight:800; color:#fff; box-shadow: 0 3px 14px ${m.shadow}; border: 2.5px solid ${m.border};">${initial}</div>`;

            return `
                <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
                    <div style="position: relative; margin-bottom: 6px;">
                        ${avatarHtml}
                        <div style="position:absolute; bottom:-5px; left:50%; transform:translateX(-50%); width:20px; height:20px; background:${m.bg}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:800; color:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.3);">${entry.rank}</div>
                    </div>
                    <div style="font-weight: 600; font-size: 0.72rem; max-width: 80px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}${isMe ? ' <span style="color:#6366f1; font-size:0.55rem;">(YOU)</span>' : ''}</div>
                    <div style="font-weight: 700; font-size: 0.78rem; color: #00ff88; margin: 2px 0;">${entry.totalReferrals || 0}</div>
                    <div style="font-size: 0.58rem; color: var(--text-muted);">referrals</div>
                    <div style="width: 80%; height: ${m.barH}px; background: linear-gradient(180deg, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.04) 100%); border-radius: 6px 6px 0 0; border-top: 2px solid ${m.border}; margin-top: 4px;"></div>
                </div>
            `;
        }).join('');

        // ── Rank List (4-10) ──
        const rest = top10.slice(3);
        if (rest.length > 0) {
            rankListEl.innerHTML = rest.map((entry, i) => {
                const rank = i + 4;
                const name = getName(entry.uid);
                const initial = (name || 'P').charAt(0).toUpperCase();
                const photo = getPhoto(entry.uid);
                const isMe = entry.uid === myUid;
                const highlight = isMe ? 'border: 1px solid rgba(99,102,241,0.4); background: rgba(99,102,241,0.05);' : 'border-bottom: 1px solid var(--border);';

                return `
                    <div style="display: flex; align-items: center; gap: 10px; padding: 9px 4px; ${highlight}; ${isMe ? 'border-radius: 8px; margin: 2px 0;' : ''}">
                        <span style="font-weight: 700; font-size: 0.82rem; color: var(--text-muted); width: 24px; text-align: center;">#${rank}</span>
                        ${photo
                            ? `<img src="${photo}" alt="${initial}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; flex-shrink:0;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                               <div style="width:30px; height:30px; border-radius:50%; background:linear-gradient(135deg,#1e293b,#334155); display:none; align-items:center; justify-content:center; font-weight:700; font-size:0.75rem; color:#fff; flex-shrink:0;">${initial}</div>`
                            : `<div style="width:30px; height:30px; border-radius:50%; background:linear-gradient(135deg,#1e293b,#334155); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.75rem; color:#fff; flex-shrink:0;">${initial}</div>`
                        }
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 600; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}${isMe ? ' <span style="font-size:0.55rem; color:#6366f1; font-weight:700;">(YOU)</span>' : ''}</div>
                            <div style="font-size: 0.62rem; color: var(--text-muted);">🪙 ${entry.totalEarnings || 0} earned</div>
                        </div>
                        <div style="font-weight: 700; font-size: 0.85rem; color: #00ff88;">${entry.totalReferrals || 0}</div>
                    </div>
                `;
            }).join('');
        }

    } catch (err) {
        console.error('Referral leaderboard error:', err);
        podiumEl.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--danger); font-size: 0.8rem;">Failed to load leaderboard</div>';
    }
}

window.copyReferralCode = function () {
    const code = document.getElementById('my-referral-code').textContent;
    if (code && code !== 'LOADING' && code !== 'N/A') {
        navigator.clipboard.writeText(code).then(() => {
            showToast('Referral code copied!', 'success');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    }
};


window.switchHomeMode = function (mode) {
    const slider = document.getElementById('toggle-slider');
    const esportsBtn = document.getElementById('toggle-esports');
    const ludoBtn = document.getElementById('toggle-ludo');
    const tourneysBtn = document.getElementById('toggle-tournaments');
    const esportsContent = document.getElementById('home-esports-content');
    const ludoContent = document.getElementById('home-ludo-content');
    const tourneysContent = document.getElementById('home-tournaments-content');

    // Reset all
    esportsBtn.style.color = 'var(--text-muted)';
    ludoBtn.style.color = 'var(--text-muted)';
    if (tourneysBtn) tourneysBtn.style.color = 'var(--text-muted)';
    esportsContent.classList.add('hidden');
    ludoContent.classList.add('hidden');
    if (tourneysContent) tourneysContent.classList.add('hidden');

    if (mode === 'esports') {
        slider.style.transform = 'translateX(0)';
        esportsBtn.style.color = 'white';
        esportsContent.classList.remove('hidden');
        loadEsportsGames();
        // Detach tournament listener when leaving tournaments section
        if (typeof stopTournamentListener === 'function') stopTournamentListener();
    } else if (mode === 'tournaments') {
        slider.style.transform = 'translateX(100%)';
        if (tourneysBtn) tourneysBtn.style.color = 'white';
        if (tourneysContent) tourneysContent.classList.remove('hidden');
        if (typeof loadUserTournaments === 'function') loadUserTournaments();
    } else if (mode === 'ludo') {
        slider.style.transform = 'translateX(200%)';
        ludoBtn.style.color = 'white';
        ludoContent.classList.remove('hidden');
        if (typeof loadChallenges === 'function') loadLudoHome();
        // Detach tournament listener when leaving tournaments section
        if (typeof stopTournamentListener === 'function') stopTournamentListener();
    }
};

// Load Ludo content for home toggle
function loadLudoHome() {
    // Auto-load Ludo King challenges (Arena removed — King is the only Ludo mode)
    if (typeof loadChallenges === 'function') loadChallenges('home-challenges-list');
}

// Toggle between game cards and Ludo King challenge section
window.selectLudoGame = function (mode) {
    const section = document.getElementById('ludo-king-section');
    if (!section) return;

    if (mode === 'king') {
        section.style.display = 'block';
        // Load challenges when opening
        if (typeof loadChallenges === 'function') loadChallenges('home-challenges-list');
        // Scroll into view
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        section.style.display = 'none';
    }
};

// Level 1: Reset to games grid (eSports HOME)
function resetToGamesGrid() {
    // Hide any match list view, show games grid
    const matchListSection = document.getElementById('esports-match-list-section');
    const gamesGrid = document.getElementById('esports-games-grid');
    if (matchListSection) matchListSection.classList.add('hidden');
    if (gamesGrid) gamesGrid.classList.remove('hidden');
    // Reload games
    loadEsportsGames();
}

// [REMOVED] loadLudoChallenges — dead code (ludo-challenges-list element no longer exists in app.html)
// Ludo challenges are now loaded exclusively through loadChallenges() in ludo.js

// Load My Games (user's joined matches)
let myGamesFilter = 'UPCOMING';

async function loadMyGames() {
    const listEl = document.getElementById('mygames-list');
    listEl.innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';

    const uid = state.user?.uid;
    if (!uid) return;

    // Supabase: get only matches this user joined with the correct status
    try {
        const { data: participantRows } = await supa.from('match_participants')
            .select('match_id')
            .eq('user_uid', uid);
        
        const myMatchIds = (participantRows || []).map(p => p.match_id);
        
        if (myMatchIds.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fa-solid fa-inbox" style="font-size: 2rem; opacity: 0.5; margin-bottom: 10px;"></i>
                    <p>No ${myGamesFilter.toLowerCase()} matches</p>
                </div>
            `;
            return;
        }

        const { data: matchRows } = await supa.from('matches')
            .select('*, match_participants(*)')
            .in('id', myMatchIds)
            .eq('status', myGamesFilter)
            .order('date_time', { ascending: myGamesFilter === 'UPCOMING' })
            .limit(50);

        const myMatches = (matchRows || []).map(m => ({
            id: m.id,
            gameId: m.game_id,
            title: m.title,
            type: m.type || 'SOLO',
            status: m.status,
            entryFee: parseFloat(m.entry_fee || 0),
            prizePool: parseFloat(m.prize_pool || 0),
            perKill: parseFloat(m.per_kill || 0),
            maxParticipants: m.max_participants || 100,
            dateTime: m.date_time,
            roomId: m.room_id,
            roomPassword: m.room_password,
            map: m.map,
            adminComment: null,
            participants: (m.match_participants || []).reduce((acc, p) => {
                acc[p.user_uid] = { ign: p.username || 'Player', username: p.username, uid: p.user_uid, bookedBy: p.booked_by || p.user_uid };
                return acc;
            }, {})
        }));

        listEl.innerHTML = '';

        if (myMatches.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fa-solid fa-inbox" style="font-size: 2rem; opacity: 0.5; margin-bottom: 10px;"></i>
                    <p>No ${myGamesFilter.toLowerCase()} matches</p>
                </div>
            `;
            return;
        }

        // Sort by dateTime (earliest first for UPCOMING, latest first for LIVE/COMPLETED)
        myMatches.sort((a, b) => {
            const dateA = new Date(a.dateTime).getTime();
            const dateB = new Date(b.dateTime).getTime();
            return myGamesFilter === 'UPCOMING' ? dateA - dateB : dateB - dateA;
        });

        myMatches.forEach(match => {
            const card = document.createElement('div');
            card.className = 'game-card';
            card.style.cursor = 'pointer';
            card.style.position = 'relative';
            card.style.overflow = 'hidden';

            const statusColor = match.status === 'LIVE' ? '#ff9500' :
                match.status === 'COMPLETED' ? 'var(--success)' : 'var(--primary)';

            const participantCount = match.participants ? Object.keys(match.participants).length : 0;

            let actionButtons = `
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); viewMatchDetails('${match.id}')" style="flex:1;">
                    <i class="fa-solid fa-info-circle"></i> Details
                </button>
            `;

            if (match.status === 'LIVE') {
                actionButtons += `
                    <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); viewRoomDetails('${match.id}')" style="flex:1;">
                        <i class="fa-solid fa-gamepad"></i> View Room
                    </button>
                `;
            } else if (match.status === 'COMPLETED') {
                actionButtons += `
                    <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); viewMatchResults('${match.id}')" style="flex:1; background:var(--success);">
                        <i class="fa-solid fa-trophy"></i> Results
                    </button>
                `;
            }

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size: 0.7rem; padding: 3px 10px; border-radius: 4px; background: ${statusColor}; color: ${match.status === 'LIVE' ? '#000' : '#fff'}; font-weight:600;">${match.status}</span>
                        <span style="font-size: 0.8rem; color: var(--text-muted);">${match.gameName || 'Game'}</span>
                    </div>
                    <span style="font-size:0.75rem; color:var(--text-muted);">
                        <i class="fa-solid fa-users"></i> ${participantCount}
                    </span>
                </div>
                <div style="display:flex; align-items:center; gap:8px; margin-bottom: 6px;">
                    <div style="font-weight: 700; font-size:1.05rem;">${match.title}</div>
                    <span style="font-size:0.65rem; color:var(--text-muted); font-family:monospace; background:var(--bg-hover); padding:2px 6px; border-radius:4px;">#${match.matchId || match.id.slice(-8)}</span>
                </div>
                <div style="display:flex; gap:16px; margin-bottom:10px; font-size:0.85rem;">
                    <span><i class="fa-solid fa-coins" style="color:var(--warning);"></i> ${match.entryFee > 0 ? '🪙 ' + match.entryFee : 'FREE'}</span>
                    <span><i class="fa-solid fa-trophy" style="color:var(--success);"></i> 🪙 ${match.prizePool || 0}</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">
                    <i class="fa-regular fa-clock"></i> ${new Date(match.dateTime).toLocaleString()}
                </div>
                ${match.adminComment?.text ? `
                <div style="padding:8px 10px; margin-bottom:10px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.25); border-radius:8px; display:flex; align-items:flex-start; gap:8px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24; font-size:0.7rem; margin-top:2px; flex-shrink:0;"></i>
                    <div style="font-size:0.75rem; color:#fbbf24; line-height:1.4; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${typeof escapeHtml === 'function' ? escapeHtml(match.adminComment.text) : match.adminComment.text}</div>
                </div>
                ` : ''}
                <div style="display:flex; gap:8px;">
                    ${actionButtons}
                </div>
            `;

            // Make card clickable
            card.onclick = () => viewMatchDetails(match.id);

            listEl.appendChild(card);
        });
    } catch(e) { console.error('[Supabase] loadMyGames error:', e); }
}

// Filter My Games
window.filterMyGames = function (status, btn) {
    myGamesFilter = status;

    // Update button styles
    document.querySelectorAll('#mygames-filters button').forEach(el => {
        el.classList.remove('active-mygames-filter', 'btn-primary');
        el.classList.add('btn-outline');
    });
    btn.classList.add('active-mygames-filter', 'btn-primary');
    btn.classList.remove('btn-outline');

    loadMyGames();
};

// Copy User ID to clipboard (kept for internal use if needed)
window.copyUserId = function () {
    const userId = state.userData?.userId;
    if (userId) {
        navigator.clipboard.writeText(userId).then(() => {
            showToast('User ID copied!');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    }
};


window.showAnnouncementHistory = async function () {
    try {
        // Get current announcement
        const currentSnap = await db.ref('announcement_bar').once('value');
        const current = currentSnap.val();

        // Get history
        const historySnap = await db.ref('announcement_history').orderByChild('createdAt').once('value');
        const historyItems = [];
        historySnap.forEach(child => {
            historyItems.push(child.val());
        });

        // Sort by createdAt descending (newest first)
        historyItems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Build history HTML
        let historyHtml = '';
        if (historyItems.length === 0 && (!current || !current.text)) {
            historyHtml = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No announcements yet</div>';
        } else {
            historyItems.forEach((item, index) => {
                const isLatest = index === 0;
                const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

                historyHtml += `
                    <div style="padding:14px 16px; border-bottom:1px solid var(--border); ${isLatest ? 'background:rgba(255,159,67,0.1);' : ''}">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                            <div style="flex:1;">
                                ${isLatest ? '<span style="font-size:0.65rem; padding:2px 6px; border-radius:4px; background:#ff9f43; color:#000; font-weight:600; margin-bottom:6px; display:inline-block;">LATEST</span>' : ''}
                                <div style="font-size:0.95rem; line-height:1.5; ${isLatest ? 'font-weight:600;' : ''}">${item.text || ''}</div>
                            </div>
                            <div style="text-align:right; font-size:0.75rem; color:var(--text-muted); white-space:nowrap;">
                                <div>${dateStr}</div>
                                <div>${timeStr}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        // Show modal
        const modalHtml = `
            <div id="announcement-history-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius:16px; max-width:400px; width:100%; max-height:80vh; overflow:hidden; display:flex; flex-direction:column; border: 2px solid #ff9f43;">
                    <div style="padding:20px; text-align:center; border-bottom:1px solid var(--border); background:linear-gradient(90deg, rgba(255,159,67,0.2), rgba(238,82,83,0.2));">
                        <div style="width:50px; height:50px; background:linear-gradient(90deg, #ff9f43, #ee5253); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;">
                            <i class="fa-solid fa-bullhorn" style="font-size:22px; color:#fff;"></i>
                        </div>
                        <h3 style="margin:0; color:#ff9f43;">📢 Announcements</h3>
                        <div style="color:var(--text-muted); font-size:0.8rem; margin-top:4px;">Rules & Updates</div>
                    </div>
                    
                    <div style="flex:1; overflow-y:auto;">
                        ${historyHtml}
                    </div>
                    
                    <div style="padding:16px; border-top:1px solid var(--border);">
                        <button onclick="document.getElementById('announcement-history-modal').remove()" style="width:100%; background:linear-gradient(90deg, #ff9f43, #ee5253); color:#fff; border:none; padding:14px; border-radius:10px; font-weight:700; font-size:1rem; cursor:pointer;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('announcement-history-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (err) {
        console.error('Load announcement history error:', err);
        showToast('Error loading announcements', 'error');
    }
};

// ═══ DETACH HOME LISTENERS (called on logout) ═══
function detachHomeListeners() {
    try {
        db.ref('announcement_bar').off('value');
        db.ref('home_slider').off('value');
        db.ref('esports_games').off('value');
        db.ref('ludo_matches').off('value');
        // Detach esports match listener if active
        if (typeof _matchListenerRef !== 'undefined' && _matchListenerRef) {
            _matchListenerRef.off('value');
        }
    } catch (e) { /* ignore */ }
    window._homeLoaded = false;
    console.log('[HOME] Listeners detached');
}

// --- DATA LOADERS ---
function loadHome() {
    // ══ GUARD: Only set up real-time listeners ONCE per session ══
    if (window._homeLoaded) {
        console.log('[HOME] Already loaded, skipping duplicate listener setup');
        return;
    }
    window._homeLoaded = true;
    console.log('[HOME] Setting up real-time listeners (first time)');

    // Load Smart Notifications
    if (typeof loadSmartNotifications === 'function') loadSmartNotifications();

    // ══ INSTANT CACHE: Show cached games immediately ══
    const cachedGames = jpCache.load('games');
    const gamesList = document.getElementById('games-list');
    if (cachedGames && gamesList) {
        gamesList.innerHTML = '';
        cachedGames.forEach(g => {
            const el = document.createElement('div');
            el.className = 'game-card flex items-center gap-4';
            el.style.cursor = 'pointer';
            el.onclick = () => navigateToGameMatches(g.id, g.name, g.icon);
            el.innerHTML = `
                <img src="${g.icon}" width="50" height="50" style="width:50px; height:50px; border-radius:10px; object-fit:cover;" loading="lazy" onerror="this.src='/assets/coin.svg'">
                <div>
                    <h4>${g.name}</h4>
                    <p class="text-muted text-sm">Play & Earn</p>
                </div>
                <i class="fa-solid fa-chevron-right" style="margin-left:auto; color:var(--text-muted);"></i>
            `;
            gamesList.appendChild(el);
        });
        console.log('[CACHE] Displayed', cachedGames.length, 'cached games instantly');
    } else if (gamesList) {
        // No cache — show skeleton placeholders
        gamesList.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            gamesList.innerHTML += `
                <div class="skeleton-game-card">
                    <div class="skeleton skeleton-game-icon"></div>
                    <div class="skeleton-game-info">
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text-sm"></div>
                    </div>
                </div>
            `;
        }
    }

    // ══ INSTANT CACHE: Show cached slider or skeleton ══
    const cachedSlider = jpCache.load('slider');
    const sliderDivInit = document.getElementById('slider-track');
    const dotsDivInit = document.getElementById('slider-dots');
    if (cachedSlider && cachedSlider.length > 0 && sliderDivInit) {
        sliderDivInit.innerHTML = '';
        if (dotsDivInit) dotsDivInit.innerHTML = '';
        cachedSlider.forEach((slide, idx) => {
            const div = document.createElement('div');
            div.className = 'slide';
            const img = document.createElement('img');
            img.src = slide.imageUrl;
            img.alt = 'Banner ' + (idx + 1);
            img.loading = idx === 0 ? 'eager' : 'lazy';
            img.onerror = () => { img.style.display = 'none'; };
            div.appendChild(img);
            if (slide.linkUrl) {
                div.style.cursor = 'pointer';
                div.onclick = () => openExternalUrl(slide.linkUrl);
            }
            sliderDivInit.appendChild(div);
            if (dotsDivInit) {
                const dot = document.createElement('button');
                dot.className = 'slider-dot' + (idx === 0 ? ' active' : '');
                dotsDivInit.appendChild(dot);
            }
        });
        console.log('[CACHE] Displayed', cachedSlider.length, 'cached slider images instantly');
    } else if (sliderDivInit && !sliderDivInit.hasChildNodes()) {
        sliderDivInit.innerHTML = '<div class="slide"><div class="skeleton skeleton-slider" style="margin:0; height:100%;"></div></div>';
        if (dotsDivInit) dotsDivInit.innerHTML = '';
    }

    // Load Announcement Bar
    // Supabase: announcement bar
    supa.from('announcements').select('*').eq('is_active', true).limit(1).then(({ data }) => {
        const announcement = data && data[0];
        if (announcement) {
            document.getElementById('announcement-bar').classList.remove('hidden');
            document.getElementById('announcement-text').innerText = announcement.text || '';
        } else {
            document.getElementById('announcement-bar').classList.add('hidden');
        }
    }).catch(() => {});

    // Load Home Slider
    let sliderInterval = null;
    supa.from('slider_images').select('*').order('sort_order', { ascending: true }).then(({ data: sliderRows }) => {
        const sliderDiv = document.getElementById('slider-track');
        const dotsDiv = document.getElementById('slider-dots');
        sliderDiv.innerHTML = '';
        dotsDiv.innerHTML = '';

        // Clear previous interval to prevent leak
        if (sliderInterval) {
            clearInterval(sliderInterval);
            sliderInterval = null;
        }

        if (sliderRows && sliderRows.length > 0) {
            const slides = sliderRows.map(s => ({
                imageUrl: s.image_url,
                linkUrl: s.link_url || '',
                order: s.sort_order || 0
            }));

            // Sort by order if available
            slides.sort((a, b) => (a.order || 0) - (b.order || 0));

            if (slides.length === 0) return;

            // ══ CACHE: Save slider data for instant display on next app open ══
            jpCache.save('slider', slides.map(s => ({
                imageUrl: s.imageUrl,
                linkUrl: s.linkUrl || s.link || '',
                order: s.order || 0
            })));

            slides.forEach((slide, idx) => {
                const div = document.createElement('div');
                div.className = 'slide';

                // Use img element for better error handling
                const img = document.createElement('img');
                img.src = slide.imageUrl;
                img.alt = 'Banner ' + (idx + 1);
                img.loading = 'lazy';
                img.onerror = () => {
                    img.style.display = 'none';
                    const fallback = document.createElement('div');
                    fallback.className = 'slide-fallback';
                    fallback.innerHTML = '<i class="fa-solid fa-image"></i>';
                    div.appendChild(fallback);
                };
                div.appendChild(img);

                // Backwards compat: support both linkUrl and link
                const linkUrl = slide.linkUrl || slide.link || '';
                if (linkUrl) {
                    div.style.cursor = 'pointer';
                    div.onclick = (e) => {
                        // Don't open link if user was swiping
                        // Use openExternalUrl to open in external app/browser (not inside WebView)
                        if (!sliderSwiped) openExternalUrl(linkUrl);
                    };
                }
                sliderDiv.appendChild(div);

                // Create dot
                const dot = document.createElement('button');
                dot.className = 'slider-dot' + (idx === 0 ? ' active' : '');
                dot.onclick = () => goToSlide(idx);
                dotsDiv.appendChild(dot);
            });

            // Slider logic
            let currentSlide = 0;
            let sliderSwiped = false;
            const totalSlides = slides.length;

            function goToSlide(index) {
                currentSlide = index;
                sliderDiv.style.transform = `translateX(-${currentSlide * 100}%)`;
                // Update dots
                dotsDiv.querySelectorAll('.slider-dot').forEach((d, i) => {
                    d.classList.toggle('active', i === currentSlide);
                });
            }

            // Auto-slide with proper cleanup
            if (totalSlides > 1) {
                sliderInterval = setInterval(() => {
                    goToSlide((currentSlide + 1) % totalSlides);
                }, 4000);
            }

            // Touch/swipe support
            let touchStartX = 0;
            let touchDiff = 0;
            let isDragging = false;

            sliderDiv.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                isDragging = true;
                sliderSwiped = false;
                sliderDiv.classList.add('dragging');
                // Pause auto-slide while touching
                if (sliderInterval) clearInterval(sliderInterval);
            }, { passive: true });

            sliderDiv.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                touchDiff = e.touches[0].clientX - touchStartX;
                const offset = -(currentSlide * 100) + (touchDiff / sliderDiv.offsetWidth * 100);
                sliderDiv.style.transform = `translateX(${offset}%)`;
            }, { passive: true });

            sliderDiv.addEventListener('touchend', () => {
                isDragging = false;
                sliderDiv.classList.remove('dragging');

                const threshold = sliderDiv.offsetWidth * 0.2;
                if (Math.abs(touchDiff) > threshold) {
                    sliderSwiped = true;
                    if (touchDiff > 0 && currentSlide > 0) {
                        goToSlide(currentSlide - 1);
                    } else if (touchDiff < 0 && currentSlide < totalSlides - 1) {
                        goToSlide(currentSlide + 1);
                    } else {
                        goToSlide(currentSlide);
                    }
                } else {
                    goToSlide(currentSlide);
                }

                touchDiff = 0;

                // Resume auto-slide
                if (totalSlides > 1) {
                    sliderInterval = setInterval(() => {
                        goToSlide((currentSlide + 1) % totalSlides);
                    }, 4000);
                }

                // Reset swiped flag after a tick so click handler can check it
                setTimeout(() => { sliderSwiped = false; }, 50);
            }, { passive: true });
        }
    });

    // Load Esports Games
    supa.from('games').select('*').eq('is_enabled', true).order('sort_order').then(({ data: gameRows, error: gErr }) => {
        const snap = { exists: () => !gErr && gameRows && gameRows.length > 0, forEach: (cb) => (gameRows || []).forEach((g, i) => cb({ val: () => ({ name: g.name, icon: g.icon, isEnabled: true }), key: g.id })) };
        const list = document.getElementById('games-list');
        if (!list) return; // Guard against null element
        list.innerHTML = '';

        if (!snap.exists()) {
            list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No games available</div>';
            jpCache.save('games', []);
            return;
        }

        const gamesForCache = [];
        snap.forEach(child => {
            const game = child.val();
            const gameId = child.key;
            // Only show enabled games
            if (game.isEnabled === false) return;

            // Save for cache
            gamesForCache.push({ id: gameId, name: game.name, icon: game.icon });

            const el = document.createElement('div');
            el.className = 'game-card flex items-center gap-4';
            el.style.cursor = 'pointer';
            el.onclick = () => navigateToGameMatches(gameId, game.name, game.icon);
            el.innerHTML = `
                <img src="${game.icon}" width="50" height="50" style="width:50px; height:50px; border-radius:10px; object-fit:cover;" loading="lazy" onerror="this.src='/assets/coin.svg'">
                <div>
                    <h4>${game.name}</h4>
                    <p class="text-muted text-sm">Play & Earn</p>
                </div>
                <i class="fa-solid fa-chevron-right" style="margin-left:auto; color:var(--text-muted);"></i>
            `;
            list.appendChild(el);
        });

        // ══ CACHE: Save games for instant display on next app open ══
        jpCache.save('games', gamesForCache);
    });
}

// Navigate to game-specific matches
function navigateToGameMatches(gameId, gameName, gameIcon) {
    state.selectedGameId = gameId;

    // Update game header
    document.getElementById('selected-game-name').textContent = gameName;
    document.getElementById('selected-game-icon').src = gameIcon;

    // Show game-specific UI (game header + filters + mode selector)
    document.getElementById('esports-game-header').classList.remove('hidden');
    document.getElementById('match-filters').classList.remove('hidden');
    document.getElementById('mode-selector').classList.remove('hidden');

    // Hide home UI (all-games header, games grid)
    document.getElementById('all-games-header').classList.add('hidden');
    document.getElementById('esports-games-grid').style.display = 'none';

    // Hide slider and toggle when viewing a game
    document.getElementById('home-slider').style.display = 'none';
    document.getElementById('mode-toggle').style.display = 'none';
    document.getElementById('announcement-bar').style.display = 'none';
    document.getElementById('smart-notifications').style.display = 'none';

    loadMatchesList();
}

function clearGameFilter() {
    state.selectedGameId = null;

    // Hide game-specific UI and reset mode filter
    document.getElementById('esports-game-header').classList.add('hidden');
    document.getElementById('match-filters').classList.add('hidden');
    document.getElementById('mode-selector').classList.add('hidden');
    // Reset mode filter to 'ALL' for next game
    modeFilter = 'ALL';
    document.querySelectorAll('#mode-selector .mode-btn').forEach(el => el.classList.remove('active-mode'));
    document.querySelector('#mode-selector .mode-btn:first-child').classList.add('active-mode');

    // Show home UI
    document.getElementById('all-games-header').classList.remove('hidden');
    document.getElementById('esports-games-grid').style.display = 'grid';
    document.getElementById('home-slider').style.display = 'block';
    document.getElementById('mode-toggle').style.display = 'flex';

    // Restore announcement bar if it has content
    const announcementBar = document.getElementById('announcement-bar');
    if (announcementBar.querySelector('#announcement-text').textContent.trim()) {
        announcementBar.style.display = 'flex';
    }

    // Refresh smart notifications
    if (typeof loadSmartNotifications === 'function') loadSmartNotifications();

    // Clear matches list
    document.getElementById('matches-list').innerHTML = '';
    loadEsportsGames();
}

