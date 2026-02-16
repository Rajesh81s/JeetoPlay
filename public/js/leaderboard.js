// JeetoPlay — Leaderboard
// Auto-extracted from app.html

// ==================== LEADERBOARD ====================
let lbCurrentPeriod = 'all';
let lbCurrentCategory = 'overall';

function getUserLevel(totalWinnings) {
    const w = totalWinnings || 0;
    if (w >= 50000) return { tier: 'Diamond', class: 'lb-level-diamond', icon: '💠', level: 5 };
    if (w >= 10000) return { tier: 'Platinum', class: 'lb-level-platinum', icon: '💎', level: 4 };
    if (w >= 2000) return { tier: 'Gold', class: 'lb-level-gold', icon: '🥇', level: 3 };
    if (w >= 500) return { tier: 'Silver', class: 'lb-level-silver', icon: '🥈', level: 2 };
    return { tier: 'Bronze', class: 'lb-level-bronze', icon: '🥉', level: 1 };
}

function setLeaderboardPeriod(period, el) {
    lbCurrentPeriod = period;
    document.querySelectorAll('.lb-time-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    loadLeaderboard();
}

function setLeaderboardCategory(cat, el) {
    lbCurrentCategory = cat;
    document.querySelectorAll('.lb-subtab').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
    loadLeaderboard();
}

async function loadLeaderboard() {
    const podiumEl = document.getElementById('lb-podium');
    const listEl = document.getElementById('lb-rank-list');
    const emptyEl = document.getElementById('lb-empty');

    podiumEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); width: 100%;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
    listEl.innerHTML = '';
    emptyEl.classList.add('hidden');

    try {
        let rankedUsers = [];

        if (lbCurrentPeriod === 'all') {
            // All Time — read from user stats
            const field = lbCurrentCategory === 'esports' ? 'esportsWinnings'
                : lbCurrentCategory === 'ludo' ? 'ludoWinnings'
                    : 'totalWinnings';

            const snap = await db.ref('users').once('value');
            const usersData = snap.val() || {};

            rankedUsers = Object.entries(usersData)
                .filter(([uid, u]) => !u.isBlocked && (u.stats?.[field] || 0) > 0)
                .map(([uid, u]) => ({
                    uid,
                    name: u.fullName || 'Player',
                    winnings: u.stats?.[field] || 0,
                    matchesPlayed: u.stats?.matchesPlayed || 0,
                    matchesWon: u.stats?.matchesWon || 0,
                    isVip: !!(u.vip && u.vip.active && u.vip.expiresAt > Date.now())
                }))
                .sort((a, b) => b.winnings - a.winnings)
                .slice(0, 50);
        } else {
            // Time-based: aggregate from wallet_transactions
            const now = Date.now();
            const periodStart = lbCurrentPeriod === 'week'
                ? now - (7 * 24 * 60 * 60 * 1000)
                : now - (30 * 24 * 60 * 60 * 1000);

            const txnSnap = await db.ref('wallet_transactions').once('value');
            const allTxns = txnSnap.val() || {};
            const userWinnings = {};

            // Aggregate winnings per user within the time period
            Object.entries(allTxns).forEach(([uid, txns]) => {
                Object.values(txns).forEach(txn => {
                    if (!txn.timestamp || txn.timestamp < periodStart) return;
                    if (txn.type !== 'win' && txn.type !== 'prize' && txn.type !== 'match_win' && txn.type !== 'ludo_win') return;

                    // Category filter
                    if (lbCurrentCategory === 'esports' && txn.type === 'ludo_win') return;
                    if (lbCurrentCategory === 'ludo' && txn.type !== 'ludo_win') return;

                    const amt = Math.abs(txn.amount || 0);
                    if (!userWinnings[uid]) userWinnings[uid] = { winnings: 0, name: '' };
                    userWinnings[uid].winnings += amt;
                });
            });

            // Get user names for the aggregated UIDs
            const uids = Object.keys(userWinnings);
            for (const uid of uids) {
                try {
                    const uSnap = await db.ref('users/' + uid + '/fullName').once('value');
                    userWinnings[uid].name = uSnap.val() || 'Player';
                } catch (e) {
                    userWinnings[uid].name = 'Player';
                }
            }

            rankedUsers = Object.entries(userWinnings)
                .map(([uid, data]) => ({
                    uid,
                    name: data.name,
                    winnings: data.winnings,
                    matchesPlayed: 0,
                    matchesWon: 0
                }))
                .sort((a, b) => b.winnings - a.winnings)
                .slice(0, 50);
        }

        if (rankedUsers.length === 0) {
            podiumEl.innerHTML = '';
            emptyEl.classList.remove('hidden');
            updateMyRankDisplay(rankedUsers);
            return;
        }

        // Render podium (top 3)
        renderPodium(rankedUsers.slice(0, 3), podiumEl);

        // Render rank list (4+)
        renderRankList(rankedUsers.slice(3), listEl);

        // Update my rank
        updateMyRankDisplay(rankedUsers);

    } catch (err) {
        console.error('Leaderboard error:', err);
        podiumEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger); width: 100%;">Failed to load leaderboard</div>';
    }
}

