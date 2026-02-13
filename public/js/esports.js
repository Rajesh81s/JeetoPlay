// JeetoPlay — eSports
// Auto-extracted from app.html

function loadEsportsGames() {
    db.ref('esports_games').on('value', snap => {
        const grid = document.getElementById('esports-games-grid');
        grid.innerHTML = '';

        if (!snap.exists()) {
            grid.innerHTML = '<div style="grid-column: span 2; text-align:center; color:var(--text-muted); padding:20px;">No games available</div>';
            return;
        }

        snap.forEach(child => {
            const game = child.val();
            const gameId = child.key;
            if (game.isEnabled === false) return;

            const el = document.createElement('div');
            el.className = 'game-card';
            el.style.cursor = 'pointer';
            el.style.textAlign = 'center';
            el.style.padding = '1rem';
            el.onclick = () => navigateToGameMatches(gameId, game.name, game.icon);
            el.innerHTML = `
                <img src="${game.icon}" style="width:60px; height:60px; border-radius:12px; object-fit:cover; margin-bottom:8px;">
                <div style="font-weight:600; font-size:0.9rem;">${game.name}</div>
            `;
            grid.appendChild(el);
        });
    });
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

function loadMatchesList() {
    const selectedGameId = state.selectedGameId;
    if (!selectedGameId) {
        document.getElementById('matches-list').innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Select a game to view matches</div>';
        return;
    }

    db.ref('esports_matches').orderByChild('gameId').equalTo(selectedGameId).on('value', snap => {
        const list = document.getElementById('matches-list');
        list.innerHTML = '';

        if (!snap.exists()) {
            list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No matches found</div>';
            return;
        }

        // Collect and filter matches
        const matchesArr = [];
        snap.forEach(child => {
            const match = child.val();
            // Skip cancelled matches - they should not appear in user's list
            if (match.status === 'CANCELLED') return;
            if (match.status !== matchFilter) return;
            // Mode filter: skip if mode selected and match.type doesn't match
            if (modeFilter !== 'ALL' && (match.type || '').toUpperCase() !== modeFilter) return;
            match.id = child.key;
            matchesArr.push(match);
        });

        // Sort by dateTime (earliest first for UPCOMING, latest first for others)
        matchesArr.sort((a, b) => {
            const dateA = new Date(a.dateTime || a.time).getTime();
            const dateB = new Date(b.dateTime || b.time).getTime();
            return matchFilter === 'UPCOMING' ? dateA - dateB : dateB - dateA;
        });

        // Render sorted matches
        matchesArr.forEach(match => {
            const joinedCount = match.participants ? Object.keys(match.participants).length : 0;
            const maxSlots = match.maxParticipants || 100;
            const isFull = joinedCount >= maxSlots;
            const hasJoined = hasUserJoinedMatch(match.participants, state.user.uid);
            const progressPercent = Math.min((joinedCount / maxSlots) * 100, 100);

            const el = document.createElement('div');
            el.className = 'match-card';
            el.innerHTML = `
                 <div class="match-header">
                    <span>#${match.matchId || match.id.slice(-10)}</span>
                    <span class="text-${match.status === 'LIVE' ? 'danger' : 'success'}">${match.status}</span>
                </div>
                <div class="match-title">${match.title}</div>
                <div class="text-muted" style="font-size:0.8rem; margin-bottom:10px;">
                    <i class="fa-regular fa-clock"></i> ${new Date(match.dateTime || match.time).toLocaleString()}
                </div>
                
                <!-- Slot Progress Bar -->
                <div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                        <span class="text-muted">SLOTS</span>
                        <span style="font-weight: 700; color: ${isFull ? 'var(--danger)' : 'var(--primary)'}">${joinedCount}/${maxSlots}</span>
                    </div>
                    <div style="background: var(--bg-hover); border-radius: 4px; height: 6px; overflow: hidden;">
                        <div style="background: ${isFull ? 'var(--danger)' : 'var(--primary)'}; height: 100%; width: ${progressPercent}%; transition: width 0.3s;"></div>
                    </div>
                </div>
                
                <div class="match-details">
                    <div class="detail-item">
                        <span class="detail-label">PRIZE POOL</span>
                        <span class="text-success" style="font-weight:700">₹${match.prizePool}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">PER KILL</span>
                        <span style="font-weight:700">₹${match.perKill}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">ENTRY FEE</span>
                        <span style="font-weight:700">₹${match.entryFee}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">TYPE</span>
                        <div>${match.type} • ${match.map}</div>
                    </div>
                </div>

                ${match.status === 'UPCOMING' ?
                    (hasJoined ?
                        `<button class="btn btn-outline btn-block" disabled>✓ Joined</button>
                         <div style="margin-top:10px; background:var(--bg-hover); padding:10px; border-radius:8px; text-align:center;">
                            <i class="fa-solid fa-lock" style="color:var(--text-muted);"></i>
                            <span class="text-muted" style="font-size:0.85rem;"> Room details available when LIVE</span>
                         </div>
                         <button class="btn btn-outline btn-sm" style="margin-top:8px; width:100%;" onclick="viewParticipants('${match.id}')">
                            <i class="fa-solid fa-users"></i> View Players (${joinedCount})
                         </button>` :
                        (isFull ?
                            `<button class="btn btn-outline btn-block" disabled style="opacity:0.5;">FULL</button>` :
                            `<button class="btn btn-primary btn-block" onclick="openJoinModal('${match.id}', ${match.entryFee})">Join Now</button>`
                        )
                    )
                    : ''}

                ${hasJoined && match.status === 'LIVE' && match.roomId ?
                    `<div style="margin-top:10px; background: linear-gradient(135deg, #1a472a 0%, #2d5a3d 100%); padding:12px; border-radius:8px; border: 1px solid var(--primary);">
                        <div style="font-size:0.75rem; color:var(--primary); margin-bottom:4px;">🎮 ROOM DETAILS</div>
                        <div style="font-family:monospace; font-size:0.95rem;">
                            ID: <span style="color:var(--primary); font-weight:700;">${match.roomId}</span>
                        </div>
                        <div style="font-family:monospace; font-size:0.95rem;">
                            Pass: <span style="color:var(--primary); font-weight:700;">${match.roomPassword || match.roomPass}</span>
                        </div>
                    </div>
                    <button class="btn btn-outline btn-sm" style="margin-top:8px; width:100%;" onclick="viewParticipants('${match.id}')">
                        <i class="fa-solid fa-users"></i> View Players (${joinedCount})
                    </button>`
                    : ''}
                
                ${match.status === 'COMPLETED' ?
                    `<button class="btn btn-primary btn-block" style="margin-top:10px;" onclick="viewMatchResults('${match.id}')">
                        <i class="fa-solid fa-trophy"></i> View Results
                    </button>
                    <button class="btn btn-outline btn-sm" style="margin-top:8px; width:100%;" onclick="viewParticipants('${match.id}')">
                        <i class="fa-solid fa-users"></i> View Players (${joinedCount})
                    </button>`
                    : ''}
            `;
            list.appendChild(el);
        });

        if (list.children.length === 0) {
            list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No ' + matchFilter.toLowerCase() + ' matches</div>';
        }
    });
}

// View Participants - IGN Only (No user IDs, emails, or phones)
window.viewParticipants = async function (matchId) {
    const listEl = document.getElementById('participants-list');
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading...</div>';
    document.getElementById('participants-modal').classList.remove('hidden');

    try {
        const pSnap = await db.ref('esports_matches/' + matchId + '/participants').once('value');

        if (!pSnap.exists()) {
            listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No participants yet</div>';
            return;
        }

        listEl.innerHTML = '';
        let count = 0;
        pSnap.forEach(child => {
            count++;
            const p = child.val();
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
                    ${p.ign || 'Player ' + count}
                </div>
            `;
            listEl.appendChild(item);
        });
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

// View Match Results - Shows winners and rewards
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

        // Calculate total distributed - handle both solo and team formats
        let totalDistributed = 0;
        // Check both 'type' (DB field) and 'matchType' (legacy) for compatibility
        const matchType = (match.type || match.matchType || 'solo').toLowerCase();
        const isTeamMode = matchType.includes('duo') || matchType.includes('squad');

        if (isTeamMode) {
            // Team mode: sum up creditedAmount from all bookers in all teams
            Object.values(results).forEach(teamResult => {
                if (teamResult.bookerBreakdown) {
                    Object.values(teamResult.bookerBreakdown).forEach(booker => {
                        totalDistributed += (booker.creditedAmount || 0);
                    });
                }
            });
        } else {
            // Solo mode: direct reward per participant
            Object.values(results).forEach(r => {
                totalDistributed += (r.reward || 0);
            });
        }

        // Build participants HTML with rewards
        let playersHtml = '';

        // Process participants differently for solo vs team
        let displayData = [];

        if (isTeamMode) {
            // Team mode: extract team number from slot key and lookup from team result
            participantList.forEach(([slotKey, p]) => {
                // Extract team number: team_1_A → 1
                const teamMatch = slotKey.match(/team_(\d+)/);
                const teamNum = teamMatch ? teamMatch[1] : null;
                const teamResultKey = teamNum ? `team_${teamNum}` : null;
                const teamResult = teamResultKey ? (results[teamResultKey] || {}) : {};

                // Find player-specific data from playerResults
                const playerData = (teamResult.playerResults || []).find(pr => pr.slotKey === slotKey) || {};
                const kills = playerData.kills ?? '-';

                // Get reward from bookerBreakdown using bookedBy UID
                const bookerUid = p.bookedBy || slotKey;
                const bookerData = teamResult.bookerBreakdown?.[bookerUid] || {};
                const reward = bookerData.creditedAmount || 0;

                const position = teamResult.position || '-';

                displayData.push({ slotKey, p, kills, reward, position, teamNum });
            });
        } else {
            // Solo mode: direct lookup
            participantList.forEach(([uid, p]) => {
                const result = results[uid] || {};
                displayData.push({
                    slotKey: uid,
                    p,
                    kills: result.kills ?? '-',
                    reward: result.reward || 0,
                    position: result.position || '-',
                    teamNum: null
                });
            });
        }

        // Sort by position (best first) or reward (highest first)
        displayData.sort((a, b) => {
            const posA = a.position === '-' ? 999 : parseInt(a.position);
            const posB = b.position === '-' ? 999 : parseInt(b.position);
            if (posA !== posB) return posA - posB;
            return (b.reward || 0) - (a.reward || 0);
        });

        displayData.forEach(({ p, kills, reward, position, teamNum }, index) => {
            playersHtml += `
                <div style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--border); ${reward > 0 ? 'background:rgba(0,255,136,0.05);' : ''}">
                    <div style="width:32px; height:32px; background:${reward > 0 ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : 'var(--bg-hover)'}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; color:${reward > 0 ? '#000' : 'var(--text-muted)'};">
                        ${position !== '-' ? position : index + 1}
                    </div>
                    <div style="flex:1;">
                        <div style="font-weight:600;">${p.ign || 'Player'}${teamNum ? ` <span style="font-size:0.7rem; color:var(--text-muted);">(Team ${teamNum})</span>` : ''}</div>
                        ${kills !== '-' ? `<div style="font-size:0.75rem; color:var(--text-muted);">${kills} kills</div>` : ''}
                    </div>
                    ${reward > 0 ? `<div style="color:var(--primary); font-weight:700;">+₹${reward}</div>` : '<div style="color:var(--text-muted); font-size:0.85rem;">-</div>'}
                </div>
            `;
        });

        // Show results modal
        const modalHtml = `
            <div id="match-results-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius:16px; max-width:380px; width:100%; max-height:80vh; overflow:hidden; display:flex; flex-direction:column; border: 2px solid var(--success);">
                    <div style="padding:20px; text-align:center; border-bottom:1px solid var(--border);">
                        <div style="width:50px; height:50px; background:linear-gradient(135deg, #ffd700, #ff8c00); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;">
                            <i class="fa-solid fa-trophy" style="font-size:24px; color:#000;"></i>
                        </div>
                        <h3 style="margin:0; color:var(--success);">🏆 MATCH RESULTS</h3>
                        <div style="color:var(--text-muted); font-size:0.85rem; margin-top:4px;">${match.title || 'Match'}</div>
                    </div>
                    
                    <div style="padding:12px 20px; background:rgba(0,255,136,0.1); display:flex; justify-content:space-around; text-align:center;">
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted);">PRIZE POOL</div>
                            <div style="font-weight:700; color:var(--success);">₹${match.prizePool || 0}</div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted);">DISTRIBUTED</div>
                            <div style="font-weight:700; color:var(--primary);">₹${totalDistributed}</div>
                        </div>
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted);">PLAYERS</div>
                            <div style="font-weight:700;">${participantList.length}</div>
                        </div>
                    </div>
                    
                    <div style="flex:1; overflow-y:auto; padding:0;">
                        ${playersHtml || '<div style="text-align:center; padding:20px; color:var(--text-muted);">No results available</div>'}
                    </div>
                    
                    <div style="padding:16px;">
                        <button onclick="document.getElementById('match-results-modal').remove()" style="width:100%; background:var(--success); color:#fff; border:none; padding:14px; border-radius:10px; font-weight:700; font-size:1rem; cursor:pointer;">
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

// View Match Details - Shows full match info with rules and participants
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
        gameSnap.forEach(child => {
            if (child.key === match.gameId) {
                gameRules = child.val().rules || '';
            }
        });

        const participants = match.participants || {};
        const participantCount = Object.keys(participants).length;
        const hasJoined = hasUserJoinedMatch(participants, state.user?.uid);
        const statusColor = match.status === 'LIVE' ? '#ff9500' : match.status === 'COMPLETED' ? '#00cc6a' : '#00ff88';

        // Build participants list
        let participantsHtml = '';
        Object.values(participants).forEach((p, i) => {
            participantsHtml += `
                <div style="display:inline-block; background:var(--bg-hover); padding:6px 12px; border-radius:20px; margin:4px; font-size:0.85rem;">
                    <span style="color:var(--primary);">${i + 1}.</span> ${p.ign || 'Player'}
                </div>
            `;
        });

        const modalHtml = `
            <div id="match-details-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px; overflow-y:auto;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius:16px; max-width:400px; width:100%; max-height:90vh; overflow-y:auto; border: 2px solid ${statusColor};">
                    <!-- Header -->
                    <div style="padding:20px; border-bottom:1px solid var(--border); position:sticky; top:0; background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); z-index:1;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <span style="font-size:0.7rem; padding:3px 8px; border-radius:4px; background:${statusColor}; color:#000; font-weight:600;">${match.status}</span>
                                ${hasJoined ? '<span style="font-size:0.7rem; padding:3px 8px; border-radius:4px; background:#00ff88; color:#000; font-weight:600; margin-left:6px;">✓ JOINED</span>' : ''}
                            </div>
                            <button onclick="document.getElementById('match-details-modal').remove()" style="background:transparent; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer;">&times;</button>
                        </div>
                        <h3 style="margin:12px 0 4px; color:#fff;">${match.title || 'Match'}</h3>
                        <div style="color:var(--text-muted); font-size:0.85rem;">${match.gameName || 'Game'} • ${match.type || 'Solo'} • ${match.map || 'Map'}</div>
                    </div>
                    
                    <!-- Match Info -->
                    <div style="padding:16px 20px; display:grid; grid-template-columns:repeat(2,1fr); gap:12px; border-bottom:1px solid var(--border);">
                        <div style="text-align:center; padding:12px; background:var(--bg-hover); border-radius:10px;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">ENTRY FEE</div>
                            <div style="font-size:1.2rem; font-weight:700;">₹${match.entryFee || 0}</div>
                        </div>
                        <div style="text-align:center; padding:12px; background:var(--bg-hover); border-radius:10px;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">PRIZE POOL</div>
                            <div style="font-size:1.2rem; font-weight:700; color:var(--success);">₹${match.prizePool || 0}</div>
                        </div>
                        <div style="text-align:center; padding:12px; background:var(--bg-hover); border-radius:10px;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">PER KILL</div>
                            <div style="font-size:1.2rem; font-weight:700; color:var(--warning);">₹${match.perKill || 0}</div>
                        </div>
                        <div style="text-align:center; padding:12px; background:var(--bg-hover); border-radius:10px;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">SLOTS</div>
                            <div style="font-size:1.2rem; font-weight:700;">${participantCount}/${match.maxParticipants || 100}</div>
                        </div>
                    </div>
                    
                    <!-- Date/Time -->
                    <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <i class="fa-regular fa-calendar" style="color:var(--primary);"></i>
                            <div>
                                <div style="font-weight:600;">${new Date(match.dateTime || match.time).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                                <div style="color:var(--text-muted); font-size:0.85rem;">${new Date(match.dateTime || match.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                            </div>
                        </div>
                    </div>
                    
                    ${hasJoined && match.status === 'LIVE' && match.roomId ? `
                    <!-- Room Details for joined users -->
                    <div style="padding:16px 20px; background:rgba(0,255,136,0.1); border-bottom:1px solid var(--border);">
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:10px; font-weight:600;">🎮 ROOM DETAILS</div>
                        <div style="display:flex; gap:16px;">
                            <div style="flex:1; background:var(--bg-main); padding:10px; border-radius:8px; text-align:center;">
                                <div style="font-size:0.7rem; color:var(--text-muted);">ROOM ID</div>
                                <div style="font-family:monospace; font-weight:700; font-size:1.1rem;">${match.roomId}</div>
                            </div>
                            <div style="flex:1; background:var(--bg-main); padding:10px; border-radius:8px; text-align:center;">
                                <div style="font-size:0.7rem; color:var(--text-muted);">PASSWORD</div>
                                <div style="font-family:monospace; font-weight:700; font-size:1.1rem;">${match.roomPassword}</div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
                    <!-- Rules -->
                    ${gameRules ? `
                    <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:10px; font-weight:600;">📋 GAME RULES</div>
                        <div style="color:var(--text-muted); font-size:0.9rem; line-height:1.6; white-space:pre-wrap;">${gameRules}</div>
                    </div>
                    ` : ''}
                    
                    <!-- Participants -->
                    <div style="padding:16px 20px;">
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:10px; font-weight:600;">👥 PARTICIPANTS (${participantCount})</div>
                        <div style="max-height:150px; overflow-y:auto;">
                            ${participantsHtml || '<div style="color:var(--text-muted); font-size:0.9rem;">No participants yet</div>'}
                        </div>
                    </div>
                    
                    <!-- Action Button -->
                    <div style="padding:16px 20px; border-top:1px solid var(--border);">
                        <button onclick="document.getElementById('match-details-modal').remove()" style="width:100%; background:${statusColor}; color:#000; border:none; padding:14px; border-radius:10px; font-weight:700; cursor:pointer;">
                            Close
                        </button>
                    </div>
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
            Object.entries(match.participants).forEach(([key, data]) => {
                if (data.teamNumber && data.slotPosition) {
                    slotState.bookedSlots[`${data.teamNumber}_${data.slotPosition}`] = data;
                } else {
                    // Legacy booking - assign to next available
                    // This handles old-style bookings
                }
            });
        }

        // Update modal header
        document.getElementById('slot-modal-title').textContent = match.title || 'Match';
        document.getElementById('slot-modal-type').textContent = matchType.charAt(0).toUpperCase() + matchType.slice(1);
        document.getElementById('slot-entry-fee').textContent = slotState.entryFee;
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
        document.getElementById('slot-total-amount').textContent = `₹${total}`;

        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = `<i class="fa-solid fa-wallet"></i> Pay ₹${total} & Join`;
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

        const joinEsportsMatchFn = functions.httpsCallable('joinEsportsMatch');
        const result = await joinEsportsMatchFn({
            matchId: matchId,
            ign: igns,
            slotsToBook: slotsToBook,
            gameId: slotState.gameId
        });
        const r = result.data;

        // Sync local state
        state.userData.depositBalance = r.newDepositBalance;
        state.userData.winningBalance = r.newWinningBalance;
        if (!state.userData.gameIGNs) state.userData.gameIGNs = {};
        state.userData.gameIGNs[slotState.gameId] = primaryIgn;
        updateUIHeader();

        closeModal('slot-selection-modal');
        showToast(`✅ Successfully joined with ${count} slot${count > 1 ? 's' : ''}!`, 'success');
        loadMatchesList();

    } catch (err) {
        console.error('Slot booking error:', err);
        showToast('Failed: ' + (err.details || err.message || 'Try again.'), 'error');
    }
};


