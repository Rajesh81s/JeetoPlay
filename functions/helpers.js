/**
 * helpers.js — Shared utilities for all Cloud Function modules
 * Contains: assertAuth, assertAdmin, sendPush, getLudoCommission,
 *           deductBalance, refundPlayer, countUserLudoMatches, checkAndCreditReferral
 *
 * ── Cloud Functions v2 Migration ──
 * v2 imports are provided for all domain files. The v1 `functions` object
 * is preserved for `functions.logger` compatibility.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// ── v1 wrappers with v2-compatible signatures ──
// Transforms v1 (data, context) into v2-style { data, auth } request object
// so ALL downstream code remains unchanged (uses request.data, request.auth, etc.)
const HttpsError = functions.https.HttpsError;

// v1 onRequest wrapper — supports v2-style (options, handler) signature
// v1 functions.https.onRequest only accepts (handler), so strip options if provided
function onRequest(optionsOrHandler, maybeHandler) {
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
    if (!handler || typeof handler !== 'function') {
        throw new Error('onRequest requires a handler function');
    }
    return functions.https.onRequest(handler);
}

function onCall(handler) {
    return functions.https.onCall((data, context) => {
        // Create a v2-like request object from v1 params
        const request = { data, auth: context.auth, rawRequest: context.rawRequest };
        return handler(request);
    });
}

function onSchedule(config, handler) {
    const cron = typeof config === 'string' ? config : config.schedule;
    const tz = (typeof config === 'object' && config.timeZone) ? config.timeZone : 'Asia/Kolkata';
    return functions.pubsub.schedule(cron).timeZone(tz).onRun((context) => {
        return handler({ scheduleTime: context.timestamp });
    });
}

// Initialize only once — safe to call multiple times but only first call applies
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.database();

// ─── Auth Helpers ───────────────────────────────────────────

function assertAuth(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    return request.auth.uid;
}

async function assertAdmin(request) {
    const uid = assertAuth(request);

    // Check admins node first (MAIN_ADMIN)
    const adminSnap = await db.ref(`admins/${uid}`).once('value');
    if (adminSnap.exists()) return uid;

    // Also check moderators node
    const modSnap = await db.ref(`moderators/${uid}`).once('value');
    if (modSnap.exists() && modSnap.val().isActive) return uid;

    functions.logger.error(`[assertAdmin] Access denied for uid: ${uid} - not found in admins or moderators`);
    throw new HttpsError('permission-denied', 'Admin access required');
}

// ─── Ban Enforcement Helper ─────────────────────────────────

/**
 * Server-side ban check. Call after assertAuth() on all sensitive functions.
 * Supports temp bans with auto-expiry. Returns user data to avoid duplicate reads.
 *
 * @param {string} uid - User UID
 * @returns {Object} User data from database
 * @throws {HttpsError} permission-denied if user is banned
 */
async function assertNotBanned(uid) {
    const snap = await db.ref(`users/${uid}`).once('value');
    const user = snap.val();

    if (!user) {
        throw new HttpsError('not-found', 'User account not found');
    }

    if (user.isBlocked) {
        // Check if temp ban has expired
        if (user.banExpiresAt && user.banExpiresAt < Date.now()) {
            // Auto-unban: temp ban expired
            await db.ref(`users/${uid}`).update({
                isBlocked: false,
                banExpiresAt: null,
                banReason: null
            });
            functions.logger.info(`[assertNotBanned] Temp ban expired for ${uid}, auto-unblocked`);
            user.isBlocked = false;
            return user;
        }

        // Ban is active
        const reason = user.banReason || 'Account suspended';
        const isPermanent = !user.banExpiresAt;
        const msg = isPermanent
            ? `Account suspended: ${reason}`
            : `Account temporarily suspended: ${reason}`;

        functions.logger.warn(`[assertNotBanned] Blocked user ${uid} tried to access function`);
        throw new HttpsError('permission-denied', msg);
    }

    return user;
}

// ─── Push Notification Helper ───────────────────────────────

