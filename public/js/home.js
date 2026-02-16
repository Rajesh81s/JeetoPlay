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

        // Load content based on tab
        if (tab === 'home') {
            resetToGamesGrid(); // Level 1: Show games list only
        } else if (tab === 'earn') {
            loadEarnView();
        } else if (tab === 'ludo') {
            loadLudoChallenges();
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
        const snap = await db.ref('platform_config/contact').once('value');
        const contact = snap.val() || {};

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
//  REFERRAL / EARN VIEW FUNCTIONS
// ==========================================

async function loadEarnView() {
    if (!state.user) return;
    const uid = state.user.uid;

    // Load spin wheel
    if (typeof loadSpinWheel === 'function') loadSpinWheel();

    // Load VIP status
    if (typeof loadVipStatus === 'function') loadVipStatus();

    // Load user's referral code
    const userSnap = await db.ref('users/' + uid + '/referralCode').once('value');
    const myCode = userSnap.val() || 'N/A';
    document.getElementById('my-referral-code').textContent = myCode;

    // Load referral stats
    const statsSnap = await db.ref('referral_stats/' + uid).once('value');
    const stats = statsSnap.val() || { totalReferrals: 0, totalEarnings: 0, pendingReferrals: 0 };
    document.getElementById('referral-count').textContent = stats.totalReferrals || 0;
    const pendingCount = stats.pendingReferrals || 0;
    const earnedText = '🪙 ' + (stats.totalEarnings || 0);
    document.getElementById('referral-earnings').textContent = earnedText;

    // Load referral reward amount + required games from config
    const configSnap = await db.ref('platform_config/referral').once('value');
    const config = configSnap.val() || {};
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

async function loadReferralLeaderboard() {
    const leaderboardEl = document.getElementById('referral-leaderboard');
    try {
        const statsSnap = await db.ref('referral_stats').orderByChild('totalReferrals').limitToLast(10).once('value');

        if (!statsSnap.exists()) {
            leaderboardEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No referrers yet. Be the first!</p>';
            return;
        }

        const entries = [];
        statsSnap.forEach(child => {
            entries.push({ uid: child.key, ...child.val() });
        });
        entries.sort((a, b) => (b.totalReferrals || 0) - (a.totalReferrals || 0));

        leaderboardEl.innerHTML = '';
        let rank = 1;
        for (const entry of entries.slice(0, 10)) {
            const userSnap = await db.ref('users/' + entry.uid + '/fullName').once('value');
            const name = userSnap.val() || 'User';
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

            leaderboardEl.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 1.2rem; width: 28px; text-align: center;">${medal}</span>
                        <span style="font-weight: 500;">${name}</span>
                    </div>
                    <span style="color: var(--primary); font-weight: 600;">${entry.totalReferrals || 0} referrals</span>
                </div>`;
            rank++;
        }
    } catch (err) {
        leaderboardEl.innerHTML = '<p style="color: var(--danger); text-align: center;">Failed to load leaderboard</p>';
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
    } else if (mode === 'ludo') {
        slider.style.transform = 'translateX(100%)';
        ludoBtn.style.color = 'white';
        ludoContent.classList.remove('hidden');
        loadLudoHome();
    } else if (mode === 'tournaments') {
        slider.style.transform = 'translateX(200%)';
        if (tourneysBtn) tourneysBtn.style.color = 'white';
        if (tourneysContent) tourneysContent.classList.remove('hidden');
        if (typeof loadUserTournaments === 'function') loadUserTournaments();
    }
};

// Load Ludo content for home toggle
function loadLudoHome() {
    loadChallenges('home-challenges-list');
}

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

// Load Ludo challenges for dedicated Ludo tab
function loadLudoChallenges() {
    const list = document.getElementById('ludo-challenges-list');
    const myActiveDiv = document.getElementById('ludo-my-challenge');

    db.ref('ludo_matches').on('value', snap => {
        let myActive = null;
        list.innerHTML = '';

        snap.forEach(child => {
            const match = child.val();
            match.id = child.key;

            // Check if this is user's active challenge
            if (match.createdBy === state.user?.uid && match.status === 'OPEN') {
                myActive = match;
            } else if (match.status === 'OPEN' && match.createdBy !== state.user?.uid) {
                // Show open challenges from others
                const card = document.createElement('div');
                card.className = 'game-card';
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600;">🪙 ${match.amount} Challenge</div>
                            <div class="text-muted" style="font-size: 0.8rem;">by ${match.creatorName || 'Player'}</div>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="acceptChallenge('${match.id}')">Accept</button>
                    </div>
                `;
                list.appendChild(card);
            }
        });

        // Show my active challenge
        if (myActiveDiv) {
            if (myActive) {
                myActiveDiv.innerHTML = `
                    <div class="game-card" style="border: 2px solid var(--primary);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600; color: var(--primary);">🪙 ${myActive.amount} Challenge</div>
                                <div class="text-muted" style="font-size: 0.8rem;">Waiting for opponent...</div>
                            </div>
                            <button class="btn btn-danger btn-sm" onclick="cancelMyChallenge('${myActive.id}')">Cancel</button>
                        </div>
                    </div>
                `;
            } else {
                myActiveDiv.innerHTML = '<div class="text-muted" style="font-size: 0.9rem;">No active challenge</div>';
            }
        }

        if (list.innerHTML === '') {
            list.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No open challenges</div>';
        }
    });
}

