// JeetoPlay — User Tournament Module
// Handles tournament listing, registration, bracket viewing, and my tournaments

let userTournamentFilter = 'OPEN';
let userTournamentCache = [];
let gameImageCache = {};
let tournamentListenerRef = null; // Real-time listener reference

// Helper: Check if user is registered in a tournament (works for both Solo and Team modes)
function isTournamentRegistered(t, uid) {
    if (!uid || !t || !t.participants) return false;
    // Solo: uid is a direct key
    if (t.participants[uid]) return true;
    // Team: check bookedBy across all participant entries
    return Object.values(t.participants).some(p => p.bookedBy === uid);
}

// Stop real-time tournament listener (call when leaving the section)
window.stopTournamentListener = function () {
    if (tournamentListenerRef) {
        tournamentListenerRef.off();
        tournamentListenerRef = null;
    }
};

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

    // Detach any previous listener to prevent duplicates
    stopTournamentListener();

    listEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem;"></i>
            <p style="margin-top: 8px; font-size: 0.85rem;">Loading tournaments...</p>
        </div>
    `;

    try {
        // Fetch game images for tournament cards (one-time)
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

        // Real-time listener — auto-updates when tournament data changes
        tournamentListenerRef = db.ref('tournaments').orderByChild('createdAt').limitToLast(30);
        tournamentListenerRef.on('value', snap => {
            const tournaments = [];
            snap.forEach(child => {
                const t = { id: child.key, ...child.val() };
                tournaments.push(t);
            });
            tournaments.reverse();

            userTournamentCache = tournaments;
            renderUserTournaments(tournaments);
            loadMyTournaments(tournaments);
        }, err => {
            console.error('Tournament listener error:', err);
            listEl.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fa-solid fa-circle-exclamation" style="color: var(--danger);"></i>
                    <p style="margin-top: 8px;">Failed to load tournaments</p>
                </div>
            `;
        });
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

// ─── Render User-Facing Tournament List (Premium Card v2) ───

