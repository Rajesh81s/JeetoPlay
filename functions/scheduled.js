/**
 * scheduled.js — Scheduled (cron) Cloud Functions
 * Exports: checkDisputeTimeouts, esportsMatchReminder, ludoRoomCodeReminder,
 *          autoExpireStaleLudoMatches, reEngageInactiveUsers,
 *          autoCloseTournamentRegistration, tournamentStartReminder,
 *          tournamentRoundReminder, checkVipExpiry, autoExpireEmptyEsportsMatches
 */

const {
    functions, admin, db,
    sendPush, refundPlayer, logEvent
} = require('./helpers');

// ─── Scheduled: Check Dispute Timeouts ─────────────────────
// Runs every 5 minutes to auto-escalate timed-out disputes

exports.checkDisputeTimeouts = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        // Ludo feature removed — skip all ludo dispute checks to save database bandwidth
        console.log('[checkDisputeTimeouts] Ludo disabled — skipping');
        return null;

        // --- ORIGINAL CODE BELOW (kept for reference if ludo is re-enabled) ---
        const now = Date.now();

        // Check IN_PROGRESS and ROOM_SHARED matches
        const [inProgressSnap, roomSharedSnap] = await Promise.all([
            db.ref('ludo_matches').orderByChild('status').equalTo('IN_PROGRESS').once('value'),
            db.ref('ludo_matches').orderByChild('status').equalTo('ROOM_SHARED').once('value')
        ]);

        const allMatches = [];
        inProgressSnap.forEach(child => { allMatches.push({ key: child.key, val: child.val() }); });
        roomSharedSnap.forEach(child => { allMatches.push({ key: child.key, val: child.val() }); });

        let escalated = 0;

        for (const { key: matchId, val: match } of allMatches) {
            // Skip if no deadline or deadline hasn't passed
            if (!match.disputeDeadline || match.disputeDeadline >= now) continue;

            const creatorResult = match.result?.creator;
            const acceptorResult = match.result?.acceptor;

            // One person submitted, other didn't respond within deadline
            if ((creatorResult && !acceptorResult) || (!creatorResult && acceptorResult)) {
                await db.ref('ludo_matches/' + matchId).update({
                    status: 'DISPUTED',
                    disputeReason: 'Opponent did not respond within 2 hours (auto-escalated)',
                    escalatedToAdmin: true,
                    disputedAt: admin.database.ServerValue.TIMESTAMP
                });

                // Notify both participants
                const creatorUid = match.creator?.uid;
                const acceptorUid = match.acceptor?.uid;
                const shortIdTE = matchId.slice(-6).toUpperCase();

                if (creatorUid) {
                    await sendPush(creatorUid, `⚠️ Match #${shortIdTE} Escalated — Admin Review`,
                        `Match #${shortIdTE} (🪙 ${match.amount}) auto-escalated — opponent didn't respond within 2 hours. Admin will review and resolve shortly.`,
                        { type: 'LUDO_DISPUTE_ESCALATED', matchId });
                }
                if (acceptorUid) {
                    await sendPush(acceptorUid, `⚠️ Match #${shortIdTE} Escalated — Admin Review`,
                        `Match #${shortIdTE} (🪙 ${match.amount}) auto-escalated — opponent didn't respond within 2 hours. Admin will review and resolve shortly.`,
                        { type: 'LUDO_DISPUTE_ESCALATED', matchId });
                }

                escalated++;
            }
        }

        console.log(`[checkDisputeTimeouts] Checked ${allMatches.length} matches, escalated ${escalated}`);
        return null;
    });

// ─── Scheduled: eSports Match Starting in ~30 min ───────────