window.openJoinModal = function (matchId, fee) {
    // Redirect to new slot modal
    openSlotModal(matchId);
};

window.confirmJoinMatch = async function () {
    const ign = document.getElementById('join-ign').value.trim();
    if (!ign) return showToast('Enter your In-Game Name (IGN)', 'error');

    const matchId = state.currentMatchId;
    const uid = state.user.uid;
    const selectedSlots = state.selectedSlots || [];

    try {
        // Show loading state
        showToast('Joining match...', 'info');

        // Get the game ID from the match for IGN saving
        const matchSnap = await db.ref(`esports_matches/${matchId}`).once('value');
        const matchData = matchSnap.val();
        const gameId = matchData?.gameId || matchData?.gameName || '';

        const joinEsportsMatchFn = functions.httpsCallable('joinEsportsMatch');
        const result = await joinEsportsMatchFn({
            matchId: matchId,
            ign: ign,
            selectedSlots: selectedSlots,
            gameId: gameId
        });
        const r = result.data;

        // Sync local state
        state.userData.depositBalance = r.newDepositBalance;
        state.userData.winningBalance = r.newWinningBalance;
        updateUIHeader();

        showToast('🎮 Joined Successfully!', 'success');
        closeModal('join-match-modal');

        // Clear selected slots
        state.selectedSlots = [];

        // Refresh the matches list
        loadMatchesList();

    } catch (e) {
        console.error('[JOIN] Error:', e);
        closeModal('join-match-modal');
        showToast('Failed: ' + (e.details || e.message || 'Please try again'), 'error');
    }
};

