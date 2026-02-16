// JeetoPlay — User Tournament Module
// Handles tournament listing, registration, bracket viewing, and my tournaments

let userTournamentFilter = 'OPEN';
let userTournamentCache = [];
let gameImageCache = {};

// XSS sanitization — all user/admin-sourced strings must go through this before innerHTML
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ─── Load User Tournaments ──────────────────────────────────

window.loadUserTournaments = async function () {
    const listEl = document.getElementById('user-tournament-list');
    if (!listEl) return;

    listEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem;"></i>
            <p style="margin-top: 8px; font-size: 0.85rem;">Loading tournaments...</p>
        </div>
    `;

    try {
        // Fetch game images for tournament cards
        if (Object.keys(gameImageCache).length === 0) {
            try {
                const gamesSnap = await db.ref('esports_games').once('value');
                if (gamesSnap.exists()) {
                    gamesSnap.forEach(g => {
                        const gd = g.val();
                        if (gd.icon || gd.image) gameImageCache[g.key] = gd.icon || gd.image;
                    });
                }
            } catch (e) { /* ignore, images are optional */ }
        }

        const snap = await db.ref('tournaments').orderByChild('createdAt').once('value');
        const tournaments = [];
        snap.forEach(child => {
            const t = { id: child.key, ...child.val() };
            tournaments.push(t);
        });
        tournaments.reverse();

        userTournamentCache = tournaments;
        renderUserTournaments(tournaments);

        // Also load my tournaments
        loadMyTournaments(tournaments);
    } catch (err) {
        console.error('Load tournaments error:', err);
        listEl.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-circle-exclamation" style="color: var(--danger);"></i>
                <p style="margin-top: 8px;">Failed to load tournaments</p>
            </div>
        `;
    }
};

// ─── Render User-Facing Tournament List ─────────────────────