exports.esportsMatchReminder = functions.pubsub
    .schedule('every 10 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();
        const thirtyMinFromNow = now + 30 * 60 * 1000;
        const twentyMinFromNow = now + 20 * 60 * 1000;

        // Find LIVE or UPCOMING matches with a scheduledTime in ~20-30 min window
        const matchesSnap = await db.ref('esports_matches')
            .orderByChild('status').equalTo('UPCOMING')
            .once('value');

        let reminded = 0;

        const promises = [];
        matchesSnap.forEach(child => {
            const match = child.val();
            const matchId = child.key;
            const matchTime = match.scheduledTime || match.matchTime;

            // Check if match is in the 20-30 min window AND hasn't been reminded yet
            if (matchTime && matchTime >= twentyMinFromNow && matchTime <= thirtyMinFromNow && !match.reminderSent) {
                const gameName = match.title || match.gameName || 'Match';

                // Mark as reminded
                promises.push(
                    db.ref(`esports_matches/${matchId}/reminderSent`).set(true)
                );

                // Get participants
                if (match.participants) {
                    const uids = [...new Set(
                        Object.entries(match.participants)
                            .map(([k, v]) => v.bookedBy || k)
                            .filter(uid => uid && uid.length > 15 && !uid.startsWith('team_'))
                    )];

                    uids.forEach(uid => {
                        const roomId = match.roomId || 'N/A';
                        const roomPass = match.roomPassword || 'N/A';
                        const shortIdR = matchId.slice(-6).toUpperCase();
                        promises.push(
                            sendPush(uid, `⏰ ${gameName} — Starting in 30 Minutes! #${shortIdR}`,
                                `${gameName} starts soon! Room ID: ${roomId} | Password: ${roomPass}. Open the app and get ready to compete!`,
                                { type: 'ESPORTS_REMINDER', matchId, roomId, roomPassword: roomPass })
                        );
                    });
                    reminded += uids.length;
                }
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[esportsMatchReminder] Reminded ${reminded} users`);
        return null;
    });

// ─── Scheduled: Ludo Room Code Reminder ─────────────────────
// Nudges the creator if PAIRED for 5+ min but room code not shared yet

exports.ludoRoomCodeReminder = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        // Ludo feature removed — skip to save database bandwidth
        console.log('[ludoRoomCodeReminder] Ludo disabled — skipping');
        return null;

        // --- ORIGINAL CODE BELOW (kept for reference if ludo is re-enabled) ---
        const pairedSnap = await db.ref('ludo_matches')
            .orderByChild('status').equalTo('PAIRED')
            .once('value');

        const now = Date.now();
        let reminded = 0;
        const promises = [];

        pairedSnap.forEach(child => {
            const match = child.val();
            const matchId = child.key;

            // Check if paired for more than 5 minutes and no reminder sent
            const pairedAt = match.pairedAt || match.acceptedAt || match.createdAt;
            if (pairedAt && (now - pairedAt) > 5 * 60 * 1000 && !match.roomCodeReminderSent) {
                // Mark as reminded (only once)
                promises.push(
                    db.ref(`ludo_matches/${matchId}/roomCodeReminderSent`).set(true)
                );

                const creatorUid = match.creator?.uid;
                if (creatorUid) {
                    const shortIdLR = matchId.slice(-6).toUpperCase();
                    promises.push(
                        sendPush(creatorUid, `⏰ Share Room Code — Match #${shortIdLR}`,
                            `Your opponent is waiting for the room code in Match #${shortIdLR} (🪙 ${match.amount}). Open Ludo King, create a room, and share the code now!`,
                            { type: 'LUDO_ROOM_REMINDER', matchId })
                    );
                    reminded++;
                }

                // Also remind acceptor to wait
                const acceptorUid = match.acceptor?.uid;
                if (acceptorUid) {
                    const shortIdLR2 = matchId.slice(-6).toUpperCase();
                    promises.push(
                        sendPush(acceptorUid, `⏳ Waiting for Room Code — Match #${shortIdLR2}`,
                            `Room code for Match #${shortIdLR2} (🪙 ${match.amount}) isn't shared yet. We've reminded your opponent — you'll be notified as soon as it's ready!`,
                            { type: 'LUDO_ROOM_REMINDER', matchId })
                    );
                }
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[ludoRoomCodeReminder] Reminded ${reminded} creators`);
        return null;
    });

// ─── Scheduled: Auto-Expire Stale Ludo Matches ─────────────
// Runs every 5 minutes. Auto-cancels:
//   OPEN   → 30 min (refund creator)
//   PAIRED → 15 min (refund both)
// ROOM_SHARED and beyond use the existing dispute timeout system.

exports.autoExpireStaleLudoMatches = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        // Ludo feature removed — skip to save database bandwidth
        console.log('[autoExpireStaleLudoMatches] Ludo disabled — skipping');
        return null;

        // --- ORIGINAL CODE BELOW (kept for reference if ludo is re-enabled) ---
        const now = Date.now();

        // Fetch configurable timeouts (defaults: OPEN=30min, PAIRED=15min)
        const [openTimeoutSnap, pairedTimeoutSnap] = await Promise.all([
            db.ref('platform_config/ludo_auto_cancel_open_ms').once('value'),
            db.ref('platform_config/ludo_auto_cancel_paired_ms').once('value')
        ]);

        const openTimeoutMs = parseInt(openTimeoutSnap.val()) || 30 * 60 * 1000;    // 30 min
        const pairedTimeoutMs = parseInt(pairedTimeoutSnap.val()) || 15 * 60 * 1000; // 15 min

        // Fetch OPEN and PAIRED matches in parallel
        const [openSnap, pairedSnap] = await Promise.all([
            db.ref('ludo_matches').orderByChild('status').equalTo('OPEN').once('value'),
            db.ref('ludo_matches').orderByChild('status').equalTo('PAIRED').once('value')
        ]);

        let expiredCount = 0;
        const promises = [];

        // ── OPEN matches: auto-cancel after timeout, refund creator ──
        openSnap.forEach(child => {
            const matchId = child.key;
            const matchData = child.val();
            const createdAt = matchData.createdAt || 0;

            if (createdAt > 0 && (now - createdAt) > openTimeoutMs) {
                promises.push(
                    (async () => {
                        try {
                            // STEP 1: Atomically claim match via transaction (prevents double-refund race)
                            const matchRef = db.ref('ludo_matches/' + matchId);
                            const txn = await matchRef.transaction(match => {
                                if (!match) return null;
                                if (match.status !== 'OPEN') return; // Abort — already changed
                                match.status = 'EXPIRING'; // Intermediate state to prevent races
                                match.expiredAt = Date.now();
                                return match;
                            }, undefined, false);

                            if (!txn.committed) {
                                functions.logger.info(`[autoExpire] OPEN match ${matchId} skipped — status already changed`);
                                return; // Another function already handled it
                            }

                            const match = txn.snapshot.val();

                            // STEP 2: Refund creator (safe — we own the match now)
                            await refundPlayer(match.creator, matchId, match.amount,
                                'Ludo challenge expired — no opponent joined (auto-refund)');

                            // STEP 3: Finalize status
                            await matchRef.update({
                                status: 'EXPIRED',
                                cancelReason: `Auto-expired: No opponent joined within ${Math.round(openTimeoutMs / 60000)} minutes`
                            });

                            // Notify creator
                            const creatorUid = match.creator?.uid;
                            if (creatorUid) {
                                const shortId = matchId.slice(-6).toUpperCase();
                                await sendPush(creatorUid, `⏰ Challenge Expired — #${shortId}`,
                                    `Your 🪙 ${match.amount} Ludo challenge (#${shortId}) expired — no opponent joined. Entry fee refunded to your wallet.`,
                                    { type: 'LUDO_EXPIRED', matchId });
                            }

                            expiredCount++;
                        } catch (err) {
                            functions.logger.error(`[autoExpire] Failed to expire OPEN match ${matchId}:`, err.message);
                        }
                    })()
                );
            }
        });

        // ── PAIRED matches: auto-cancel after timeout, refund both ──
        pairedSnap.forEach(child => {
            const matchId = child.key;
            const matchData = child.val();
            const pairedAt = matchData.pairedAt || matchData.acceptedAt || matchData.createdAt || 0;

            if (pairedAt > 0 && (now - pairedAt) > pairedTimeoutMs) {
                promises.push(
                    (async () => {
                        try {
                            // STEP 1: Atomically claim match via transaction
                            const matchRef = db.ref('ludo_matches/' + matchId);
                            const txn = await matchRef.transaction(match => {
                                if (!match) return null;
                                if (match.status !== 'PAIRED') return; // Abort — already changed
                                match.status = 'EXPIRING';
                                match.expiredAt = Date.now();
                                return match;
                            }, undefined, false);

                            if (!txn.committed) {
                                functions.logger.info(`[autoExpire] PAIRED match ${matchId} skipped — status already changed`);
                                return;
                            }

                            const match = txn.snapshot.val();

                            // STEP 2: Refund both players (safe — we own the match now)
                            await refundPlayer(match.creator, matchId, match.amount,
                                'Ludo match expired — room code not shared in time (auto-refund)');
                            if (match.acceptor?.uid) {
                                await refundPlayer(match.acceptor, matchId, match.amount,
                                    'Ludo match expired — room code not shared in time (auto-refund)');
                            }

                            // STEP 3: Finalize status
                            await matchRef.update({
                                status: 'EXPIRED',
                                cancelReason: `Auto-expired: Room code not shared within ${Math.round(pairedTimeoutMs / 60000)} minutes`
                            });

                            // Notify both players
                            const shortId = matchId.slice(-6).toUpperCase();
                            const creatorUid = match.creator?.uid;
                            const acceptorUid = match.acceptor?.uid;

                            if (creatorUid) {
                                await sendPush(creatorUid, `⏰ Match Expired — #${shortId}`,
                                    `Match #${shortId} (🪙 ${match.amount}) expired — room code was not shared in time. Entry fee refunded to your wallet.`,
                                    { type: 'LUDO_EXPIRED', matchId });
                            }
                            if (acceptorUid) {
                                await sendPush(acceptorUid, `⏰ Match Expired — #${shortId}`,
                                    `Match #${shortId} (🪙 ${match.amount}) expired — room code was not shared in time. Entry fee refunded to your wallet.`,
                                    { type: 'LUDO_EXPIRED', matchId });
                            }

                            expiredCount++;
                        } catch (err) {
                            functions.logger.error(`[autoExpire] Failed to expire PAIRED match ${matchId}:`, err.message);
                        }
                    })()
                );
            }
        });

        // ── REMATCH_PENDING matches: auto-cancel after rematchExpiresAt ──
        const rematchSnap = await db.ref('ludo_matches')
            .orderByChild('status').equalTo('REMATCH_PENDING').once('value');
        rematchSnap.forEach(child => {
            const matchId = child.key;
            const matchData = child.val();
            const expiresAt = matchData.rematchExpiresAt || 0;

            if (expiresAt > 0 && now > expiresAt) {
                promises.push(
                    db.ref('ludo_matches/' + matchId).update({
                        status: 'EXPIRED',
                        cancelReason: 'Rematch request expired (no response within 5 minutes)',
                        expiredAt: admin.database.ServerValue.TIMESTAMP
                    }).then(() => {
                        expiredCount++;
                    }).catch(err => {
                        functions.logger.error(`[autoExpire] Failed to expire REMATCH_PENDING ${matchId}:`, err.message);
                    })
                );
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[autoExpireStaleLudoMatches] Expired ${expiredCount} stale matches`);
        return null;
    });

// ─── Scheduled: Re-engage Inactive Users ────────────────────
// Runs once daily at 10am IST

exports.reEngageInactiveUsers = functions.pubsub
    .schedule('0 10 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();
        const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

        const usersSnap = await db.ref('users').once('value');
        let engaged = 0;
        const promises = [];

        usersSnap.forEach(child => {
            const user = child.val();
            const uid = child.key;
            const lastActive = user.lastActive || user.lastLogin || user.createdAt;

            // Skip users without an FCM token
            if (!user.fcmToken) return;

            // Skip very old inactive (> 30 days) — don't spam
            if (lastActive && lastActive < now - 30 * 24 * 60 * 60 * 1000) return;

            if (lastActive && lastActive < sevenDaysAgo) {
                // 7+ days inactive
                promises.push(
                    sendPush(uid, '🔥 Big Wins Are Happening NOW!',
                        `Players are winning real cash in live Ludo & eSports matches right now! Come back and claim your share — your skills are needed! 🏆`,
                        { type: 'RE_ENGAGE_7D' })
                );
                engaged++;
            } else if (lastActive && lastActive < threeDaysAgo) {
                // 3-7 days inactive
                promises.push(
                    sendPush(uid, '👋 Your Matches Are Waiting!',
                        `Hey! New Ludo challenges and eSports tournaments with exciting prizes are live. Jump back in and start winning real cash today!`,
                        { type: 'RE_ENGAGE_3D' })
                );
                engaged++;
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[reEngageInactiveUsers] Sent re-engagement push to ${engaged} users`);
        return null;
    });

