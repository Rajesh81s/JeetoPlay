/**
 * triggers.js — Database trigger Cloud Functions
 * Exports: onLudoMatchUpdate, onWithdrawalUpdate, onFcmTokenUpdate, onNewUser
 */

const {
    functions, admin, db,
    sendPush
} = require('./helpers');

// ─── Database Trigger: Ludo Match Status Notifications ──────

exports.onLudoMatchUpdate = functions.database
    .ref('/ludo_matches/{matchId}')
    .onUpdate(async (change, context) => {
        const before = change.before.val();
        const after = change.after.val();
        const matchId = context.params.matchId;

        functions.logger.info(`[onLudoMatchUpdate] Match ${matchId}: ${before.status} → ${after.status}`);

        // Only act on status changes
        if (before.status === after.status) return null;

        const creatorUid = after.creator?.uid;
        const acceptorUid = after.acceptor?.uid;
        const shortId = matchId.slice(-6).toUpperCase();
        const creatorName = after.creator?.ludoKingUsername || after.creator?.username || 'Opponent';
        const acceptorName = after.acceptor?.ludoKingUsername || after.acceptor?.username || 'Opponent';

        functions.logger.info(`[onLudoMatchUpdate] Creator: ${creatorUid}, Acceptor: ${acceptorUid}`);

        switch (after.status) {
            case 'PAIRED':
                if (creatorUid) {
                    functions.logger.info(`[onLudoMatchUpdate] Sending PAIRED push to creator ${creatorUid}`);
                    await sendPush(creatorUid, `🎮 Challenge Accepted! #${shortId}`,
                        `${acceptorName} accepted your ₹${after.amount} Ludo challenge! Create a room in Ludo King and share the room code to start playing.`,
                        { type: 'LUDO_PAIRED', matchId });
                }
                break;

            case 'ROOM_SHARED':
                // Notify acceptor that room code is ready — include the actual code!
                functions.logger.info(`[onLudoMatchUpdate] ROOM_SHARED: acceptorUid=${acceptorUid}, before.status=${before.status}`);
                if (acceptorUid && before.status === 'PAIRED') {
                    functions.logger.info(`[onLudoMatchUpdate] Sending ROOM_SHARED push to acceptor ${acceptorUid}`);
                    await sendPush(acceptorUid, `🔑 Room Code: ${after.roomCode || 'N/A'} — #${shortId}`,
                        `Room code for your ₹${after.amount} Ludo match vs ${creatorName} is: ${after.roomCode}. Open Ludo King → Join Room → Enter code → Play!`,
                        { type: 'LUDO_ROOM_SHARED', matchId, roomCode: after.roomCode || '' });
                } else {
                    functions.logger.warn(`[onLudoMatchUpdate] ROOM_SHARED: Not sending push. acceptorUid=${acceptorUid}, before.status=${before.status}`);
                }
                break;

            case 'IN_PROGRESS':
                // Both players notified
                functions.logger.info(`[onLudoMatchUpdate] Sending IN_PROGRESS push to both players`);
                if (creatorUid) await sendPush(creatorUid, `🎲 Match Live! #${shortId} — ₹${after.amount}`,
                    `Your ₹${after.amount} Ludo match vs ${acceptorName} is LIVE! Room: ${after.roomCode || 'N/A'}. Play your best — winner gets ₹${(after.amount * 2) - Math.ceil(after.amount * 2 * 0.1)}!`,
                    { type: 'LUDO_IN_PROGRESS', matchId, roomCode: after.roomCode || '' });
                if (acceptorUid) await sendPush(acceptorUid, `🎲 Match Live! #${shortId} — ₹${after.amount}`,
                    `Your ₹${after.amount} Ludo match vs ${creatorName} is LIVE! Room: ${after.roomCode || 'N/A'}. Play your best — winner gets ₹${(after.amount * 2) - Math.ceil(after.amount * 2 * 0.1)}!`,
                    { type: 'LUDO_IN_PROGRESS', matchId, roomCode: after.roomCode || '' });
                break;

            default:
                functions.logger.info(`[onLudoMatchUpdate] No notification for status: ${after.status}`);
        }

        return null;
    });

// ─── Database Trigger: Withdrawal Status Notifications ──────