function renderUserTournaments(tournaments) {
    const listEl = document.getElementById('user-tournament-list');
    const now = Date.now();
    const uid = state.user?.uid;

    // Apply filter
    let filtered;
    if (userTournamentFilter === 'OPEN') {
        filtered = tournaments.filter(t => t.status === 'REGISTRATION' && now < t.registrationCloses);
    } else if (userTournamentFilter === 'ACTIVE') {
        filtered = tournaments.filter(t => ['REGISTRATION_CLOSED', 'BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE', 'LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED'].includes(t.status));
    } else if (userTournamentFilter === 'COMPLETED') {
        filtered = tournaments.filter(t => t.status === 'COMPLETED');
    } else {
        filtered = tournaments.filter(t => t.status !== 'CANCELLED');
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 50px 20px; color: var(--text-muted);">
                <i class="fa-solid fa-trophy" style="font-size: 2.5rem; opacity: 0.25; margin-bottom: 10px; display: block;"></i>
                <p style="margin: 0; font-size: 0.9rem;">No tournaments found</p>
                <p style="margin: 4px 0 0; font-size: 0.75rem;">Check back later for new tournaments!</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = '';
    filtered.forEach(t => {
        const isRegistered = uid && t.participants && t.participants[uid];
        const regProgress = t.maxParticipants > 0 ? Math.round((t.registeredCount || 0) / t.maxParticipants * 100) : 0;
        const isFull = (t.registeredCount || 0) >= t.maxParticipants;
        const isRegOpen = t.status === 'REGISTRATION' && now >= t.registrationOpens && now < t.registrationCloses;
        const timeLeft = t.registrationCloses - now;
        const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
        const minsLeft = Math.max(0, Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)));

        // Status + CTA logic
        let statusHTML = '';
        let ctaHTML = '';

        if (t.status === 'REGISTRATION') {
            if (isRegistered) {
                statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(34,197,94,0.15); color: #22c55e; border-radius: 12px; font-weight: 600;"><i class="fa-solid fa-check"></i> Registered</span>`;
                ctaHTML = `<span style="font-size: 0.72rem; color: #22c55e; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Joined</span>`;
            } else if (isFull) {
                statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(239,68,68,0.15); color: #ef4444; border-radius: 12px; font-weight: 600;">Full</span>`;
            } else if (isRegOpen) {
                statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(34,197,94,0.15); color: #22c55e; border-radius: 12px; font-weight: 600;">🟢 Open</span>`;
                ctaHTML = `<button onclick="event.stopPropagation(); openTournamentRegModal('${t.id}')" class="btn btn-primary btn-sm" style="font-size: 0.75rem;">Join 🪙 ${t.entryFee || 0}</button>`;
            } else {
                statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(251,191,36,0.15); color: #fbbf24; border-radius: 12px; font-weight: 600;">⏳ Opens ${new Date(t.registrationOpens).toLocaleDateString()}</span>`;
            }
        } else if (t.status === 'REGISTRATION_CLOSED') {
            const pendingText = t.format === 'LOBBY_ELIMINATION' ? '⏳ Lobbies Pending' : '⏳ Bracket Pending';
            statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(59,130,246,0.15); color: #3b82f6; border-radius: 12px; font-weight: 600;">${pendingText}</span>`;
        } else if (['BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE'].includes(t.status)) {
            statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(239,68,68,0.15); color: #ef4444; border-radius: 12px; font-weight: 600; animation: pulse 2s infinite;"><i class="fa-solid fa-play"></i> Round ${t.currentRound || 1}/${t.totalRounds || '?'}</span>`;
            ctaHTML = `<button onclick="event.stopPropagation(); viewTournamentBracket('${t.id}')" class="btn btn-outline btn-sm" style="font-size: 0.75rem;"><i class="fa-solid fa-sitemap"></i> Bracket</button>`;
        } else if (['LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED'].includes(t.status)) {
            statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(99,102,241,0.15); color: #6366f1; border-radius: 12px; font-weight: 600; animation: pulse 2s infinite;"><i class="fa-solid fa-gamepad"></i> Round ${t.currentRound || 1}/${t.totalRounds || '?'}</span>`;
            ctaHTML = `<button onclick="event.stopPropagation(); viewTournamentDetail('${t.id}')" class="btn btn-outline btn-sm" style="font-size: 0.75rem;"><i class="fa-solid fa-circle-info"></i> Info</button>`;
        } else if (t.status === 'COMPLETED') {
            statusHTML = `<span style="font-size: 0.7rem; padding: 3px 10px; background: rgba(139,92,246,0.15); color: #8b5cf6; border-radius: 12px; font-weight: 600;">🏆 Completed</span>`;
            if (t.format === 'LOBBY_ELIMINATION') {
                ctaHTML = `<button onclick="event.stopPropagation(); viewTournamentDetail('${t.id}')" class="btn btn-outline btn-sm" style="font-size: 0.75rem;">Results</button>`;
            } else {
                ctaHTML = `<button onclick="event.stopPropagation(); viewTournamentBracket('${t.id}')" class="btn btn-outline btn-sm" style="font-size: 0.75rem;">Results</button>`;
            }
        }

        // Prize display
        const prizeBreakdown = t.prizeBreakdown || {};
        let prizeText = '';
        if (prizeBreakdown['1']) prizeText = `🩇🪙 ${prizeBreakdown['1']}`;
        if (prizeBreakdown['2']) prizeText += ` 🩈🪙 ${prizeBreakdown['2']}`;
        if (prizeBreakdown['3']) prizeText += ` 🩉🪙 ${prizeBreakdown['3']}`;

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--bg-card-solid);
            border: 1px solid ${isRegistered ? 'rgba(34,197,94,0.3)' : 'var(--border)'};
            border-radius: var(--radius-md);
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.15s, box-shadow 0.15s;
        `;
        card.onclick = () => viewTournamentDetail(t.id);

        const gameImg = gameImageCache[t.gameId] || '';
        // Fix double-encoded Firebase Storage URLs (%252F → %2F)
        const fixUrl = (u) => u ? u.replace(/%25([0-9A-Fa-f]{2})/g, '%$1') : '';
        const safeGameImg = fixUrl(gameImg);
        const safeBanner = fixUrl(t.bannerImage);
        const fallbackBg = `<div style="width:100%;height:100px;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;gap:12px;padding:0 16px;">${safeGameImg ? `<img src="${safeGameImg}" style="height:50px;width:50px;border-radius:10px;object-fit:cover;box-shadow:0 2px 10px rgba(0,0,0,0.3);" onerror="this.style.display='none'">` : ''}<div style="font-weight:700;font-size:1rem;color:#fff;">${escapeHtml(t.gameName) || 'Tournament'}</div></div>`;
        card.innerHTML = `
            <div style="position:relative;width:100%;height:100px;overflow:hidden;">
                ${fallbackBg}
                ${safeBanner ? `<img src="${safeBanner}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">` : ''}
            </div>
            <div style="padding: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 8px;">
                    <div style="flex: 1; min-width: 0;">
                        <h4 style="margin: 0 0 4px; font-size: 0.95rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.title) || 'Tournament'}</h4>
                        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                            <span style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(t.gameName) || 'Game'}</span>
                            <span style="font-size: 0.65rem; padding: 1px 6px; background: rgba(139,92,246,0.12); color: #a78bfa; border-radius: 8px;">${escapeHtml(t.type) || 'Solo'}</span>
                        </div>
                    </div>
                    ${statusHTML}
                </div>

                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;">
                    <div style="text-align: center; padding: 6px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Entry</div>
                        <div style="font-weight: 700; font-size: 0.85rem; color: #4dd0e1;">${t.entryFee > 0 ? '🪙 ' + t.entryFee : 'FREE'}</div>
                    </div>
                    <div style="text-align: center; padding: 6px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Prize Pool</div>
                        <div style="font-weight: 700; font-size: 0.85rem; color: #00ff88;">🪙 ${t.prizePool || 0}</div>
                    </div>
                    <div style="text-align: center; padding: 6px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Slots</div>
                        <div style="font-weight: 700; font-size: 0.85rem;">${t.registeredCount || 0}/${t.maxParticipants}</div>
                    </div>
                </div>

                ${t.status === 'REGISTRATION' ? `
                <div style="margin-bottom: 8px;">
                    <div style="height: 4px; background: var(--bg-hover); border-radius: 2px; overflow: hidden;">
                        <div style="height: 100%; width: ${regProgress}%; background: linear-gradient(90deg, #4dd0e1, #00ff88); border-radius: 2px; transition: width 0.5s;"></div>
                    </div>
                </div>
                ` : ''}

                ${prizeText ? `<div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 8px;">${prizeText}</div>` : ''}

                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.68rem; color: var(--text-muted);">
                        ${isRegOpen && timeLeft > 0 ? `Closes in ${hoursLeft}h ${minsLeft}m` : t.startsAt ? `Starts: ${new Date(t.startsAt).toLocaleDateString()}` : ''}
                    </span>
                    ${ctaHTML}
                </div>
            </div>
        `;

        listEl.appendChild(card);
    });
}

// ─── Filter Tournaments ─────────────────────────────────────

window.filterUserTournaments = function (filter, btn) {
    userTournamentFilter = filter;

    document.querySelectorAll('.active-tournament-filter').forEach(b => {
        b.classList.remove('btn-primary', 'active-tournament-filter');
        b.classList.add('btn-outline');
    });
    if (btn) {
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary', 'active-tournament-filter');
    }

    renderUserTournaments(userTournamentCache);
};

// ─── My Tournaments Toggle ──────────────────────────────────

window.toggleMyTournaments = function () {
    const dropdown = document.getElementById('my-tournaments-dropdown');
    const arrow = document.getElementById('my-tournaments-arrow');
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
    } else {
        dropdown.style.display = 'none';
        arrow.style.transform = '';
    }
};

function loadMyTournaments(tournaments) {
    const uid = state.user?.uid;
    if (!uid) return;

    const myList = document.getElementById('my-tournaments-list');
    const countEl = document.getElementById('my-tournaments-count');
    if (!myList) return;

    const myTournaments = tournaments.filter(t => t.participants && t.participants[uid]);
    if (countEl) countEl.textContent = myTournaments.length;

    if (myTournaments.length === 0) {
        myList.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">
                <p style="margin: 0;">You haven't joined any tournaments yet</p>
            </div>
        `;
        return;
    }

    myList.innerHTML = '';
    myTournaments.forEach(t => {
        const isLobby = t.format === 'LOBBY_ELIMINATION';
        const statusMap = {
            'REGISTRATION': { color: '#22c55e', text: 'Registered' },
            'REGISTRATION_CLOSED': { color: '#3b82f6', text: isLobby ? 'Lobbies Pending' : 'Bracket Pending' },
            'BRACKET_GENERATED': { color: '#3b82f6', text: 'Starting Soon' },
            'ROUND_IN_PROGRESS': { color: '#ef4444', text: `Round ${t.currentRound}/${t.totalRounds}` },
            'ROUND_COMPLETE': { color: '#fbbf24', text: 'Round Complete' },
            'LOBBIES_GENERATED': { color: '#6366f1', text: 'Lobbies Ready' },
            'LOBBY_IN_PROGRESS': { color: '#ef4444', text: `Round ${t.currentRound || 1}/${t.totalRounds || '?'}` },
            'LOBBY_SCORED': { color: '#fbbf24', text: 'Lobby Scored' },
            'COMPLETED': { color: '#8b5cf6', text: 'Completed' },
            'CANCELLED': { color: '#6b7280', text: 'Cancelled' }
        };
        const s = statusMap[t.status] || statusMap['REGISTRATION'];

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--bg-card-solid);
            border: 1px solid rgba(34,197,94,0.2);
            border-radius: 10px;
            padding: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        `;
        card.onclick = () => {
            if (['BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE', 'COMPLETED'].includes(t.status) && t.bracket && t.format !== 'LOBBY_ELIMINATION') {
                viewTournamentBracket(t.id);
            } else {
                viewTournamentDetail(t.id);
            }
        };

        card.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.title) || 'Tournament'}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(t.gameName) || ''} • 🪙 ${t.prizePool || 0} pool</div>
            </div>
            <span style="font-size: 0.68rem; padding: 3px 10px; background: rgba(${s.color === '#22c55e' ? '34,197,94' : s.color === '#ef4444' ? '239,68,68' : s.color === '#3b82f6' ? '59,130,246' : s.color === '#fbbf24' ? '251,191,36' : s.color === '#8b5cf6' ? '139,92,246' : '107,114,128'},0.15); color: ${s.color}; border-radius: 10px; font-weight: 600; white-space: nowrap;">${s.text}</span>
        `;
        myList.appendChild(card);
    });
}

