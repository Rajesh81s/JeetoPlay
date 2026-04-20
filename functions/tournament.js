/**
 * tournament.js — Tournament Cloud Functions
 * 
 * Secure, server-side tournament operations.
 * Registration is final — once a user joins, they cannot leave.
 * Only admins can cancel tournaments (with refunds via admin panel).
 * 
 * Exports:
 *   registerForTournament       — User joins a tournament (deducts entry fee)
 *   completeBracketTournament   — Admin completes bracket tournament (prizes)
 *   completeLobbyTournament     — Admin completes lobby tournament (prizes)
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, sendPush, deductBalance, checkRateLimit, assertNotBanned, logEvent
} = require('./helpers');

// ─── Register For Tournament ────────────────────────────────

exports.registerForTournament = onCall(async (request) => {
    const uid = assertAuth(request);
    const { tournamentId, ign, slotsToBook } = request.data;

    // Rate limit: max 5 registration attempts per 5 minutes
    await checkRateLimit(uid, 'tournament_register', 5, 5 * 60 * 1000);

    // Ban check
    await assertNotBanned(uid);

    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');

    // Sanitize IGN — supports both string (solo) and array (team)
    const sanitizeIgn = (val) => {
        if (typeof val !== 'string') return String(val).substring(0, 30);
        return val.replace(/<[^>]*>/g, '').trim().substring(0, 30);
    };
    let sanitizedIgn;
    if (Array.isArray(ign)) {
        sanitizedIgn = ign.map(v => sanitizeIgn(v));
    } else {
        if (!ign || typeof ign !== 'string' || ign.trim().length < 2) {
            throw new HttpsError('invalid-argument', 'Valid IGN required (min 2 chars)');
        }
        sanitizedIgn = sanitizeIgn(ign);
    }

    // Determine if team booking (Duo/Squad) or Solo
    const isDuoSquad = Array.isArray(slotsToBook) && slotsToBook.length > 0;
    const slotsCount = isDuoSquad ? slotsToBook.length : 1;

    const tournRef = db.ref('tournaments/' + tournamentId);

    // Atomically register the participant(s)
    const txn = await tournRef.transaction(tournament => {
        if (!tournament) return null; // Retry on cold start

        // Validate status
        if (tournament.status !== 'REGISTRATION') return; // Abort

        // Validate registration window
        const now = Date.now();
        if (now < tournament.registrationOpens) return; // Not open yet
        if (now >= tournament.registrationCloses) return; // Closed

        // Check capacity
        if (!tournament.participants) tournament.participants = {};
        const currentCount = Object.keys(tournament.participants).length;

        if (isDuoSquad) {
            // ── Team Mode (Duo/Squad) ──
            // Check capacity for all requested slots
            if (currentCount + slotsToBook.length > tournament.maxParticipants) return; // Full

            // Check specific team/position slots aren't taken
            for (const slot of slotsToBook) {
                const slotKey = `team_${slot.team}_${slot.position}`;
                if (tournament.participants[slotKey]) return; // Slot taken
            }

            // Prevent same user re-booking: check bookedBy across all participants
            const alreadyBooked = Object.values(tournament.participants).some(
                p => p.bookedBy === uid
            );
            if (alreadyBooked) return;

            // Reserve slots
            const timestamp = Date.now();
            slotsToBook.forEach((slot, index) => {
                const slotKey = `team_${slot.team}_${slot.position}`;
                tournament.participants[slotKey] = {
                    bookedBy: uid,
                    ign: Array.isArray(sanitizedIgn) ? sanitizedIgn[index] : sanitizedIgn,
                    joinedAt: timestamp,
                    teamNumber: slot.team,
                    slotPosition: slot.position,
                    slotIndex: index + 1,
                    pending: true
                };
            });
            tournament.registeredCount = currentCount + slotsToBook.length;
        } else {
            // ── Solo Mode ──
            if (currentCount >= tournament.maxParticipants) return; // Full
            if (tournament.participants[uid]) return; // Already in

            tournament.participants[uid] = {
                ign: sanitizedIgn,
                registeredAt: now,
                uid: uid
            };
            tournament.registeredCount = currentCount + 1;
        }

        return tournament;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError(
            'failed-precondition',
            'Registration failed. Tournament may be full, closed, or you are already registered.'
        );
    }

    const tournamentData = txn.snapshot.val();
    const perSlotFee = tournamentData.entryFee || 0;
    const totalFee = perSlotFee * slotsCount;

    // Deduct entry fee atomically (if > 0)
    if (totalFee > 0) {
        const deduction = await deductBalance(uid, totalFee);
        if (!deduction) {
            // Rollback registration
            if (isDuoSquad) {
                const rollback = {};
                slotsToBook.forEach(slot => {
                    rollback[`participants/team_${slot.team}_${slot.position}`] = null;
                });
                // Also fix registeredCount
                await tournRef.transaction(t => {
                    if (!t) return null;
                    slotsToBook.forEach(slot => {
                        const slotKey = `team_${slot.team}_${slot.position}`;
                        if (t.participants && t.participants[slotKey]) {
                            delete t.participants[slotKey];
                        }
                    });
                    t.registeredCount = Math.max(0, (t.registeredCount || slotsCount) - slotsCount);
                    return t;
                });
            } else {
                await tournRef.transaction(t => {
                    if (!t) return null;
                    if (t.participants && t.participants[uid]) {
                        delete t.participants[uid];
                        t.registeredCount = Math.max(0, (t.registeredCount || 1) - 1);
                    }
                    return t;
                });
            }
            throw new HttpsError(
                'failed-precondition',
                `Insufficient balance. Entry fee: 🪙 ${totalFee}`
            );
        }

        // Confirm slots + record deposit/winning split for precise refunds
        const confirmUpdates = {};
        if (isDuoSquad) {
            slotsToBook.forEach(slot => {
                const slotKey = `team_${slot.team}_${slot.position}`;
                confirmUpdates[`participants/${slotKey}/pending`] = null;
                confirmUpdates[`participants/${slotKey}/confirmed`] = true;
                confirmUpdates[`participants/${slotKey}/depositDeducted`] = deduction.depositDeducted / slotsCount;
                confirmUpdates[`participants/${slotKey}/winningDeducted`] = deduction.winningDeducted / slotsCount;
            });
        } else {
            confirmUpdates[`participants/${uid}/depositDeducted`] = deduction.depositDeducted;
            confirmUpdates[`participants/${uid}/winningDeducted`] = deduction.winningDeducted;
            confirmUpdates[`participants/${uid}/confirmed`] = true;
        }
        await tournRef.update(confirmUpdates);

        // Log transaction
        const userAfter = deduction.userAfter;
        await db.ref('wallet_transactions').push({
            userId: uid,
            userName: userAfter.fullName || userAfter.username || 'User',
            amount: totalFee,
            type: 'DEBIT',
            isCredit: false,
            description: `Tournament Entry: ${tournamentData.title || 'Tournament'}${slotsCount > 1 ? ` (${slotsCount} slots)` : ''}`,
            reason: `Joined Tournament: ${tournamentData.title || tournamentId}`,
            gameName: tournamentData.gameName || '',
            tournamentId: tournamentId,
            slotsBooked: slotsCount,
            depositDeducted: deduction.depositDeducted,
            winningDeducted: deduction.winningDeducted,
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // Send notification
        const shortId = tournamentId.slice(-6).toUpperCase();
        sendPush(
            uid,
            `🏆 Tournament Registered — ${tournamentData.gameName || 'Tournament'}`,
            `You're in "${tournamentData.title}"! 🪙 ${totalFee} deducted (${slotsCount} slot${slotsCount > 1 ? 's' : ''}). Good luck!`,
            { type: 'TOURNAMENT_REGISTERED', tournamentId }
        ).catch(() => { });

        return {
            success: true,
            slotsBooked: slotsCount,
            depositDeducted: deduction.depositDeducted,
            winningDeducted: deduction.winningDeducted,
            newDepositBalance: userAfter.depositBalance || 0,
            newWinningBalance: userAfter.winningBalance || 0
        };
    } else {
        // Free tournament — no balance deduction needed
        if (isDuoSquad) {
            const confirmUpdates = {};
            slotsToBook.forEach(slot => {
                const slotKey = `team_${slot.team}_${slot.position}`;
                confirmUpdates[`participants/${slotKey}/pending`] = null;
                confirmUpdates[`participants/${slotKey}/confirmed`] = true;
            });
            await tournRef.update(confirmUpdates);
        } else {
            await tournRef.child(`participants/${uid}`).update({ confirmed: true });
        }

        sendPush(
            uid,
            `🏆 Tournament Registered — ${tournamentData.gameName || 'Tournament'}`,
            `You're in "${tournamentData.title}"! Free entry (${slotsCount} slot${slotsCount > 1 ? 's' : ''}). Good luck!`,
            { type: 'TOURNAMENT_REGISTERED', tournamentId }
        ).catch(() => { });

        return {
            success: true,
            slotsBooked: slotsCount,
            depositDeducted: 0,
            winningDeducted: 0,
            newDepositBalance: 0,
            newWinningBalance: 0
        };
    }
});

// NOTE: Unregistration is intentionally NOT supported.
// Once a user registers for a tournament, they cannot leave.
// Only admins can cancel entire tournaments (with refunds).

// ─── Complete Bracket Tournament (Admin) ────────────────────

exports.completeBracketTournament = onCall(async (request) => {
    const adminUid = assertAuth(request);

    // Verify admin
    const adminSnap = await db.ref(`admins/${adminUid}`).once('value');
    const modSnap = await db.ref(`moderators/${adminUid}`).once('value');
    if (!adminSnap.exists() && !modSnap.exists()) {
        throw new HttpsError('permission-denied', 'Admin access required');
    }

    const { tournamentId, championUid, runnerUpUid } = request.data;
    if (!tournamentId || !championUid) {
        throw new HttpsError('invalid-argument', 'tournamentId and championUid required');
    }

    const tournRef = db.ref('tournaments/' + tournamentId);
    const snap = await tournRef.once('value');
    if (!snap.exists()) throw new HttpsError('not-found', 'Tournament not found');

    const t = snap.val();

    // Validate state — must be in bracket-active status
    if (!['BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE'].includes(t.status)) {
        throw new HttpsError('failed-precondition', `Cannot complete tournament in status: ${t.status}`);
    }

    const prizeBreakdown = t.prizeBreakdown || {};
    const distributionPromises = [];
    const isTeamMode = t.type === 'Duo' || t.type === 'Squad';
    const participants = t.participants || {};

    // Helper: get all real UIDs for a team by finding all participants with matching teamNumber
    const getTeamMemberUids = (leaderUid) => {
        if (!isTeamMode) return [leaderUid];
        // For team modes: check if the leaderUid is a participant key (uid or team_X_Y)
        const participant = participants[leaderUid];
        if (!participant) return [leaderUid];
        const teamNum = participant.teamNumber;
        if (!teamNum) return [participant.bookedBy || leaderUid];
        // Find all unique UIDs in this team
        const uids = new Set();
        for (const [, p] of Object.entries(participants)) {
            if (p.teamNumber === teamNum && p.bookedBy) uids.add(p.bookedBy);
        }
        return uids.size > 0 ? [...uids] : [leaderUid];
    };

    // Helper: atomic prize credit
    const creditPrize = (uid, amount, place, reason) => {
        distributionPromises.push(
            db.ref(`users/${uid}`).transaction(user => {
                if (!user) return user;
                user.winningBalance = (user.winningBalance || 0) + amount;
                user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
                return user;
            }),
            db.ref('wallet_transactions').push({
                userId: uid,
                amount,
                type: 'TOURNAMENT_PRIZE',
                isCredit: true,
                reason,
                tournamentId,
                place,
                timestamp: admin.database.ServerValue.TIMESTAMP,
                status: 'SUCCESS',
                creditedTo: 'winning'
            }),
            db.ref(`users/${uid}`).update({
                'stats/esportsWinnings': admin.database.ServerValue.increment(amount),
                'stats/totalWinnings': admin.database.ServerValue.increment(amount),
                'stats/matchesWon': admin.database.ServerValue.increment(1)
            })
        );
        sendPush(
            uid,
            `🏆 Tournament Prize Won!`,
            `You placed ${ordinalLabel(place)} in "${t.title}"! 🪙${amount} has been credited to your wallet.`,
            { type: 'TOURNAMENT_PRIZE', tournamentId, place: String(place), amount: String(amount) }
        ).catch(() => { });
    };

    // Distribute prizes — for team modes, split among team members
    const distributePlacePrize = (placeUid, place) => {
        const totalPrize = prizeBreakdown[String(place)] || 0;
        if (totalPrize <= 0 || !placeUid) return;
        const memberUids = getTeamMemberUids(placeUid);
        const perMemberPrize = Math.floor(totalPrize / memberUids.length);
        if (perMemberPrize <= 0) return;
        memberUids.forEach(uid => {
            creditPrize(uid, perMemberPrize, place, `${ordinalLabel(place)} Place — ${t.title}`);
        });
    };

    // 1st place
    distributePlacePrize(championUid, 1);

    // 2nd place
    distributePlacePrize(runnerUpUid, 2);

    // 3rd place (semifinal losers)
    if (prizeBreakdown['3'] && t.totalRounds >= 2) {
        const semiRound = t.bracket?.[`round_${t.totalRounds - 1}`];
        if (semiRound) {
            for (const [, mv] of Object.entries(semiRound)) {
                if (mv.loser && mv.loser !== championUid && mv.loser !== runnerUpUid) {
                    distributePlacePrize(mv.loser, 3);
                }
            }
        }
    }

    await Promise.all(distributionPromises);

    // Update tournament status
    await tournRef.update({
        status: 'COMPLETED',
        completedAt: admin.database.ServerValue.TIMESTAMP,
        completedBy: adminUid,
        champion: championUid,
        runnerUp: runnerUpUid || null
    });

    // Admin log
    await db.ref('admin_logs').push({
        action: 'COMPLETE_TOURNAMENT',
        adminId: adminUid,
        details: `Tournament "${t.title}" completed. Champion: ${championUid}. Prizes distributed server-side.`,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        tournamentId
    });

    logEvent('completeBracketTournament', 'info', 'Bracket tournament completed', { tournamentId, championUid, adminUid });

    return { success: true, message: 'Tournament completed and prizes distributed.' };
});

// ─── Complete Lobby Tournament (Admin) ──────────────────────

exports.completeLobbyTournament = onCall(async (request) => {
    const adminUid = assertAuth(request);

    // Verify admin
    const adminSnap = await db.ref(`admins/${adminUid}`).once('value');
    const modSnap = await db.ref(`moderators/${adminUid}`).once('value');
    if (!adminSnap.exists() && !modSnap.exists()) {
        throw new HttpsError('permission-denied', 'Admin access required');
    }

    const { tournamentId } = request.data;
    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');

    const tournRef = db.ref('tournaments/' + tournamentId);
    const snap = await tournRef.once('value');
    if (!snap.exists()) throw new HttpsError('not-found', 'Tournament not found');

    const t = snap.val();

    // Validate state
    if (!['LOBBY_SCORED', 'LOBBY_IN_PROGRESS', 'LOBBIES_GENERATED'].includes(t.status)) {
        throw new HttpsError('failed-precondition', `Cannot complete tournament in status: ${t.status}`);
    }

    const round = t.currentRound || 1;
    const roundKey = `round_${round}`;
    const lobbies = t.lobbies?.[roundKey] || {};
    const winnersCount = t.winnersCount || 3;
    const prizeBreakdown = t.prizeBreakdown || {};
    const isTeamMode = t.type === 'Duo' || t.type === 'Squad';
    const participants = t.participants || {};

    // Verify all lobbies are scored
    const lobbyEntries = Object.entries(lobbies);
    if (lobbyEntries.length === 0) {
        throw new HttpsError('failed-precondition', 'No lobbies found for the final round');
    }
    const unscored = lobbyEntries.filter(([, l]) => !l.scored);
    if (unscored.length > 0) {
        throw new HttpsError('failed-precondition', `${unscored.length} lobby(s) not yet scored`);
    }

    // Aggregate final scores
    const allResults = [];

    if (isTeamMode) {
        // ── Team Mode: results are keyed by team_X in lobby results ──
        for (const [, lobby] of lobbyEntries) {
            const results = lobby.results || {};
            const players = lobby.players || {};
            for (const [key, result] of Object.entries(results)) {
                // key is team_X — extract X as the team number
                const teamNum = key.startsWith('team_') ? key.replace('team_', '') : key;
                // Collect all UIDs belonging to this team from the lobby players
                const teamMemberUids = [];
                const teamIgns = [];
                for (const [pKey, pData] of Object.entries(players)) {
                    if (String(pData.teamNumber) === String(teamNum)) {
                        if (pData.bookedBy) teamMemberUids.push(pData.bookedBy);
                        if (pData.ign) teamIgns.push(pData.ign);
                    }
                }
                // Deduplicate UIDs (same user may have booked multiple slots)
                const uniqueUids = [...new Set(teamMemberUids)];
                allResults.push({
                    uid: key, // team key for sorting
                    teamNumber: teamNum,
                    memberUids: uniqueUids,
                    memberIgns: teamIgns,
                    ign: teamIgns.length > 0 ? `Team ${teamNum}` : 'Unknown',
                    kills: result.kills || 0,
                    placement: result.placement || 0,
                    score: result.score || 0,
                    playerKills: result.playerKills || {}
                });
            }
        }
    } else {
        // ── Solo Mode: existing per-player results ──
        for (const [, lobby] of lobbyEntries) {
            const results = lobby.results || {};
            for (const [uid, result] of Object.entries(results)) {
                allResults.push({
                    uid,
                    ign: lobby.players?.[uid]?.ign || 'Unknown',
                    kills: result.kills || 0,
                    placement: result.placement || 0,
                    score: result.score || 0
                });
            }
        }
    }

    allResults.sort((a, b) => (b.score - a.score) || (a.placement - b.placement));
    const winners = allResults.slice(0, winnersCount);

    if (winners.length === 0) {
        throw new HttpsError('failed-precondition', 'No results found for the final round');
    }

    // Distribute prizes
    const prizePromises = [];
    for (let i = 0; i < winners.length; i++) {
        const place = i + 1;
        const totalPrize = prizeBreakdown[place] || 0;
        const winner = winners[i];

        if (totalPrize > 0) {
            if (isTeamMode && winner.memberUids && winner.memberUids.length > 0) {
                // Split prize equally among team members
                const perMemberPrize = Math.floor(totalPrize / winner.memberUids.length);
                if (perMemberPrize > 0) {
                    for (const memberUid of winner.memberUids) {
                        prizePromises.push(
                            db.ref(`users/${memberUid}`).transaction(user => {
                                if (!user) return user;
                                user.winningBalance = (user.winningBalance || 0) + perMemberPrize;
                                user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
                                return user;
                            }),
                            db.ref('wallet_transactions').push({
                                userId: memberUid,
                                amount: perMemberPrize,
                                type: 'TOURNAMENT_PRIZE',
                                isCredit: true,
                                reason: `${ordinalLabel(place)} place (Team ${winner.teamNumber}) in tournament: ${t.title}`,
                                tournamentId,
                                place,
                                timestamp: admin.database.ServerValue.TIMESTAMP,
                                status: 'SUCCESS',
                                creditedTo: 'winning'
                            }),
                            db.ref(`users/${memberUid}`).update({
                                'stats/esportsWinnings': admin.database.ServerValue.increment(perMemberPrize),
                                'stats/totalWinnings': admin.database.ServerValue.increment(perMemberPrize),
                                'stats/matchesWon': admin.database.ServerValue.increment(1)
                            })
                        );
                        sendPush(
                            memberUid,
                            `🏆 Tournament Prize Won!`,
                            `Your team placed ${ordinalLabel(place)} in "${t.title}"! 🪙${perMemberPrize} has been credited to your wallet.`,
                            { type: 'TOURNAMENT_PRIZE', tournamentId, place: String(place), amount: String(perMemberPrize) }
                        ).catch(() => { });
                    }
                }
            } else {
                // Solo prize distribution
                const uid = winner.uid;
                prizePromises.push(
                    db.ref(`users/${uid}`).transaction(user => {
                        if (!user) return user;
                        user.winningBalance = (user.winningBalance || 0) + totalPrize;
                        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
                        return user;
                    }),
                    db.ref('wallet_transactions').push({
                        userId: uid,
                        amount: totalPrize,
                        type: 'TOURNAMENT_PRIZE',
                        isCredit: true,
                        reason: `${ordinalLabel(place)} place in tournament: ${t.title}`,
                        tournamentId,
                        place,
                        timestamp: admin.database.ServerValue.TIMESTAMP,
                        status: 'SUCCESS',
                        creditedTo: 'winning'
                    }),
                    db.ref(`users/${uid}`).update({
                        'stats/esportsWinnings': admin.database.ServerValue.increment(totalPrize),
                        'stats/totalWinnings': admin.database.ServerValue.increment(totalPrize),
                        'stats/matchesWon': admin.database.ServerValue.increment(1)
                    })
                );
                sendPush(
                    uid,
                    `🏆 Tournament Prize Won!`,
                    `You placed ${ordinalLabel(place)} in "${t.title}"! 🪙${totalPrize} has been credited to your wallet.`,
                    { type: 'TOURNAMENT_PRIZE', tournamentId, place: String(place), amount: String(totalPrize) }
                ).catch(() => { });
            }
        }
    }

    await Promise.all(prizePromises);

    // Build winners data for storage
    const winnersData = {};
    winners.forEach((w, i) => {
        winnersData[i + 1] = {
            uid: w.uid,
            ign: w.ign,
            score: w.score,
            kills: w.kills,
            placement: w.placement,
            prize: prizeBreakdown[i + 1] || 0,
            ...(isTeamMode ? { teamNumber: w.teamNumber, memberUids: w.memberUids, memberIgns: w.memberIgns || [], playerKills: w.playerKills || {} } : {})
        };
    });

    // Update tournament
    await tournRef.update({
        status: 'COMPLETED',
        completedAt: admin.database.ServerValue.TIMESTAMP,
        completedBy: adminUid,
        winners: winnersData,
        scoringConfigSnapshot: t.scoringConfig || null,
        finalStandings: allResults.map((r, i) => ({
            rank: i + 1,
            uid: r.uid,
            ign: r.ign,
            score: r.score,
            kills: r.kills,
            placement: r.placement,
            ...(isTeamMode ? { teamNumber: r.teamNumber, memberUids: r.memberUids, memberIgns: r.memberIgns || [], playerKills: r.playerKills || {} } : {})
        }))
    });

    // Admin log
    await db.ref('admin_logs').push({
        action: 'COMPLETE_LOBBY_TOURNAMENT',
        adminId: adminUid,
        details: `Completed lobby tournament "${t.title}" — ${winners.length} winners, Prize pool: 🪙${t.prizePool}`,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        tournamentId
    });

    logEvent('completeLobbyTournament', 'info', 'Lobby tournament completed', {
        tournamentId, winnersCount: winners.length, adminUid
    });

    return { success: true, message: `Tournament completed! ${winners.length} winners have been rewarded.` };
});

// ─── Helper: ordinal label (1st, 2nd, 3rd, 4th...) ─────────
function ordinalLabel(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