// Show insufficient balance modal with redirect option
function showInsufficientBalanceModal(message) {
    const modal = document.createElement('div');
    modal.id = 'insufficient-balance-modal';
    modal.className = 'modal-overlay';
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

// Challenge Created Success Modal with Instructions
function showChallengeCreatedModal() {
    const modal = document.createElement('div');
    modal.id = 'challenge-created-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="text-align: left; max-width: 380px;">
            <h3 style="color: var(--danger); margin-bottom: 0.5rem; text-align: center; font-weight: 700;">
                You have successfully created the challenge. The challenge will appear in your My Challenges.
            </h3>
            <ol style="padding-left: 1.2rem; margin: 1rem 0; font-size: 0.85rem; color: var(--text-muted); line-height: 1.6;">
                <li><strong>Please wait until an opponent accepts your challenge.</strong></li>
                <li><strong>Once matched, share the Room Code from Ludo King app.</strong></li>
                <li><strong>Create a room in Ludo King and copy the code to share.</strong></li>
                <li><strong>After the game ends, submit your result immediately.</strong></li>
                <li><strong style="color: var(--danger);">Penalty: ₹25 deduction for not submitting your result.</strong></li>
                <li><strong style="color: var(--danger);">Penalty: ₹25 deduction for submitting incorrect result.</strong></li>
                <li><strong>Need help? Watch the tutorial video for Room Code steps.</strong></li>
                <li><strong style="color: var(--danger);">Important: Share room code within 15 mins or ₹25 penalty applies.</strong></li>
            </ol>
            <button class="btn btn-primary btn-block" onclick="closeChallengeCreatedModal()" style="margin-top: 0.5rem;">
                OK
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

window.closeChallengeCreatedModal = function () {
    const modal = document.getElementById('challenge-created-modal');
    if (modal) modal.remove();
};

// Challenge Joined Success Modal with Instructions (for acceptor)
function showChallengeJoinedModal() {
    const modal = document.createElement('div');
    modal.id = 'challenge-joined-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="text-align: left; max-width: 380px;">
            <h3 style="color: var(--danger); margin-bottom: 0.5rem; text-align: center; font-weight: 700;">
                You have successfully joined the challenge. The challenge will appear in your My Challenges.
            </h3>
            <ol style="padding-left: 1.2rem; margin: 1rem 0; font-size: 0.85rem; color: var(--text-muted); line-height: 1.6;">
                <li><strong>The challenger will share the Room Code shortly.</strong></li>
                <li><strong>Open Ludo King app and enter the code to join.</strong></li>
                <li><strong>Complete the match and report your result promptly.</strong></li>
                <li><strong style="color: var(--danger);">Penalty: ₹25 deduction if result is not submitted.</strong></li>
                <li><strong style="color: var(--danger);">Penalty: ₹25 deduction for false result claims.</strong></li>
                <li><strong>Watch the help video to understand the process better.</strong></li>
                <li><strong>For any issues, reach out to JeetoPlay support.</strong></li>
                <li><strong style="color: var(--danger);">Important: Submit result within 2 hours or ₹25 penalty applies.</strong></li>
            </ol>
            <button class="btn btn-primary btn-block" onclick="closeChallengeJoinedModal()" style="margin-top: 0.5rem;">
                OK
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

window.closeChallengeJoinedModal = function () {
    const modal = document.getElementById('challenge-joined-modal');
    if (modal) modal.remove();
};