// Load My Games (user's joined matches)
let myGamesFilter = 'UPCOMING';

function loadMyGames() {
    const listEl = document.getElementById('mygames-list');
    listEl.innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';

    const uid = state.user?.uid;
    if (!uid) return;

    db.ref('esports_matches').once('value', snap => {
        const myMatches = [];

        snap.forEach(child => {
            const match = child.val();
            match.id = child.key;

            // Check if user is a participant (works for both legacy and slot-based bookings)
            if (hasUserJoinedMatch(match.participants, uid)) {
                if (match.status === myGamesFilter) {
                    myMatches.push(match);
                }
            }
        });

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
                <div style="font-weight: 700; margin-bottom: 6px; font-size:1.05rem;">${match.title}</div>
                <div style="display:flex; gap:16px; margin-bottom:10px; font-size:0.85rem;">
                    <span><i class="fa-solid fa-coins" style="color:var(--warning);"></i> 🪙 ${match.entryFee || 0}</span>
                    <span><i class="fa-solid fa-trophy" style="color:var(--success);"></i> 🪙 ${match.prizePool || 0}</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">
                    <i class="fa-regular fa-clock"></i> ${new Date(match.dateTime).toLocaleString()}
                </div>
                <div style="display:flex; gap:8px;">
                    ${actionButtons}
                </div>
            `;

            // Make card clickable
            card.onclick = () => viewMatchDetails(match.id);

            listEl.appendChild(card);
        });
    });
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

// --- DATA LOADERS (Placeholders for logic) ---
function loadHome() {
    // Load Smart Notifications
    if (typeof loadSmartNotifications === 'function') loadSmartNotifications();

    // Load Announcement Bar
    db.ref('announcement_bar').on('value', snap => {
        const announcement = snap.val();
        if (announcement && announcement.isActive) {
            document.getElementById('announcement-bar').classList.remove('hidden');
            document.getElementById('announcement-text').innerText = announcement.text || '';
        } else {
            document.getElementById('announcement-bar').classList.add('hidden');
        }
    });

    // Load Home Slider
    let sliderInterval = null;
    db.ref('home_slider').on('value', snap => {
        const sliderDiv = document.getElementById('slider-track');
        const dotsDiv = document.getElementById('slider-dots');
        sliderDiv.innerHTML = '';
        dotsDiv.innerHTML = '';

        // Clear previous interval to prevent leak
        if (sliderInterval) {
            clearInterval(sliderInterval);
            sliderInterval = null;
        }

        if (snap.exists()) {
            const slides = [];
            snap.forEach(child => {
                slides.push(child.val());
            });

            // Sort by order if available
            slides.sort((a, b) => (a.order || 0) - (b.order || 0));

            if (slides.length === 0) return;

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
    db.ref('esports_games').on('value', snap => {
        const list = document.getElementById('games-list');
        if (!list) return; // Guard against null element
        list.innerHTML = '';

        if (!snap.exists()) {
            list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No games available</div>';
            return;
        }

        snap.forEach(child => {
            const game = child.val();
            const gameId = child.key;
            // Only show enabled games
            if (game.isEnabled === false) return;

            const el = document.createElement('div');
            el.className = 'game-card flex items-center gap-4';
            el.style.cursor = 'pointer';
            el.onclick = () => navigateToGameMatches(gameId, game.name, game.icon);
            el.innerHTML = `
        <img src="${game.icon}" style="width:50px; height:50px; border-radius:10px; object-fit:cover;">
        <div>
            <h4>${game.name}</h4>
            <p class="text-muted text-sm">Play & Earn</p>
        </div>
        <i class="fa-solid fa-chevron-right" style="margin-left:auto; color:var(--text-muted);"></i>
    `;
            list.appendChild(el);
        });
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