async function sendPush(uid, title, body, extraData = {}) {
    try {
        // Determine Android channel based on notification type
        const type = extraData.type || 'GENERAL';
        let channelId = 'jeetoplay_notifications';
        let priority = 'high';

        // Urgent: matches, room codes, disputes — need immediate attention
        if (['LUDO_PAIRED', 'LUDO_ROOM_SHARED', 'LUDO_IN_PROGRESS', 'LUDO_CANCEL_REQUEST',
            'LUDO_DISPUTED', 'ESPORTS_REMINDER'].includes(type)) {
            channelId = 'jeetoplay_urgent';
        }
        // Financial: deposits, withdrawals, winnings — critical
        else if (['DEPOSIT_SUCCESS', 'WITHDRAWAL_APPROVED', 'WITHDRAWAL_COMPLETED',
            'WITHDRAWAL_REJECTED', 'LUDO_WON', 'REFERRAL_REWARD', 'ESPORTS_PRIZE'].includes(type)) {
            channelId = 'jeetoplay_wallet';
        }
        // Promotional: re-engagement, welcome — normal priority
        else if (['RE_ENGAGE_3D', 'RE_ENGAGE_7D', 'WELCOME'].includes(type)) {
            channelId = 'jeetoplay_promo';
            priority = 'normal';
        }

        // Build the notification payload once
        const messagePayload = {
            notification: { title, body },
            data: {
                title, body,
                ...Object.fromEntries(
                    Object.entries(extraData).map(([k, v]) => [k, String(v)])
                )
            },
            android: {
                priority,
                notification: {
                    channelId,
                    priority: priority === 'high' ? 'high' : 'default',
                    defaultSound: true,
                    defaultVibrateTimings: priority === 'high'
                }
            },
            webpush: {
                headers: { Urgency: priority },
                notification: {
                    icon: '/assets/images/icon-192.png',
                    badge: '/assets/images/badge-72.png',
                    vibrate: priority === 'high' ? [200, 100, 200] : [100]
                }
            }
        };

        // Strategy: Send via BOTH user-specific topic AND individual token
        // Topic reaches ALL devices (web + Android app) subscribed as user_{uid}
        // Individual token reaches the specific last-registered device
        let topicSent = false;
        let tokenSent = false;

        // 1) Send via user-specific topic (reaches ALL user's devices)
        const userTopic = `user_${uid}`;
        try {
            await admin.messaging().send({ ...messagePayload, topic: userTopic });
            topicSent = true;
            functions.logger.info(`[sendPush] Topic push sent to ${userTopic}: ${title}`);
        } catch (topicErr) {
            functions.logger.warn(`[sendPush] Topic push to ${userTopic} failed: ${topicErr.message}`);
        }

        // 2) If topic failed, fall back to individual token
        if (!topicSent) {
            const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once('value');
            const token = tokenSnap.val();
            if (token && typeof token === 'string') {
                try {
                    await admin.messaging().send({ ...messagePayload, token });
                    tokenSent = true;
                    functions.logger.info(`[sendPush] Token push sent to ${uid}: ${title}`);
                } catch (tokenErr) {
                    if (tokenErr.code === 'messaging/registration-token-not-registered' ||
                        tokenErr.code === 'messaging/invalid-registration-token') {
                        await db.ref(`users/${uid}/fcmToken`).remove();
                        functions.logger.warn(`[sendPush] Removed stale FCM token for ${uid}`);
                    }
                    functions.logger.warn(`[sendPush] Token push to ${uid} failed: ${tokenErr.message}`);
                }
            } else {
                functions.logger.warn(`[sendPush] No FCM token for ${uid}, topic also failed`);
            }
        }

        // 3) Save to in-app notifications regardless of push success
        const notifId = db.ref('user_notifications').push().key;
        await db.ref(`user_notifications/${uid}/${notifId}`).set({
            id: notifId,
            title,
            body,
            type,
            sender: 'system',
            sentAt: new Date().toISOString(),
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        if (!topicSent && !tokenSent) {
            functions.logger.error(`[sendPush] All push delivery failed for ${uid}: ${title}`);
        }
    } catch (err) {
        functions.logger.error(`[sendPush] Push to ${uid} failed:`, err.message);
    }
}

// ─── Ludo Commission Helper ─────────────────────────────────

async function getLudoCommission() {
    const snap = await db.ref('platform_config/ludo_commission_percent').once('value');
    return snap.val() || 15;
}

// ─── Balance Deduction (deposit first, then winning) ─────────

async function deductBalance(uid, amount) {
    let txnDepositBefore = 0, txnWinningBefore = 0;

    const txn = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) {
            functions.logger.warn(`deductBalance: user ${uid} is null in transaction (cold start retry)`);
            return null; // Return null to abort — but applyLocally:false ensures we get server data first
        }

        let depBal = user.depositBalance || 0;
        let winBal = user.winningBalance || 0;
        const walBal = user.walletBalance || 0;

        functions.logger.info(`deductBalance: uid=${uid}, amount=${amount}, depBal=${depBal}, winBal=${winBal}, walBal=${walBal}`);

        // Legacy migration: if depositBalance+winningBalance are 0 but walletBalance has funds,
        // treat walletBalance as depositBalance for backward compatibility
        if (depBal === 0 && winBal === 0 && walBal > 0) {
            depBal = walBal;
            user.depositBalance = depBal;
            functions.logger.info(`deductBalance: migrated walletBalance ${walBal} -> depositBalance for ${uid}`);
        }

        const total = depBal + winBal;
        if (amount > total) {
            functions.logger.warn(`deductBalance: INSUFFICIENT for ${uid}. Need ${amount}, have ${total} (dep=${depBal}, win=${winBal})`);
            return; // Abort — insufficient
        }

        txnDepositBefore = depBal;
        txnWinningBefore = winBal;

        let remaining = amount;
        if (depBal >= remaining) {
            user.depositBalance = depBal - remaining;
        } else {
            remaining -= depBal;
            user.depositBalance = 0;
            user.winningBalance = winBal - remaining;
        }
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);

        functions.logger.info(`deductBalance: SUCCESS for ${uid}. New dep=${user.depositBalance}, win=${user.winningBalance}, wal=${user.walletBalance}`);
        return user;
    }, undefined, false); // applyLocally: false — forces server-side read first, prevents null on cold starts

    if (!txn.committed) return null;

    const after = txn.snapshot.val();
    const depositDeducted = txnDepositBefore - (after.depositBalance || 0);
    const winningDeducted = txnWinningBefore - (after.winningBalance || 0);

    return { depositDeducted, winningDeducted, userAfter: after };
}