// ─── Scheduled: Auto-Close Tournament Registration ──────────
// Runs every 5 minutes. If registrationCloses has passed and status is
// still REGISTRATION, update status to BRACKET_GENERATED (admin will
// manually trigger bracket generation or it auto-notifies).

exports.autoCloseTournamentRegistration = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();
        const snap = await db.ref('tournaments')
            .orderByChild('status').equalTo('REGISTRATION')
            .once('value');

        let closed = 0;
        const promises = [];

        snap.forEach(child => {
            const tournament = child.val();
            const tournamentId = child.key;

            if (tournament.registrationCloses && tournament.registrationCloses <= now) {
                promises.push(
                    (async () => {
                        try {
                            // Atomically close registration
                            const txn = await db.ref('tournaments/' + tournamentId).transaction(t => {
                                if (!t) return null;
                                if (t.status !== 'REGISTRATION') return; // Already changed
                                t.status = 'REGISTRATION_CLOSED';
                                t.registrationClosedAt = Date.now();
                                return t;
                            }, undefined, false);

                            if (!txn.committed) return;

                            const t = txn.snapshot.val();

                            // Notify all registered participants
                            if (t.participants) {
                                Object.keys(t.participants).forEach(uid => {
                                    const nextStep = t.format === 'LOBBY_ELIMINATION' ? 'Lobbies' : 'Bracket';
                                    promises.push(
                                        sendPush(uid, `🏆 Registration Closed — ${t.title}`,
                                            `Registration for "${t.title}" has closed! ${Object.keys(t.participants).length} players registered. ${nextStep} will be generated soon.`,
                                            { type: 'TOURNAMENT_REG_CLOSED', tournamentId })
                                    );
                                });
                            }

                            closed++;
                        } catch (err) {
                            functions.logger.error(`[autoCloseTournamentReg] Failed for ${tournamentId}:`, err.message);
                        }
                    })()
                );
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[autoCloseTournamentRegistration] Closed ${closed} tournaments`);
        return null;
    });

// ─── Scheduled: Tournament Start Reminder ───────────────────
// Runs every 10 min. Sends push 30 min before tournament starts.

exports.tournamentStartReminder = functions.pubsub
    .schedule('every 10 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();
        const thirtyMin = now + 30 * 60 * 1000;
        const twentyMin = now + 20 * 60 * 1000;

        // Find tournaments starting in ~20-30 min window
        // Only query upcoming tournaments, not ALL (saves bandwidth)
        const snap = await db.ref('tournaments')
            .orderByChild('status').equalTo('REGISTRATION')
            .once('value');
        let reminded = 0;
        const promises = [];

        snap.forEach(child => {
            const t = child.val();
            const tournamentId = child.key;

            // Only remind for upcoming tournaments (REGISTRATION or REGISTRATION_CLOSED)
            if (!['REGISTRATION', 'REGISTRATION_CLOSED', 'BRACKET_GENERATED'].includes(t.status)) return;
            if (t.startReminderSent) return; // Already sent

            const startTime = t.startsAt;
            if (startTime && startTime >= twentyMin && startTime <= thirtyMin) {
                // Mark as reminded
                promises.push(
                    db.ref(`tournaments/${tournamentId}/startReminderSent`).set(true)
                );

                // Notify all participants
                if (t.participants) {
                    Object.keys(t.participants).forEach(uid => {
                        promises.push(
                            sendPush(uid, `⏰ "${t.title}" Starts in 30 Minutes!`,
                                `Your tournament "${t.title}" (${t.gameName || ''}) starts soon! ${Object.keys(t.participants).length} players competing for 🪙 ${t.prizePool || 0}. Get ready!`,
                                { type: 'TOURNAMENT_REMINDER', tournamentId })
                        );
                    });
                    reminded += Object.keys(t.participants).length;
                }
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[tournamentStartReminder] Reminded ${reminded} players`);
        return null;
    });

