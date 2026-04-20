// JeetoPlay — eSports
// Auto-extracted from app.html

// XSS sanitization for user-controlled values (IGN names, titles, etc.)
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

let _esportsGamesListenerAttached = false; // Guard: prevent duplicate loads

async function loadEsportsGames() {
    if (_esportsGamesListenerAttached) return;
    _esportsGamesListenerAttached = true;

    const grid = document.getElementById('esports-games-grid');
    
    try {
        const { data: games, error } = await supa.from('games')
            .select('*')
            .eq('is_enabled', true)
            .order('sort_order', { ascending: true });

        grid.innerHTML = '';

        if (error || !games || games.length === 0) {
            grid.innerHTML = '<div style="grid-column: span 2; text-align:center; color:var(--text-muted); padding:20px;">No games available</div>';
            return;
        }

        games.forEach(game => {
            const gameId = game.id;
            const el = document.createElement('div');
            el.className = 'game-card';
            el.style.cursor = 'pointer';
            el.style.padding = '0';
            el.style.overflow = 'hidden';
            el.style.position = 'relative';
            el.style.borderRadius = '16px';
            el.style.aspectRatio = '1';
            el.onclick = () => navigateToGameMatches(gameId, game.name, game.icon);
            el.innerHTML = `
                <img src="${game.icon}" style="width:100%; height:100%; object-fit:cover; display:block;">
                <div style="position:absolute; bottom:0; left:0; right:0; padding:10px 8px 10px; background:linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%); text-align:center;">
                    <div style="font-weight:700; font-size:0.85rem; color:#fff; text-transform:uppercase; letter-spacing:0.5px; text-shadow: 0 1px 4px rgba(0,0,0,0.5);">${game.name}</div>
                </div>
            `;
            grid.appendChild(el);
        });
    } catch(e) {
        console.error('[Supabase] loadEsportsGames error:', e);
    }
}

// --- eSPORTS LOGIC ---
let matchFilter = 'UPCOMING';
let modeFilter = 'ALL';  // Mode filter: ALL, SOLO, DUO, SQUAD

function filterMatches(status, btn) {
    matchFilter = status;

    // Remove active class and btn-primary from all filter buttons
    const filterBtns = document.querySelectorAll('#match-filters button');
    filterBtns.forEach(el => {
        el.classList.remove('active-match-filter', 'btn-primary');
        el.classList.add('btn-outline');
    });

    // Add active class and btn-primary to clicked button
    btn.classList.add('active-match-filter', 'btn-primary');
    btn.classList.remove('btn-outline');

    loadMatchesList();
}

// Mode filter function (Solo / Duo / Squad)
function filterMode(mode, btn) {
    modeFilter = mode;

    // Update button states
    document.querySelectorAll('#mode-selector .mode-btn').forEach(el => {
        el.classList.remove('active-mode');
    });
    btn.classList.add('active-mode');

    loadMatchesList();
}

// Check if current user has joined a match (works for both legacy uid-key and new slot-based bookings)
function hasUserJoinedMatch(participants, uid) {
    if (!participants || !uid) return false;
    // Legacy: direct uid key
    if (participants[uid]) return true;
    // Slot-based: check bookedBy field in each participant
    return Object.values(participants).some(p => p.bookedBy === uid);
}

let _matchListenerRef = null; // Track active listener to detach on game switch

function loadMatchesList() {
    const selectedGameId = state.selectedGameId;
    if (!selectedGameId) {
        document.getElementById('matches-list').innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Select a game to view matches</div>';
        return;
    }

    // Detach previous listener and clear auto-refresh timer
    if (_matchListenerRef) {
        // Legacy Firebase cleanup (safe to call even if not attached)
        try { _matchListenerRef.off && _matchListenerRef.off('value'); } catch(e) {}
        _matchListenerRef = null;
    }
    if (window._esportsRefreshTimer) {
        clearInterval(window._esportsRefreshTimer);
        window._esportsRefreshTimer = null;
    }

    // ==================== SUPABASE DATA FETCH ====================
    // Supabase can filter by game_id + status in ONE query
    // (Firebase RTDB could only filter by one field = wasted bandwidth)
    const fetchMatches = async () => {
        const list = document.getElementById('matches-list');
        list.innerHTML = '';

        try {
            // Build query: filter by game AND status server-side
            let query = supa.from('matches')
                .select('*, match_participants(*)')
                .eq('game_id', selectedGameId)
                .eq('status', matchFilter)
                .neq('status', 'CANCELLED');

            if (matchFilter === 'UPCOMING') {
                query = query.order('date_time', { ascending: true }).limit(100);
            } else {
                query = query.order('date_time', { ascending: false }).limit(20);
            }

            const { data: rows, error } = await query;

            if (error) {
                console.error('[Supabase] Match fetch error:', error.message);
                list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Error loading matches</div>';
                return;
            }

            if (!rows || rows.length === 0) {
                list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No matches found</div>';
                return;
            }

            // Transform Supabase rows → Firebase-compatible format
            // (so ALL existing rendering code below works unchanged)
            const matchesArr = [];
            const now = Date.now();

            rows.forEach(m => {
                const match = {
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
                    version: m.version,
                    createdBy: m.created_by,
                    participants: {}
                };

                // Convert participants array → Firebase-style object { uid: {...} }
                if (m.match_participants && m.match_participants.length > 0) {
                    m.match_participants.forEach(p => {
                        match.participants[p.user_uid] = {
                            ign: p.username || 'Player',
                            username: p.username,
                            slotNumber: p.slot_number,
                            kills: p.kills || 0,
                            placement: p.placement,
                            prizeAmount: p.prize_amount || 0,
                            bookedBy: p.booked_by || p.user_uid,
                            teamName: p.team_name,
                            slotPosition: p.slot_number,
                            teamNumber: p.team_name ? parseInt(p.team_name.replace(/\D/g, '')) || 0 : 0,
                            uid: p.user_uid
                        };
                    });
                }

                // Hide expired UPCOMING with 0 participants
                if (match.status === 'UPCOMING') {
                    const matchTimeMs = new Date(match.dateTime).getTime();
                    const participantCount = Object.keys(match.participants).length;
                    if (participantCount === 0 && matchTimeMs && now > matchTimeMs) return;
                }

                // Mode filter
                const normalizedType = (match.type || '').trim().toUpperCase();
                if (modeFilter !== 'ALL' && normalizedType !== modeFilter) return;

                matchesArr.push(match);
            });

        // Already sorted by Supabase query, and limited
        const displayMatches = matchesArr;

        // Render sorted matches
        displayMatches.forEach(match => {
            const joinedCount = match.participants ? Object.keys(match.participants).length : 0;
            const maxSlots = match.maxParticipants || 100;
            const isFull = joinedCount >= maxSlots;
            const hasJoined = hasUserJoinedMatch(match.participants, state.user.uid);
            const progressPercent = Math.min((joinedCount / maxSlots) * 100, 100);

            // Type info
            const matchTypeRaw = (match.type || 'Solo').trim().toUpperCase();
            const typeClass = matchTypeRaw.includes('SQUAD') ? 'type-squad' : matchTypeRaw.includes('DUO') ? 'type-duo' : 'type-solo';

            // Status
            const statusClass = match.status === 'LIVE' ? 'status-live' : match.status === 'COMPLETED' ? 'status-completed' : 'status-upcoming';
            const statusIcon = match.status === 'LIVE' ? '<i class="fa-solid fa-circle" style="font-size:0.45rem;vertical-align:middle;margin-right:3px;"></i>' : '';

            // Slot fill class
            const slotClass = isFull ? 'slot-full' : progressPercent > 60 ? 'slot-filling' : 'slot-open';

            // Format date: "17 Mar, 10:35 PM"
            const matchDate = new Date(match.dateTime || match.time);
            const day = matchDate.getDate();
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const month = monthNames[matchDate.getMonth()];
            let hours = matchDate.getHours();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const mins = String(matchDate.getMinutes()).padStart(2, '0');
            const dateTimeStr = `${day} ${month}, ${hours}:${mins} ${ampm}`;

            // Map display
            const mapDisplay = match.map || '';
            const typeDisplay = matchTypeRaw + (mapDisplay ? ' • ' + mapDisplay : '');

            const el = document.createElement('div');
            el.className = 'match-card';
            el.style.cursor = 'pointer';
            el.onclick = () => viewMatchDetails(match.id);

            // CTA / Status indicator
            let statusIndicator = '';
            if (match.status === 'UPCOMING') {
                if (hasJoined) {
                    statusIndicator = `<div class="mc-status-bar mc-joined">
                        <span><i class="fa-solid fa-circle-check"></i> Joined</span>
                        <span class="mc-status-hint">Tap for details <i class="fa-solid fa-chevron-right"></i></span>
                    </div>`;
                } else if (isFull) {
                    statusIndicator = `<div class="mc-status-bar mc-full">
                        <i class="fa-solid fa-ban"></i> MATCH FULL
                    </div>`;
                } else {
                    statusIndicator = `<div onclick="event.stopPropagation(); openSlotModal('${match.id}')" class="mc-join-btn">
                        <i class="fa-solid fa-bolt"></i> Join Now — ${match.entryFee > 0 ? '🪙 ' + match.entryFee : 'FREE'}
                    </div>`;
                }
            } else if (match.status === 'LIVE') {
                statusIndicator = `<div class="mc-status-bar mc-live">
                    <span><i class="fa-solid fa-broadcast-tower"></i> LIVE NOW</span>
                    ${hasJoined ? '<span class="mc-status-hint">Room details <i class="fa-solid fa-chevron-right"></i></span>' : ''}
                </div>`;
            } else if (match.status === 'COMPLETED') {
                statusIndicator = `<div onclick="event.stopPropagation(); viewMatchResults('${match.id}')" class="mc-status-bar mc-result">
                    <i class="fa-solid fa-trophy"></i>
                    <span>View Results</span>
                    <i class="fa-solid fa-chevron-right" style="font-size:0.6rem;opacity:0.5;"></i>
                </div>`;
            }

            el.innerHTML = `
                <div class="mc-inner">
                    <!-- Header: Title + Status -->
                    <div class="mc-header">
                        <div class="mc-title-block">
                            <div class="mc-title">${match.title}</div>
                            <div class="mc-id">#${match.matchId || match.id.slice(-10)}</div>
                        </div>
                        <span class="mc-status ${statusClass}">${statusIcon}${match.status}</span>
                    </div>

                    <!-- 2-Row Detail Grid -->
                    <div class="mc-grid">
                        <div class="mc-cell mc-prize">
                            <div class="mc-cell-label">Prize Pool</div>
                            <div class="mc-cell-value mc-val-green">🪙 ${match.prizePool}</div>
                        </div>
                        <div class="mc-cell mc-kill">
                            <div class="mc-cell-label">Per Kill</div>
                            <div class="mc-cell-value mc-val-gold">🪙 ${match.perKill}</div>
                        </div>
                        <div class="mc-cell mc-fee">
                            <div class="mc-cell-label">Entry Fee</div>
                            <div class="mc-cell-value mc-val-cyan">${match.entryFee > 0 ? '🪙 ' + match.entryFee : 'FREE'}</div>
                        </div>
                        <div class="mc-cell mc-date">
                            <div class="mc-cell-label"><i class="fa-regular fa-calendar"></i> Schedule</div>
                            <div class="mc-cell-value mc-val-white">${dateTimeStr}</div>
                        </div>
                        <div class="mc-cell mc-type">
                            <div class="mc-cell-label"><i class="fa-solid fa-gamepad"></i> Type</div>
                            <div class="mc-cell-value"><span class="mc-type-pill ${typeClass}">${typeDisplay}</span></div>
                        </div>
                        <div class="mc-cell mc-slots">
                            <div class="mc-cell-label"><i class="fa-solid fa-users"></i> Filled</div>
                            <div class="mc-cell-value" style="color:${isFull ? '#ef4444' : '#06b6d4'}">${joinedCount}<span style="opacity:0.4;font-weight:400;">/${maxSlots}</span></div>
                            <div class="mc-slot-track">
                                <div class="mc-slot-fill ${slotClass}" style="width:${progressPercent}%;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Admin Comment Banner -->
                    ${match.adminComment?.text ? `
                    <div style="margin:0 10px; padding:8px 12px; background:rgba(251,191,36,0.12); border:1px solid rgba(251,191,36,0.25); border-radius:8px; display:flex; align-items:flex-start; gap:8px;">
                        <i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24; font-size:0.75rem; margin-top:2px; flex-shrink:0;"></i>
                        <div style="font-size:0.75rem; color:#fbbf24; line-height:1.4; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${escapeHtml(match.adminComment.text)}</div>
                    </div>
                    ` : ''}

                    <!-- CTA -->
                    ${statusIndicator}
                </div>
            `;
            list.appendChild(el);
        });

        if (list.children.length === 0) {
            list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No ' + matchFilter.toLowerCase() + ' matches</div>';
        }
        } catch(e) {
            console.error('[Supabase] fetchMatches error:', e);
            list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Error loading matches</div>';
        }
    };

    // Initial fetch + auto-refresh every 30 seconds
    fetchMatches();
    window._esportsRefreshTimer = setInterval(fetchMatches, 30000);
}