exports.onWithdrawalUpdate = functions.database
    .ref('/withdrawals/{withdrawalId}')
    .onUpdate(async (change, context) => {
        const before = change.before.val();
        const after = change.after.val();
        const withdrawalId = context.params.withdrawalId;

        if (before.status === after.status) return null;

        const userId = after.userId;
        if (!userId) return null;

        // Find and update the original wallet_transaction status
        try {
            const txnSnap = await db.ref('wallet_transactions')
                .orderByChild('withdrawalId')
                .equalTo(withdrawalId)
                .limitToFirst(1)
                .once('value');
            if (txnSnap.exists()) {
                const txnKey = Object.keys(txnSnap.val())[0];
                await db.ref('wallet_transactions/' + txnKey).update({
                    status: after.status
                });
            }
        } catch (err) {
            console.error('[onWithdrawalUpdate] Failed to sync wallet_transaction status:', err);
        }

        switch (after.status) {
            case 'APPROVED':
                await sendPush(userId, `✅ Withdrawal Approved — ₹${after.amount}`, `Great news! Your ₹${after.amount} withdrawal has been approved and is being processed. You'll receive the payment shortly.`, { type: 'WITHDRAWAL_APPROVED' });
                break;

            case 'COMPLETED':
                await sendPush(userId, `💸 ₹${after.amount} Sent to Your Account`, `₹${after.amount} has been successfully transferred to your UPI/bank account. It may take a few minutes to reflect.`, { type: 'WITHDRAWAL_COMPLETED' });
                break;

            case 'REJECTED': {
                // Atomic refund to winning balance (server-side, secure)
                const refundTxn = await db.ref(`users/${userId}/winningBalance`).transaction(bal => {
                    return (bal || 0) + after.amount;
                });
                const newBal = refundTxn.snapshot.val() || 0;

                // Log refund as a wallet transaction
                const refundKey = db.ref('wallet_transactions').push().key;
                await db.ref('wallet_transactions/' + refundKey).set({
                    userId: userId,
                    userName: after.userName || 'User',
                    type: 'CREDIT',
                    amount: after.amount,
                    isCredit: true,
                    description: `Withdrawal rejected — refund to winning balance`,
                    reason: 'Withdrawal Rejection Refund',
                    walletType: 'winning',
                    withdrawalId: withdrawalId,
                    adminNote: after.adminNote || '',
                    balanceBefore: { winning: newBal - after.amount },
                    balanceAfter: { winning: newBal },
                    status: 'SUCCESS',
                    timestamp: admin.database.ServerValue.TIMESTAMP
                });

                // Mark withdrawal as refunded
                await db.ref('withdrawals/' + withdrawalId).update({
                    refundedAt: admin.database.ServerValue.TIMESTAMP,
                    winningBalanceAfterRefund: newBal
                });

                await sendPush(userId, `❌ Withdrawal Rejected — ₹${after.amount} Refunded`, `Your ₹${after.amount} withdrawal was rejected${after.adminNote ? ': ' + after.adminNote : ''}. The amount has been refunded to your winning balance.`, { type: 'WITHDRAWAL_REJECTED' });
                break;
            }
        }

        return null;
    });

// ─── Auto-subscribe to personal topic when FCM token is saved ─

exports.onFcmTokenUpdate = functions.database
    .ref('/users/{uid}/fcmToken')
    .onWrite(async (change, context) => {
        const uid = context.params.uid;
        const newToken = change.after.val();

        // Only act if token was set (not deleted)
        if (!newToken || typeof newToken !== 'string') return null;

        const userTopic = `user_${uid}`;

        try {
            // Subscribe this device to user's personal topic
            const personalResult = await admin.messaging().subscribeToTopic(newToken, userTopic);
            functions.logger.info(`[onFcmTokenUpdate] Subscribed ${uid} to '${userTopic}': ${personalResult.successCount} success, ${personalResult.failureCount} failures`);

            // Also ensure subscribed to all_users topic
            const allResult = await admin.messaging().subscribeToTopic(newToken, 'all_users');
            functions.logger.info(`[onFcmTokenUpdate] Subscribed ${uid} to 'all_users': ${allResult.successCount} success, ${allResult.failureCount} failures`);
        } catch (err) {
            functions.logger.error(`[onFcmTokenUpdate] Failed for ${uid}:`, err.message);
            // If token is invalid, remove it
            if (err.code === 'messaging/registration-token-not-registered' ||
                err.code === 'messaging/invalid-registration-token') {
                await change.after.ref.remove();
                functions.logger.warn(`[onFcmTokenUpdate] Removed invalid token for ${uid}`);
            }
        }

        return null;
    });

// ─── Welcome New User Push ──────────────────────────────────

exports.onNewUser = functions.database
    .ref('/users/{uid}')
    .onCreate(async (snapshot, context) => {
        const uid = context.params.uid;
        const user = snapshot.val();
        const name = user.fullName || user.username || user.name || 'Player';

        // Send welcome notification (small delay to allow token to be saved)
        setTimeout(async () => {
            try {
                await sendPush(uid, `🎮 Welcome to JeetoPlay, ${name}!`,
                    `Hey ${name}! 🎯 Play Ludo & eSports tournaments, win REAL CASH, and withdraw instantly. Your gaming journey starts now — explore live matches and start winning!`,
                    { type: 'WELCOME' });
                // In-app notification is auto-saved by sendPush
            } catch (err) {
                functions.logger.warn(`Welcome push failed for ${uid}:`, err.message);
            }
        }, 5000); // 5s delay for token to be saved

        return null;
    });
