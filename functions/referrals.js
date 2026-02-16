/**
 * referrals.js — Referral system Cloud Functions
 * Exports: processReferralReward
 * (checkAndCreditReferral is in helpers.js as it's shared across ludo/esports)
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, sendPush, checkRateLimit, assertNotBanned, logEvent
} = require('./helpers');

// ─── Process Referral Reward ────────────────────────────────

exports.processReferralReward = onCall(async (request) => {
    const uid = assertAuth(request);
    const { referrerUid, deviceFingerprint } = request.data;

    // ── Rate limit: max 5 referral attempts per hour ──
    await checkRateLimit(uid, 'referral', 5, 60 * 60 * 1000);

    // ── Server-side ban enforcement ──
    await assertNotBanned(uid);

    if (!referrerUid) throw new HttpsError('invalid-argument', 'referrerUid required');
    if (referrerUid === uid) throw new HttpsError('invalid-argument', 'Cannot refer yourself');

    // ── Duplicate check: already processed this referral?
    const existingRef = await db.ref(`referrals/${referrerUid}/${uid}`).once('value');
    if (existingRef.exists()) {
        throw new HttpsError('already-exists', 'Referral already processed');
    }

    // ── Verify referrer user exists
    const referrerSnap = await db.ref('users/' + referrerUid).once('value');
    if (!referrerSnap.exists()) throw new HttpsError('not-found', 'Referrer not found');

    // ── Device fingerprint check: block same-device abuse
    if (deviceFingerprint) {
        const referrerData = referrerSnap.val();
        if (referrerData.deviceFingerprint && referrerData.deviceFingerprint === deviceFingerprint) {
            functions.logger.warn(`[processReferralReward] Same device fingerprint detected: referrer=${referrerUid}, referee=${uid}`);
            throw new HttpsError('permission-denied', 'Referral blocked: same device detected');
        }
    }

    // ── Daily cap check
    const configSnap = await db.ref('platform_config/referral').once('value');
    const config = configSnap.val() || {};
    const rewardAmount = config.rewardAmount || 5;
    const dailyCap = config.dailyCap || 5;
    const requiredGames = config.requiredGames || 3;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const statsSnap = await db.ref(`referral_stats/${referrerUid}`).once('value');
    const stats = statsSnap.val() || {};

    if (stats.lastResetDate === today && (stats.dailyCount || 0) >= dailyCap) {
        throw new HttpsError('resource-exhausted', `Daily referral limit (${dailyCap}) reached. Try again tomorrow.`);
    }

    // ── Save PENDING referral (NOT credited yet)
    await db.ref(`referrals/${referrerUid}/${uid}`).set({
        username: (await db.ref(`users/${uid}/fullName`).once('value')).val() || 'User',
        joinedAt: admin.database.ServerValue.TIMESTAMP,
        rewardAmount: rewardAmount,
        status: 'PENDING',               // ← NOT credited yet
        gamesRequired: requiredGames,
        gamesCompleted: 0
    });

    // ── Update daily count (no earnings yet — only on completion)
    await db.ref(`referral_stats/${referrerUid}`).transaction(s => {
        if (!s) s = { totalReferrals: 0, totalEarnings: 0, pendingReferrals: 0 };
        s.totalReferrals = (s.totalReferrals || 0) + 1;
        s.pendingReferrals = (s.pendingReferrals || 0) + 1;
        // Reset daily count if new day
        if (s.lastResetDate !== today) {
            s.dailyCount = 1;
            s.lastResetDate = today;
        } else {
            s.dailyCount = (s.dailyCount || 0) + 1;
        }
        return s;
    });

    // Notify referrer about pending referral
    await sendPush(referrerUid, `🎊 New Referral Registered!`,
        `Your friend just joined JeetoPlay! You'll earn 🪙 ${rewardAmount} once they complete ${requiredGames} games. Keep sharing!`,
        { type: 'REFERRAL_PENDING', amount: String(rewardAmount) });

    return { success: true, rewardAmount, status: 'PENDING', requiredGames };
});