// View Participants - IGN Only (No user IDs, emails, or phones)
// Team-aware: groups players by team for Duo/Squad modes
window.viewParticipants = async function (matchId) {
    const listEl = document.getElementById('participants-list');
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading...</div>';
    document.getElementById('participants-modal').classList.remove('hidden');

    try {
        // Supabase: get participants + match type in one query
        const { data: matchData, error: mErr } = await supa.from('matches')
            .select('type, match_participants(*)')
            .eq('id', matchId)
            .single();

        if (mErr || !matchData || !matchData.match_participants || matchData.match_participants.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No participants yet</div>';
            return;
        }

        const matchType = (matchData.type || 'SOLO').trim().toUpperCase();
        // Convert to Firebase-compatible format for existing rendering code
        const participants = {};
        matchData.match_participants.forEach(p => {
            participants[p.user_uid] = {
                ign: p.username || 'Player',
                username: p.username,
                slotNumber: p.slot_number,
                kills: p.kills || 0,
                placement: p.placement,
                prizeAmount: p.prize_amount || 0,
                bookedBy: p.booked_by || p.user_uid,
                teamName: p.team_name,
                slotPosition: p.slot_number,
                teamNumber: p.team_name ? parseInt(p.team_name.replace(/\D/g, '')) || 0 : 0,
                uid: p.user_uid
            };
        });
        // Create snap-like interface for existing code
        const pSnap = {
            exists: () => true,
            val: () => participants,
            forEach: (cb) => Object.keys(participants).forEach(key => cb({ key, val: () => participants[key] }))
        };
        const typeSnap = { val: () => matchType };

        const _vpMatchType = (typeSnap.val() || 'solo').toLowerCase();
        const _vpIsTeamMode = _vpMatchType.includes('duo') || _vpMatchType.includes('squad');
        const _vpTeamSize = _vpMatchType.includes('squad') ? 4 : 2;

        // Batch-fetch VIP flags for all participant UIDs
        const vipMap = {};
        const entries = [];
        pSnap.forEach(child => { entries.push({ key: child.key, val: child.val() }); });
        const uids = entries.map(e => e.val.bookedBy || e.key).filter(Boolean);
        const uniqueUids = [...new Set(uids)];
        await Promise.all(uniqueUids.map(async uid => {
            try {
                const { data } = await supa.from('profiles').select('is_vip').eq('uid', uid).single();
                vipMap[uid] = data?.is_vip === true;
            } catch (e) { /* ignore */ }
        }));

        listEl.innerHTML = '';

        if (_vpIsTeamMode) {
            // ── TEAM MODE: Group by team number ──
            const _vpTeamColors = ['#00ff88','#6366f1','#ffc107','#ff6b6b','#4dd0e1','#ff9500','#a78bfa','#f472b6','#34d399','#f59e0b','#06b6d4','#ec4899','#84cc16','#e879f9'];
            const teamGroups = {};
            entries.forEach(({ key, val }) => {
                const tm = key.match(/team_(\d+)/);
                const teamNum = tm ? tm[1] : (val.teamNumber ? String(val.teamNumber) : '0');
                if (!teamGroups[teamNum]) teamGroups[teamNum] = [];
                teamGroups[teamNum].push({ key, val });
            });
            const sortedTeams = Object.keys(teamGroups).sort((a, b) => parseInt(a) - parseInt(b));

            sortedTeams.forEach((tNum, tIdx) => {
                const members = teamGroups[tNum];
                const tColor = _vpTeamColors[tIdx % _vpTeamColors.length];

                // Team header
                const teamHeader = document.createElement('div');
                teamHeader.style.cssText = `padding:10px 15px 8px; display:flex; align-items:center; gap:8px; background:linear-gradient(90deg, ${tColor}12, transparent); border-bottom:1px solid ${tColor}20;`;
                teamHeader.innerHTML = `
                    <div style="width:28px; height:28px; background:${tColor}20; border:1.5px solid ${tColor}50; border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.75rem; color:${tColor};">${tNum}</div>
                    <span style="font-weight:700; font-size:0.82rem; color:${tColor}; letter-spacing:0.3px;">TEAM ${tNum}</span>
                    <span style="font-size:0.68rem; color:var(--text-muted); margin-left:auto; padding:2px 8px; background:var(--bg-hover); border-radius:10px;">${members.length}/${_vpTeamSize}</span>
                `;
                listEl.appendChild(teamHeader);

                // Team members
                members.forEach(({ key, val: p }) => {
                    const pUid = p.bookedBy || key;
                    const vipBadge = vipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                    const item = document.createElement('div');
                    item.style.cssText = `padding:8px 15px 8px 42px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px;`;
                    item.innerHTML = `
                        <div style="width:22px; height:22px; background:${tColor}15; border:1px solid ${tColor}35; border-radius:5px; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:0.65rem; color:${tColor};">${p.slotPosition || '•'}</div>
                        <div style="font-weight:600; color:var(--text-main); font-size:0.9rem;">
                            ${p.ign || 'Player'} ${vipBadge}
                        </div>
                    `;
                    listEl.appendChild(item);
                });
            });
        } else {
            // ── SOLO MODE: Original flat list ──
            let count = 0;
            entries.forEach(({ key, val: p }) => {
                count++;
                const pUid = p.bookedBy || key;
                const vipBadge = vipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                const item = document.createElement('div');
                item.style.padding = '10px 15px';
                item.style.borderBottom = '1px solid var(--border)';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.gap = '12px';
                item.innerHTML = `
                    <div style="width:32px; height:32px; background:var(--bg-hover); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600; color:var(--primary);">
                        ${count}
                    </div>
                    <div style="font-weight:600; color:var(--text-main);">
                        ${p.ign || 'Player ' + count} ${vipBadge}
                    </div>
                `;
                listEl.appendChild(item);
            });
        }
    } catch (err) {
        listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--danger);">Error loading participants</div>';
    }
};