function renderUserTournaments(tournaments) {
    const listEl = document.getElementById('user-tournament-list');
    const now = Date.now();
    const uid = state.user?.uid;

    // Apply filter (unchanged logic)
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

    // Helper: Fix double-encoded Firebase Storage URLs (%252F → %2F)
    const fixUrl = (u) => u ? u.replace(/%25([0-9A-Fa-f]{2})/g, '%$1') : '';

    listEl.innerHTML = '';
    filtered.forEach(t => {
        const isRegistered = isTournamentRegistered(t, uid);
        const joinedCount = t.registeredCount || 0;
        const maxSlots = t.maxParticipants || 100;
        const isFull = joinedCount >= maxSlots;
        const progressPercent = Math.min((joinedCount / maxSlots) * 100, 100);
        const isRegOpen = t.status === 'REGISTRATION' && now >= t.registrationOpens && now < t.registrationCloses;
        const timeLeft = t.registrationCloses - now;
        const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
        const minsLeft = Math.max(0, Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)));

        // ── Type info ──
        const matchTypeRaw = (t.type || 'Solo').trim().toUpperCase();
        const typeClass = matchTypeRaw.includes('SQUAD') ? 'type-squad' : matchTypeRaw.includes('DUO') ? 'type-duo' : 'type-solo';
        const typeDisplay = matchTypeRaw.includes('SQUAD') ? 'Squad' : matchTypeRaw.includes('DUO') ? 'Duo' : 'Solo';

        // ── Slot fill class ──
        const slotClass = isFull ? 'slot-full' : progressPercent > 60 ? 'slot-filling' : 'slot-open';

        // ── Format display ──
        const formatDisplay = t.format === 'LOBBY_ELIMINATION' ? 'Lobby' : 'Bracket';
        const formatIcon = t.format === 'LOBBY_ELIMINATION' ? 'fa-solid fa-layer-group' : 'fa-solid fa-sitemap';

        // ── Date formatting ──
        const matchDate = t.startsAt ? new Date(t.startsAt) : null;
        let dateStr = '—';
        let timeStr = '—';
        if (matchDate) {
            const day = matchDate.getDate();
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const month = monthNames[matchDate.getMonth()];
            dateStr = `${day} ${month}`;
            let hours = matchDate.getHours();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const mins = String(matchDate.getMinutes()).padStart(2, '0');
            timeStr = `${hours}:${mins} ${ampm}`;
        }

        // ── Game image ──
        const gameImg = gameImageCache[t.gameId] || '';
        const safeGameImg = fixUrl(gameImg);

        // ── Status pill ──
        let statusClass = '';
        let statusText = '';
        if (t.status === 'REGISTRATION') {
            if (isRegistered) {
                statusClass = 'tc-st-registered';
                statusText = '<i class="fa-solid fa-check"></i> Registered';
            } else if (isFull) {
                statusClass = 'tc-st-full';
                statusText = 'Full';
            } else if (isRegOpen) {
                statusClass = 'tc-st-open';
                statusText = '🟢 Open';
            } else {
                statusClass = 'tc-st-pending';
                statusText = '⏳ Upcoming';
            }
        } else if (t.status === 'REGISTRATION_CLOSED') {
            statusClass = 'tc-st-bracket-pending';
            statusText = t.format === 'LOBBY_ELIMINATION' ? '⏳ Lobbies Pending' : '⏳ Bracket Pending';
        } else if (['BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE'].includes(t.status)) {
            statusClass = 'tc-st-active';
            statusText = `<i class="fa-solid fa-play"></i> Round ${t.currentRound || 1}/${t.totalRounds || '?'}`;
        } else if (['LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED'].includes(t.status)) {
            statusClass = 'tc-st-lobby';
            statusText = `<i class="fa-solid fa-gamepad"></i> Round ${t.currentRound || 1}/${t.totalRounds || '?'}`;
        } else if (t.status === 'COMPLETED') {
            statusClass = 'tc-st-completed';
            statusText = '🏆 Completed';
        }

        // ── CTA / Status indicator ──
        let ctaHTML = '';
        if (t.status === 'REGISTRATION') {
            if (isRegistered) {
                ctaHTML = `<div class="tc-status-bar tc-joined">
                    <span><i class="fa-solid fa-circle-check"></i> Joined</span>
                    <span class="tc-status-hint">Tap for details <i class="fa-solid fa-chevron-right"></i></span>
                </div>`;
            } else if (isFull) {
                ctaHTML = `<div class="tc-status-bar tc-full">
                    <i class="fa-solid fa-ban"></i> MATCH FULL
                </div>`;
            } else if (isRegOpen) {
                ctaHTML = `<div onclick="event.stopPropagation(); openTournamentRegModal('${t.id}')" class="tc-join-btn">
                    <i class="fa-solid fa-bolt"></i> Join Tournament — ${t.entryFee > 0 ? '🪙 ' + t.entryFee : 'FREE'}
                </div>`;
            }
        } else if (['BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE'].includes(t.status)) {
            ctaHTML = `<div onclick="event.stopPropagation(); viewTournamentBracket('${t.id}')" class="tc-status-bar tc-bracket">
                <i class="fa-solid fa-sitemap"></i>
                <span>View Bracket</span>
                <i class="fa-solid fa-chevron-right" style="font-size:0.6rem;opacity:0.5;"></i>
            </div>`;
        } else if (['LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED'].includes(t.status)) {
            if (isRegistered) {
                ctaHTML = `<div onclick="event.stopPropagation(); viewTournamentRoomDetails('${t.id}')" class="tc-status-bar tc-room">
                    <i class="fa-solid fa-key"></i>
                    <span>Room Details</span>
                    <i class="fa-solid fa-chevron-right" style="font-size:0.6rem;opacity:0.5;"></i>
                </div>`;
            } else {
                ctaHTML = `<div onclick="event.stopPropagation(); viewTournamentDetail('${t.id}')" class="tc-status-bar tc-bracket">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>View Info</span>
                    <i class="fa-solid fa-chevron-right" style="font-size:0.6rem;opacity:0.5;"></i>
                </div>`;
            }
        } else if (t.status === 'COMPLETED') {
            ctaHTML = `<div onclick="event.stopPropagation(); viewTournamentResults('${t.id}')" class="tc-status-bar tc-result">
                <i class="fa-solid fa-trophy"></i>
                <span>View Results</span>
                <i class="fa-solid fa-chevron-right" style="font-size:0.6rem;opacity:0.5;"></i>
            </div>`;
        }

        // ── Prize breakdown bar ──
        const prizeBreakdown = t.prizeBreakdown || {};
        let prizeBarHTML = '';
        const prizeEntries = Object.entries(prizeBreakdown).slice(0, 3);
        if (prizeEntries.length > 0) {
            const medalMap = { '1': '🥇', '2': '🥈', '3': '🥉' };
            prizeBarHTML = `<div class="tc-prize-bar">
                ${prizeEntries.map(([place, amount]) => `<div class="tc-prize-item">${medalMap[place] || '🏅'} <span class="tc-prize-amt">🪙 ${amount}</span></div>`).join('')}
            </div>`;
        }

        // ── Countdown / footer info ──
        let countdownHTML = '';
        if (t.status === 'REGISTRATION') {
            if (isRegOpen && timeLeft > 0) {
                countdownHTML = `<div class="tc-countdown"><i class="fa-solid fa-clock"></i> Closes in ${hoursLeft}h ${minsLeft}m</div>`;
            } else if (!isRegOpen && t.registrationOpens > now) {
                countdownHTML = `<div class="tc-countdown"><i class="fa-solid fa-clock"></i> Opens ${new Date(t.registrationOpens).toLocaleDateString()}</div>`;
            }
        } else if (t.status === 'REGISTRATION_CLOSED') {
            countdownHTML = matchDate ? `<div class="tc-countdown"><i class="fa-solid fa-clock"></i> Starts ${dateStr}, ${timeStr}</div>` : '';
        }

        // ── Build card ──
        const card = document.createElement('div');
        card.className = `tournament-card${isRegistered ? ' tc-registered' : ''}`;
        card.style.cursor = 'pointer';
        card.onclick = () => viewTournamentDetail(t.id);

        card.innerHTML = `
            <div class="tc-inner">
                <!-- Banner Strip: Game Icon + Title + Status -->
                <div class="tc-banner-strip">
                    ${safeGameImg ? `<img src="${safeGameImg}" class="tc-game-icon" onerror="this.style.display='none'">` : `<div class="tc-game-icon" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-crown" style="color:#fff;font-size:1rem;"></i></div>`}
                    <div class="tc-game-info">
                        <div class="tc-game-name">${escapeHtml(t.gameName) || 'Game'}</div>
                        <div class="tc-title">${escapeHtml(t.title) || 'Tournament'}</div>
                    </div>
                    <span class="tc-status ${statusClass}">${statusText}</span>
                </div>

                <!-- 6-Cell Detail Grid -->
                <div class="tc-grid">
                    <div class="tc-cell tc-prize">
                        <div class="tc-cell-label">Prize Pool</div>
                        <div class="tc-cell-value tc-val-green">🪙 ${t.prizePool || 0}</div>
                    </div>
                    <div class="tc-cell tc-entry">
                        <div class="tc-cell-label">Entry Fee</div>
                        <div class="tc-cell-value tc-val-cyan">${t.entryFee > 0 ? '🪙 ' + t.entryFee : 'FREE'}</div>
                    </div>
                    <div class="tc-cell tc-slots">
                        <div class="tc-cell-label"><i class="fa-solid fa-users"></i> Slots</div>
                        <div class="tc-cell-value" style="color:${isFull ? '#ef4444' : '#06b6d4'}">${joinedCount}<span style="opacity:0.4;font-weight:400;">/${maxSlots}</span></div>
                        <div class="tc-slot-track">
                            <div class="tc-slot-fill ${slotClass}" style="width:${progressPercent}%;"></div>
                        </div>
                    </div>
                    <div class="tc-cell tc-date">
                        <div class="tc-cell-label"><i class="fa-regular fa-calendar"></i> Date & Time</div>
                        <div class="tc-cell-value tc-val-gold" style="font-size:0.78rem;">${dateStr}, ${timeStr}</div>
                    </div>
                    <div class="tc-cell tc-mode">
                        <div class="tc-cell-label"><i class="fa-solid fa-gamepad"></i> Mode</div>
                        <div class="tc-cell-value"><span class="tc-type-pill ${typeClass}">${typeDisplay}</span></div>
                    </div>
                    <div class="tc-cell tc-format">
                        <div class="tc-cell-label"><i class="${formatIcon}"></i> Format</div>
                        <div class="tc-cell-value tc-val-purple" style="font-size:0.78rem;">${formatDisplay}</div>
                    </div>
                </div>

                <!-- Prize Breakdown Bar -->
                ${prizeBarHTML}

                <!-- Footer: Countdown + CTA -->
                <div class="tc-footer">
                    ${countdownHTML}
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

    const myTournaments = tournaments.filter(t => isTournamentRegistered(t, uid));
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

        // Personal placement info for completed tournaments
        let placementText = '';
        if (t.status === 'COMPLETED' && uid) {
            const myPlace = getPersonalPlacement(t, uid);
            if (myPlace) {
                placementText = myPlace.text;
            }
        }

        const statusMap = {
            'REGISTRATION': { color: '#22c55e', text: 'Registered' },
            'REGISTRATION_CLOSED': { color: '#3b82f6', text: isLobby ? 'Lobbies Pending' : 'Bracket Pending' },
            'BRACKET_GENERATED': { color: '#3b82f6', text: 'Starting Soon' },
            'ROUND_IN_PROGRESS': { color: '#ef4444', text: `Round ${t.currentRound}/${t.totalRounds}` },
            'ROUND_COMPLETE': { color: '#fbbf24', text: 'Round Complete' },
            'LOBBIES_GENERATED': { color: '#6366f1', text: 'Lobbies Ready' },
            'LOBBY_IN_PROGRESS': { color: '#ef4444', text: `Round ${t.currentRound || 1}/${t.totalRounds || '?'}` },
            'LOBBY_SCORED': { color: '#fbbf24', text: 'Lobby Scored' },
            'COMPLETED': { color: placementText ? '#fbbf24' : '#8b5cf6', text: placementText || 'Completed' },
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

    // For Duo/Squad: open the team slot booking modal
    const tType = (t.type || 'Solo').toLowerCase();
    if (tType.includes('duo') || tType.includes('squad')) {
        if (typeof openTournamentSlotModal === 'function') {
            openTournamentSlotModal(t.id);
        } else {
            showToast('Slot booking not available', 'error');
        }
        return;
    }

    // Solo: show simple IGN modal (existing flow)
    const pb = t.prizeBreakdown || {};
    let prizeHTML = '';
    const medals = { '1': '🥇 1st', '2': '🥈 2nd', '3': '🥉 3rd' };
    for (const [place, amount] of Object.entries(pb)) {
        prizeHTML += `<div style="display: flex; justify-content: space-between; padding: 4px 0;"><span>${medals[place] || place + 'th'}</span><span style="font-weight: 700; color: #00ff88;">🪙 ${amount}</span></div>`;
    }

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
            // Real-time listener auto-updates when tournament data changes — no manual refresh needed
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

// ─── View Tournament Room Details (Premium Modal) ───────────

window.viewTournamentRoomDetails = async function (tournamentId) {
    try {
        const t = userTournamentCache.find(x => x.id === tournamentId);
        if (!t) {
            showToast('Tournament not found', 'error');
            return;
        }

        const uid = state.user?.uid;
        if (!uid || !isTournamentRegistered(t, uid)) {
            showToast('You are not a participant in this tournament', 'error');
            return;
        }

        // Find user's lobby in current round (check both uid key and bookedBy for team modes)
        const round = t.currentRound || 1;
        const roundKey = `round_${round}`;
        const lobbies = t.lobbies?.[roundKey] || {};
        const lobbyEntries = Object.entries(lobbies);

        let myLobbyData = null;
        let myLobbyIdx = 0;
        let myIGN = '';
        let lobbyPlayerCount = 0;

        for (let i = 0; i < lobbyEntries.length; i++) {
            const [key, lobby] = lobbyEntries[i];
            if (!lobby.players) continue;
            // Check by uid key (solo) or by bookedBy (team)
            if (lobby.players[uid]) {
                myLobbyData = lobby;
                myLobbyIdx = i + 1;
                myIGN = lobby.players[uid].ign || t.participants[uid]?.ign || '';
                lobbyPlayerCount = Object.keys(lobby.players).length;
                break;
            }
            // Team mode: check bookedBy
            const teamEntry = Object.entries(lobby.players).find(([, p]) => p.bookedBy === uid);
            if (teamEntry) {
                myLobbyData = lobby;
                myLobbyIdx = i + 1;
                myIGN = teamEntry[1].ign || '';
                lobbyPlayerCount = Object.keys(lobby.players).length;
                break;
            }
        }

        if (!myLobbyData) {
            // Player may have been eliminated in a previous round
            showToast('You are not assigned to a lobby in this round', 'error');
            return;
        }

        const hasRoom = !!(myLobbyData.roomId && myLobbyData.roomPassword);
        const safeRoomId = hasRoom ? String(myLobbyData.roomId).replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
        const safeRoomPass = hasRoom ? String(myLobbyData.roomPassword).replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';

        // Build the premium modal
        const modalHtml = `
            <div id="tournament-room-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;" onclick="if(event.target===this) this.remove();">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius:20px; padding:0; max-width:360px; width:100%; border: 2px solid ${hasRoom ? '#6366f1' : '#fbbf24'}; box-shadow: 0 0 50px ${hasRoom ? 'rgba(99,102,241,0.25)' : 'rgba(251,191,36,0.15)'}; overflow:hidden;">
                    <!-- Header -->
                    <div style="padding:20px 20px 16px; text-align:center; background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.06));">
                        <div style="width:56px; height:56px; background:linear-gradient(135deg, #6366f1, #8b5cf6); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;">
                            <i class="fa-solid fa-key" style="font-size:24px; color:#fff;"></i>
                        </div>
                        <h3 style="color:#fff; margin:0 0 4px; font-size:1.15rem;">${escapeHtml(t.title)}</h3>
                        <div style="color:var(--text-muted); font-size:0.8rem;">Round ${round} of ${t.totalRounds || '?'}</div>
                    </div>

                    <!-- Lobby Info Bar -->
                    <div style="display:grid; grid-template-columns: 1fr 1fr ${myIGN ? '1fr' : ''}; gap:0; border-bottom:1px solid var(--border);">
                        <div style="text-align:center; padding:12px 8px; border-right:1px solid var(--border);">
                            <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Your Lobby</div>
                            <div style="font-weight:700; font-size:1rem; color:#6366f1;">Lobby ${myLobbyIdx}</div>
                        </div>
                        <div style="text-align:center; padding:12px 8px; ${myIGN ? 'border-right:1px solid var(--border);' : ''}">
                            <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Players</div>
                            <div style="font-weight:700; font-size:1rem; color:#fff;"><i class="fa-solid fa-users" style="font-size:0.8rem;"></i> ${lobbyPlayerCount}</div>
                        </div>
                        ${myIGN ? `
                        <div style="text-align:center; padding:12px 8px;">
                            <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Your IGN</div>
                            <div style="font-weight:700; font-size:0.85rem; color:#4dd0e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(myIGN)}</div>
                        </div>` : ''}
                    </div>

                    <!-- Room Details or Pending -->
                    <div style="padding:20px;">
                        ${hasRoom ? `
                        <!-- Room ID -->
                        <div style="background:rgba(99,102,241,0.1); border:1.5px solid rgba(99,102,241,0.3); border-radius:12px; padding:14px; margin-bottom:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="color:var(--text-muted); font-size:0.8rem; font-weight:600;">ROOM ID</span>
                                <button onclick="navigator.clipboard.writeText('${safeRoomId}'); if(typeof showToast==='function') showToast('Room ID copied!','success');" style="background:transparent; border:1px solid #6366f1; color:#6366f1; padding:4px 12px; border-radius:6px; font-size:0.72rem; cursor:pointer; font-weight:600;">
                                    <i class="fa-solid fa-copy"></i> Copy
                                </button>
                            </div>
                            <div style="font-family:monospace; font-size:1.4rem; font-weight:700; color:#fff; letter-spacing:2px;">${escapeHtml(myLobbyData.roomId)}</div>
                        </div>

                        <!-- Password -->
                        <div style="background:rgba(99,102,241,0.1); border:1.5px solid rgba(99,102,241,0.3); border-radius:12px; padding:14px; margin-bottom:16px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="color:var(--text-muted); font-size:0.8rem; font-weight:600;">PASSWORD</span>
                                <button onclick="navigator.clipboard.writeText('${safeRoomPass}'); if(typeof showToast==='function') showToast('Password copied!','success');" style="background:transparent; border:1px solid #6366f1; color:#6366f1; padding:4px 12px; border-radius:6px; font-size:0.72rem; cursor:pointer; font-weight:600;">
                                    <i class="fa-solid fa-copy"></i> Copy
                                </button>
                            </div>
                            <div style="font-family:monospace; font-size:1.4rem; font-weight:700; color:#fff; letter-spacing:2px;">${escapeHtml(myLobbyData.roomPassword)}</div>
                        </div>

                        <div style="text-align:center; color:#fbbf24; font-size:0.78rem; margin-bottom:16px;">
                            <i class="fa-solid fa-clock"></i> Match is active — Join the room now!
                        </div>
                        ` : `
                        <!-- Room Pending -->
                        <div style="text-align:center; padding:30px 16px;">
                            <i class="fa-solid fa-hourglass-half" style="font-size:2.5rem; color:#fbbf24; margin-bottom:12px;"></i>
                            <div style="font-size:1rem; font-weight:700; color:#fff; margin-bottom:6px;">Room Details Pending</div>
                            <div style="font-size:0.82rem; color:var(--text-muted); line-height:1.5;">
                                Admin has not shared room credentials yet.<br>
                                You'll receive a <b style="color:#fff;">push notification</b> when they're available.
                            </div>
                        </div>
                        `}

                        <button onclick="document.getElementById('tournament-room-modal').remove()" style="width:100%; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; border:none; padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:pointer;">
                            ${hasRoom ? 'Got it!' : 'Close'}
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('tournament-room-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (err) {
        console.error('View tournament room details error:', err);
        showToast('Error loading room details', 'error');
    }
};

// ─── View Tournament Detail (Info Modal) ────────────────────

window.viewTournamentDetail = async function (tournamentId) {
    const t = userTournamentCache.find(x => x.id === tournamentId);
    if (!t) return;

    const uid = state.user?.uid;
    const isRegistered = isTournamentRegistered(t, uid);
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

    // Participants list (first 25)
    const participants = Object.entries(t.participants || {}).slice(0, 25);
    const participantCount = Object.keys(t.participants || {}).length;
    let participantsHTML = '';
    // Batch-fetch VIP flags for participants
    const _tVipMap = {};
    const _tUids = participants.map(([uid]) => uid).filter(Boolean);
    const _tUniqueUids = [...new Set(_tUids)];
    await Promise.all(_tUniqueUids.map(async tUid => {
        try { const s = await db.ref(`users/${tUid}/isVip`).once('value'); _tVipMap[tUid] = s.val() === true; } catch (e) { }
    }));
    const _tDetailType = (t.type || 'Solo').toLowerCase();
    const _tIsTeamMode = _tDetailType.includes('duo') || _tDetailType.includes('squad');
    const _tTeamSize = _tDetailType.includes('squad') ? '4' : '2';

    if (_tIsTeamMode && participants.length > 0) {
        // ── TEAM MODE: Group by team number ──
        const _tTeamColors = ['#00ff88','#6366f1','#ffc107','#ff6b6b','#4dd0e1','#ff9500','#a78bfa','#f472b6','#34d399','#f59e0b','#06b6d4','#ec4899'];
        const _tTeamGroups = {};
        participants.forEach(([k, p]) => {
            const tm = k.match(/team_(\d+)/);
            const teamNum = tm ? tm[1] : (p.teamNumber ? String(p.teamNumber) : '0');
            if (!_tTeamGroups[teamNum]) _tTeamGroups[teamNum] = [];
            _tTeamGroups[teamNum].push({ key: k, p });
        });
        const _tSortedTeams = Object.keys(_tTeamGroups).sort((a, b) => parseInt(a) - parseInt(b));

        participantsHTML = _tSortedTeams.map((tNum, tIdx) => {
            const members = _tTeamGroups[tNum];
            const tColor = _tTeamColors[tIdx % _tTeamColors.length];
            const membersHtml = members.map(({ key, p }) => {
                const pUid = p.bookedBy || key;
                const tVipBadge = _tVipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                return `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
                    <div style="width:18px; height:18px; background:${tColor}15; border:1px solid ${tColor}40; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700; color:${tColor};">${p.slotPosition || '\u2022'}</div>
                    <span style="font-size:0.78rem; color:var(--text-main); font-weight:500;">${escapeHtml(p.ign) || 'Player'}</span> ${tVipBadge}
                </div>`;
            }).join('');

            return `<div style="background:${tColor}08; border:1px solid ${tColor}20; border-radius:10px; padding:8px 12px; width:100%;">
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid ${tColor}15;">
                    <div style="width:20px; height:20px; background:${tColor}20; border:1.5px solid ${tColor}50; border-radius:5px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700; color:${tColor};">${tNum}</div>
                    <span style="font-size:0.72rem; font-weight:700; color:${tColor}; letter-spacing:0.3px;">TEAM ${tNum}</span>
                    <span style="font-size:0.6rem; color:var(--text-muted); margin-left:auto;">${members.length}/${_tTeamSize}</span>
                </div>
                <div style="padding-left:2px;">${membersHtml}</div>
            </div>`;
        }).join('');

        if (participantCount > 25) {
            participantsHTML += `<div style="text-align:center; width:100%; font-size:0.75rem; color:var(--text-muted); padding:6px;">+${participantCount - 25} more players</div>`;
        }
    } else if (participants.length > 0) {
        // ── SOLO MODE: Original flat pill layout ──
        participantsHTML = participants.map(([pUid, p], i) => {
            const tVipBadge = _tVipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
            return `<span style="display: inline-block; font-size: 0.78rem; padding: 3px 10px; background: var(--bg-hover); border-radius: 20px; margin: 3px;"><span style="color: var(--primary); font-weight: 600;">${i + 1}.</span> ${escapeHtml(p.ign) || 'Player'} ${tVipBadge}</span>`;
        }).join('');
        if (participantCount > 25) {
            participantsHTML += `<span style="font-size: 0.75rem; color: var(--text-muted); padding: 3px 8px;">+${participantCount - 25} more</span>`;
        }
    } else {
        participantsHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No participants yet</div>';
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

    // Winners section for completed tournaments
    let winnersHTML = '';
    let personalResultHTML = '';
    const isTeamMode = t.type === 'Duo' || t.type === 'Squad';
    const sc = t.scoringConfigSnapshot || t.scoringConfig || null;
    const perKillPt = sc?.perKillPoint || 1;
    const posPoints = sc?.positionPoints || {};
    if (t.status === 'COMPLETED') {
        const myPlace = uid ? getPersonalPlacement(t, uid) : null;

        // Find my stats from finalStandings for detailed breakdown
        const myStanding = uid ? (normalizeFinalStandings(t.finalStandings) || []).find(s => s.uid === uid || (Array.isArray(s.memberUids) && s.memberUids.includes(uid))) : null;

        // Personal result banner with score breakdown
        if (uid && isRegistered) {
            if (myPlace && myPlace.place) {
                const placeNum = myPlace.place;
                const prizeWon = myPlace.prize || 0;
                const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
                const ordinals = { 1: '1st', 2: '2nd', 3: '3rd' };
                const medal = medals[placeNum] || '🏅';
                const ordinal = ordinals[placeNum] || placeNum + 'th';

                // Build score breakdown if standing data available
                let breakdownHTML = '';
                if (myStanding) {
                    const myKills = myStanding.kills || 0;
                    const myPlacement = myStanding.placement || 0;
                    const killPts = myKills * perKillPt;
                    const posPts = Number(posPoints[myPlacement]) || 0;
                    breakdownHTML = `
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(251,191,36,0.15);">
                            <div style="font-size: 0.7rem; color: #fbbf24; font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Score Breakdown</div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; max-width: 280px; margin: 0 auto;">
                                <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px;">
                                    <div style="font-size: 0.62rem; color: var(--text-muted);">Kill Points</div>
                                    <div style="font-weight: 700; color: #ef4444; font-size: 0.9rem;">${killPts} <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 400;">(${myKills} &#215; ${perKillPt}pts)</span></div>
                                </div>
                                <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px;">
                                    <div style="font-size: 0.62rem; color: var(--text-muted);">Position Points</div>
                                    <div style="font-weight: 700; color: #3b82f6; font-size: 0.9rem;">${posPts} <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 400;">(#${myPlacement})</span></div>
                                </div>
                            </div>
                            <div style="margin-top: 6px; font-weight: 700; color: #00ff88; font-size: 0.88rem;">Total: ${myStanding.score || 0} pts</div>
                        </div>`;
                }

                personalResultHTML = `
                    <div style="background: linear-gradient(135deg, rgba(251,191,36,0.15), rgba(255,215,0,0.08)); border: 1.5px solid rgba(251,191,36,0.3); border-radius: 12px; padding: 16px; margin-bottom: 14px; text-align: center;">
                        <div style="font-size: 2rem; margin-bottom: 6px;">${medal}</div>
                        <div style="font-weight: 700; font-size: 1.1rem; color: #fbbf24;">You placed ${ordinal}!</div>
                        ${prizeWon > 0 ? `<div style="font-size: 0.9rem; color: #00ff88; font-weight: 600; margin-top: 4px;">🪙 ${prizeWon} won</div>` : ''}
                        ${breakdownHTML}
                    </div>
                `;
            } else {
                personalResultHTML = `
                    <div style="background: var(--bg-hover); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 14px; text-align: center;">
                        <div style="font-size: 0.9rem; color: var(--text-muted);">You participated but did not place in the prizes</div>
                    </div>
                `;
            }
        }

        // Winners podium
        const winners = t.winners || {};
        const winnerEntries = Object.entries(winners).sort(([a], [b]) => Number(a) - Number(b));
        if (winnerEntries.length > 0) {
            const medals = { '1': '🥇', '2': '🥈', '3': '🥉' };
            const ordinals = { '1': '1st', '2': '2nd', '3': '3rd' };
            let podiumItems = '';
            for (const [place, w] of winnerEntries) {
                const medal = medals[place] || '🏅';
                const ord = ordinals[place] || place + 'th';
                const prize = w.prize || pb[place] || 0;
                const isMyWin = uid && (w.uid === uid || (Array.isArray(w.memberUids) && w.memberUids.includes(uid)));

                // Team member details for team mode
                let teamMembersLine = '';
                if (isTeamMode && Array.isArray(w.memberIgns) && w.memberIgns.length > 0) {
                    teamMembersLine = `<div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 1px;">${w.memberIgns.map(n => escapeHtml(n)).join(', ')}</div>`;
                } else if (isTeamMode && w.playerKills && Object.keys(w.playerKills).length > 0) {
                    teamMembersLine = `<div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 1px;">${Object.keys(w.playerKills).length} players</div>`;
                }

                podiumItems += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); ${isMyWin ? 'background: rgba(251,191,36,0.08); border-left: 3px solid #fbbf24;' : ''}">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 1.2rem;">${medal}</span>
                            <div>
                                <div style="font-weight: 600; font-size: 0.88rem; ${isMyWin ? 'color: #fbbf24;' : ''}">${escapeHtml(w.ign) || 'Player'}${isMyWin ? ' (You)' : ''}</div>
                                <div style="font-size: 0.7rem; color: var(--text-muted);">${ord} Place${w.score != null ? ` &#8226; ${w.kills || 0} kills &#8226; ${w.score} pts` : ''}</div>
                                ${teamMembersLine}
                            </div>
                        </div>
                        ${prize > 0 ? `<span style="font-weight: 700; color: #00ff88; font-size: 0.9rem;">🪙 ${prize}</span>` : ''}
                    </div>
                `;
            }
            winnersHTML = `
                <div style="background: var(--bg-hover); border-radius: 12px; overflow: hidden; margin-bottom: 14px; border: 1px solid rgba(251,191,36,0.15);">
                    <div style="font-size: 0.8rem; color: #fbbf24; font-weight: 600; padding: 10px 12px 6px;">🏆 WINNERS</div>
                    ${podiumItems}
                </div>
            `;
        } else if (t.champion) {
            // Bracket tournament — build from champion/runnerUp
            let podiumItems = '';
            const champName = t.participants?.[t.champion]?.ign || 'Player';
            podiumItems += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 1.2rem;">🥇</span><div><div style="font-weight: 600; font-size: 0.88rem;">${escapeHtml(champName)}</div><div style="font-size: 0.7rem; color: var(--text-muted);">1st Place</div></div></div>${pb['1'] ? `<span style="font-weight: 700; color: #00ff88; font-size: 0.9rem;">🪙 ${pb['1']}</span>` : ''}</div>`;
            if (t.runnerUp) {
                const runName = t.participants?.[t.runnerUp]?.ign || 'Player';
                podiumItems += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 1.2rem;">🥈</span><div><div style="font-weight: 600; font-size: 0.88rem;">${escapeHtml(runName)}</div><div style="font-size: 0.7rem; color: var(--text-muted);">2nd Place</div></div></div>${pb['2'] ? `<span style="font-weight: 700; color: #00ff88; font-size: 0.9rem;">🪙 ${pb['2']}</span>` : ''}</div>`;
            }
            winnersHTML = `
                <div style="background: var(--bg-hover); border-radius: 12px; overflow: hidden; margin-bottom: 14px; border: 1px solid rgba(251,191,36,0.15);">
                    <div style="font-size: 0.8rem; color: #fbbf24; font-weight: 600; padding: 10px 12px 6px;">🏆 WINNERS</div>
                    ${podiumItems}
                </div>
            `;
        }

        // Full standings leaderboard for lobby tournaments
        const allStandings = normalizeFinalStandings(t.finalStandings);
        if (allStandings.length > 0 && t.format === 'LOBBY_ELIMINATION') {
            const standingsId = 'standings-' + t.id;

            // Scoring config banner
            let scoringBanner = '';
            if (sc) {
                const posEntries = Object.entries(posPoints).sort(([a],[b]) => Number(a) - Number(b));
                const posStr = posEntries.length > 0 ? posEntries.map(([pos, pts]) => `#${pos}=${pts}`).join(', ') : 'none';
                scoringBanner = `
                    <div style="padding: 8px 12px; background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05)); border-bottom: 1px solid rgba(99,102,241,0.12); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="font-size: 0.65rem; color: #a78bfa; font-weight: 600;">&#9889; SCORING:</span>
                        <span style="font-size: 0.65rem; color: var(--text-muted);">${perKillPt} pts/kill</span>
                        <span style="font-size: 0.65rem; color: rgba(255,255,255,0.15);">&#124;</span>
                        <span style="font-size: 0.65rem; color: var(--text-muted);">Position: ${posStr}</span>
                    </div>`;
            }

            let standingsItems = '';
            allStandings.forEach((s, i) => {
                const rank = s.rank || (i + 1);
                const isMe = uid && (s.uid === uid || (Array.isArray(s.memberUids) && s.memberUids.includes(uid)));
                const prize = pb[String(rank)] || 0;
                const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
                const medal = medals[rank] || '';
                const sKills = s.kills || 0;
                const sPlacement = s.placement || 0;
                const killPts = sKills * perKillPt;
                const posPts = Number(posPoints[sPlacement]) || 0;

                // Per-player kill breakdown for team mode
                let playerKillsHTML = '';
                if (isTeamMode && s.playerKills && Object.keys(s.playerKills).length > 0) {
                    const memberIgns = s.memberIgns || [];
                    const pkEntries = Object.entries(s.playerKills);
                    let pkRows = '';
                    pkEntries.forEach(([pKey, pKills], idx) => {
                        // Try to find a matching IGN name
                        const pIgn = memberIgns[idx] || pKey.slice(0, 12);
                        const isLast = idx === pkEntries.length - 1;
                        pkRows += `<div style="display: flex; justify-content: space-between; padding: 2px 0; ${!isLast ? 'border-bottom: 1px dashed rgba(255,255,255,0.04);' : ''}">
                            <span style="font-size: 0.62rem; color: var(--text-muted);">${isLast ? '&#9492;' : '&#9500;'} ${escapeHtml(pIgn)}</span>
                            <span style="font-size: 0.62rem; color: #ef4444; font-weight: 600;">${pKills} kills (${pKills * perKillPt} pts)</span>
                        </div>`;
                    });
                    playerKillsHTML = `<div style="margin-top: 4px; padding: 4px 8px; background: rgba(139,92,246,0.04); border-radius: 6px; border: 1px solid rgba(139,92,246,0.08);">${pkRows}</div>`;
                } else if (isTeamMode && Array.isArray(s.memberIgns) && s.memberIgns.length > 0) {
                    playerKillsHTML = `<div style="font-size: 0.6rem; color: var(--text-muted); margin-top: 2px;">${s.memberIgns.map(n => escapeHtml(n)).join(', ')}</div>`;
                }

                standingsItems += `
                    <div class="${i >= 5 ? 'standings-extra-' + standingsId : ''}" style="display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); ${isMe ? 'background: rgba(251,191,36,0.08); border-left: 3px solid #fbbf24;' : ''} ${i >= 5 ? 'display: none;' : ''}">
                        <div style="display: flex; align-items: flex-start; gap: 8px; flex: 1;">
                            <span style="width: 24px; text-align: center; font-size: 0.78rem; font-weight: 700; color: ${rank <= 3 ? '#fbbf24' : 'var(--text-muted)'}; padding-top: 2px;">${medal || rank}</span>
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 0.82rem; font-weight: ${isMe ? '700' : '500'}; color: ${isMe ? '#fbbf24' : '#fff'};">${escapeHtml(s.ign) || 'Player'}${isMe ? ' (You)' : ''}</div>
                                <div style="font-size: 0.65rem; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 1px;">
                                    <span style="color: #ef4444;">${sKills} kills (${killPts}pts)</span>
                                    <span style="color: rgba(255,255,255,0.15);">&#8226;</span>
                                    <span style="color: #3b82f6;">#${sPlacement} (${posPts}pts)</span>
                                </div>
                                ${playerKillsHTML}
                            </div>
                        </div>
                        <div style="text-align: right; flex-shrink: 0;">
                            <div style="font-weight: 700; font-size: 0.85rem; color: ${rank <= 3 ? '#00ff88' : '#fff'};">${s.score || 0} pts</div>
                            ${prize > 0 ? `<div style="font-size: 0.65rem; color: #00ff88;">🪙 ${prize}</div>` : ''}
                        </div>
                    </div>
                `;
            });

            const showMoreBtn = allStandings.length > 5 ? `
                <div style="text-align: center; padding: 8px;">
                    <button onclick="document.querySelectorAll('.standings-extra-${standingsId}').forEach(el => { el.style.display = el.style.display === 'none' ? 'flex' : 'none'; }); this.textContent = this.textContent.includes('Show') ? 'Show Less' : 'Show All (${allStandings.length})';" style="background: none; border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); padding: 6px 16px; border-radius: 8px; font-size: 0.75rem; cursor: pointer;">Show All (${allStandings.length})</button>
                </div>
            ` : '';

            winnersHTML += `
                <div style="background: var(--bg-hover); border-radius: 12px; overflow: hidden; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="font-size: 0.8rem; color: var(--primary); font-weight: 600; padding: 10px 12px 6px;">📊 FINAL STANDINGS</div>
                    ${scoringBanner}
                    ${standingsItems}
                    ${showMoreBtn}
                </div>
            `;
        }
    }

    let actionBtn = '';
    if (t.status === 'REGISTRATION' && !isRegistered && isRegOpen && !isFull) {
        actionBtn = `<button onclick="closeCustomModal(); openTournamentRegModal('${t.id}')" style="width: 100%; background: linear-gradient(135deg, #00ff88, #00cc6a); color: #000; border: none; padding: 14px; border-radius: 12px; font-weight: 700; font-size: 1rem; cursor: pointer; transition: transform 0.2s; box-shadow: 0 4px 15px rgba(0,255,136,0.25);" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'"><i class="fa-solid fa-trophy"></i> Join Tournament — 🪙 ${t.entryFee || 0}</button>`;
    } else if (t.status === 'REGISTRATION' && isRegistered) {
        actionBtn = `<div style="width: 100%; padding: 14px; text-align: center; background: rgba(34,197,94,0.12); border: 1.5px solid rgba(34,197,94,0.25); border-radius: 12px; color: #22c55e; font-weight: 700; font-size: 0.95rem;"><i class="fa-solid fa-circle-check"></i> Already Registered</div>`;
    } else if (['REGISTRATION_CLOSED', 'BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'COMPLETED'].includes(t.status) && t.format !== 'LOBBY_ELIMINATION') {
        actionBtn = `<button onclick="closeCustomModal(); viewTournamentBracket('${t.id}')" style="width: 100%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border: none; padding: 14px; border-radius: 12px; font-weight: 700; font-size: 1rem; cursor: pointer;"><i class="fa-solid fa-sitemap"></i> View Bracket</button>`;
    } else if (['LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED', 'COMPLETED'].includes(t.status) && t.format === 'LOBBY_ELIMINATION') {
        const roundText = t.status === 'COMPLETED' ? 'Tournament Complete' : `Round ${t.currentRound || 1} of ${t.totalRounds || '?'}`;

        // Find user's lobby and show room details
        let roomDetailsHTML = '';
        if (uid && isRegistered && t.status !== 'COMPLETED') {
            const round = t.currentRound || 1;
            const roundKey = `round_${round}`;
            const lobbies = t.lobbies?.[roundKey] || {};
            let myLobbyKey = null;
            let myLobbyData = null;
            let myLobbyIdx = 0;

            const lobbyEntries = Object.entries(lobbies);
            for (let i = 0; i < lobbyEntries.length; i++) {
                const [key, lobby] = lobbyEntries[i];
                if (lobby.players && lobby.players[uid]) {
                    myLobbyKey = key;
                    myLobbyData = lobby;
                    myLobbyIdx = i + 1;
                    break;
                }
            }

            if (myLobbyData) {
                if (myLobbyData.roomId && myLobbyData.roomPassword) {
                    // Escape for safe use inside onclick single-quoted strings
                    const safeRoomId = String(myLobbyData.roomId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    const safeRoomPass = String(myLobbyData.roomPassword).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    roomDetailsHTML = `
                        <div style="background: linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.08)); border: 1.5px solid rgba(59,130,246,0.25); border-radius: 12px; padding: 14px; margin-bottom: 14px;">
                            <div style="font-size: 0.75rem; color: #3b82f6; font-weight: 700; margin-bottom: 10px;"><i class="fa-solid fa-key"></i> YOUR ROOM DETAILS — Lobby ${myLobbyIdx}</div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; cursor: pointer;" onclick="navigator.clipboard.writeText('${safeRoomId}'); if(typeof showToast==='function') showToast('Room ID copied!','success');">
                                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 2px;">Room ID</div>
                                    <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">${escapeHtml(myLobbyData.roomId)} <i class="fa-solid fa-copy" style="font-size: 0.7rem; color: #3b82f6; margin-left: 4px;"></i></div>
                                </div>
                                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; cursor: pointer;" onclick="navigator.clipboard.writeText('${safeRoomPass}'); if(typeof showToast==='function') showToast('Password copied!','success');">
                                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 2px;">Password</div>
                                    <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">${escapeHtml(myLobbyData.roomPassword)} <i class="fa-solid fa-copy" style="font-size: 0.7rem; color: #3b82f6; margin-left: 4px;"></i></div>
                                </div>
                            </div>
                        </div>`;
                } else {
                    roomDetailsHTML = `
                        <div style="background: var(--bg-hover); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 14px; text-align: center;">
                            <i class="fa-solid fa-clock" style="color: #fbbf24; font-size: 1.2rem; margin-bottom: 6px;"></i>
                            <div style="font-size: 0.85rem; color: var(--text-muted);">Lobby ${myLobbyIdx} — Waiting for room details</div>
                            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">You'll receive a notification when room details are shared</div>
                        </div>`;
                }
            }
        }

        actionBtn = roomDetailsHTML + `<div style="text-align: center; padding: 14px; background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08)); border: 1px solid rgba(99,102,241,0.2); border-radius: 12px; font-size: 0.9rem; color: #6366f1; font-weight: 700;"><i class="fa-solid fa-gamepad"></i> ${roundText}</div>`;
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

            <!-- Quick View Participants Button -->
            <div onclick="const el = document.getElementById('tournament-participants-section'); if(el) el.scrollIntoView({behavior:'smooth', block:'start'});" style="background:var(--bg-hover); border:1px solid var(--border); border-radius:12px; padding:12px 14px; margin-bottom:14px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:all 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.08)'; this.style.borderColor='rgba(0,255,136,0.3)'" onmouseleave="this.style.background='var(--bg-hover)'; this.style.borderColor='var(--border)'">
                <div style="width:34px; height:34px; background:linear-gradient(135deg, rgba(0,255,136,0.15), rgba(0,204,106,0.08)); border:1.5px solid rgba(0,255,136,0.25); border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i class="fa-solid fa-users" style="color:#00ff88; font-size:0.85rem;"></i>
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:0.85rem; color:var(--text-main);">View Participants</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${participantCount} of ${t.maxParticipants} slots filled${_tIsTeamMode ? ' • ' + (t.type || 'Team') + ' Teams' : ''}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    <div style="width:40px; height:4px; background:rgba(255,255,255,0.06); border-radius:2px; overflow:hidden;">
                        <div style="height:100%; width:${progressPercent}%; background:${isFull ? '#ef4444' : '#00ff88'}; border-radius:2px;"></div>
                    </div>
                    <i class="fa-solid fa-chevron-down" style="color:var(--text-muted); font-size:0.6rem; opacity:0.6;"></i>
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
            <div id="tournament-participants-section" style="background: var(--bg-hover); border-radius: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 0.8rem; color: var(--primary); margin-bottom: 8px; font-weight: 600;">👥 PARTICIPANTS (${participantCount}/${t.maxParticipants})</div>
                <div style="background: rgba(255,255,255,0.03); border-radius: 10px; padding: 10px; max-height: ${_tIsTeamMode ? '240' : '140'}px; overflow-y: auto;">
                    <div style="display: flex; flex-wrap: wrap; gap: ${_tIsTeamMode ? '6' : '2'}px;">${participantsHTML}</div>
                </div>
                <!-- Slot progress -->
                <div style="margin-top: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; height: 5px; overflow: hidden;">
                    <div style="background: ${isFull ? '#ef4444' : 'var(--primary)'}; height: 100%; width: ${progressPercent}%; transition: width 0.3s; border-radius: 6px;"></div>
                </div>
            </div>

            <!-- Personal Result -->
            ${personalResultHTML}

            <!-- Winners -->
            ${winnersHTML}

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
        const isTeamBracket = t.type === 'Duo' || t.type === 'Squad';

        // For team modes, find team members from participants
        let teamMembersHTML = '';
        if (isTeamBracket && champData?.teamNumber) {
            const teamMembers = Object.values(t.participants || {}).filter(p => String(p.teamNumber) === String(champData.teamNumber));
            if (teamMembers.length > 0) {
                teamMembersHTML = `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">${teamMembers.map(m => escapeHtml(m.ign || 'Player')).join(', ')}</div>`;
            }
        }

        // Runner up info
        let runnerUpHTML = '';
        if (t.runnerUp) {
            const runData = t.participants?.[t.runnerUp];
            runnerUpHTML = `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);">&#x1F948; Runner-up: ${escapeHtml(runData?.ign) || 'Player'}${t.prizeBreakdown?.['2'] ? ' &#8226; &#x1FA99; ' + t.prizeBreakdown['2'] : ''}</div>`;
        }

        bracketHTML = `
            <div style="text-align: center; padding: 16px; margin-bottom: 12px; background: linear-gradient(135deg, rgba(251,191,36,0.1), rgba(139,92,246,0.1)); border-radius: 12px; border: 1px solid rgba(251,191,36,0.2);">
                <div style="font-size: 2rem;">&#x1F3C6;</div>
                <div style="font-size: 1.1rem; font-weight: 700; margin: 4px 0;">Champion: ${escapeHtml(champData?.ign) || 'Winner'}</div>
                ${teamMembersHTML}
                <div style="font-size: 0.8rem; color: #00ff88; font-weight: 600; margin-top: 4px;">Won &#x1FA99; ${t.prizeBreakdown?.['1'] || t.prizePool || 0}</div>
                ${runnerUpHTML}
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

// ─── Personal Placement Helper ──────────────────────────────
// Returns { place: number, prize: number, text: string } or null

function getPersonalPlacement(t, uid) {
    if (!t || !uid || t.status !== 'COMPLETED') return null;
    const pb = t.prizeBreakdown || {};

    // Helper: check if uid matches directly or is in memberUids array (team mode)
    const isMatch = (entry) => {
        if (entry.uid === uid) return true;
        if (Array.isArray(entry.memberUids) && entry.memberUids.includes(uid)) return true;
        return false;
    };

    // Check lobby tournament winners (stored by completeLobbyTournament Cloud Function)
    if (t.winners) {
        for (const [place, w] of Object.entries(t.winners)) {
            if (isMatch(w)) {
                const placeNum = parseInt(place);
                const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
                const ordinals = { 1: '1st', 2: '2nd', 3: '3rd' };
                const medal = medals[placeNum] || '🏅';
                const ord = ordinals[placeNum] || placeNum + 'th';
                return {
                    place: placeNum,
                    prize: w.prize || pb[place] || 0,
                    text: `${medal} ${ord} Place`
                };
            }
        }
    }

    // Check bracket tournament (champion / runnerUp)
    if (t.champion === uid) {
        return { place: 1, prize: pb['1'] || 0, text: '🥇 Champion' };
    }
    if (t.runnerUp === uid) {
        return { place: 2, prize: pb['2'] || 0, text: '🥈 Runner-up' };
    }

    // Check 3rd place (semi-final losers in bracket tournaments)
    if (t.bracket && t.totalRounds >= 2 && pb['3']) {
        const semiRound = t.bracket[`round_${t.totalRounds - 1}`];
        if (semiRound) {
            for (const [, mv] of Object.entries(semiRound)) {
                if (mv.loser === uid) {
                    return { place: 3, prize: pb['3'] || 0, text: '🥉 3rd Place' };
                }
            }
        }
    }

    // Check finalStandings (lobby tournaments — find rank even if not a winner)
    // Firebase stores arrays as objects with numeric keys, so handle both formats
    const standings = normalizeFinalStandings(t.finalStandings);
    if (standings.length > 0) {
        const myStanding = standings.find(s => isMatch(s));
        if (myStanding) {
            const prize = pb[String(myStanding.rank)] || 0;
            return { place: myStanding.rank, prize, text: `#${myStanding.rank} Overall` };
        }
    }

    return null;
}

