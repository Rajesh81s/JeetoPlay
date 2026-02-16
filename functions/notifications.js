/**
 * notifications.js — Notification-related Cloud Functions
 * Exports: sendAdminNotification, subscribeToTopic, sendEsportsNotification,
 *          sendEsportsPrizePush, sendEsportsRoomCredsPush
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertAdmin, sendPush, logEvent
} = require('./helpers');

// ─── Send Admin Notification (FCM Topics for broadcasts) ────

exports.sendAdminNotification = onCall(async (request) => {
    await assertAdmin(request);

    const { title, body, imageUrl, recipientUids } = request.data;
    if (!title || !body) {
        throw new HttpsError('invalid-argument', 'title and body are required');
    }

    const timestamp = admin.database.ServerValue.TIMESTAMP;
    const notifId = db.ref('admin_notifications').push().key;

    const notificationData = {
        id: notifId,
        title,
        body,
        imageUrl: imageUrl || null,
        sender: 'admin',
        sentAt: new Date().toISOString(),
        timestamp
    };

    // Determine recipient list
    const isAllUsers = (recipientUids === 'all' || !recipientUids);
    let targetUids = [];
    let recipientLabel = 'ALL';

    if (isAllUsers) {
        const usersSnap = await db.ref('users').once('value');
        usersSnap.forEach(child => { targetUids.push(child.key); });
    } else if (Array.isArray(recipientUids)) {
        targetUids = recipientUids;
        recipientLabel = targetUids.length.toString();
    }

    // 1. Save to admin_notifications for history
    const updates = {};
    updates['admin_notifications/' + notifId] = {
        ...notificationData,
        recipients: recipientLabel,
        recipientCount: targetUids.length
    };

    // 2. Write to user_notifications for in-app display
    targetUids.forEach(uid => {
        updates['user_notifications/' + uid + '/' + notifId] = notificationData;
    });

    await db.ref().update(updates);

    // 3. Send FCM push notification
    let pushSuccess = 0;
    let pushFailed = 0;

    // Build the notification message payload
    const baseMessage = {
        notification: { title, body },
        data: { type: 'ADMIN_BROADCAST', notifId, title, body },
        android: {
            priority: 'high',
            notification: {
                channelId: 'jeetoplay_notifications',
                priority: 'high',
                defaultSound: true,
                defaultVibrateTimings: true
            }
        },
        webpush: {
            headers: { Urgency: 'high' },
            notification: {
                icon: '/assets/images/icon-192.png',
                badge: '/assets/images/badge-72.png',
                vibrate: [200, 100, 200]
            }
        }
    };
    if (imageUrl) {
        baseMessage.notification.image = imageUrl;
        baseMessage.android.notification.imageUrl = imageUrl;
    }

    if (isAllUsers) {
        // ⚡ TOPIC-BASED: Send ONE message to the 'all_users' topic
        // Firebase delivers to all subscribed devices automatically
        try {
            await admin.messaging().send({ ...baseMessage, topic: 'all_users' });
            pushSuccess = targetUids.length; // Topic handles all deliveries
            functions.logger.info(`[sendAdminNotification] Topic message sent to 'all_users'`);
        } catch (err) {
            pushFailed = targetUids.length;
            functions.logger.error(`[sendAdminNotification] Topic send failed:`, err.message);
        }
    } else {
        // INDIVIDUAL: Send to selected users by token (for targeted notifications)
        const pushPromises = targetUids.map(async (uid) => {
            try {
                const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once('value');
                const token = tokenSnap.val();
                if (!token || typeof token !== 'string') { pushFailed++; return; }

                await admin.messaging().send({ ...baseMessage, token });
                pushSuccess++;
            } catch (err) {
                pushFailed++;
                if (err.code === 'messaging/registration-token-not-registered' ||
                    err.code === 'messaging/invalid-registration-token') {
                    await db.ref(`users/${uid}/fcmToken`).remove().catch(() => { });
                }
            }
        });
        await Promise.all(pushPromises);
    }

    functions.logger.info(`[sendAdminNotification] ${isAllUsers ? 'TOPIC' : 'INDIVIDUAL'}: ${pushSuccess}/${targetUids.length} (${pushFailed} failed)`);

    return {
        success: true,
        totalUsers: targetUids.length,
        pushDelivered: pushSuccess,
        pushFailed
    };
});

// ─── Subscribe FCM Token to Topic ───────────────────────────

exports.subscribeToTopic = onCall(async (request) => {
    assertAuth(request); // Any authenticated user can subscribe

    const { token, topic } = request.data;
    if (!token || !topic) {
        throw new HttpsError('invalid-argument', 'token and topic are required');
    }

    // Whitelist allowed topics to prevent abuse
    // Allow: 'all_users' + 'user_{own_uid}' (personal topic for targeted notifications)
    const uid = request.auth.uid;
    const allowedTopics = ['all_users', `user_${uid}`];
    if (!allowedTopics.includes(topic)) {
        throw new HttpsError('invalid-argument', 'Invalid topic');
    }

    try {
        const response = await admin.messaging().subscribeToTopic(token, topic);
        functions.logger.info(`[subscribeToTopic] Subscribed to '${topic}': ${response.successCount} success, ${response.failureCount} failures`);
        return { success: true, successCount: response.successCount };
    } catch (err) {
        functions.logger.error(`[subscribeToTopic] Failed:`, err.message);
        throw new HttpsError('internal', 'Failed to subscribe to topic');
    }
});

// ─── Send eSports Match Notifications ───────────────────────

exports.sendEsportsNotification = onCall(async (request) => {
    await assertAdmin(request);

    const { matchId, notifType } = request.data;
    if (!matchId || !notifType) {
        throw new HttpsError('invalid-argument', 'matchId and notifType required');
    }

    const matchSnap = await db.ref('esports_matches/' + matchId).once('value');
    const match = matchSnap.val();
    if (!match) throw new HttpsError('not-found', 'Match not found');

    // Get all participant UIDs
    const participantIds = [];
    if (match.participants) {
        Object.entries(match.participants).forEach(([key, data]) => {
            const uid = data.bookedBy || key;
            if (uid && uid.length > 15 && !uid.startsWith('team_') && !participantIds.includes(uid)) {
                participantIds.push(uid);
            }
        });
    }

    if (participantIds.length === 0) {
        return { success: true, message: 'No participants to notify' };
    }

    let title, body, extraData;
    const gameName = match.title || match.gameName || 'eSports Match';

    if (notifType === 'MATCH_LIVE') {
        title = `🎮 Match is LIVE! - ${gameName}`;
        body = `🔑 Room: ${match.roomId || 'N/A'}\n🔒 Pass: ${match.roomPassword || 'N/A'}\n\n⏰ Starting in 5 minutes - Join NOW!`;
        extraData = { type: 'ESPORTS_LIVE', matchId, roomId: match.roomId || '', roomPassword: match.roomPassword || '' };
    } else if (notifType === 'RESULTS_DECLARED') {
        title = `🏆 Results Declared! - ${gameName}`;
        body = `Results for your match have been declared! Check your winnings now.`;
        extraData = { type: 'ESPORTS_RESULTS', matchId };
    } else {
        throw new HttpsError('invalid-argument', 'Unknown notifType');
    }

    // Save to user_notifications
    const notifId = db.ref('admin_notifications').push().key;
    const notificationData = {
        id: notifId, title, body,
        type: notifType, matchId,
        sender: 'system',
        sentAt: new Date().toISOString(),
        timestamp: admin.database.ServerValue.TIMESTAMP
    };

    const updates = {};
    participantIds.forEach(uid => {
        updates['user_notifications/' + uid + '/' + notifId] = notificationData;
    });
    updates['admin_notifications/' + notifId] = {
        ...notificationData,
        recipientCount: participantIds.length,
        autoGenerated: true
    };
    await db.ref().update(updates);

    // Send FCM push
    let sent = 0;
    const pushPromises = participantIds.map(uid =>
        sendPush(uid, title, body, extraData).then(() => { sent++; }).catch(() => { })
    );
    await Promise.all(pushPromises);

    functions.logger.info(`[sendEsportsNotification] ${notifType} sent to ${participantIds.length} participants, ${sent} FCM delivered`);

    return { success: true, notified: participantIds.length, pushSent: sent };
});

// ─── eSports Prize Push (callable from admin results page) ──

exports.sendEsportsPrizePush = onCall(async (request) => {
    await assertAdmin(request);

    const { matchId, winners } = request.data;
    // winners = [{ uid, prize, rank }]
    if (!matchId || !Array.isArray(winners)) {
        throw new HttpsError('invalid-argument', 'matchId and winners array required');
    }

    const matchSnap = await db.ref('esports_matches/' + matchId).once('value');
    const match = matchSnap.val();
    const gameName = match?.title || match?.gameName || 'Match';

    let sent = 0;
    const promises = winners.map(async (w) => {
        if (!w.uid || !w.prize) return;
        try {
            const shortIdEP = matchId.slice(-6).toUpperCase();
            await sendPush(w.uid, `🏆 🪙 ${w.prize} Prize Won — ${gameName} #${shortIdEP}!`,
                `Congratulations! You finished #${w.rank || '?'} in ${gameName} (Match #${shortIdEP}) and earned 🪙 ${w.prize}! Winnings credited to your wallet.`,
                { type: 'ESPORTS_PRIZE', matchId, prize: String(w.prize) });
            // In-app notification is auto-saved by sendPush
            sent++;
        } catch (err) {
            functions.logger.error(`Prize push failed for ${w.uid}:`, err.message);
        }
    });

    await Promise.all(promises);
    return { success: true, notified: sent };
});

// ─── eSports Room Credentials Push ──────────────────────────

exports.sendEsportsRoomCredsPush = onCall(async (request) => {
    await assertAdmin(request);

    const { matchId, roomId, roomPassword } = request.data;
    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    const matchSnap = await db.ref('esports_matches/' + matchId).once('value');
    const match = matchSnap.val();
    if (!match) throw new HttpsError('not-found', 'Match not found');

    const gameName = match.gameName || match.title || 'eSports Match';
    const shortId = matchId.slice(-6).toUpperCase();
    const participants = match.participants || {};

    const uids = [...new Set(
        Object.entries(participants)
            .filter(([, v]) => v.confirmed)
            .map(([k, v]) => v.bookedBy || k)
            .filter(uid => uid && uid.length > 15 && !uid.startsWith('team_'))
    )];

    let sent = 0;
    const promises = uids.map(async (uid) => {
        try {
            await sendPush(uid, `🔑 Room Credentials — ${gameName} #${shortId}`,
                `Room ID: ${roomId} | Password: ${roomPassword}. Join the room before the match starts!`,
                { type: 'ESPORTS_ROOM_CREDS', matchId, roomId, roomPassword });
            sent++;
        } catch (err) {
            functions.logger.error(`Room creds push failed for ${uid}:`, err.message);
        }
    });

    await Promise.all(promises);
    return { success: true, notified: sent };
});