// ─── Scheduled: Tournament Round Reminder ───────────────────
// Runs every 5 minutes. Sends push 10 min before each round starts.
// Round start calculated as: startsAt + (round - 1) * roundIntervalMinutes

exports.tournamentRoundReminder = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();
        // Only query active tournaments, not ALL (saves bandwidth)
        const snap = await db.ref('tournaments')
            .orderByChild('status').equalTo('ROUND_IN_PROGRESS')
            .once('value');
        let reminded = 0;
        const promises = [];

        snap.forEach(child => {
            const t = child.val();
            const tournamentId = child.key;

            // Only active tournaments with round scheduling
            const activeStatuses = [
                'BRACKET_GENERATED', 'ROUND_IN_PROGRESS', 'ROUND_COMPLETE',
                'LOBBIES_GENERATED', 'LOBBY_IN_PROGRESS', 'LOBBY_SCORED'
            ];
            if (!activeStatuses.includes(t.status)) return;
            if (!t.startsAt || !t.roundIntervalMinutes || !t.totalRounds) return;

            const currentRound = t.currentRound || 1;
            const intervalMs = t.roundIntervalMinutes * 60 * 1000;

            // Check each upcoming round (current and future)
            for (let r = currentRound; r <= t.totalRounds; r++) {
                const roundStartMs = t.startsAt + ((r - 1) * intervalMs);
                const reminderKey = `roundReminder_${r}`;

                // Already reminded for this round?
                if (t[reminderKey]) continue;

                // Is the round starting within 8-15 min from now? (10 min window)
                const minsUntilRound = (roundStartMs - now) / 60000;
                if (minsUntilRound >= 8 && minsUntilRound <= 15) {
                    // Mark as reminded
                    promises.push(
                        db.ref(`tournaments/${tournamentId}/${reminderKey}`).set(true)
                    );

                    // Notify all participants
                    if (t.participants) {
                        const roundLabel = r === t.totalRounds ? 'Final' : r === t.totalRounds - 1 && t.totalRounds > 2 ? 'Semi-Final' : `Round ${r}`;
                        Object.keys(t.participants).forEach(uid => {
                            promises.push(
                                sendPush(uid, `⏰ ${roundLabel} starts in ~10 min! — ${t.title}`,
                                    `${roundLabel} of "${t.title}" (${t.gameName || ''}) starts at ${new Date(roundStartMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Get ready! 🎮`,
                                    { type: 'TOURNAMENT_ROUND_REMINDER', tournamentId, round: String(r) })
                            );
                        });
                        reminded += Object.keys(t.participants).length;
                    }

                    break; // Only remind for the nearest upcoming round
                }
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[tournamentRoundReminder] Reminded ${reminded} players`);
        return null;
    });

// ─── Scheduled: Check VIP Expiry ────────────────────────────
// Runs every 6 hours. Deactivates expired VIP memberships.

exports.checkVipExpiry = functions.pubsub
    .schedule('every 6 hours')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();
        const usersSnap = await db.ref('users').once('value');

        let deactivated = 0;
        const promises = [];

        usersSnap.forEach(child => {
            const user = child.val();
            const uid = child.key;

            // Only process users with active VIP
            if (!user.vip || !user.vip.active) return;

            // Check if VIP has expired
            if (user.vip.expiresAt && user.vip.expiresAt <= now) {
                promises.push(
                    (async () => {
                        try {
                            // Deactivate VIP
                            await db.ref(`users/${uid}`).update({
                                'vip/active': false,
                                'isVip': false
                            });

                            // Send push notification
                            if (user.fcmToken) {
                                await sendPush(uid,
                                    '👑 VIP Membership Expired',
                                    'Your VIP membership has expired. Renew now to keep enjoying deposit bonuses and the VIP badge!',
                                    { type: 'VIP_EXPIRED' }
                                );
                            }

                            deactivated++;
                        } catch (err) {
                            functions.logger.error(`[checkVipExpiry] Failed to deactivate VIP for ${uid}:`, err.message);
                        }
                    })()
                );
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[checkVipExpiry] Deactivated ${deactivated} expired VIP memberships`);
        return null;
    });