// Firebase stores arrays as objects with numeric keys {"0": {...}, "1": {...}}
// This normalizes to a proper JS array
function normalizeFinalStandings(standings) {
    if (!standings) return [];
    if (Array.isArray(standings)) return standings;
    // Firebase object-style array: { "0": {...}, "1": {...} }
    if (typeof standings === 'object') {
        return Object.values(standings).filter(s => s && s.uid);
    }
    return [];
}

// ── View Tournament Results Modal (direct results view) ──
window.viewTournamentResults = async function (tournamentId) {
    try {
        const snap = await db.ref('tournaments/' + tournamentId).once('value');
        const t = snap.val();
        if (!t) { showNotification('Tournament not found', 'error'); return; }
        t.id = tournamentId;

        const uid = state.user?.uid;
        const pb = t.prizeBreakdown || {};

        // ── Personal Result ──
        const myPlace = uid ? getPersonalPlacement(t, uid) : null;
        let personalHTML = '';
        if (myPlace && myPlace.place) {
            const placeNum = myPlace.place;
            const prizeWon = myPlace.prize || 0;
            const isWinner = placeNum <= 3;
            const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
            const ordinals = { 1: '1st', 2: '2nd', 3: '3rd' };
            const medal = medals[placeNum] || '🏅';
            const ordinal = ordinals[placeNum] || placeNum + 'th';
            personalHTML = `
                <div style="text-align: center; padding: 20px 16px; background: linear-gradient(135deg, ${isWinner ? 'rgba(251,191,36,0.12)' : 'rgba(99,102,241,0.08)'}, transparent); border-radius: 12px; margin-bottom: 16px; border: 1px solid ${isWinner ? 'rgba(251,191,36,0.2)' : 'rgba(99,102,241,0.15)'};">
                    <div style="font-size: 2rem; margin-bottom: 6px;">${medal}</div>
                    <div style="font-size: 1.1rem; font-weight: 700; color: ${isWinner ? '#fbbf24' : '#fff'};">You placed ${ordinal}!</div>
                    ${prizeWon > 0 ? `<div style="font-size: 1.3rem; font-weight: 800; color: #00ff88; margin-top: 6px;">🪙 ${prizeWon} won</div>` : ''}
                </div>
            `;
        } else if (uid) {
            personalHTML = `
                <div style="text-align: center; padding: 14px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.06);">
                    <div style="font-size: 0.85rem; color: var(--text-muted);">You participated but did not place in the prizes</div>
                </div>
            `;
        }

        // ── Full Standings (lobby) ──
        let standingsHTML = '';
        const allStandings = normalizeFinalStandings(t.finalStandings);

        if (allStandings.length > 0) {
            const _sc2 = t.scoringConfigSnapshot || t.scoringConfig || null;
            const _pkpt2 = _sc2?.perKillPoint || 1;
            const _posPts2 = _sc2?.positionPoints || {};
            standingsHTML = allStandings.map((s, i) => {
                const rank = s.rank || (i + 1);
                const isMe = uid && (s.uid === uid || (Array.isArray(s.memberUids) && s.memberUids.includes(uid)));
                const prize = pb[String(rank)] || 0;
                const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
                const medal = medals[rank] || '';
                const sKills = s.kills || 0;
                const sPlacement = s.placement || 0;
                const killPts = sKills * _pkpt2;
                const posPts = Number(_posPts2[sPlacement]) || 0;

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); ${isMe ? 'background: rgba(251,191,36,0.08); border-left: 3px solid #fbbf24;' : ''}">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 26px; text-align: center; font-size: 0.82rem; font-weight: 700; color: ${rank <= 3 ? '#fbbf24' : 'var(--text-muted)'};">${medal || rank}</span>
                            <div>
                                <div style="font-size: 0.85rem; font-weight: ${isMe ? '700' : '500'}; color: ${isMe ? '#fbbf24' : '#fff'};">${escapeHtml(s.ign) || 'Player'}${isMe ? ' (You)' : ''}</div>
                                <div style="font-size: 0.65rem; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap;">
                                    <span style="color: #ef4444;">${sKills} kills (${killPts}pts)</span>
                                    <span style="color: rgba(255,255,255,0.15);">&#8226;</span>
                                    <span style="color: #3b82f6;">#${sPlacement} (${posPts}pts)</span>
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 700; font-size: 0.88rem; color: ${rank <= 3 ? '#00ff88' : '#fff'};">${s.score || 0} pts</div>
                            ${prize > 0 ? `<div style="font-size: 0.65rem; color: #00ff88;">🪙 ${prize}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // ── Bracket Winners (bracket tournaments) ──
        let bracketWinnersHTML = '';
        if (t.format !== 'LOBBY_ELIMINATION' && (t.champion || t.runnerUp)) {
            const winners = [];
            if (t.champion) {
                const cSnap = await db.ref('users/' + t.champion + '/fullName').once('value');
                winners.push({ rank: 1, name: cSnap.val() || 'Winner', prize: pb['1'] || 0, medal: '🥇' });
            }
            if (t.runnerUp) {
                const rSnap = await db.ref('users/' + t.runnerUp + '/fullName').once('value');
                winners.push({ rank: 2, name: rSnap.val() || 'Runner-up', prize: pb['2'] || 0, medal: '🥈' });
            }

            bracketWinnersHTML = winners.map(w => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.2rem;">${w.medal}</span>
                        <span style="font-weight: 600;">${escapeHtml(w.name)}</span>
                    </div>
                    <div style="text-align: right;">
                        ${w.prize > 0 ? `<span style="font-weight: 700; color: #00ff88;">🪙 ${w.prize}</span>` : '<span style="color: var(--text-muted);">-</span>'}
                    </div>
                </div>
            `).join('');
        }

        // ── Build Modal ──
        const hasStandings = standingsHTML || bracketWinnersHTML;

        const modal = document.createElement('div');
        modal.id = 'tournament-results-modal';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); display: flex; flex-direction: column; animation: fadeIn 0.2s ease;';

        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                <div>
                    <div style="font-size: 1rem; font-weight: 700;">🏆 Tournament Results</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(t.title || 'Tournament')}</div>
                </div>
                <button onclick="document.getElementById('tournament-results-modal')?.remove()" style="background: rgba(255,255,255,0.1); border: none; color: #fff; width: 32px; height: 32px; border-radius: 50%; font-size: 1rem; cursor: pointer;">✕</button>
            </div>
            <div style="flex: 1; overflow-y: auto; padding: 16px 20px;">
                ${personalHTML}
                ${hasStandings ? `
                    <div style="background: rgba(255,255,255,0.03); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06);">
                        <div style="font-size: 0.82rem; color: var(--primary); font-weight: 600; padding: 12px 14px 8px;">📊 Final Standings</div>
                        ${standingsHTML || bracketWinnersHTML}
                    </div>
                ` : '<div style="text-align: center; padding: 30px; color: var(--text-muted);">Results not available yet</div>'}
            </div>
        `;

        // Remove existing modal if any
        document.getElementById('tournament-results-modal')?.remove();
        document.body.appendChild(modal);

    } catch (err) {
        console.error('viewTournamentResults error:', err);
        showNotification('Failed to load results', 'error');
    }
};
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
if (!document.getElementById('tournament-animations')) {
    style.id = 'tournament-animations';
    document.head.appendChild(style);
}