// ─── Refund helper: credits deposit + winning balance back ──

async function refundPlayer(playerData, matchId, matchAmount, reason) {
    if (!playerData?.uid) return;

    const playerUid = playerData.uid;
    const depositRefund = playerData.depositDeducted || 0;
    const winningRefund = playerData.winningDeducted || 0;

    if (depositRefund > 0 || winningRefund > 0) {
        await db.ref(`users/${playerUid}`).transaction(user => {
            if (!user) return user;
            if (depositRefund > 0) user.depositBalance = (user.depositBalance || 0) + depositRefund;
            if (winningRefund > 0) user.winningBalance = (user.winningBalance || 0) + winningRefund;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        });
    }

    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: playerUid,
        userName: playerData.ludoKingUsername || 'Player',
        amount: matchAmount,
        type: 'CREDIT',
        isCredit: true,
        reason: reason,
        description: reason,
        ludoMatchId: matchId,
        depositRefund,
        winningRefund,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });
}

// ─── Count user's active Ludo matches ───────────────────────

async function countUserLudoMatches(uid, statusFilter) {
    const allMatches = await db.ref('ludo_matches')
        .orderByChild('creator/uid').equalTo(uid)
        .once('value');
    let count = 0;
    allMatches.forEach(snap => {
        const m = snap.val();
        if (statusFilter.includes(m.status)) count++;
    });

    // Also count matches where user is acceptor
    const allMatchesSnap = await db.ref('ludo_matches').once('value');
    allMatchesSnap.forEach(snap => {
        const m = snap.val();
        if (m.acceptor?.uid === uid && statusFilter.includes(m.status)) count++;
    });
    return count;
}

// ─── Check & Credit Referral After Game Completion ──────────

async function checkAndCreditReferral(playerUid) {
    try {
        // Does this player have a referrer?
        const userSnap = await db.ref(`users/${playerUid}/referredBy`).once('value');
        const referrerUid = userSnap.val();
        if (!referrerUid) return; // No referrer, skip

        // Check if referral is still PENDING
        const refSnap = await db.ref(`referrals/${referrerUid}/${playerUid}`).once('value');
        const refData = refSnap.val();
        if (!refData || refData.status !== 'PENDING') return; // Already completed or doesn't exist

        // Count completed games (Ludo matches where this user participated)
        const [creatorSnap, acceptorSnap] = await Promise.all([
            db.ref('ludo_matches').orderByChild('creator/uid').equalTo(playerUid).once('value'),
            db.ref('ludo_matches').orderByChild('acceptor/uid').equalTo(playerUid).once('value')
        ]);

        let completedGames = 0;
        const countCompleted = (snap) => {
            snap.forEach(child => {
                const m = child.val();
                if (m.status === 'COMPLETED') completedGames++;
            });
        };
        countCompleted(creatorSnap);
        countCompleted(acceptorSnap);

        // Also count eSports participations
        const esportsSnap = await db.ref('esports_matches').once('value');
        if (esportsSnap.exists()) {
            esportsSnap.forEach(child => {
                const m = child.val();
                if (m.status === 'COMPLETED' && m.participants && m.participants[playerUid]?.confirmed) {
                    completedGames++;
                }
            });
        }

        const requiredGames = refData.gamesRequired || 3;

        // Update games count on referral record
        await db.ref(`referrals/${referrerUid}/${playerUid}/gamesCompleted`).set(completedGames);

        // Check if threshold reached
        if (completedGames >= requiredGames) {
            const rewardAmount = refData.rewardAmount || 5;

            // Credit referrer's DEPOSIT balance atomically (not winning!)
            await db.ref(`users/${referrerUid}`).transaction(user => {
                if (!user) return user;
                user.depositBalance = (user.depositBalance || 0) + rewardAmount;
                user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
                return user;
            });

            // Mark referral as COMPLETED
            await db.ref(`referrals/${referrerUid}/${playerUid}`).update({
                status: 'COMPLETED',
                completedAt: admin.database.ServerValue.TIMESTAMP,
                gamesCompleted: completedGames
            });

            // Update referral stats
            await db.ref(`referral_stats/${referrerUid}`).transaction(s => {
                if (!s) s = { totalReferrals: 0, totalEarnings: 0, pendingReferrals: 0 };
                s.totalEarnings = (s.totalEarnings || 0) + rewardAmount;
                s.pendingReferrals = Math.max(0, (s.pendingReferrals || 0) - 1);
                return s;
            });

            // Record wallet transaction
            const txnKey = db.ref('wallet_transactions').push().key;
            await db.ref('wallet_transactions/' + txnKey).set({
                userId: referrerUid,
                amount: rewardAmount,
                type: 'CREDIT',
                isCredit: true,
                reason: 'Referral Reward',
                description: `Referral reward — friend completed ${requiredGames} games`,
                status: 'SUCCESS',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });

            // Notify referrer — reward credited!
            await sendPush(referrerUid, `🎊 🪙 ${rewardAmount} Referral Bonus Credited!`,
                `Your referred friend completed ${requiredGames} games! 🪙 ${rewardAmount} has been added to your deposit balance.`,
                { type: 'REFERRAL_REWARD', amount: String(rewardAmount) });

            functions.logger.info(`[checkAndCreditReferral] Credited ₹${rewardAmount} to ${referrerUid} for referral ${playerUid}`);
        }
    } catch (err) {
        functions.logger.error(`[checkAndCreditReferral] Error for ${playerUid}:`, err.message);
        // Non-blocking — don't let referral errors break game flow
    }
}

