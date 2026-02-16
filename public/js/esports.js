// JeetoPlay — eSports
// Auto-extracted from app.html

// XSS sanitization for user-controlled values (IGN names, titles, etc.)
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

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
            el.style.cursor = 'pointer';
            el.onclick = () => viewMatchDetails(match.id);

            // Mini status indicator at the bottom
            let statusIndicator = '';
            if (match.status === 'UPCOMING') {
                if (hasJoined) {
                    statusIndicator = `<div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
                        <span style="font-size:0.78rem; color:#00ff88; font-weight:600;"><i class="fa-solid fa-circle-check"></i> Joined</span>
                        <span style="font-size:0.75rem; color:var(--text-muted);">Tap for details →</span>
                    </div>`;
                } else if (isFull) {
                    statusIndicator = `<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border); text-align:center;">
                        <span style="font-size:0.78rem; color:var(--danger); font-weight:600;">FULL</span>
                    </div>`;
                } else {
                    statusIndicator = `<div style="margin-top:12px;">
                        <div style="background:linear-gradient(135deg, #00ff88, #00cc6a); padding:12px 16px; border-radius:10px; text-align:center; cursor:pointer; box-shadow:0 4px 15px rgba(0,255,136,0.25);">
                            <span style="font-size:0.9rem; color:#000; font-weight:700; letter-spacing:0.3px;"><i class="fa-solid fa-bolt"></i> Join Now — 🪙 ${match.entryFee}</span>
                        </div>
                    </div>`;
                }
            } else if (match.status === 'LIVE') {
                statusIndicator = `<div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
                    <span style="font-size:0.78rem; color:#ff9500; font-weight:600;"><i class="fa-solid fa-broadcast-tower"></i> LIVE NOW</span>
                    ${hasJoined ? '<span style="font-size:0.75rem; color:var(--text-muted);">Tap for room details →</span>' : ''}
                </div>`;
            } else if (match.status === 'COMPLETED') {
                statusIndicator = `<div style="margin-top:10px; padding:10px; background:linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08)); border-radius:8px; text-align:center; border:1px solid rgba(99,102,241,0.2);">
                    <span style="font-size:0.85rem; color:#8b5cf6; font-weight:700;"><i class="fa-solid fa-trophy"></i> View Results</span>
                </div>`;
            }

            el.innerHTML = `
                 <div class="match-header">
                    <span>#${match.matchId || match.id.slice(-10)}</span>
                    <span class="text-${match.status === 'LIVE' ? 'danger' : match.status === 'COMPLETED' ? 'primary' : 'success'}">${match.status}</span>
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
                        <span class="text-success" style="font-weight:700">🪙 ${match.prizePool}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">PER KILL</span>
                        <span style="font-weight:700">🪙 ${match.perKill}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">ENTRY FEE</span>
                        <span style="font-weight:700">🪙 ${match.entryFee}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">TYPE</span>
                        <div>${match.type} • ${match.map}</div>
                    </div>
                </div>

                ${statusIndicator}
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

        // Batch-fetch VIP flags for all participant UIDs
        const vipMap = {};
        const entries = [];
        pSnap.forEach(child => { entries.push({ key: child.key, val: child.val() }); });
        const uids = entries.map(e => e.val.bookedBy || e.key).filter(Boolean);
        const uniqueUids = [...new Set(uids)];
        await Promise.all(uniqueUids.map(async uid => {
            try {
                const s = await db.ref(`users/${uid}/isVip`).once('value');
                vipMap[uid] = s.val() === true;
            } catch (e) { /* ignore */ }
        }));

        listEl.innerHTML = '';
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

        if (isTeamMode) {
            participantList.forEach(([slotKey, p]) => {
                const teamMatch = slotKey.match(/team_(\d+)/);
                const teamNum = teamMatch ? teamMatch[1] : null;
                const teamResultKey = teamNum ? `team_${teamNum}` : null;
                const teamResult = teamResultKey ? (results[teamResultKey] || {}) : {};

                const playerData = (teamResult.playerResults || []).find(pr => pr.slotKey === slotKey) || {};
                const kills = playerData.kills ?? '-';

                const bookerUid = p.bookedBy || slotKey;
                const bookerData = teamResult.bookerBreakdown?.[bookerUid] || {};
                const reward = bookerData.creditedAmount || 0;

                const position = teamResult.position || '-';

                displayData.push({ slotKey, p, kills, reward, position, teamNum, bookerUid });
            });
        } else {
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
        }

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
                        <div style="font-weight:600; font-size:0.9rem; ${isMe ? 'color:#6366f1;' : ''}">${escapeHtml(p.ign) || 'Player'} ${rVipBadge}${isMe ? ' <span style="font-size:0.65rem; padding:1px 6px; background:rgba(99,102,241,0.2); border-radius:10px; color:#818cf8;">YOU</span>' : ''}${teamNum ? ` <span style="font-size:0.65rem; color:var(--text-muted);">(Team ${teamNum})</span>` : ''}</div>
                        <div style="display:flex; gap:10px; margin-top:2px;">
                            ${kills !== '-' ? `<span style="font-size:0.73rem; color:var(--text-muted);"><i class="fa-solid fa-crosshairs"></i> ${kills} kills</span>` : ''}
                            ${posNum ? `<span style="font-size:0.73rem; color:var(--text-muted);"><i class="fa-solid fa-ranking-star"></i> #${posNum}</span>` : ''}
                        </div>
                    </div>
                    ${reward > 0 ? `<div style="color:#00ff88; font-weight:700; font-size:0.95rem; flex-shrink:0;">+🪙 ${reward}</div>` : '<div style="color:var(--text-muted); font-size:0.85rem; flex-shrink:0;">-</div>'}
                </div>
            `;
        });

        // Current user's result summary
        let myResultHTML = '';
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
                            <div style="font-weight:700; font-size:1.1rem; color:${myResult.reward > 0 ? '#00ff88' : 'var(--text-muted)'};"> ${myResult.reward > 0 ? '+🪙 ' + myResult.reward : '🪙 0'}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Show results modal
        const modalHtml = `
            <div id="match-results-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px;">
                <div style="background: linear-gradient(145deg, #0f1923 0%, #151f2e 50%, #0d1520 100%); border-radius:20px; max-width:420px; width:100%; max-height:88vh; overflow:hidden; display:flex; flex-direction:column; border: 1.5px solid #6366f1; box-shadow: 0 0 60px rgba(0,0,0,0.5), 0 0 20px rgba(99,102,241,0.2);">
                    <!-- Header -->
                    <div style="padding:20px; text-align:center; border-bottom:1px solid var(--border);">
                        <div style="width:50px; height:50px; background:linear-gradient(135deg, #ffd700, #ff8c00); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;">
                            <i class="fa-solid fa-trophy" style="font-size:24px; color:#000;"></i>
                        </div>
                        <h3 style="margin:0 0 4px; color:#fff; font-size:1.1rem;">${match.title || 'Match Results'}</h3>
                        <div style="color:var(--text-muted); font-size:0.82rem;">${match.gameName || 'Game'} • ${(match.type || 'Solo')} • ${match.map || 'Map'}</div>
                        <div style="color:var(--text-muted); font-size:0.75rem; margin-top:4px;">${new Date(match.dateTime || match.time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    </div>
                    
                    <!-- Stats -->
                    <div style="padding:12px 16px; display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; border-bottom:1px solid var(--border);">
                        <div style="text-align:center;">
                            <div style="font-size:0.65rem; color:var(--text-muted);">POOL</div>
                            <div style="font-weight:700; color:#00ff88; font-size:0.9rem;">🪙 ${match.prizePool || 0}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.65rem; color:var(--text-muted);">GIVEN</div>
                            <div style="font-weight:700; color:var(--primary); font-size:0.9rem;">🪙 ${totalDistributed}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.65rem; color:var(--text-muted);">PER KILL</div>
                            <div style="font-weight:700; color:#ffc107; font-size:0.9rem;">🪙 ${match.perKill || 0}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.65rem; color:var(--text-muted);">PLAYERS</div>
                            <div style="font-weight:700; font-size:0.9rem;">${participantList.length}</div>
                        </div>
                    </div>
                    
                    ${myResultHTML}
                    ${posRewardsHTML}
                    
                    <!-- Results List -->
                    <div style="flex:1; overflow-y:auto; padding:0;">
                        ${playersHtml || '<div style="text-align:center; padding:20px; color:var(--text-muted);">No results available yet</div>'}
                    </div>
                    
                    <div style="padding:14px 16px; border-top:1px solid var(--border);">
                        <button onclick="document.getElementById('match-results-modal').remove()" style="width:100%; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; border:none; padding:14px; border-radius:12px; font-weight:700; font-size:1rem; cursor:pointer;">
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

        // ── Participants (with VIP badge) ──
        const participantEntries = Object.entries(participants).slice(0, 20);
        let participantsHTML = '';
        // Batch-fetch VIP flags
        const _vipMap = {};
        const _pUids = participantEntries.map(([k, p]) => p.bookedBy || k).filter(Boolean);
        const _uniquePUids = [...new Set(_pUids)];
        await Promise.all(_uniquePUids.map(async pUid => {
            try { const s = await db.ref(`users/${pUid}/isVip`).once('value'); _vipMap[pUid] = s.val() === true; } catch (e) { }
        }));
        if (participantEntries.length > 0) {
            participantsHTML = participantEntries.map(([k, p], i) => {
                const pUid = p.bookedBy || k;
                const vBadge = _vipMap[pUid] && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : '';
                return `
                <span style="display:inline-block; font-size:0.78rem; padding:3px 10px; background:var(--bg-hover); border-radius:20px; margin:3px;">
                    <span style="color:var(--primary); font-weight:600;">${i + 1}.</span> ${escapeHtml(p.ign) || 'Player'} ${vBadge}
                </span>
            `;
            }).join('');
            if (participantCount > 20) {
                participantsHTML += `<span style="font-size:0.75rem; color:var(--text-muted); padding:3px 8px;">+${participantCount - 20} more</span>`;
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
                        <i class="fa-solid fa-bolt"></i> Join Now — 🪙 ${match.entryFee || 0}
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
                        <div style="font-size:0.8rem; color:var(--primary); margin-bottom:8px; font-weight:600;">👥 PARTICIPANTS (${participantCount}/${maxSlots})</div>
                        <div style="background:var(--bg-hover); border-radius:10px; padding:10px; max-height:160px; overflow-y:auto;">
                            <div style="display:flex; flex-wrap:wrap; gap:2px;">
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
        document.getElementById('slot-total-amount').textContent = `🪙 ${total}`;

        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = `<i class="fa-solid fa-wallet"></i> Pay 🪙 ${total} & Join`;
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
    // Redirect to slot-based booking modal
    openSlotModal(matchId);
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