function renderPodium(top3, container) {
    if (top3.length === 0) { container.innerHTML = ''; return; }

    // Order for display: 2nd, 1st, 3rd
    const ordered = [];
    if (top3[1]) ordered.push({ ...top3[1], rank: 2 });
    if (top3[0]) ordered.push({ ...top3[0], rank: 1 });
    if (top3[2]) ordered.push({ ...top3[2], rank: 3 });

    container.innerHTML = ordered.map(user => {
        const initial = (user.name || 'P').charAt(0).toUpperCase();
        const level = getUserLevel(user.winnings);
        const vipBadge = user.isVip && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
        return `
            <div class="lb-podium-item rank-${user.rank}">
                <div style="position: relative;">
                    <div class="lb-podium-avatar">${initial}</div>
                    <div class="lb-podium-rank-badge">${user.rank}</div>
                </div>
                <div class="lb-podium-name">${user.name}${vipBadge}</div>
                <div class="lb-podium-wins">${formatCoin(user.winnings)}</div>
                <div class="lb-podium-pedestal">
                    <span class="lb-rank-level ${level.class}" style="font-size: 0.55rem;">${level.tier}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderRankList(users, container) {
    if (users.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = users.map((user, i) => {
        const rank = i + 4;
        const initial = (user.name || 'P').charAt(0).toUpperCase();
        const level = getUserLevel(user.winnings);
        const delay = Math.min(i * 50, 500);
        const vipBadge = user.isVip && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
        return `
            <div class="lb-rank-item" style="animation-delay: ${delay}ms;">
                <div class="lb-rank-num">#${rank}</div>
                <div class="lb-rank-avatar">${initial}</div>
                <div class="lb-rank-info">
                    <div class="lb-rank-name">${user.name}${vipBadge}</div>
                    <span class="lb-rank-level ${level.class}">${level.icon} ${level.tier}</span>
                </div>
                <div class="lb-rank-winnings">${formatCoin(user.winnings)}</div>
            </div>
        `;
    }).join('');
}

function updateMyRankDisplay(rankedUsers) {
    const uid = state.user?.uid;
    if (!uid) return;

    const myIndex = rankedUsers.findIndex(u => u.uid === uid);
    const myRank = myIndex >= 0 ? myIndex + 1 : '-';

    // Get my winnings from stats or from ranked list
    let myWinnings = 0;
    let myPlayed = 0;
    let myWon = 0;
    if (myIndex >= 0) {
        myWinnings = rankedUsers[myIndex].winnings;
        myPlayed = rankedUsers[myIndex].matchesPlayed;
        myWon = rankedUsers[myIndex].matchesWon;
    } else {
        // Fallback: get from user stats
        const stats = state.userData?.stats || {};
        const field = lbCurrentCategory === 'esports' ? 'esportsWinnings'
            : lbCurrentCategory === 'ludo' ? 'ludoWinnings'
                : 'totalWinnings';
        myWinnings = stats[field] || 0;
        myPlayed = stats.matchesPlayed || 0;
        myWon = stats.matchesWon || 0;
    }

    const level = getUserLevel(myWinnings);

    // Leaderboard my-rank banner
    document.getElementById('lb-my-rank-num').textContent = '#' + myRank;
    document.getElementById('lb-my-winnings').innerHTML = formatCoin(myWinnings);
    const lbBadge = document.getElementById('lb-my-level-badge');
    lbBadge.textContent = level.icon + ' ' + level.tier;
    lbBadge.className = 'lb-rank-level ' + level.class;

    // Profile ranking card
    const profileRankNum = document.getElementById('profile-rank-num');
    const profileRankWin = document.getElementById('profile-rank-winnings');
    const profileRankPlayed = document.getElementById('profile-rank-played');
    const profileRankBadge = document.getElementById('profile-rank-badge');
    if (profileRankNum) profileRankNum.textContent = '#' + myRank;
    if (profileRankWin) profileRankWin.innerHTML = formatCoin(myWinnings);
    if (profileRankPlayed) profileRankPlayed.textContent = myPlayed;
    if (profileRankBadge) {
        profileRankBadge.textContent = level.icon + ' ' + level.tier;
        profileRankBadge.className = 'lb-rank-level ' + level.class;
    }
}

// Load my ranking for profile section
async function loadMyRanking() {
    try {
        const uid = state.user?.uid;
        if (!uid) return;

        const stats = state.userData?.stats || {};
        const myWinnings = stats.totalWinnings || 0;
        const level = getUserLevel(myWinnings);

        // Quick rank calculation
        const snap = await db.ref('users').orderByChild('stats/totalWinnings').once('value');
        let rank = 0;
        let total = 0;
        snap.forEach(child => {
            const w = child.val()?.stats?.totalWinnings || 0;
            if (w > 0) total++;
            if (w > myWinnings) rank++;
        });
        const myRank = myWinnings > 0 ? rank + 1 : '-';

        const profileRankNum = document.getElementById('profile-rank-num');
        const profileRankWin = document.getElementById('profile-rank-winnings');
        const profileRankPlayed = document.getElementById('profile-rank-played');
        const profileRankBadge = document.getElementById('profile-rank-badge');
        if (profileRankNum) profileRankNum.textContent = '#' + myRank;
        if (profileRankWin) profileRankWin.innerHTML = formatCoin(myWinnings);
        if (profileRankPlayed) profileRankPlayed.textContent = stats.matchesPlayed || 0;
        if (profileRankBadge) {
            profileRankBadge.textContent = level.icon + ' ' + level.tier;
            profileRankBadge.className = 'lb-rank-level ' + level.class;
        }
    } catch (err) {
        console.error('loadMyRanking error:', err);
    }
}

// Load wallet transactions with professional labels