// ─── Tournament Registration Modal ──────────────────────────

window.openTournamentRegModal = function (tournamentId) {
    const t = userTournamentCache.find(x => x.id === tournamentId);
    if (!t) return;

    const uid = state.user?.uid;
    if (!uid) {
        alert('Please log in to join tournaments.');
        return;
    }

    // Build prize breakdown text
    const pb = t.prizeBreakdown || {};
    let prizeHTML = '';
    const medals = { '1': '🥇 1st', '2': '🥈 2nd', '3': '🥉 3rd' };
    for (const [place, amount] of Object.entries(pb)) {
        prizeHTML += `<div style="display: flex; justify-content: space-between; padding: 4px 0;"><span>${medals[place] || place + 'th'}</span><span style="font-weight: 700; color: #00ff88;">🪙 ${amount}</span></div>`;
    }

    // Show confirmation modal
    const content = `
        <div style="text-align: center; margin-bottom: 16px;">
            <i class="fa-solid fa-trophy" style="font-size: 2.5rem; color: #fbbf24; margin-bottom: 8px;"></i>
            <h3 style="margin: 0;">${escapeHtml(t.title)}</h3>
            <p style="color: var(--text-muted); font-size: 0.8rem; margin: 4px 0;">${escapeHtml(t.gameName)} • ${escapeHtml(t.type)} • Single Elimination</p>
        </div>

        <div style="background: var(--bg-hover); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85rem;">
                <div><strong>Entry Fee:</strong></div><div style="text-align: right; font-weight: 700; color: #4dd0e1;">🪙 ${t.entryFee || 0}</div>
                <div><strong>Prize Pool:</strong></div><div style="text-align: right; font-weight: 700; color: #00ff88;">🪙 ${t.prizePool || 0}</div>
                <div><strong>Slots Left:</strong></div><div style="text-align: right; font-weight: 700;">${Math.max(0, (t.maxParticipants || 0) - (t.registeredCount || 0))}</div>
                <div><strong>Rounds:</strong></div><div style="text-align: right; font-weight: 700;">${t.totalRounds || '?'}</div>
            </div>
        </div>

        ${prizeHTML ? `
        <div style="background: var(--bg-hover); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">PRIZE BREAKDOWN</div>
            ${prizeHTML}
        </div>
        ` : ''}

        <div style="margin-bottom: 16px;">
            <label style="font-size: 0.8rem; font-weight: 600; display: block; margin-bottom: 6px;">Your In-Game Name (IGN)</label>
            <input id="tournament-reg-ign" type="text" placeholder="Enter your IGN" 
                style="width: 100%; padding: 10px 14px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 8px; color: var(--text-main); font-size: 0.9rem;"
                value="">
        </div>

        <button id="tournament-reg-btn" onclick="confirmTournamentRegistration('${t.id}')"
            style="width: 100%; padding: 14px; font-size: 1rem; font-weight: 700;"
            class="btn btn-primary">
            <i class="fa-solid fa-trophy"></i> Join Tournament — 🪙 ${t.entryFee || 0}
        </button>
    `;

    showCustomModal('Join Tournament', content);

    // Pre-fill IGN from game IGNs
    if (t.gameId && state.userData?.gameIGNs?.[t.gameId]) {
        document.getElementById('tournament-reg-ign').value = state.userData.gameIGNs[t.gameId];
    } else if (state.userData?.username) {
        document.getElementById('tournament-reg-ign').value = state.userData.username;
    }
};