// ─── Rate Limiting Helper ───────────────────────────────────

/**
 * Server-side rate limiter using Firebase Realtime Database.
 * Tracks call timestamps per user/action in rate_limits/{uid}/{action}.
 * Uses atomic transaction to count calls within sliding window.
 *
 * @param {string} uid      - User UID
 * @param {string} action   - Action identifier (e.g., 'withdrawal', 'deposit')
 * @param {number} maxCalls - Max calls allowed within window
 * @param {number} windowMs - Time window in milliseconds
 * @throws {HttpsError} resource-exhausted if rate limit exceeded
 */
async function checkRateLimit(uid, action, maxCalls, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const ref = db.ref(`rate_limits/${uid}/${action}`);

    const txn = await ref.transaction(data => {
        if (!data) data = { calls: [] };

        // Firebase RTDB converts arrays to objects ({0: ts, 1: ts, ...})
        // Always normalize to array using Object.values()
        const rawCalls = data.calls || [];
        const callsArray = Array.isArray(rawCalls) ? rawCalls : Object.values(rawCalls);

        // Clean expired entries
        const activeCalls = callsArray.filter(ts => typeof ts === 'number' && ts > cutoff);

        if (activeCalls.length >= maxCalls) {
            // Don't modify — we'll check committed flag
            return;  // Abort transaction
        }

        // Add current call timestamp
        activeCalls.push(now);
        data.calls = activeCalls;
        data.lastCall = now;
        return data;
    });

    if (!txn.committed) {
        const windowMin = Math.ceil(windowMs / 60000);
        throw new HttpsError('resource-exhausted',
            `Too many requests. Max ${maxCalls} per ${windowMin} minute${windowMin > 1 ? 's' : ''}. Please try again later.`);
    }
}

// ─── Structured Logging ─────────────────────────────────────

/**
 * Structured log helper for production observability.
 * Outputs JSON metadata alongside messages for Cloud Logging.
 *
 * @param {string} fn - Function name (e.g., 'submitLudoResult')
 * @param {'info'|'warn'|'error'} level - Log level
 * @param {string} message - Human-readable message
 * @param {Object} [meta={}] - Structured metadata (uid, matchId, amount, etc.)
 */
function logEvent(fn, level, message, meta = {}) {
    const entry = { fn, ...meta };
    if (meta.uid) entry.uid = meta.uid;
    functions.logger[level](`[${fn}] ${message}`, entry);
}

// ─── HTML Escape (shared) ───────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── Exports ────────────────────────────────────────────────

module.exports = {
    admin,
    db,
    functions,
    // v1 utilities
    onCall,
    onRequest,
    HttpsError,
    onSchedule,
    // Shared helpers
    assertAuth,
    assertAdmin,
    assertNotBanned,
    sendPush,
    getLudoCommission,
    deductBalance,
    refundPlayer,
    countUserLudoMatches,
    checkAndCreditReferral,
    checkRateLimit,
    logEvent,
    escapeHtml
};
