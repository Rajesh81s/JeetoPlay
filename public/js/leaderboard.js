// JeetoPlay — Leaderboard (Premium)

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

    // Update category hint
    const hintEl = document.getElementById('lb-hint-text');
    if (hintEl) {
        const hints = {
            overall: 'All game earnings combined',
            esports: 'eSports matches + Tournament prizes',
            ludo: 'Ludo King P2P earnings'
        };
        hintEl.textContent = hints[cat] || '';
    }

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
            // All Time — read from user stats (fast + reliable)
            const field = lbCurrentCategory === 'esports' ? 'esportsWinnings'
                : lbCurrentCategory === 'ludo' ? 'ludoWinnings'
                    : 'totalWinnings';

            const snap = await db.ref('users').once('value');
            const usersData = snap.val() || {};

            rankedUsers = Object.entries(usersData)
                .filter(([uid, u]) => (u.stats?.[field] || 0) > 0)
                .map(([uid, u]) => ({
                    uid,
                    name: u.fullName || 'Player',
                    photoURL: u.photoURL || null,
                    winnings: u.stats?.[field] || 0,
                    matchesPlayed: u.stats?.matchesPlayed || 0,
                    matchesWon: u.stats?.matchesWon || 0,
                    isVip: !!(u.vip && u.vip.active && u.vip.expiresAt > Date.now())
                }))
                .sort((a, b) => b.winnings - a.winnings)
                .slice(0, 50);
        } else {
            // Time-based: aggregate from wallet_transactions with correct type matching
            const now = Date.now();
            const periodStart = lbCurrentPeriod === 'week'
                ? now - (7 * 24 * 60 * 60 * 1000)
                : now - (30 * 24 * 60 * 60 * 1000);

            const txnSnap = await db.ref('wallet_transactions')
                .orderByChild('timestamp')
                .startAt(periodStart)
                .once('value');
            const allTxns = txnSnap.val() || {};
            const userWinnings = {};

            // Aggregate winnings per user within the time period
            Object.values(allTxns).forEach(txn => {
                if (!txn.isCredit || !txn.userId) return;
                if (!txn.timestamp || txn.timestamp < periodStart) return;

                const uid = txn.userId;

                // ── Category filter ──
                if (lbCurrentCategory === 'esports') {
                    // eSports + Tournaments: matchId OR TOURNAMENT_PRIZE
                    const isEsports = !!txn.matchId && (txn.type === 'MATCH_WINNING' || txn.type === 'REWARD_ADJUSTMENT');
                    const isTournament = txn.type === 'TOURNAMENT_PRIZE';
                    if (!isEsports && !isTournament) return;
                } else if (lbCurrentCategory === 'ludo') {
                    // Ludo P2P + Ludo Arena: any txn with ludoMatchId, ludoAIMatchId, or ludoPvPMatchId
                    const isLudo = !!(txn.ludoMatchId || txn.ludoAIMatchId || txn.ludoPvPMatchId);
                    if (!isLudo) return;
                    // Exclude refunds
                    const reason = (txn.reason || '').toLowerCase();
                    if (reason.includes('refund') || reason.includes('cancel')) return;
                } else {
                    // Overall: any game winning (exclude admin credits, deposits, refunds, etc.)
                    const isGameWin = !!txn.matchId || !!txn.ludoMatchId || !!txn.ludoAIMatchId || !!txn.ludoPvPMatchId || txn.type === 'TOURNAMENT_PRIZE';
                    if (!isGameWin) return;
                    // Exclude refunds
                    const reason = (txn.reason || '').toLowerCase();
                    if (reason.includes('refund') || reason.includes('cancel')) return;
                }

                const amt = Math.abs(txn.amount || 0);
                if (amt <= 0) return;
                if (!userWinnings[uid]) userWinnings[uid] = { winnings: 0, uid };
                userWinnings[uid].winnings += amt;
            });

            // Get user names + VIP status for the aggregated UIDs
            const uids = Object.keys(userWinnings);
            const userCache = {};
            if (uids.length > 0) {
                // Fetch only needed users instead of entire collection
                const userSnaps = await Promise.all(
                    uids.map(uid => db.ref('users/' + uid).once('value'))
                );
                userSnaps.forEach(uSnap => {
                    if (!uSnap.exists()) return;
                    const uid = uSnap.key;
                    const u = uSnap.val();
                    userCache[uid] = {
                        name: u.fullName || 'Player',
                        photoURL: u.photoURL || null,
                        isVip: !!(u.vip && u.vip.active && u.vip.expiresAt > Date.now()),
                        matchesPlayed: u.stats?.matchesPlayed || 0,
                        matchesWon: u.stats?.matchesWon || 0
                    };
                });
            }

            rankedUsers = Object.values(userWinnings)
                .map(d => ({
                    uid: d.uid,
                    name: userCache[d.uid]?.name || 'Player',
                    photoURL: userCache[d.uid]?.photoURL || null,
                    winnings: d.winnings,
                    matchesPlayed: userCache[d.uid]?.matchesPlayed || 0,
                    matchesWon: userCache[d.uid]?.matchesWon || 0,
                    isVip: userCache[d.uid]?.isVip || false
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

    const medalColors = {
        1: { bg: 'linear-gradient(135deg, #FFD700, #FFA500)', shadow: 'rgba(255, 215, 0, 0.4)', border: '#FFD700', text: '#FFA500' },
        2: { bg: 'linear-gradient(135deg, #C0C0C0, #A8A8A8)', shadow: 'rgba(192, 192, 192, 0.3)', border: '#C0C0C0', text: '#C0C0C0' },
        3: { bg: 'linear-gradient(135deg, #CD7F32, #B87333)', shadow: 'rgba(205, 127, 50, 0.3)', border: '#CD7F32', text: '#CD7F32' }
    };

    container.innerHTML = ordered.map(user => {
        const initial = (user.name || 'P').charAt(0).toUpperCase();
        const nameParts = (user.name || 'Player').split(' ');
        const shortName = nameParts.length > 1 
            ? `${nameParts[0]} ${nameParts[1].charAt(0).toUpperCase()}.`
            : nameParts[0];
        const level = getUserLevel(user.winnings);
        const medal = medalColors[user.rank];
        const vipBadge = user.isVip && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
        const isFirst = user.rank === 1;
        const avatarSize = isFirst ? 72 : 56;
        const pedestalH = isFirst ? 90 : user.rank === 2 ? 65 : 50;

        const avatarHtml = user.photoURL
            ? `<img src="${user.photoURL}" alt="${initial}" style="width:${avatarSize}px; height:${avatarSize}px; border-radius:50%; object-fit:cover; box-shadow: 0 4px 18px ${medal.shadow}; border: 3px solid ${medal.border};" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
               <div style="width:${avatarSize}px; height:${avatarSize}px; border-radius:50%; background:${medal.bg}; display:none; align-items:center; justify-content:center; font-size:${isFirst ? '1.6' : '1.2'}rem; font-weight:800; color:#fff; box-shadow: 0 4px 18px ${medal.shadow}; border: 3px solid ${medal.border};">${initial}</div>`
            : `<div style="width:${avatarSize}px; height:${avatarSize}px; border-radius:50%; background:${medal.bg}; display:flex; align-items:center; justify-content:center; font-size:${isFirst ? '1.6' : '1.2'}rem; font-weight:800; color:#fff; box-shadow: 0 4px 18px ${medal.shadow}; border: 3px solid ${medal.border};">${initial}</div>`;

        return `
            <div class="lb-podium-item rank-${user.rank}" style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
                <div style="position: relative; margin-bottom: 8px;">
                    ${avatarHtml}
                    <div style="position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); width:24px; height:24px; background:${medal.bg}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:800; color:#fff; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${user.rank}</div>
                </div>
                <div style="font-weight: 700; font-size: ${isFirst ? '0.9' : '0.8'}rem; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;">${shortName}</div>
                ${vipBadge ? `<div style="margin-bottom: 2px;">${vipBadge}</div>` : ''}
                <div style="font-weight: 700; font-size: ${isFirst ? '1' : '0.85'}rem; color: ${medal.text}; margin-bottom: 4px;">${formatCoin(user.winnings)}</div>
                <div style="width: 85%; height: ${pedestalH}px; background: linear-gradient(180deg, rgba(99,102,241,0.2) 0%, rgba(99,102,241,0.05) 100%); border-radius: 8px 8px 0 0; border-top: 2px solid ${medal.border}; display:flex; align-items:center; justify-content:center;">
                    <span class="lb-rank-level ${level.class}" style="font-size: 0.6rem;">${level.icon} ${level.tier}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderRankList(users, container) {
    if (users.length === 0) { container.innerHTML = ''; return; }

    const uid = state.user?.uid;

    container.innerHTML = users.map((user, i) => {
        const rank = i + 4;
        const initial = (user.name || 'P').charAt(0).toUpperCase();
        const level = getUserLevel(user.winnings);
        const delay = Math.min(i * 50, 500);
        const vipBadge = user.isVip && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
        const isMe = user.uid === uid;
        const highlight = isMe ? 'border: 1.5px solid rgba(99,102,241,0.5); background: rgba(99,102,241,0.06);' : '';

        return `
            <div class="lb-rank-item" style="animation-delay: ${delay}ms; ${highlight}">
                <div class="lb-rank-num" style="font-weight: 700; color: ${rank <= 10 ? '#6366f1' : 'var(--text-muted)'};">#${rank}</div>
                ${user.photoURL
                    ? `<img src="${user.photoURL}" alt="${initial}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; flex-shrink:0;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                       <div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#1e293b,#334155); display:none; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; color:#fff; flex-shrink:0;">${initial}</div>`
                    : `<div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#1e293b,#334155); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; color:#fff; flex-shrink:0;">${initial}</div>`
                }
                <div class="lb-rank-info" style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${user.name}${vipBadge}${isMe ? ' <span style="font-size:0.6rem; color:#6366f1; font-weight:700;">(YOU)</span>' : ''}</div>
                    <div style="display: flex; gap: 6px; align-items: center; margin-top: 1px;">
                        <span class="lb-rank-level ${level.class}" style="font-size: 0.6rem;">${level.icon} ${level.tier}</span>
                        <span style="font-size: 0.6rem; color: var(--text-muted);">${user.matchesWon || 0}W/${user.matchesPlayed || 0}P</span>
                    </div>
                </div>
                <div style="font-weight: 700; font-size: 0.9rem; color: #00ff88;">${formatCoin(user.winnings)}</div>
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