// ─── Confirm Tournament Registration (calls Cloud Function) ─

window.confirmTournamentRegistration = async function (tournamentId) {
    const ignInput = document.getElementById('tournament-reg-ign');
    const ign = ignInput?.value?.trim();
    const btn = document.getElementById('tournament-reg-btn');

    if (!ign || ign.length < 2) {
        alert('Please enter a valid IGN (at least 2 characters).');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Joining...';

    try {
        const registerFn = firebase.functions().httpsCallable('registerForTournament');
        const result = await registerFn({ tournamentId, ign });

        if (result.data.success) {
            closeCustomModal();
            if (typeof showToast === 'function') showToast(`🏆 You're in! Tournament joined successfully.`, 'success');
            loadUserTournaments(); // Refresh list
        }
    } catch (err) {
        console.error('Tournament registration error:', err);
        const msg = err.message || 'Registration failed';
        if (msg.includes('Insufficient balance')) {
            if (typeof showInsufficientBalanceModal === 'function') {
                showInsufficientBalanceModal(msg);
            } else {
                alert(msg);
            }
        } else {
            alert(msg);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            const t = userTournamentCache.find(x => x.id === tournamentId);
            btn.innerHTML = `<i class="fa-solid fa-trophy"></i> Join Tournament — 🪙 ${t?.entryFee || 0}`;
        }
    }
};

// ─── Unregister From Tournament ─────────────────────────────
// NOTE: Unregistration/cancellation is disabled by design.
// Once a user registers for a tournament, they cannot leave.
// This matches the eSports match behavior where joining is final.

window.unregisterFromTournament = async function (tournamentId) {
    if (typeof showToast === 'function') showToast('You cannot leave a tournament after registering', 'error');
};

// ─── View Tournament Detail (Info Modal) ────────────────────

window.viewTournamentDetail = async function (tournamentId) {
    const t = userTournamentCache.find(x => x.id === tournamentId);
    if (!t) return;

    const uid = state.user?.uid;
    const isRegistered = uid && t.participants && t.participants[uid];
    const rawGameImg = gameImageCache[t.gameId] || '';
    // Fix double-encoded Firebase Storage URLs (%252F → %2F)
    const fixUrl = (u) => u ? u.replace(/%25([0-9A-Fa-f]{2})/g, '%$1') : '';
    const gameImg = fixUrl(rawGameImg);

    // Prize breakdown
    const pb = t.prizeBreakdown || {};
    let prizeHTML = '';
    const medalMap = { '1': '🥇', '2': '🥈', '3': '🥉' };
    const ordMap = { '1': '1st', '2': '2nd', '3': '3rd' };
    for (let p = 4; p <= 10; p++) ordMap[String(p)] = p + 'th';
    for (const [place, amount] of Object.entries(pb)) {
        prizeHTML += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);"><span style="font-size: 0.9rem;">${medalMap[place] || '🏅'} ${ordMap[place] || place + 'th'}</span><span style="font-weight: 700; color: #00ff88; font-size: 0.95rem;">🪙 ${amount}</span></div>`;
    }

    // Participants list (first 15)
    const participants = Object.entries(t.participants || {}).slice(0, 15);
    const participantCount = Object.keys(t.participants || {}).length;
    let participantsHTML = '';
    // Batch-fetch VIP flags for participants
    const _tVipMap = {};
    const _tUids = participants.map(([uid]) => uid).filter(Boolean);
    const _tUniqueUids = [...new Set(_tUids)];
    await Promise.all(_tUniqueUids.map(async tUid => {
        try { const s = await db.ref(`users/${tUid}/isVip`).once('value'); _tVipMap[tUid] = s.val() === true; } catch (e) { }
    }));
    if (participants.length > 0) {
        participantsHTML = participants.map(([pUid, p], i) => {
            const tVipBadge = _tVipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
            return `<span style="display: inline-block; font-size: 0.78rem; padding: 3px 10px; background: var(--bg-hover); border-radius: 20px; margin: 3px;"><span style="color: var(--primary); font-weight: 600;">${i + 1}.</span> ${escapeHtml(p.ign) || 'Player'} ${tVipBadge}</span>`;
        }).join('');
    } else {
        participantsHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No participants yet</div>';
    }

    if (participantCount > 15) {
        participantsHTML += `<span style="font-size: 0.75rem; color: var(--text-muted); padding: 3px 8px;">+${participantCount - 15} more</span>`;
    }

    // Round schedule calculation
    const totalRounds = t.totalRounds || 1;
    const roundInterval = t.roundIntervalMinutes || 30;
    const startsAt = t.startsAt;
    let roundScheduleHTML = '';
    if (startsAt && totalRounds > 0) {
        roundScheduleHTML = '<div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">';
        for (let r = 1; r <= totalRounds; r++) {
            const roundStartMs = startsAt + ((r - 1) * roundInterval * 60 * 1000);
            const roundDate = new Date(roundStartMs);
            const isCurrentRound = r === (t.currentRound || 0);
            const isPast = Date.now() > roundStartMs;
            const roundLabel = r === totalRounds ? '🏆 Final' : r === totalRounds - 1 && totalRounds > 2 ? 'Semi-Final' : `Round ${r}`;
            roundScheduleHTML += `
                <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: ${isCurrentRound ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.03)'}; border-radius: 8px; border-left: 3px solid ${isCurrentRound ? '#fbbf24' : isPast ? '#22c55e' : 'rgba(255,255,255,0.1)'};">  
                    <div style="width: 28px; height: 28px; border-radius: 50%; background: ${isCurrentRound ? 'rgba(251,191,36,0.2)' : isPast ? 'rgba(34,197,94,0.15)' : 'var(--bg-hover)'}; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; color: ${isCurrentRound ? '#fbbf24' : isPast ? '#22c55e' : 'var(--text-muted)'}; flex-shrink: 0;">${isPast ? '✓' : r}</div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 0.82rem; color: ${isCurrentRound ? '#fbbf24' : '#fff'};">${roundLabel}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted);">${roundDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} • ${roundDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    ${isCurrentRound ? '<span style="font-size: 0.65rem; padding: 2px 8px; background: rgba(251,191,36,0.2); color: #fbbf24; border-radius: 10px; font-weight: 600; animation: pulse 2s infinite;">NOW</span>' : ''}
                </div>`;
        }
        roundScheduleHTML += '</div>';
    }

    const now = Date.now();
    const isRegOpen = t.status === 'REGISTRATION' && now >= t.registrationOpens && now < t.registrationCloses;
    const isFull = (t.registeredCount || 0) >= t.maxParticipants;
    const progressPercent = t.maxParticipants > 0 ? Math.min((participantCount / t.maxParticipants) * 100, 100) : 0;

    let actionBtn = '';
    if (t.status === 'REGISTRATION' && !isRegistered && isRegOpen && !isFull) {
        actionBtn = `<button onclick="closeCustomModal(); openTournamentRegModal('${t.id}')" style="width: 100%; background: linear-gradient(135deg, #00ff88, #00cc6a); color: #000; border: none; padding: 14px; border-radius: 12px; font-weight: 700; font-size: 1rem; cursor: pointer; transition: transform 0.2s; box-shadow: 0 4px 15px rgba(0,255,136,0.25);" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'"><i class="fa-solid fa-trophy"></i> Join Tournament — 🪙 ${t.entryFee || 0}</button>`;
    } else if (t.status === 'REGISTRATION' && isRegistered) {
        actionBtn = `<div style="width: 100%; padding: 14px; text-align: center; background: rgba(34,197,94,0.12); border: 1.5px solid rgba(34,197,94,0.25); border-radius: 12px; color: #22c55e; font-weight: 700; font-size: 0.95rem;"><i class="fa-solid fa-circle-check"></i> Already Registered</div>`;
    } else if (['REGISTRATION_CLOSED', 'BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'COMPLETED'].includes(t.status) && t.format !== 'LOBBY_ELIMINATION') {
        actionBtn = `<button onclick="closeCustomModal(); viewTournamentBracket('${t.id}')" style="width: 100%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border: none; padding: 14px; border-radius: 12px; font-weight: 700; font-size: 1rem; cursor: pointer;"><i class="fa-solid fa-sitemap"></i> View Bracket</button>`;
    } else if (['LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED', 'COMPLETED'].includes(t.status) && t.format === 'LOBBY_ELIMINATION') {
        const roundText = t.status === 'COMPLETED' ? 'Tournament Complete' : `Round ${t.currentRound || 1} of ${t.totalRounds || '?'}`;
        actionBtn = `<div style="text-align: center; padding: 14px; background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08)); border: 1px solid rgba(99,102,241,0.2); border-radius: 12px; font-size: 0.9rem; color: #6366f1; font-weight: 700;"><i class="fa-solid fa-gamepad"></i> ${roundText}</div>`;
    }

    const statusColors = { 'REGISTRATION': '#22c55e', 'REGISTRATION_CLOSED': '#3b82f6', 'BRACKET_GENERATED': '#3b82f6', 'ROUND_IN_PROGRESS': '#ef4444', 'LOBBIES_GENERATED': '#6366f1', 'LOBBY_IN_PROGRESS': '#ef4444', 'COMPLETED': '#8b5cf6', 'CANCELLED': '#6b7280' };
    const statusColor = statusColors[t.status] || '#22c55e';
    const statusLabels = { 'REGISTRATION': 'Open', 'REGISTRATION_CLOSED': 'Reg Closed', 'BRACKET_GENERATED': 'Starting', 'ROUND_IN_PROGRESS': 'Live', 'LOBBIES_GENERATED': 'Lobbies Ready', 'LOBBY_IN_PROGRESS': 'Live', 'LOBBY_SCORED': 'Scored', 'COMPLETED': 'Completed', 'CANCELLED': 'Cancelled' };

    const content = `
        <div style="display: grid; gap: 0;">
            <!-- Game Banner / Icon Header -->
            ${gameImg ? `
            <div style="display: flex; align-items: center; gap: 14px; padding: 0 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 14px;">
                <img src="${gameImg}" style="width: 52px; height: 52px; border-radius: 12px; object-fit: cover; box-shadow: 0 2px 12px rgba(0,0,0,0.3);" onerror="this.style.display='none'">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;">
                        <span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; background: ${statusColor}22; color: ${statusColor}; font-weight: 700; border: 1px solid ${statusColor}44;">${statusLabels[t.status] || t.status}</span>
                        <span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; background: var(--bg-hover); color: var(--text-muted); font-weight: 600;">${escapeHtml(t.type) || 'Solo'}</span>
                        ${isRegistered ? '<span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; background: rgba(0,255,136,0.15); color: #00ff88; font-weight: 700;">✓ JOINED</span>' : ''}
                    </div>
                    <h3 style="margin: 0; font-size: 1.1rem; color: #fff;">${escapeHtml(t.title)}</h3>
                    <div style="color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(t.gameName)} • ${t.format === 'LOBBY_ELIMINATION' ? 'Lobby Battle Royale' : 'Single Elimination'}</div>
                </div>
            </div>
            ` : `
            <div style="padding: 0 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 14px;">
                <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
                    <span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; background: ${statusColor}22; color: ${statusColor}; font-weight: 700; border: 1px solid ${statusColor}44;">${statusLabels[t.status] || t.status}</span>
                    <span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; background: var(--bg-hover); color: var(--text-muted); font-weight: 600;">${escapeHtml(t.type) || 'Solo'}</span>
                    ${isRegistered ? '<span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; background: rgba(0,255,136,0.15); color: #00ff88; font-weight: 700;">✓ JOINED</span>' : ''}
                </div>
                <h3 style="margin: 0; font-size: 1.1rem; color: #fff;">${escapeHtml(t.title)}</h3>
                <div style="color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(t.gameName)} • ${t.format === 'LOBBY_ELIMINATION' ? 'Lobby Battle Royale' : 'Single Elimination'}</div>
            </div>
            `}

            <!-- Info Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px;">
                <div style="text-align: center; padding: 12px 8px; background: rgba(0,255,136,0.06); border: 1px solid rgba(0,255,136,0.12); border-radius: 12px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Entry</div>
                    <div style="font-weight: 700; color: #4dd0e1; font-size: 1.1rem; margin-top: 2px;">${t.entryFee > 0 ? '🪙 ' + t.entryFee : 'FREE'}</div>
                </div>
                <div style="text-align: center; padding: 12px 8px; background: rgba(0,255,136,0.06); border: 1px solid rgba(0,255,136,0.12); border-radius: 12px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Prize Pool</div>
                    <div style="font-weight: 700; color: #00ff88; font-size: 1.1rem; margin-top: 2px;">🪙 ${t.prizePool || 0}</div>
                </div>
                <div style="text-align: center; padding: 12px 8px; background: var(--bg-hover); border: 1px solid var(--border); border-radius: 12px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Players</div>
                    <div style="font-weight: 700; font-size: 1.1rem; margin-top: 2px;"><span style="color: ${isFull ? '#ef4444' : '#00ff88'};">${participantCount}</span>/${t.maxParticipants}</div>
                </div>
            </div>

            ${prizeHTML ? `
            <!-- Prizes -->
            <div style="background: var(--bg-hover); border-radius: 12px; overflow: hidden; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 0.8rem; color: var(--primary); font-weight: 600; padding: 10px 12px 6px;">🏆 PRIZES</div>
                ${prizeHTML}
            </div>
            ` : ''}

            <!-- Schedule with Round Times -->
            <div style="background: var(--bg-hover); border-radius: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 0.8rem; color: var(--primary); margin-bottom: 8px; font-weight: 600;">📅 SCHEDULE</div>
                <div style="display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.03); padding: 10px 12px; border-radius: 10px; margin-bottom: 6px;">
                    <i class="fa-regular fa-calendar" style="color: var(--primary); font-size: 1.1rem;"></i>
                    <div>
                        <div style="font-weight: 600; font-size: 0.92rem;">${startsAt ? new Date(startsAt).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-'}</div>
                        <div style="color: var(--text-muted); font-size: 0.82rem;">${startsAt ? new Date(startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'}</div>
                    </div>
                </div>
                ${totalRounds > 1 ? roundScheduleHTML : ''}
                <div style="display: flex; gap: 8px; margin-top: 8px; font-size: 0.72rem; color: var(--text-muted);">
                    <span>Reg Opens: ${t.registrationOpens ? new Date(t.registrationOpens).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                    <span>•</span>
                    <span>Reg Closes: ${t.registrationCloses ? new Date(t.registrationCloses).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                </div>
            </div>

            ${t.rules ? `
            <!-- Rules (above participants) -->
            <div style="background: var(--bg-hover); border-radius: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 0.8rem; color: var(--primary); margin-bottom: 8px; font-weight: 600;">📋 RULES</div>
                <div style="font-size: 0.85rem; line-height: 1.7; white-space: pre-wrap; color: var(--text-muted);">${escapeHtml(t.rules)}</div>
            </div>
            ` : ''}

            <!-- Participants (bottom) -->
            <div style="background: var(--bg-hover); border-radius: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 0.8rem; color: var(--primary); margin-bottom: 8px; font-weight: 600;">👥 PARTICIPANTS (${participantCount}/${t.maxParticipants})</div>
                <div style="background: rgba(255,255,255,0.03); border-radius: 10px; padding: 10px; max-height: 140px; overflow-y: auto;">
                    <div style="display: flex; flex-wrap: wrap; gap: 2px;">${participantsHTML}</div>
                </div>
                <!-- Slot progress -->
                <div style="margin-top: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; height: 5px; overflow: hidden;">
                    <div style="background: ${isFull ? '#ef4444' : 'var(--primary)'}; height: 100%; width: ${progressPercent}%; transition: width 0.3s; border-radius: 6px;"></div>
                </div>
            </div>

            <!-- CTA -->
            ${actionBtn ? `<div style="margin-top: 2px;">${actionBtn}</div>` : ''}
        </div>
    `;

    showCustomModal(escapeHtml(t.title), content);
};

// ─── View Tournament Bracket (Premium Visualization) ────────

window.viewTournamentBracket = async function (tournamentId) {
    const t = userTournamentCache.find(x => x.id === tournamentId);
    if (!t || !t.bracket) {
        if (typeof showToast === 'function') showToast('Bracket not available yet', 'info');
        return;
    }

    const uid = state.user?.uid;
    const bracket = t.bracket;

    // Batch-fetch VIP flags for all bracket players
    const _bVipMap = {};
    const _bUids = [];
    Object.values(bracket).forEach(matches => {
        Object.values(matches).forEach(match => {
            if (match.player1?.uid) _bUids.push(match.player1.uid);
            if (match.player2?.uid) _bUids.push(match.player2.uid);
        });
    });
    const _bUniqueUids = [...new Set(_bUids)];
    await Promise.all(_bUniqueUids.map(async bUid => {
        try { const s = await db.ref(`users/${bUid}/isVip`).once('value'); _bVipMap[bUid] = s.val() === true; } catch (e) { }
    }));

    let bracketHTML = '<div style="overflow-x: auto; padding-bottom: 10px;">';
    bracketHTML += '<div style="display: flex; gap: 12px; min-width: max-content;">';

    const roundKeys = Object.keys(bracket).sort((a, b) => {
        return parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]);
    });

    roundKeys.forEach(roundKey => {
        const roundNum = parseInt(roundKey.split('_')[1]);
        const matches = bracket[roundKey];
        const isCurrentRound = roundNum === (t.currentRound || 1);
        const roundLabel = roundNum === t.totalRounds ? '🏆 Final'
            : roundNum === t.totalRounds - 1 ? 'Semi-Finals'
                : `Round ${roundNum}`;

        bracketHTML += `
            <div style="min-width: 200px; display: flex; flex-direction: column; gap: 8px;">
                <div style="text-align: center; font-size: 0.75rem; font-weight: 700; color: ${isCurrentRound ? '#fbbf24' : 'var(--text-muted)'}; padding: 4px 8px; background: ${isCurrentRound ? 'rgba(251,191,36,0.1)' : 'transparent'}; border-radius: 6px;">
                    ${roundLabel}
                </div>
        `;

        Object.entries(matches).forEach(([matchKey, match]) => {
            const p1 = match.player1;
            const p2 = match.player2;
            const p1Name = escapeHtml(p1?.ign) || (p1 ? 'Player' : 'TBD');
            const p2Name = escapeHtml(p2?.ign) || (p2 ? 'Player' : 'TBD');
            const p1Vip = p1?.uid && _bVipMap[p1.uid] && typeof getVipBadgeHtml === 'function' ? ' ' + getVipBadgeHtml(true) : '';
            const p2Vip = p2?.uid && _bVipMap[p2.uid] && typeof getVipBadgeHtml === 'function' ? ' ' + getVipBadgeHtml(true) : '';
            const isMyMatch = uid && ((p1?.uid === uid) || (p2?.uid === uid));
            const isCompleted = match.status === 'COMPLETED' || match.status === 'BYE';
            const p1Won = match.winner === p1?.uid;
            const p2Won = match.winner === p2?.uid;

            bracketHTML += `
                <div style="background: var(--bg-card-solid); border: 1px solid ${isMyMatch ? 'rgba(0,255,136,0.4)' : 'var(--border)'}; border-radius: 8px; padding: 8px; ${isMyMatch ? 'box-shadow: 0 0 12px rgba(0,255,136,0.1);' : ''}">
                    <div style="display: flex; align-items: center; padding: 5px 6px; background: ${p1Won ? 'rgba(34,197,94,0.1)' : 'transparent'}; border-radius: 4px; margin-bottom: 2px; ${p1?.uid === uid ? 'border-left: 2px solid var(--primary);' : ''}">
                        <span style="flex: 1; font-size: 0.78rem; font-weight: ${p1Won ? '700' : '400'}; ${p1?.uid === uid ? 'color: var(--primary);' : ''}">${p1Name}${p1Vip}</span>
                        ${p1Won ? '<i class="fa-solid fa-crown" style="color: #fbbf24; font-size: 0.6rem;"></i>' : ''}
                    </div>
                    <div style="text-align: center; font-size: 0.55rem; color: var(--text-muted);">vs</div>
                    <div style="display: flex; align-items: center; padding: 5px 6px; background: ${p2Won ? 'rgba(34,197,94,0.1)' : 'transparent'}; border-radius: 4px; ${p2?.uid === uid ? 'border-left: 2px solid var(--primary);' : ''}">
                        <span style="flex: 1; font-size: 0.78rem; font-weight: ${p2Won ? '700' : '400'}; ${p2?.uid === uid ? 'color: var(--primary);' : ''}">${p2Name}${p2Vip}</span>
                        ${p2Won ? '<i class="fa-solid fa-crown" style="color: #fbbf24; font-size: 0.6rem;"></i>' : ''}
                    </div>
                    <div style="text-align: center; margin-top: 4px; font-size: 0.6rem; color: ${isCompleted ? '#22c55e' : match.status === 'PENDING' ? '#fbbf24' : '#6b7280'}; font-weight: 600;">
                        ${match.status === 'BYE' ? 'BYE' : match.status}
                    </div>
                </div>
            `;
        });

        bracketHTML += '</div>';
    });

    bracketHTML += '</div></div>';

    // Add champion display if completed
    if (t.status === 'COMPLETED' && t.champion) {
        const champData = t.participants?.[t.champion];
        bracketHTML = `
            <div style="text-align: center; padding: 16px; margin-bottom: 12px; background: linear-gradient(135deg, rgba(251,191,36,0.1), rgba(139,92,246,0.1)); border-radius: 12px; border: 1px solid rgba(251,191,36,0.2);">
                <div style="font-size: 2rem;">🏆</div>
                <div style="font-size: 1.1rem; font-weight: 700; margin: 4px 0;">Champion: ${escapeHtml(champData?.ign) || 'Winner'}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">Won 🪙 ${t.prizeBreakdown?.['1'] || t.prizePool || 0}</div>
            </div>
        ` + bracketHTML;
    }

    showCustomModal(`${escapeHtml(t.title)} — Bracket`, bracketHTML);
};

// ─── Custom Modal (reusable for tournament views) ───────────

function showCustomModal(title, content) {
    // Remove existing modal if any
    const existing = document.getElementById('custom-tournament-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'custom-tournament-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000;
        background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
        padding: 16px; backdrop-filter: blur(4px); animation: fadeIn 0.2s;
    `;
    modal.onclick = (e) => { if (e.target === modal) closeCustomModal(); };

    modal.innerHTML = `
        <div style="background: var(--bg-card-solid); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 420px; max-height: 85vh; overflow-y: auto; animation: slideUp 0.3s;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 10px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg-card-solid); z-index: 1; border-radius: 16px 16px 0 0;">
                <h3 style="margin: 0; font-size: 1rem;">${title}</h3>
                <button onclick="closeCustomModal()" style="background: none; border: none; color: var(--text-muted); font-size: 1.2rem; cursor: pointer; padding: 4px 8px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div style="padding: 16px;">
                ${content}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

window.closeCustomModal = function () {
    const modal = document.getElementById('custom-tournament-modal');
    if (modal) modal.remove();
};

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
`;
if (!document.getElementById('tournament-animations')) {
    style.id = 'tournament-animations';
    document.head.appendChild(style);
}