// View Room Details - Shows Room ID and Password for LIVE matches
window.viewRoomDetails = async function (matchId) {
    try {
        const matchSnap = await db.ref('esports_matches/' + matchId).once('value');
        const match = matchSnap.val();

        if (!match) {
            showToast('Match not found', 'error');
            return;
        }

        // Check if user is a participant
        // Works with BOTH old format (uid as key) AND new format (team_X_Y with bookedBy field)
        const uid = state.user?.uid;
        let isParticipant = false;

        if (match.participants) {
            // Check old format: uid as key
            if (match.participants[uid]) {
                isParticipant = true;
            } else {
                // Check new format: search for bookedBy match
                isParticipant = Object.values(match.participants).some(p => p.bookedBy === uid);
            }
        }

        if (!isParticipant) {
            showToast('You are not a participant in this match', 'error');
            return;
        }

        // Check if match is LIVE
        if (match.status !== 'LIVE') {
            showToast('Room details are only available when match is LIVE', 'error');
            return;
        }

        // Check if room details exist
        if (!match.roomId || !match.roomPassword) {
            showToast('Room details not yet uploaded by admin', 'error');
            return;
        }

        // Show premium room details modal
        const modalHtml = `
            <div id="room-details-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius:16px; padding:24px; max-width:340px; width:100%; border: 2px solid var(--primary); box-shadow: 0 0 40px rgba(0,255,136,0.2);">
                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="width:60px; height:60px; background:linear-gradient(135deg, #00ff88, #00cc6a); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">
                            <i class="fa-solid fa-gamepad" style="font-size:28px; color:#000;"></i>
                        </div>
                        <h3 style="color:var(--primary); margin:0; font-size:1.3rem;">🎮 ROOM DETAILS</h3>
                        <div style="color:var(--text-muted); font-size:0.85rem; margin-top:4px;">${match.title || 'Match'}</div>
                    </div>
                    
                    <div style="background:rgba(0,255,136,0.1); border:1px solid var(--primary); border-radius:12px; padding:16px; margin-bottom:16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <span style="color:var(--text-muted); font-size:0.85rem;">ROOM ID</span>
                            <button onclick="navigator.clipboard.writeText('${match.roomId}'); showToast('Room ID copied!')" style="background:transparent; border:1px solid var(--primary); color:var(--primary); padding:4px 10px; border-radius:6px; font-size:0.75rem; cursor:pointer;">
                                <i class="fa-solid fa-copy"></i> Copy
                            </button>
                        </div>
                        <div style="font-family:monospace; font-size:1.5rem; font-weight:700; color:#fff; letter-spacing:2px;">${match.roomId}</div>
                    </div>
                    
                    <div style="background:rgba(0,255,136,0.1); border:1px solid var(--primary); border-radius:12px; padding:16px; margin-bottom:20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <span style="color:var(--text-muted); font-size:0.85rem;">PASSWORD</span>
                            <button onclick="navigator.clipboard.writeText('${match.roomPassword}'); showToast('Password copied!')" style="background:transparent; border:1px solid var(--primary); color:var(--primary); padding:4px 10px; border-radius:6px; font-size:0.75rem; cursor:pointer;">
                                <i class="fa-solid fa-copy"></i> Copy
                            </button>
                        </div>
                        <div style="font-family:monospace; font-size:1.5rem; font-weight:700; color:#fff; letter-spacing:2px;">${match.roomPassword}</div>
                    </div>
                    
                    <div style="text-align:center; color:var(--warning); font-size:0.8rem; margin-bottom:16px;">
                        <i class="fa-solid fa-clock"></i> Match is LIVE! Join now!
                    </div>
                    
                    <button onclick="document.getElementById('room-details-modal').remove()" style="width:100%; background:linear-gradient(135deg, #00ff88, #00cc6a); color:#000; border:none; padding:14px; border-radius:10px; font-weight:700; font-size:1rem; cursor:pointer;">
                        Got it!
                    </button>
                </div>
            </div>
        `;

        // Remove existing modal if any
        document.getElementById('room-details-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (err) {
        console.error('View room details error:', err);
        showToast('Error loading room details', 'error');
    }
};

// View Match Results - Enhanced results with match info and position rewards
window.viewMatchResults = async function (matchId) {
    try {
        const matchSnap = await db.ref('esports_matches/' + matchId).once('value');
        const match = matchSnap.val();

        if (!match) {
            showToast('Match not found', 'error');
            return;
        }

        // Get participants and results
        const participants = match.participants || {};
        const results = match.results || {};
        const participantList = Object.entries(participants);
        const uid = state.user?.uid;

        // Calculate total distributed - handle both solo and team formats
        let totalDistributed = 0;
        const matchType = (match.type || match.matchType || 'solo').toLowerCase();
        const isTeamMode = matchType.includes('duo') || matchType.includes('squad');

        if (isTeamMode) {
            Object.values(results).forEach(teamResult => {
                if (teamResult.bookerBreakdown) {
                    Object.values(teamResult.bookerBreakdown).forEach(booker => {
                        totalDistributed += (booker.creditedAmount || 0);
                    });
                }
            });
        } else {
            Object.values(results).forEach(r => {
                totalDistributed += (r.reward || 0);
            });
        }

        // Position rewards setup
        const posRewards = match.positionRewards || {};
        const medalMap = { '1': '🥇', '2': '🥈', '3': '🥉' };
        const ordMap = { '1': '1st', '2': '2nd', '3': '3rd' };
        for (let p = 4; p <= 20; p++) ordMap[String(p)] = p + 'th';

        let posRewardsHTML = '';
        const prizeEntries = Object.entries(posRewards).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        if (prizeEntries.length > 0) {
            posRewardsHTML = `
                <div style="padding:12px 16px; border-bottom:1px solid var(--border);">
                    <div style="font-size:0.75rem; color:var(--primary); margin-bottom:8px; font-weight:600;">🏆 POSITION PRIZES</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                        ${prizeEntries.map(([place, amount]) => `
                            <div style="flex:1; min-width:70px; text-align:center; padding:8px 4px; background:var(--bg-hover); border-radius:8px;">
                                <div style="font-size:0.85rem;">${medalMap[place] || '🏅'}</div>
                                <div style="font-size:0.7rem; color:var(--text-muted);">${ordMap[place] || place + 'th'}</div>
                                <div style="font-weight:700; color:#00ff88; font-size:0.85rem;">🪙 ${amount}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Build participants HTML with rewards
        let playersHtml = '';
        let displayData = [];
        let teamDisplayData = []; // For team-grouped rendering
        let myResultHTML = '';

        if (isTeamMode) {
            // ── TEAM MODE: Group participants by team ──
            const teamGroups = {};
            participantList.forEach(([slotKey, p]) => {
                const teamMatch = slotKey.match(/team_(\d+)/);
                const teamNum = teamMatch ? teamMatch[1] : '0';
                if (!teamGroups[teamNum]) teamGroups[teamNum] = [];
                teamGroups[teamNum].push({ slotKey, p });
            });

            // Batch-fetch VIP flags
            const _rVipMap = {};
            const allUids = participantList.map(([k, p]) => p.bookedBy || k).filter(Boolean);
            const uniqueUids = [...new Set(allUids)];
            await Promise.all(uniqueUids.map(async rUid => {
                try { const s = await db.ref(`users/${rUid}/isVip`).once('value'); _rVipMap[rUid] = s.val() === true; } catch (e) { }
            }));

            // Build team-level display data
            Object.keys(teamGroups).forEach(teamNum => {
                const teamMembers = teamGroups[teamNum];
                const teamResultKey = `team_${teamNum}`;
                const teamResult = results[teamResultKey] || {};
                const position = teamResult.position || 0;
                const totalKills = teamResult.totalKills || 0;
                const positionReward = teamResult.positionReward || 0;

                // Calculate total team reward from bookerBreakdown
                let totalTeamReward = 0;
                if (teamResult.bookerBreakdown) {
                    Object.values(teamResult.bookerBreakdown).forEach(b => {
                        totalTeamReward += (b.creditedAmount || 0);
                    });
                }

                // Check if current user is in this team
                let isMyTeam = false;
                let myKills = 0;
                let myReward = 0;

                // Build player entries for this team
                const players = teamMembers.map(({ slotKey, p }) => {
                    const playerData = (teamResult.playerResults || []).find(pr => pr.slotKey === slotKey) || {};
                    const kills = playerData.kills ?? 0;
                    const bookerUid = p.bookedBy || slotKey;
                    const isMe = slotKey === uid || bookerUid === uid;
                    if (isMe) {
                        isMyTeam = true;
                        myKills = kills;
                        // Get this user's reward from bookerBreakdown
                        const myBookerData = teamResult.bookerBreakdown?.[uid] || {};
                        myReward = myBookerData.creditedAmount || 0;
                    }
                    const vipBadge = _rVipMap[bookerUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                    return { slotKey, p, kills, bookerUid, isMe, vipBadge, slotPosition: p.slotPosition || '?' };
                });

                teamDisplayData.push({
                    teamNum, position, totalKills, positionReward, totalTeamReward, players, isMyTeam, myKills, myReward
                });
            });

            // Sort teams by position (ascending), unranked at bottom
            teamDisplayData.sort((a, b) => {
                const posA = a.position || 999;
                const posB = b.position || 999;
                if (posA !== posB) return posA - posB;
                return b.totalKills - a.totalKills;
            });

            // Build "YOUR TEAM RESULT" section
            const myTeam = teamDisplayData.find(t => t.isMyTeam);
            if (myTeam) {
                const myTeamPos = myTeam.position ? '#' + myTeam.position : '–';
                myResultHTML = `
                <div style="padding:10px 14px; background:linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08)); border-bottom:1px solid var(--border);">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:0.72rem; color:#818cf8; font-weight:600;">🛡️ YOUR TEAM</span>
                            <span style="font-size:0.6rem; padding:1px 6px; background:rgba(99,102,241,0.2); border-radius:8px; color:#818cf8;">Team ${myTeam.teamNum}</span>
                        </div>
                        <div style="font-weight:700; font-size:0.9rem; color:${myTeam.totalTeamReward > 0 ? '#00ff88' : 'var(--text-muted)'};">${myTeam.totalTeamReward > 0 ? '+🪙 ' + myTeam.totalTeamReward : '🪙 0'}</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; gap:6px;">
                        <div style="display:flex; gap:12px; align-items:center;">
                            <div style="text-align:center;"><div style="font-size:0.58rem; color:var(--text-muted);">RANK</div><div style="font-weight:700; font-size:0.95rem; color:#fff;">${myTeamPos}</div></div>
                            <div style="text-align:center;"><div style="font-size:0.58rem; color:var(--text-muted);">TEAM K</div><div style="font-weight:700; font-size:0.95rem; color:#ffc107;">${myTeam.totalKills}</div></div>
                            <div style="text-align:center;"><div style="font-size:0.58rem; color:var(--text-muted);">YOUR K</div><div style="font-weight:700; font-size:0.95rem; color:#818cf8;">${myTeam.myKills}</div></div>
                        </div>
                        ${myTeam.myReward > 0 && myTeam.myReward !== myTeam.totalTeamReward ? `<div style="text-align:center;"><div style="font-size:0.58rem; color:rgba(129,140,248,0.7);">YOUR SHARE</div><div style="font-weight:700; font-size:0.85rem; color:#00ff88;">🪙 ${myTeam.myReward}</div></div>` : ''}
                    </div>
                </div>
                `;
            }

            // Render team cards
            teamDisplayData.forEach((team) => {
                const posNum = team.position || 0;
                const isTop3 = posNum > 0 && posNum <= 3;
                const isWinner = team.totalTeamReward > 0;
                const borderColor = team.isMyTeam ? '#6366f1' : isTop3 ? '#ffd700' : isWinner ? '#00ff88' : 'var(--border)';
                const bgGrad = team.isMyTeam
                    ? 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))'
                    : isTop3
                        ? 'linear-gradient(135deg, rgba(255,215,0,0.06), rgba(255,140,0,0.03))'
                        : isWinner
                            ? 'linear-gradient(135deg, rgba(0,255,136,0.04), rgba(0,204,106,0.02))'
                            : 'transparent';

                // Team header
                const rankDisplay = isTop3 ? (medalMap[String(posNum)] || '#' + posNum) : (posNum > 0 ? '#' + posNum : '–');
                const rankBg = isTop3 ? 'linear-gradient(135deg, #ffd700, #ff8c00)' : isWinner ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : 'var(--bg-hover)';
                const rankColor = isTop3 || isWinner ? '#000' : 'var(--text-muted)';

                let teamCardHtml = `
                <div style="margin:5px 10px; border-radius:12px; border:1px solid ${borderColor}; overflow:hidden; background:${bgGrad};">
                    <!-- Team Header -->
                    <div style="display:flex; align-items:center; gap:8px; padding:9px 12px; background:rgba(0,0,0,0.15);">
                        <div style="width:30px; height:30px; background:${rankBg}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:${isTop3 ? '0.9rem' : '0.78rem'}; color:${rankColor}; flex-shrink:0;">
                            ${rankDisplay}
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; font-size:0.85rem; color:#fff;">Team ${team.teamNum}${team.isMyTeam ? ' <span style="font-size:0.55rem; padding:1px 5px; background:rgba(99,102,241,0.25); border-radius:8px; color:#818cf8; margin-left:3px;">YOU</span>' : ''}</div>
                            <div style="display:flex; gap:8px; margin-top:1px;">
                                <span style="font-size:0.68rem; color:var(--text-muted);"><i class="fa-solid fa-crosshairs"></i> ${team.totalKills}</span>
                                <span style="font-size:0.68rem; color:var(--text-muted);"><i class="fa-solid fa-users"></i> ${team.players.length}</span>
                            </div>
                        </div>
                        ${team.totalTeamReward > 0 ? `<div style="color:#00ff88; font-weight:700; font-size:0.9rem; flex-shrink:0;">+🪙 ${team.totalTeamReward}</div>` : '<div style="color:var(--text-muted); font-size:0.8rem; flex-shrink:0;">–</div>'}
                    </div>
                    <!-- Player Rows -->
                    <div style="padding:2px 0;">
                `;

                team.players.forEach((player) => {
                    const isMe = player.isMe;
                    const playerKills = player.kills ?? 0;
                    teamCardHtml += `
                        <div style="display:flex; align-items:center; gap:8px; padding:5px 12px; ${isMe ? 'background:rgba(99,102,241,0.1);' : ''}">
                            <div style="width:18px; height:18px; background:var(--bg-hover); border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:600; color:var(--primary); flex-shrink:0;">${player.slotPosition}</div>
                            <div style="flex:1; min-width:0;">
                                <span style="font-weight:600; font-size:0.78rem; ${isMe ? 'color:#6366f1;' : 'color:var(--text-main);'}">${escapeHtml(player.p.ign) || 'Player'}</span>
                                ${player.vipBadge}
                                ${isMe ? ' <span style="font-size:0.55rem; padding:1px 4px; background:rgba(99,102,241,0.2); border-radius:6px; color:#818cf8;">YOU</span>' : ''}
                            </div>
                            <div style="font-size:0.72rem; color:var(--text-muted); flex-shrink:0;"><i class="fa-solid fa-crosshairs" style="font-size:0.6rem;"></i> ${playerKills}</div>
                        </div>
                    `;
                });

                // Team footer with position reward info
                if (team.positionReward > 0) {
                    teamCardHtml += `
                        <div style="padding:4px 12px 5px; border-top:1px solid rgba(255,255,255,0.05);">
                            <div style="font-size:0.62rem; color:var(--text-muted); display:flex; justify-content:space-between;">
                                <span>🏆 Pos: 🪙 ${team.positionReward}</span>
                                <span>Kills: 🪙 ${team.totalKills * (match.perKill || 0)}</span>
                            </div>
                        </div>
                    `;
                }

                teamCardHtml += `
                    </div>
                </div>`;

                playersHtml += teamCardHtml;
            });

        } else {
            // ── SOLO MODE: Original flat rendering (unchanged) ──
            participantList.forEach(([participantUid, p]) => {
                const result = results[participantUid] || {};
                displayData.push({
                    slotKey: participantUid,
                    p,
                    kills: result.kills ?? '-',
                    reward: result.reward || 0,
                    position: result.position || '-',
                    teamNum: null,
                    bookerUid: participantUid
                });
            });

            // Sort by position (best first) or reward (highest first)
            displayData.sort((a, b) => {
                const posA = a.position === '-' ? 999 : parseInt(a.position);
                const posB = b.position === '-' ? 999 : parseInt(b.position);
                if (posA !== posB) return posA - posB;
                return (b.reward || 0) - (a.reward || 0);
            });

            // Find current user's result
            let myResult = null;
            displayData.forEach(d => {
                if (d.slotKey === uid || d.bookerUid === uid) {
                    myResult = d;
                }
            });

            // Batch-fetch VIP flags for results
            const _rVipMap = {};
            const _rUids = displayData.map(d => d.bookerUid || d.slotKey).filter(Boolean);
            const _rUniqueUids = [...new Set(_rUids)];
            await Promise.all(_rUniqueUids.map(async rUid => {
                try { const s = await db.ref(`users/${rUid}/isVip`).once('value'); _rVipMap[rUid] = s.val() === true; } catch (e) { }
            }));

            displayData.forEach(({ slotKey, p, kills, reward, position, teamNum, bookerUid }, index) => {
                const isMe = slotKey === uid || bookerUid === uid;
                const posNum = position !== '-' ? parseInt(position) : null;
                const isWinner = reward > 0;
                const isTop3 = posNum && posNum <= 3;
                const rVipBadge = _rVipMap[bookerUid || slotKey] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';

                playersHtml += `
                    <div style="display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); ${isMe ? 'background:rgba(99,102,241,0.12); border-left:3px solid #6366f1;' : isWinner ? 'background:rgba(0,255,136,0.05);' : ''}">
                        <div style="width:34px; height:34px; background:${isTop3 ? 'linear-gradient(135deg, #ffd700, #ff8c00)' : isWinner ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : 'var(--bg-hover)'}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:${isTop3 ? '1rem' : '0.85rem'}; color:${isTop3 || isWinner ? '#000' : 'var(--text-muted)'}; flex-shrink:0;">
                            ${isTop3 ? (medalMap[String(posNum)] || posNum) : (position !== '-' ? position : index + 1)}
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:600; font-size:0.9rem; ${isMe ? 'color:#6366f1;' : ''}">${escapeHtml(p.ign) || 'Player'} ${rVipBadge}${isMe ? ' <span style="font-size:0.65rem; padding:1px 6px; background:rgba(99,102,241,0.2); border-radius:10px; color:#818cf8;">YOU</span>' : ''}</div>
                            <div style="display:flex; gap:10px; margin-top:2px;">
                                ${kills !== '-' ? `<span style="font-size:0.73rem; color:var(--text-muted);"><i class="fa-solid fa-crosshairs"></i> ${kills} kills</span>` : ''}
                                ${posNum ? `<span style="font-size:0.73rem; color:var(--text-muted);"><i class="fa-solid fa-ranking-star"></i> #${posNum}</span>` : ''}
                            </div>
                        </div>
                        ${reward > 0 ? `<div style="color:#00ff88; font-weight:700; font-size:0.95rem; flex-shrink:0;">+🪙 ${reward}</div>` : '<div style="color:var(--text-muted); font-size:0.85rem; flex-shrink:0;">-</div>'}
                    </div>
                `;
            });

            // Current user's result summary (Solo)
            if (myResult) {
                myResultHTML = `
                    <div style="padding:12px 16px; background:linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1)); border-bottom:1px solid var(--border);">
                        <div style="font-size:0.75rem; color:#818cf8; font-weight:600; margin-bottom:6px;">YOUR RESULT</div>
                        <div style="display:flex; justify-content:space-around; text-align:center;">
                            <div>
                                <div style="font-size:0.68rem; color:var(--text-muted);">POSITION</div>
                                <div style="font-weight:700; font-size:1.1rem;">${myResult.position !== '-' ? '#' + myResult.position : '-'}</div>
                            </div>
                            <div>
                                <div style="font-size:0.68rem; color:var(--text-muted);">KILLS</div>
                                <div style="font-weight:700; font-size:1.1rem;">${myResult.kills !== '-' ? myResult.kills : '-'}</div>
                            </div>
                            <div>
                                <div style="font-size:0.68rem; color:var(--text-muted);">EARNED</div>
                                <div style="font-weight:700; font-size:1.1rem; color:${myResult.reward > 0 ? '#00ff88' : 'var(--text-muted)'};">${myResult.reward > 0 ? '+🪙 ' + myResult.reward : '🪙 0'}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // Show results modal
        const modalHtml = `
            <div id="match-results-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:1000; display:flex; align-items:flex-end; justify-content:center; padding:0;">
                <div style="background: linear-gradient(145deg, #0f1923 0%, #151f2e 50%, #0d1520 100%); border-radius:20px 20px 0 0; max-width:420px; width:100%; max-height:95vh; overflow:hidden; display:flex; flex-direction:column; border: 1.5px solid #6366f1; border-bottom:none; box-shadow: 0 0 60px rgba(0,0,0,0.5), 0 0 20px rgba(99,102,241,0.2);">
                    <!-- Compact Header -->
                    <div style="padding:14px 16px 10px; text-align:center; border-bottom:1px solid var(--border);">
                        <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:4px;">
                            <div style="width:32px; height:32px; background:linear-gradient(135deg, #ffd700, #ff8c00); border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fa-solid fa-trophy" style="font-size:15px; color:#000;"></i>
                            </div>
                            <div style="text-align:left;">
                                <h3 style="margin:0; color:#fff; font-size:1rem; line-height:1.2;">${match.title || 'Match Results'}</h3>
                                <div style="color:var(--text-muted); font-size:0.75rem;">${match.gameName || 'Game'} • ${(match.type || 'Solo')} • ${match.map || 'Map'} • ${new Date(match.dateTime || match.time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Stats -->
                    <div style="padding:8px 14px; display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; border-bottom:1px solid var(--border);">
                        <div style="text-align:center;">
                            <div style="font-size:0.6rem; color:var(--text-muted);">POOL</div>
                            <div style="font-weight:700; color:#00ff88; font-size:0.82rem;">🪙 ${match.prizePool || 0}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.6rem; color:var(--text-muted);">GIVEN</div>
                            <div style="font-weight:700; color:var(--primary); font-size:0.82rem;">🪙 ${totalDistributed}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.6rem; color:var(--text-muted);">PER KILL</div>
                            <div style="font-weight:700; color:#ffc107; font-size:0.82rem;">🪙 ${match.perKill || 0}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.6rem; color:var(--text-muted);">${isTeamMode ? 'TEAMS' : 'PLAYERS'}</div>
                            <div style="font-weight:700; font-size:0.82rem;">${isTeamMode ? teamDisplayData.length : participantList.length}</div>
                        </div>
                    </div>
                    
                    ${match.adminComment?.text ? `
                    <div style="padding:10px 14px; background:rgba(251,191,36,0.1); border-bottom:1px solid rgba(251,191,36,0.2);">
                        <div style="display:flex; align-items:flex-start; gap:8px;">
                            <i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24; font-size:0.85rem; margin-top:2px; flex-shrink:0;"></i>
                            <div>
                                <div style="font-size:0.78rem; color:#fbbf24; font-weight:600; margin-bottom:2px;">Admin Note</div>
                                <div style="font-size:0.82rem; color:var(--text-main); line-height:1.5;">${escapeHtml(match.adminComment.text)}</div>
                                <div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">— ${match.adminComment.addedByName || 'Admin'}${match.adminComment.updatedAt ? ', ' + new Date(match.adminComment.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</div>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    ${myResultHTML}
                    
                    <!-- Scrollable Results (position prizes + team cards) -->
                    <div style="flex:1; overflow-y:auto; padding:0; -webkit-overflow-scrolling:touch;">
                        ${posRewardsHTML}
                        ${playersHtml || '<div style="text-align:center; padding:20px; color:var(--text-muted);">No results available yet</div>'}
                    </div>
                    
                    <div style="padding:10px 14px; border-top:1px solid var(--border);">
                        <button onclick="document.getElementById('match-results-modal').remove()" style="width:100%; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; border:none; padding:12px; border-radius:10px; font-weight:700; font-size:0.95rem; cursor:pointer;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('match-results-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (err) {
        console.error('View results error:', err);
        showToast('Error loading results', 'error');
    }
};

// View Match Details - Premium tournament-style detail modal
window.viewMatchDetails = async function (matchId) {
    try {
        const [matchSnap, gameSnap] = await Promise.all([
            db.ref('esports_matches/' + matchId).once('value'),
            db.ref('esports_games').once('value')
        ]);

        const match = matchSnap.val();
        if (!match) {
            showToast('Match not found', 'error');
            return;
        }

        // Get game rules
        let gameRules = '';
        let gameIcon = '';
        gameSnap.forEach(child => {
            if (child.key === match.gameId) {
                const g = child.val();
                gameRules = g.rules || '';
                gameIcon = g.icon || '';
            }
        });

        const participants = match.participants || {};
        const participantCount = Object.keys(participants).length;
        const uid = state.user?.uid;
        const hasJoined = hasUserJoinedMatch(participants, uid);
        const maxSlots = match.maxParticipants || 100;
        const isFull = participantCount >= maxSlots;
        const progressPercent = Math.min((participantCount / maxSlots) * 100, 100);
        const matchType = (match.type || 'Solo');
        const statusColors = { 'UPCOMING': '#00ff88', 'LIVE': '#ff9500', 'COMPLETED': '#6366f1', 'CANCELLED': '#ef4444' };
        const statusColor = statusColors[match.status] || '#00ff88';

        // ── Position Rewards ──
        const posRewards = match.positionRewards || {};
        const medalMap = { '1': '🥇', '2': '🥈', '3': '🥉' };
        const ordMap = { '1': '1st', '2': '2nd', '3': '3rd' };
        for (let p = 4; p <= 20; p++) ordMap[String(p)] = p + 'th';

        let posRewardsHTML = '';
        const prizeEntries = Object.entries(posRewards).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        if (prizeEntries.length > 0) {
            posRewardsHTML = `
                <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
                    <div style="font-size:0.8rem; color:var(--primary); margin-bottom:10px; font-weight:600;">🏆 POSITION REWARDS</div>
                    <div style="background:var(--bg-hover); border-radius:10px; overflow:hidden;">
                        ${prizeEntries.map(([place, amount]) => `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.05);">
                                <span style="font-size:0.9rem;">${medalMap[place] || '🏅'} ${ordMap[place] || place + 'th'}</span>
                                <span style="font-weight:700; color:#00ff88; font-size:0.95rem;">🪙 ${amount}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // ── Participants (with VIP badge, team-aware for Duo/Squad) ──
        const participantEntries = Object.entries(participants);
        const _displayEntries = participantEntries.slice(0, 30);
        let participantsHTML = '';
        // Batch-fetch VIP flags
        const _vipMap = {};
        const _pUids = _displayEntries.map(([k, p]) => p.bookedBy || k).filter(Boolean);
        const _uniquePUids = [...new Set(_pUids)];
        await Promise.all(_uniquePUids.map(async pUid => {
            try { const s = await db.ref(`users/${pUid}/isVip`).once('value'); _vipMap[pUid] = s.val() === true; } catch (e) { }
        }));
        const _detailMatchType = (match.type || 'solo').toLowerCase();
        const _isDetailTeamMode = _detailMatchType.includes('duo') || _detailMatchType.includes('squad');
        const _detailTeamSize = _detailMatchType.includes('squad') ? '4' : '2';

        if (_isDetailTeamMode && _displayEntries.length > 0) {
            // ── TEAM MODE: Group by team number ──
            const _dtTeamColors = ['#00ff88','#6366f1','#ffc107','#ff6b6b','#4dd0e1','#ff9500','#a78bfa','#f472b6','#34d399','#f59e0b','#06b6d4','#ec4899','#84cc16','#e879f9'];
            const _dtTeamGroups = {};
            _displayEntries.forEach(([k, p]) => {
                const tm = k.match(/team_(\d+)/);
                const teamNum = tm ? tm[1] : (p.teamNumber ? String(p.teamNumber) : '0');
                if (!_dtTeamGroups[teamNum]) _dtTeamGroups[teamNum] = [];
                _dtTeamGroups[teamNum].push({ key: k, p });
            });
            const _dtSortedTeams = Object.keys(_dtTeamGroups).sort((a, b) => parseInt(a) - parseInt(b));

            participantsHTML = _dtSortedTeams.map((tNum, tIdx) => {
                const members = _dtTeamGroups[tNum];
                const tColor = _dtTeamColors[tIdx % _dtTeamColors.length];
                const membersHtml = members.map(({ key, p }) => {
                    const pUid = p.bookedBy || key;
                    const vBadge = _vipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                    return `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
                        <div style="width:18px; height:18px; background:${tColor}15; border:1px solid ${tColor}40; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700; color:${tColor};">${p.slotPosition || '•'}</div>
                        <span style="font-size:0.78rem; color:var(--text-main); font-weight:500;">${escapeHtml(p.ign) || 'Player'}</span> ${vBadge}
                    </div>`;
                }).join('');

                return `<div style="background:${tColor}08; border:1px solid ${tColor}20; border-radius:10px; padding:8px 12px; width:100%;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid ${tColor}15;">
                        <div style="width:20px; height:20px; background:${tColor}20; border:1.5px solid ${tColor}50; border-radius:5px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700; color:${tColor};">${tNum}</div>
                        <span style="font-size:0.72rem; font-weight:700; color:${tColor}; letter-spacing:0.3px;">TEAM ${tNum}</span>
                        <span style="font-size:0.6rem; color:var(--text-muted); margin-left:auto;">${members.length}/${_detailTeamSize}</span>
                    </div>
                    <div style="padding-left:2px;">${membersHtml}</div>
                </div>`;
            }).join('');

            if (participantCount > 30) {
                participantsHTML += `<div style="text-align:center; width:100%; font-size:0.75rem; color:var(--text-muted); padding:6px;">+${participantCount - 30} more players</div>`;
            }
        } else if (_displayEntries.length > 0) {
            // ── SOLO MODE: Original flat pill layout ──
            participantsHTML = _displayEntries.map(([k, p], i) => {
                const pUid = p.bookedBy || k;
                const vBadge = _vipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                return `
                <span style="display:inline-block; font-size:0.78rem; padding:3px 10px; background:var(--bg-hover); border-radius:20px; margin:3px;">
                    <span style="color:var(--primary); font-weight:600;">${i + 1}.</span> ${escapeHtml(p.ign) || 'Player'} ${vBadge}
                </span>
            `;
            }).join('');
            if (participantCount > 30) {
                participantsHTML += `<span style="font-size:0.75rem; color:var(--text-muted); padding:3px 8px;">+${participantCount - 30} more</span>`;
            }
        } else {
            participantsHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">No participants yet</div>';
        }

        // ── CTA Button ──
        let ctaHTML = '';
        if (match.status === 'UPCOMING') {
            if (hasJoined) {
                ctaHTML = `
                    <button disabled style="width:100%; background:rgba(0,255,136,0.15); color:#00ff88; border:2px solid rgba(0,255,136,0.3); padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:default;">
                        <i class="fa-solid fa-circle-check"></i> Already Joined
                    </button>`;
            } else if (isFull) {
                ctaHTML = `
                    <button disabled style="width:100%; background:rgba(239,68,68,0.15); color:#ef4444; border:2px solid rgba(239,68,68,0.3); padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:default;">
                        <i class="fa-solid fa-ban"></i> FULL
                    </button>`;
            } else {
                ctaHTML = `
                    <button onclick="document.getElementById('match-details-modal').remove(); openSlotModal('${matchId}')" style="width:100%; background:linear-gradient(135deg, #00ff88, #00cc6a); color:#000; border:none; padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:pointer; transition:transform 0.2s;" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
                        <i class="fa-solid fa-bolt"></i> Join Now — ${match.entryFee > 0 ? '🪙 ' + match.entryFee : 'FREE'}
                    </button>`;
            }
        } else if (match.status === 'LIVE' && hasJoined && match.roomId) {
            ctaHTML = `
                <button onclick="document.getElementById('match-details-modal').remove(); viewRoomDetails('${matchId}')" style="width:100%; background:linear-gradient(135deg, #ff9500, #ff6b00); color:#000; border:none; padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:pointer;">
                    <i class="fa-solid fa-gamepad"></i> View Room Details
                </button>`;
        } else if (match.status === 'COMPLETED') {
            ctaHTML = `
                <button onclick="document.getElementById('match-details-modal').remove(); viewMatchResults('${matchId}')" style="width:100%; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; border:none; padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:pointer;">
                    <i class="fa-solid fa-trophy"></i> View Results
                </button>`;
        }

        const modalHtml = `
            <div id="match-details-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; overflow-y:auto;">
                <div style="background: linear-gradient(145deg, #0f1923 0%, #151f2e 50%, #0d1520 100%); border-radius:20px; max-width:420px; width:100%; max-height:92vh; overflow-y:auto; border: 1.5px solid ${statusColor}; box-shadow: 0 0 60px rgba(0,0,0,0.5), 0 0 20px ${statusColor}33;">
                    <!-- Header -->
                    <div style="padding:20px 20px 16px; border-bottom:1px solid var(--border); position:sticky; top:0; background:linear-gradient(145deg, #0f1923, #151f2e); z-index:1; border-radius:20px 20px 0 0;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                            <div style="flex:1;">
                                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                                    <span style="font-size:0.7rem; padding:3px 10px; border-radius:20px; background:${statusColor}22; color:${statusColor}; font-weight:700; border:1px solid ${statusColor}44;">${match.status}</span>
                                    <span style="font-size:0.7rem; padding:3px 10px; border-radius:20px; background:var(--bg-hover); color:var(--text-muted); font-weight:600;">${matchType}</span>
                                    ${hasJoined ? '<span style="font-size:0.7rem; padding:3px 10px; border-radius:20px; background:rgba(0,255,136,0.15); color:#00ff88; font-weight:700;">✓ JOINED</span>' : ''}
                                </div>
                                <h3 style="margin:0 0 4px; color:#fff; font-size:1.15rem;">${match.title || 'Match'}</h3>
                                <div style="color:var(--text-muted); font-size:0.82rem;">${match.gameName || 'Game'} • ${match.map || 'Map'}</div>
                            </div>
                            <button onclick="document.getElementById('match-details-modal').remove()" style="background:rgba(255,255,255,0.08); border:none; color:var(--text-muted); font-size:1.3rem; cursor:pointer; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">&times;</button>
                        </div>
                    </div>
                    
                    <!-- Match Info Grid -->
                    <div style="padding:14px 20px; display:grid; grid-template-columns:repeat(2,1fr); gap:10px; border-bottom:1px solid var(--border);">
                        <div style="text-align:center; padding:14px 8px; background:rgba(0,255,136,0.06); border:1px solid rgba(0,255,136,0.12); border-radius:12px;">
                            <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Entry Fee</div>
                            <div style="font-size:1.25rem; font-weight:700; color:#4dd0e1; margin-top:2px;">${match.entryFee > 0 ? '🪙 ' + match.entryFee : 'FREE'}</div>
                        </div>
                        <div style="text-align:center; padding:14px 8px; background:rgba(0,255,136,0.06); border:1px solid rgba(0,255,136,0.12); border-radius:12px;">
                            <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Prize Pool</div>
                            <div style="font-size:1.25rem; font-weight:700; color:#00ff88; margin-top:2px;">🪙 ${match.prizePool || 0}</div>
                        </div>
                        <div style="text-align:center; padding:14px 8px; background:rgba(255,193,7,0.06); border:1px solid rgba(255,193,7,0.12); border-radius:12px;">
                            <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Per Kill</div>
                            <div style="font-size:1.25rem; font-weight:700; color:#ffc107; margin-top:2px;">🪙 ${match.perKill || 0}</div>
                        </div>
                        <div style="text-align:center; padding:14px 8px; background:var(--bg-hover); border:1px solid var(--border); border-radius:12px;">
                            <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Slots</div>
                            <div style="font-size:1.25rem; font-weight:700; margin-top:2px;"><span style="color:${isFull ? '#ef4444' : '#00ff88'}">${participantCount}</span>/${maxSlots}</div>
                        </div>
                    </div>
                    
                    ${match.adminComment?.text ? `
                    <!-- Admin Comment Notice -->
                    <div style="padding:12px 20px; border-bottom:1px solid rgba(251,191,36,0.2); background:rgba(251,191,36,0.08);">
                        <div style="display:flex; align-items:flex-start; gap:10px;">
                            <div style="width:32px; height:32px; background:rgba(251,191,36,0.15); border:1.5px solid rgba(251,191,36,0.3); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24; font-size:0.85rem;"></i>
                            </div>
                            <div style="flex:1;">
                                <div style="font-size:0.75rem; color:#fbbf24; font-weight:600; margin-bottom:3px;">Admin Note</div>
                                <div style="font-size:0.85rem; color:var(--text-main); line-height:1.5;">${escapeHtml(match.adminComment.text)}</div>
                                <div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">— ${match.adminComment.addedByName || 'Admin'}${match.adminComment.updatedAt ? ', ' + new Date(match.adminComment.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</div>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Quick View Participants Button -->
                    <div style="padding:8px 20px;" onclick="document.getElementById('match-details-modal').remove(); viewParticipants('${matchId}')">
                        <div style="display:flex; align-items:center; gap:10px; padding:12px 16px; background:var(--bg-hover); border:1px solid var(--border); border-radius:12px; cursor:pointer; transition:all 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.08)'; this.style.borderColor='rgba(0,255,136,0.3)'" onmouseleave="this.style.background='var(--bg-hover)'; this.style.borderColor='var(--border)'">
                            <div style="width:36px; height:36px; background:linear-gradient(135deg, rgba(0,255,136,0.15), rgba(0,204,106,0.08)); border:1.5px solid rgba(0,255,136,0.25); border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fa-solid fa-users" style="color:#00ff88; font-size:0.9rem;"></i>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:600; font-size:0.88rem; color:var(--text-main);">View Participants</div>
                                <div style="font-size:0.72rem; color:var(--text-muted);">${participantCount} of ${maxSlots} slots filled${_isDetailTeamMode ? ' • ' + _detailMatchType.charAt(0).toUpperCase() + _detailMatchType.slice(1) + ' Teams' : ''}</div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                                <div style="width:40px; height:4px; background:rgba(255,255,255,0.06); border-radius:2px; overflow:hidden;">
                                    <div style="height:100%; width:${progressPercent}%; background:${isFull ? '#ef4444' : '#00ff88'}; border-radius:2px; transition:width 0.3s;"></div>
                                </div>
                                <i class="fa-solid fa-chevron-right" style="color:var(--text-muted); font-size:0.6rem; opacity:0.6;"></i>
                            </div>
                        </div>
                    </div>
                    
                    ${posRewardsHTML}
                    
                    <!-- Schedule -->
                    <div style="padding:14px 20px; border-bottom:1px solid var(--border);">
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:8px; font-weight:600;">📅 SCHEDULE</div>
                        <div style="display:flex; align-items:center; gap:12px; background:var(--bg-hover); padding:12px; border-radius:10px;">
                            <i class="fa-regular fa-calendar" style="color:var(--primary); font-size:1.2rem;"></i>
                            <div>
                                <div style="font-weight:600; font-size:0.95rem;">${new Date(match.dateTime || match.time).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                <div style="color:var(--text-muted); font-size:0.85rem;">${new Date(match.dateTime || match.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                            </div>
                        </div>
                    </div>
                    
                    ${hasJoined && match.status === 'LIVE' && match.roomId ? `
                    <!-- Room Details -->
                    <div style="padding:14px 20px; border-bottom:1px solid var(--border); background:rgba(0,255,136,0.04);">
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:10px; font-weight:600;">🎮 ROOM DETAILS</div>
                        <div style="display:flex; gap:12px;">
                            <div style="flex:1; background:var(--bg-main); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border);">
                                <div style="font-size:0.68rem; color:var(--text-muted); margin-bottom:4px;">ROOM ID</div>
                                <div style="font-family:monospace; font-weight:700; font-size:1.15rem; color:#fff;">${match.roomId}</div>
                            </div>
                            <div style="flex:1; background:var(--bg-main); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--border);">
                                <div style="font-size:0.68rem; color:var(--text-muted); margin-bottom:4px;">PASSWORD</div>
                                <div style="font-family:monospace; font-weight:700; font-size:1.15rem; color:#fff;">${match.roomPassword}</div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${gameRules ? `
                    <!-- Rules (above participants) -->
                    <div style="padding:14px 20px; border-bottom:1px solid var(--border);">
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:8px; font-weight:600;">📋 RULES</div>
                        <div style="background:var(--bg-hover); border-radius:10px; padding:12px; color:var(--text-muted); font-size:0.88rem; line-height:1.7; white-space:pre-wrap;">${gameRules}</div>
                    </div>
                    ` : ''}
                    
                    <!-- Participants (below rules) -->
                    <div style="padding:14px 20px; border-bottom:1px solid var(--border);">
                        <div onclick="document.getElementById('match-details-modal').remove(); viewParticipants('${matchId}')" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-bottom:8px;">
                            <div style="font-size:0.8rem; color:var(--primary); font-weight:600;">👥 PARTICIPANTS (${participantCount}/${maxSlots})</div>
                            <span style="font-size:0.65rem; color:var(--text-muted); display:flex; align-items:center; gap:3px;">View all <i class="fa-solid fa-chevron-right" style="font-size:0.5rem;"></i></span>
                        </div>
                        <div style="background:var(--bg-hover); border-radius:10px; padding:10px; max-height:${_isDetailTeamMode ? '180' : '120'}px; overflow-y:auto;">
                            <div style="display:flex; flex-wrap:wrap; gap:${_isDetailTeamMode ? '6' : '2'}px;">
                                ${participantsHTML}
                            </div>
                        </div>
                        <!-- Slot progress -->
                        <div style="margin-top:10px; background:rgba(255,255,255,0.05); border-radius:6px; height:6px; overflow:hidden;">
                            <div style="background:${isFull ? '#ef4444' : 'var(--primary)'}; height:100%; width:${progressPercent}%; transition:width 0.3s; border-radius:6px;"></div>
                        </div>
                    </div>
                    
                    <!-- CTA -->
                    ${ctaHTML ? `<div style="padding:16px 20px;">${ctaHTML}</div>` : ''}
                </div>
            </div>
        `;

        document.getElementById('match-details-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

    } catch (err) {
        console.error('View match details error:', err);
        showToast('Error loading match details', 'error');
    }
};

// ==========================================
//  PREMIUM SLOT BOOKING SYSTEM
// ==========================================

// Slot state management
let slotState = {
    matchId: null,
    match: null,
    source: 'esports',    // 'esports' or 'tournament'
    tournamentId: null,   // Set when source is 'tournament'
    teamSize: 1,          // 1 for Solo, 2 for Duo, 4 for Squad
    totalTeams: 0,
    selectedSlots: [],    // Array of {team, position}
    selectedTeam: null,   // For Duo/Squad: lock to one team
    entryFee: 0,
    bookedSlots: {}       // Map of "team_position" -> participant data
};

// Open slot selection modal
window.openSlotModal = async function (matchId) {
    slotState.matchId = matchId;
    slotState.source = 'esports';
    slotState.tournamentId = null;
    slotState.selectedSlots = [];
    slotState.selectedTeam = null;

    document.getElementById('slot-selection-modal').classList.remove('hidden');
    document.getElementById('slot-grid-container').innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading slots...</div>';
    document.getElementById('slot-primary-ign').value = '';
    document.getElementById('slot-teammate-igns-container').innerHTML = '';
    document.getElementById('slot-teammate-igns').classList.add('hidden');
    document.getElementById('slot-selection-summary').classList.add('hidden');

    try {
        const [matchSnap, userSnap] = await Promise.all([
            db.ref(`esports_matches/${matchId}`).once('value'),
            db.ref(`users/${state.user.uid}`).once('value')
        ]);

        const match = matchSnap.val();
        const user = userSnap.val();

        if (!match) {
            closeModal('slot-selection-modal');
            return showToast('Match not found', 'error');
        }

        if (match.status !== 'UPCOMING') {
            closeModal('slot-selection-modal');
            return showToast('This match is no longer open for joining', 'error');
        }

        slotState.match = match;
        slotState.entryFee = match.entryFee || 0;
        slotState.gameId = match.gameId; // Store for saving IGN later

        // Determine team size based on match type
        const matchType = (match.type || 'solo').toLowerCase();
        if (matchType.includes('squad')) {
            slotState.teamSize = 4;
        } else if (matchType.includes('duo')) {
            slotState.teamSize = 2;
        } else {
            slotState.teamSize = 1;
        }

        // Calculate total teams
        const maxPlayers = match.maxParticipants || 100;
        slotState.totalTeams = Math.ceil(maxPlayers / slotState.teamSize);

        // Build booked slots map
        slotState.bookedSlots = {};
        if (match.participants) {
            let legacySlotIndex = 1; // Counter for legacy bookings without team/position
            Object.entries(match.participants).forEach(([key, data]) => {
                if (data.teamNumber && data.slotPosition) {
                    slotState.bookedSlots[`${data.teamNumber}_${data.slotPosition}`] = data;
                } else {
                    // Legacy booking — assign to next sequential solo slot
                    const assignedTeam = data.slotNumber || legacySlotIndex;
                    slotState.bookedSlots[`${assignedTeam}_A`] = { ...data, bookedBy: data.bookedBy || key };
                    legacySlotIndex++;
                }
            });
        }

        // Update modal header
        document.getElementById('slot-modal-title').textContent = match.title || 'Match';
        document.getElementById('slot-modal-type').textContent = matchType.charAt(0).toUpperCase() + matchType.slice(1);
        document.getElementById('slot-entry-fee').textContent = slotState.entryFee > 0 ? slotState.entryFee : 'FREE';
        document.getElementById('slot-user-balance').textContent = ((user?.depositBalance || 0) + (user?.winningBalance || 0));
        document.getElementById('slot-match-id').value = matchId;
        document.getElementById('slot-match-type').value = matchType;
        document.getElementById('slot-team-size').value = slotState.teamSize;

        // Pre-fill IGN from saved game-specific IGN
        const savedIGN = user?.gameIGNs?.[match.gameId] || '';
        document.getElementById('slot-primary-ign').value = savedIGN;
        if (savedIGN) {
            document.getElementById('slot-primary-ign').placeholder = 'Your saved IGN';
        } else {
            document.getElementById('slot-primary-ign').placeholder = 'Enter your in-game name';
        }

        // Render the slot grid
        renderSlotGrid();
        updateSlotSummary();

    } catch (err) {
        console.error('Open slot modal error:', err);
        closeModal('slot-selection-modal');
        showToast('Error loading match details', 'error');
    }
};

// Open slot modal for TOURNAMENT registration (reads tournament data instead of esports)
window.openTournamentSlotModal = async function (tournamentId) {
    slotState.matchId = null;
    slotState.source = 'tournament';
    slotState.tournamentId = tournamentId;
    slotState.selectedSlots = [];
    slotState.selectedTeam = null;

    document.getElementById('slot-selection-modal').classList.remove('hidden');
    document.getElementById('slot-grid-container').innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading slots...</div>';
    document.getElementById('slot-primary-ign').value = '';
    document.getElementById('slot-teammate-igns-container').innerHTML = '';
    document.getElementById('slot-teammate-igns').classList.add('hidden');
    document.getElementById('slot-selection-summary').classList.add('hidden');

    try {
        const [tSnap, userSnap] = await Promise.all([
            db.ref(`tournaments/${tournamentId}`).once('value'),
            db.ref(`users/${state.user.uid}`).once('value')
        ]);

        const t = tSnap.val();
        const user = userSnap.val();

        if (!t) {
            closeModal('slot-selection-modal');
            return showToast('Tournament not found', 'error');
        }

        if (t.status !== 'REGISTRATION') {
            closeModal('slot-selection-modal');
            return showToast('Registration is not open', 'error');
        }

        slotState.match = t;
        slotState.entryFee = t.entryFee || 0;
        slotState.gameId = t.gameId;

        // Determine team size based on tournament type
        const tType = (t.type || 'Solo').toLowerCase();
        if (tType.includes('squad')) {
            slotState.teamSize = 4;
        } else if (tType.includes('duo')) {
            slotState.teamSize = 2;
        } else {
            slotState.teamSize = 1;
        }

        // Calculate total teams
        const maxPlayers = t.maxParticipants || 100;
        slotState.totalTeams = Math.ceil(maxPlayers / slotState.teamSize);

        // Build booked slots map from tournament participants
        slotState.bookedSlots = {};
        if (t.participants) {
            Object.entries(t.participants).forEach(([key, data]) => {
                if (data.teamNumber && data.slotPosition) {
                    slotState.bookedSlots[`${data.teamNumber}_${data.slotPosition}`] = data;
                }
            });
        }

        // Update modal header
        document.getElementById('slot-modal-title').textContent = t.title || 'Tournament';
        document.getElementById('slot-modal-type').textContent = tType.charAt(0).toUpperCase() + tType.slice(1);
        document.getElementById('slot-entry-fee').textContent = slotState.entryFee > 0 ? slotState.entryFee : 'FREE';
        document.getElementById('slot-user-balance').textContent = ((user?.depositBalance || 0) + (user?.winningBalance || 0));
        document.getElementById('slot-match-id').value = tournamentId;
        document.getElementById('slot-match-type').value = tType;
        document.getElementById('slot-team-size').value = slotState.teamSize;

        // Pre-fill IGN from saved game-specific IGN
        const savedIGN = user?.gameIGNs?.[t.gameId] || '';
        document.getElementById('slot-primary-ign').value = savedIGN;
        document.getElementById('slot-primary-ign').placeholder = savedIGN ? 'Your saved IGN' : 'Enter your in-game name';

        // Render the slot grid
        renderSlotGrid();
        updateSlotSummary();

    } catch (err) {
        console.error('Open tournament slot modal error:', err);
        closeModal('slot-selection-modal');
        showToast('Error loading tournament details', 'error');
    }
};

// Render team-based slot grid
function renderSlotGrid() {
    const container = document.getElementById('slot-grid-container');
    const teamSize = slotState.teamSize;
    const totalTeams = slotState.totalTeams;
    const positionLabels = ['A', 'B', 'C', 'D'];

    // Count available slots
    let bookedCount = Object.keys(slotState.bookedSlots).length;
    let totalSlots = totalTeams * teamSize;
    let availableCount = totalSlots - bookedCount;
    document.getElementById('slot-available-count').textContent = `${availableCount}/${totalSlots} available`;

    if (teamSize === 1) {
        // Solo mode - simple grid
        let html = '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 15px;">';
        for (let i = 1; i <= totalTeams; i++) {
            const slotKey = `${i}_A`;
            const isBooked = slotState.bookedSlots[slotKey];
            const isSelected = slotState.selectedSlots.some(s => s.team === i && s.position === 'A');
            const isOwnBooking = isBooked && isBooked.bookedBy === state.user.uid;

            let bgColor = 'var(--bg-hover)';
            let borderColor = 'var(--border)';
            let textColor = 'var(--text)';
            let cursor = 'pointer';
            let opacity = '1';

            if (isOwnBooking) {
                bgColor = 'rgba(16, 185, 129, 0.2)';
                borderColor = 'var(--success)';
                textColor = 'var(--success)';
                cursor = 'default';
            } else if (isBooked) {
                bgColor = 'rgba(239, 68, 68, 0.15)';
                borderColor = '#ef4444';
                textColor = '#ef4444';
                cursor = 'not-allowed';
                opacity = '0.6';
            } else if (isSelected) {
                bgColor = 'linear-gradient(135deg, #4f46e5, #7c3aed)';
                borderColor = '#7c3aed';
                textColor = 'white';
            }

            html += `
                <div onclick="${!isBooked && !isOwnBooking ? `toggleSlotSelection(${i}, 'A')` : ''}" 
                     style="background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 10px; padding: 12px 8px; text-align: center; cursor: ${cursor}; opacity: ${opacity}; transition: all 0.2s;">
                    <div style="font-weight: 700; color: ${textColor}; font-size: 1.1rem;">${i}</div>
                    ${isBooked ? `<div style="font-size: 0.65rem; color: ${textColor}; margin-top: 2px;">${isOwnBooking ? 'You' : '⛔'}</div>` : ''}
                    ${isSelected ? '<div style="font-size: 0.7rem; margin-top: 2px;">✓</div>' : ''}
                </div>
            `;
        }
        html += '</div>';
        container.innerHTML = html;

    } else {
        // Duo/Squad mode - team table
        let html = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-hover);">
                        <th style="padding: 12px; text-align: left; font-size: 0.85rem; font-weight: 600; border-bottom: 1px solid var(--border);">Team</th>
        `;

        for (let p = 0; p < teamSize; p++) {
            html += `<th style="padding: 12px; text-align: center; font-size: 0.85rem; font-weight: 600; border-bottom: 1px solid var(--border);">${positionLabels[p]}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (let t = 1; t <= totalTeams; t++) {
            const teamHasSelection = slotState.selectedSlots.some(s => s.team === t);
            const isLockedTeam = slotState.selectedTeam !== null && slotState.selectedTeam !== t;

            html += `<tr style="border-bottom: 1px solid var(--border); ${teamHasSelection ? 'background: rgba(124, 58, 237, 0.05);' : ''}">`;
            html += `<td style="padding: 12px; font-weight: 600; font-size: 0.9rem; color: ${teamHasSelection ? 'var(--primary)' : 'var(--text-muted)'};">Team ${t}</td>`;

            for (let p = 0; p < teamSize; p++) {
                const pos = positionLabels[p];
                const slotKey = `${t}_${pos}`;
                const isBooked = slotState.bookedSlots[slotKey];
                const isSelected = slotState.selectedSlots.some(s => s.team === t && s.position === pos);
                const isOwnBooking = isBooked && isBooked.bookedBy === state.user.uid;
                const isDisabled = isBooked || isLockedTeam;

                let cellStyle = 'padding: 10px; text-align: center;';
                let boxStyle = 'width: 36px; height: 36px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.9rem; transition: all 0.2s; ';

                if (isOwnBooking) {
                    boxStyle += 'background: rgba(16, 185, 129, 0.2); border: 2px solid var(--success); color: var(--success); cursor: default;';
                } else if (isBooked) {
                    boxStyle += 'background: rgba(239, 68, 68, 0.15); border: 2px solid #ef4444; color: #ef4444; cursor: not-allowed; opacity: 0.6;';
                } else if (isSelected) {
                    boxStyle += 'background: linear-gradient(135deg, #4f46e5, #7c3aed); border: 2px solid #7c3aed; color: white; cursor: pointer;';
                } else if (isLockedTeam) {
                    boxStyle += 'background: var(--bg-hover); border: 2px dashed var(--border); color: var(--text-muted); cursor: not-allowed; opacity: 0.4;';
                } else {
                    boxStyle += 'background: var(--bg-hover); border: 2px solid var(--border); color: var(--text); cursor: pointer;';
                }

                const onclick = !isDisabled ? `onclick="toggleSlotSelection(${t}, '${pos}')"` : '';

                html += `
                    <td style="${cellStyle}">
                        <div ${onclick} style="${boxStyle}">
                            ${isOwnBooking ? '✓' : (isBooked ? '✗' : (isSelected ? '✓' : (p + 1)))}
                        </div>
                    </td>
                `;
            }
            html += '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }
}

// Toggle slot selection
window.toggleSlotSelection = function (team, position) {
    const existingIndex = slotState.selectedSlots.findIndex(s => s.team === team && s.position === position);

    if (existingIndex >= 0) {
        // Deselect
        slotState.selectedSlots.splice(existingIndex, 1);
        if (slotState.selectedSlots.length === 0) {
            slotState.selectedTeam = null;
        }
    } else {
        // For Duo/Squad: restrict to same team
        if (slotState.teamSize > 1) {
            if (slotState.selectedTeam !== null && slotState.selectedTeam !== team) {
                showToast('You can only select slots from one team', 'warning');
                return;
            }
            slotState.selectedTeam = team;
        }

        // For Solo: only allow 1 slot
        if (slotState.teamSize === 1 && slotState.selectedSlots.length >= 1) {
            slotState.selectedSlots = []; // Clear previous
        }

        slotState.selectedSlots.push({ team, position });
    }

    renderSlotGrid();
    updateSlotSummary();
    updateTeammateIgnFields();
};

// Update selection summary
function updateSlotSummary() {
    const count = slotState.selectedSlots.length;
    const total = count * slotState.entryFee;
    const summaryDiv = document.getElementById('slot-selection-summary');
    const btn = document.getElementById('slot-confirm-btn');

    if (count > 0) {
        summaryDiv.classList.remove('hidden');
        document.getElementById('slot-count-display').textContent = `${count} slot(s)`;
        document.getElementById('slot-total-amount').textContent = total > 0 ? `🪙 ${total}` : 'FREE';

        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = total > 0 ? `<i class="fa-solid fa-wallet"></i> Pay 🪙 ${total} & Join` : `<i class="fa-solid fa-bolt"></i> Join Free`;
    } else {
        summaryDiv.classList.add('hidden');
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.innerHTML = 'Select a Slot to Join';
    }
}

// Update teammate IGN fields based on selection
function updateTeammateIgnFields() {
    const count = slotState.selectedSlots.length;
    const container = document.getElementById('slot-teammate-igns-container');
    const section = document.getElementById('slot-teammate-igns');

    if (count <= 1) {
        section.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    section.classList.remove('hidden');
    container.innerHTML = '';

    // Need IGN for additional slots (slot 2, 3, 4, etc.)
    for (let i = 2; i <= count; i++) {
        const slot = slotState.selectedSlots[i - 1];
        const posLabel = slotState.teamSize > 1 ? ` (Position ${slot.position})` : '';

        container.innerHTML += `
            <div style="margin-bottom: 10px;">
                <input type="text" class="form-input teammate-ign-input" 
                       id="teammate-ign-${i}" 
                       placeholder="Teammate ${i} IGN${posLabel}" 
                       required 
                       style="font-size: 0.95rem;">
            </div>
        `;
    }
}

// Confirm slot booking - ATOMIC VERSION with race condition protection
window.confirmSlotBooking = async function () {
    const primaryIgn = document.getElementById('slot-primary-ign').value.trim();
    if (!primaryIgn) {
        return showToast('Enter your In-Game Name (IGN)', 'error');
    }

    const count = slotState.selectedSlots.length;
    if (count === 0) {
        return showToast('Please select at least one slot', 'error');
    }

    // Collect all IGNs
    const igns = [primaryIgn];
    for (let i = 2; i <= count; i++) {
        const teammateIgn = document.getElementById(`teammate-ign-${i}`)?.value.trim();
        if (!teammateIgn) {
            return showToast(`Enter IGN for teammate ${i}`, 'error');
        }
        igns.push(teammateIgn);
    }

    const totalAmount = count * slotState.entryFee;
    const uid = state.user.uid;
    const matchId = slotState.matchId;
    const slotsToBook = [...slotState.selectedSlots]; // Copy to prevent mutation

    try {
        showToast('Booking slots...', 'info');

        let r;
        if (slotState.source === 'tournament') {
            // Tournament registration via slot booking
            const registerFn = firebase.functions().httpsCallable('registerForTournament');
            const result = await registerFn({
                tournamentId: slotState.tournamentId,
                ign: igns,
                slotsToBook: slotsToBook
            });
            r = result.data;
        } else {
            // eSports match slot booking via Supabase Edge Function
            const res = await fetch('https://zrucdzkgrmtwhykvplqs.supabase.co/functions/v1/join-match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: state.user.uid,
                    matchId: matchId,
                    ign: igns,
                    slotsToBook: slotsToBook,
                    gameId: slotState.gameId
                })
            });
            const resData = await res.json();
            if (!res.ok || resData.error) {
                throw new Error(resData.error || 'Failed to join match');
            }
            r = resData;
        }

        // Sync local state
        state.userData.depositBalance = r.newDepositBalance;
        state.userData.winningBalance = r.newWinningBalance;
        if (!state.userData.gameIGNs) state.userData.gameIGNs = {};
        if (slotState.gameId) state.userData.gameIGNs[slotState.gameId] = primaryIgn;
        updateUIHeader();

        closeModal('slot-selection-modal');

        if (slotState.source === 'tournament') {
            showToast(`🏆 Tournament joined with ${count} slot${count > 1 ? 's' : ''}!`, 'success');
        } else {
            showToast(`✅ Successfully joined with ${count} slot${count > 1 ? 's' : ''}!`, 'success');
            loadMatchesList();
        }

    } catch (err) {
        console.error('Slot booking error:', err);
        const msg = err.message || err.details || 'Try again.';
        if (msg.includes('Insufficient balance') && typeof showInsufficientBalanceModal === 'function') {
            showInsufficientBalanceModal(msg);
        } else {
            showToast('Failed: ' + msg, 'error');
        }
    }
};


window.openJoinModal = function (matchId, fee) {
    // Redirect to slot-based booking modal
    openSlotModal(matchId);
};

// Show insufficient balance modal with redirect option
function showInsufficientBalanceModal(message) {
    const modal = document.createElement('div');
    modal.id = 'insufficient-balance-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '1100';
    modal.innerHTML = `
        <div class="modal-content" style="text-align: center;">
            <div style="font-size: 4rem; margin-bottom: 1rem;">💰</div>
            <h3 style="color: var(--danger); margin-bottom: 0.5rem;">Insufficient Balance</h3>
            <p style="color: var(--text-muted); margin-bottom: 1.5rem; font-size: 0.9rem;">
                ${message || 'You need to top up your wallet to join this match.'}
            </p>
            <button class="btn btn-primary btn-block" onclick="goToWalletFromModal()" style="margin-bottom: 0.75rem;">
                <i class="fa-solid fa-wallet"></i> Top Up Wallet
            </button>
            <button class="btn btn-outline btn-block" onclick="closeInsufficientBalanceModal()">
                Cancel
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

window.goToWalletFromModal = function () {
    closeInsufficientBalanceModal();
    // Navigate to profile tab which has wallet options
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector('[data-tab="profile"]').classList.add('active');
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-profile').classList.remove('hidden');
    // Open deposit modal after a short delay
    setTimeout(() => openDepositModal(), 300);
};

window.closeInsufficientBalanceModal = function () {
    const modal = document.getElementById('insufficient-balance-modal');
    if (modal) modal.remove();
};

// Challenge Created Success Modal — Premium Design
function showChallengeCreatedModal() {
    const modal = document.createElement('div');
    modal.id = 'challenge-created-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div style="background: linear-gradient(145deg, #0f172a, #1e293b); border: 1px solid rgba(34,197,94,0.15); border-radius: 20px; max-width: 380px; width: 90%; margin: auto; overflow: hidden; box-shadow: 0 24px 48px rgba(0,0,0,0.4);">
            <!-- Header -->
            <div style="text-align: center; padding: 28px 20px 16px; position: relative;">
                <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 50%; height: 3px; background: linear-gradient(90deg, transparent, #22c55e, transparent);"></div>
                <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #22c55e, #16a34a); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 8px 24px rgba(34,197,94,0.3);">
                    <i class="fa-solid fa-check" style="color: white; font-size: 1.4rem;"></i>
                </div>
                <div style="font-weight: 700; font-size: 1.1rem; color: #e2e8f0; margin-bottom: 4px;">Challenge Created!</div>
                <div style="font-size: 0.78rem; color: #64748b;">Your challenge is live. Check <strong style="color: #94a3b8;">My Challenges</strong></div>
            </div>

            <!-- Steps -->
            <div style="padding: 0 16px 4px;">
                <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; padding-left: 4px;">What's Next</div>

                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">⏳</span>
                    <span style="font-size: 0.78rem; color: #94a3b8;">Wait for an opponent to accept your challenge</span>
                </div>
                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">🔗</span>
                    <span style="font-size: 0.78rem; color: #94a3b8;">Create a room in Ludo King and share the code</span>
                </div>
                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">🏆</span>
                    <span style="font-size: 0.78rem; color: #94a3b8;">Play the match and submit your result immediately</span>
                </div>
            </div>

            <!-- Penalties -->
            <div style="padding: 0 16px 4px;">
                <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; padding-left: 4px;">Important Rules</div>

                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(239,68,68,0.04); border: 1px solid rgba(239,68,68,0.1); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">⚠️</span>
                    <span style="font-size: 0.75rem; color: #fca5a5;">Share room code within 15 mins — <strong>🪙 25 penalty</strong> if missed</span>
                </div>
                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(239,68,68,0.04); border: 1px solid rgba(239,68,68,0.1); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">⚠️</span>
                    <span style="font-size: 0.75rem; color: #fca5a5;">🪙 25 deduction for not submitting or submitting wrong result</span>
                </div>
            </div>

            <!-- Button -->
            <div style="padding: 12px 16px 20px;">
                <button onclick="closeChallengeCreatedModal()" style="width: 100%; padding: 14px; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border: none; border-radius: 12px; font-weight: 600; font-size: 0.9rem; cursor: pointer; box-shadow: 0 4px 12px rgba(34,197,94,0.25);">
                    <i class="fa-solid fa-thumbs-up" style="margin-right: 6px;"></i> Got It, Let's Play!
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

window.closeChallengeCreatedModal = function () {
    const modal = document.getElementById('challenge-created-modal');
    if (modal) modal.remove();
};

// Challenge Joined Success Modal — Premium Design
function showChallengeJoinedModal() {
    const modal = document.createElement('div');
    modal.id = 'challenge-joined-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div style="background: linear-gradient(145deg, #0f172a, #1e293b); border: 1px solid rgba(99,102,241,0.15); border-radius: 20px; max-width: 380px; width: 90%; margin: auto; overflow: hidden; box-shadow: 0 24px 48px rgba(0,0,0,0.4);">
            <!-- Header -->
            <div style="text-align: center; padding: 28px 20px 16px; position: relative;">
                <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 50%; height: 3px; background: linear-gradient(90deg, transparent, #6366f1, transparent);"></div>
                <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 8px 24px rgba(99,102,241,0.3);">
                    <i class="fa-solid fa-handshake" style="color: white; font-size: 1.3rem;"></i>
                </div>
                <div style="font-weight: 700; font-size: 1.1rem; color: #e2e8f0; margin-bottom: 4px;">Challenge Accepted!</div>
                <div style="font-size: 0.78rem; color: #64748b;">You're in! Check <strong style="color: #94a3b8;">My Challenges</strong> for updates</div>
            </div>

            <!-- Steps -->
            <div style="padding: 0 16px 4px;">
                <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; padding-left: 4px;">What's Next</div>

                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">📩</span>
                    <span style="font-size: 0.78rem; color: #94a3b8;">The challenger will share the Room Code shortly</span>
                </div>
                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">🎮</span>
                    <span style="font-size: 0.78rem; color: #94a3b8;">Open Ludo King and enter the code to join the match</span>
                </div>
                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">📊</span>
                    <span style="font-size: 0.78rem; color: #94a3b8;">After the game, submit your result promptly</span>
                </div>
            </div>

            <!-- Penalties -->
            <div style="padding: 0 16px 4px;">
                <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; padding-left: 4px;">Important Rules</div>

                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(239,68,68,0.04); border: 1px solid rgba(239,68,68,0.1); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">⚠️</span>
                    <span style="font-size: 0.75rem; color: #fca5a5;">Submit result within 2 hours — <strong>🪙 25 penalty</strong> if missed</span>
                </div>
                <div style="display: flex; align-items: start; gap: 10px; padding: 10px; background: rgba(239,68,68,0.04); border: 1px solid rgba(239,68,68,0.1); border-radius: 10px; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; min-width: 20px;">⚠️</span>
                    <span style="font-size: 0.75rem; color: #fca5a5;">🪙 25 deduction for false result claims</span>
                </div>
            </div>

            <!-- Button -->
            <div style="padding: 12px 16px 20px;">
                <button onclick="closeChallengeJoinedModal()" style="width: 100%; padding: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 12px; font-weight: 600; font-size: 0.9rem; cursor: pointer; box-shadow: 0 4px 12px rgba(99,102,241,0.25);">
                    <i class="fa-solid fa-gamepad" style="margin-right: 6px;"></i> Let's Go!
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

window.closeChallengeJoinedModal = function () {
    const modal = document.getElementById('challenge-joined-modal');
    if (modal) modal.remove();
};


