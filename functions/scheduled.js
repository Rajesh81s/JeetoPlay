/**
 * scheduled.js — Scheduled (cron) Cloud Functions
 * Exports: checkDisputeTimeouts, esportsMatchReminder, ludoRoomCodeReminder, reEngageInactiveUsers
 */

const {
    functions, admin, db,
    sendPush
} = require('./helpers');

// ─── Scheduled: Check Dispute Timeouts ─────────────────────
// Runs every 5 minutes to auto-escalate timed-out disputes

exports.checkDisputeTimeouts = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
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
                        `Match #${shortIdTE} (₹${match.amount}) auto-escalated — opponent didn't respond within 2 hours. Admin will review and resolve shortly.`,
                        { type: 'LUDO_DISPUTE_ESCALATED', matchId });
                }
                if (acceptorUid) {
                    await sendPush(acceptorUid, `⚠️ Match #${shortIdTE} Escalated — Admin Review`,
                        `Match #${shortIdTE} (₹${match.amount}) auto-escalated — opponent didn't respond within 2 hours. Admin will review and resolve shortly.`,
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
                            `Your opponent is waiting for the room code in Match #${shortIdLR} (₹${match.amount}). Open Ludo King, create a room, and share the code now!`,
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
                            `Room code for Match #${shortIdLR2} (₹${match.amount}) isn't shared yet. We've reminded your opponent — you'll be notified as soon as it's ready!`,
                            { type: 'LUDO_ROOM_REMINDER', matchId })
                    );
                }
            }
        });

        await Promise.all(promises);
        functions.logger.info(`[ludoRoomCodeReminder] Reminded ${reminded} creators`);
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