// ─── Scheduled: Auto-Delete Empty eSports Matches ───────────
// Runs every 10 minutes. Deletes UPCOMING eSports matches where:
//   - scheduledTime (dateTime) has passed + grace period
//   - Zero participants joined (participants object is empty/missing)
// Matches with ANY participants (even pending) are never touched.

exports.autoExpireEmptyEsportsMatches = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async () => {
        const now = Date.now();

        // Fetch all UPCOMING eSports matches
        const matchesSnap = await db.ref('esports_matches')
            .orderByChild('status').equalTo('UPCOMING')
            .once('value');

        if (!matchesSnap.exists()) {
            functions.logger.info('[autoExpireEmptyEsports] No UPCOMING matches found');
            return null;
        }

        let deletedCount = 0;
        const deletions = [];

        matchesSnap.forEach(child => {
            const match = child.val();
            const matchId = child.key;

            // Parse match time (stored as ISO string in dateTime)
            const matchTimeMs = new Date(match.dateTime).getTime();
            if (!matchTimeMs || isNaN(matchTimeMs)) return; // Skip invalid/missing dates

            // Check if match time has passed
            if (now < matchTimeMs) return; // Match hasn't started yet

            // Check participant count — only delete if ZERO participants
            const participants = match.participants || {};
            const participantCount = Object.keys(participants).length;
            if (participantCount > 0) return; // Has participants — skip

            // Safe to delete — no participants, time has passed
            deletions.push(
                (async () => {
                    try {
                        // Delete the match entirely
                        await db.ref('esports_matches/' + matchId).remove();

                        // Audit log
                        const logKey = db.ref('admin_logs').push().key;
                        await db.ref('admin_logs/' + logKey).set({
                            action: 'AUTO_DELETE_EMPTY_ESPORTS_MATCH',
                            details: `Auto-deleted empty match "${match.title || 'Untitled'}" (${match.gameName || 'Unknown Game'}) — scheduled for ${new Date(matchTimeMs).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}, 0 participants`,
                            matchId: matchId,
                            matchTitle: match.title || '',
                            gameName: match.gameName || '',
                            gameId: match.gameId || '',
                            scheduledTime: match.dateTime || '',
                            performedBy: 'system',
                            timestamp: admin.database.ServerValue.TIMESTAMP
                        });

                        deletedCount++;
                    } catch (err) {
                        functions.logger.error(`[autoExpireEmptyEsports] Failed to delete match ${matchId}:`, err.message);
                    }
                })()
            );
        });

        await Promise.all(deletions);
        functions.logger.info(`[autoExpireEmptyEsports] Deleted ${deletedCount} empty expired matches`);
        return null;
    });
