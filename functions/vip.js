/**
 * vip.js — VIP / Premium Membership Cloud Functions
 * Exports: purchaseVip
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertNotBanned, checkRateLimit, logEvent
} = require('./helpers');

// Default VIP config
const DEFAULT_VIP_CONFIG = {
    enabled: true,
    price: 99,
    bonusPercent: 5,
    durationDays: 30,
    benefits: ['Deposit bonus', 'VIP badge', 'Priority support']
};

// 30 days in milliseconds
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Helper: Check if user has active VIP ──────────────────
function isVipActive(vipData) {
    if (!vipData || !vipData.active) return false;
    if (!vipData.expiresAt) return false;
    return vipData.expiresAt > Date.now();
}

// ─── User: Purchase VIP Membership ─────────────────────────

exports.purchaseVip = onCall(async (request) => {
    const uid = assertAuth(request);
    const userData = await assertNotBanned(uid);

    // Rate limit: max 3 VIP purchase attempts per hour
    await checkRateLimit(uid, 'vip_purchase', 3, 60 * 60 * 1000);

    // Read VIP config
    const configSnap = await db.ref('platform_config/vip').once('value');
    const config = configSnap.val() || DEFAULT_VIP_CONFIG;

    if (config.enabled === false) {
        throw new HttpsError('failed-precondition', 'VIP membership is currently unavailable');
    }

    const price = config.price || DEFAULT_VIP_CONFIG.price;
    const durationDays = config.durationDays || DEFAULT_VIP_CONFIG.durationDays;
    const bonusPercent = config.bonusPercent || DEFAULT_VIP_CONFIG.bonusPercent;

    // Check if already VIP — allow renewal if ≤3 days left
    const vipSnap = await db.ref(`users/${uid}/vip`).once('value');
    const currentVip = vipSnap.val();

    if (isVipActive(currentVip)) {
        const daysLeft = Math.ceil((currentVip.expiresAt - Date.now()) / DAY_MS);
        if (daysLeft > 3) {
            throw new HttpsError('already-exists',
                `You already have an active VIP membership until ${new Date(currentVip.expiresAt).toLocaleDateString('en-IN')} (${daysLeft} days left)`);
        }
    }

    // ─── ATOMIC: Deduct price from depositBalance ───
    const balTxn = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) return user;
        const deposit = user.depositBalance || 0;

        if (deposit < price) {
            return; // Abort — insufficient balance
        }

        user.depositBalance = deposit - price;
        user.walletBalance = (user.depositBalance) + (user.winningBalance || 0);
        return user;
    }, undefined, false);

    if (!balTxn.committed) {
        // Check if aborted due to insufficient balance
        const checkSnap = await db.ref(`users/${uid}/depositBalance`).once('value');
        const currentBal = checkSnap.val() || 0;
        if (currentBal < price) {
            throw new HttpsError('failed-precondition',
                `Insufficient balance. You need 🪙 ${price} but have 🪙 ${currentBal}. Please add funds first.`);
        }
        throw new HttpsError('internal', 'Failed to process payment — please try again');
    }

    // ─── Activate VIP ───
    const now = Date.now();
    // For renewals, extend from current expiry; for new purchases, start from now
    const baseTime = (currentVip && isVipActive(currentVip)) ? currentVip.expiresAt : now;
    const expiresAt = baseTime + (durationDays * DAY_MS);

    const vipData = {
        active: true,
        purchasedAt: now,
        expiresAt: expiresAt,
        price: price,
        durationDays: durationDays,
        bonusPercent: bonusPercent,
        autoRenew: false
    };

    const vipSetResult = await db.ref(`users/${uid}/vip`).set(vipData)
        .then(() => true)
        .catch(() => false);

    // Set isVip flag on user root for cross-feature badge visibility
    await db.ref(`users/${uid}/isVip`).set(true).catch(() => { });

    if (!vipSetResult) {
        // Rollback balance deduction
        await db.ref(`users/${uid}`).transaction(user => {
            if (!user) return user;
            user.depositBalance = (user.depositBalance || 0) + price;
            user.walletBalance = (user.depositBalance) + (user.winningBalance || 0);
            return user;
        });
        throw new HttpsError('internal', 'Failed to activate VIP — balance restored');
    }

    // ─── Wallet Transaction ───
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref(`wallet_transactions/${txnKey}`).set({
        userId: uid,
        userName: userData.fullName || userData.username || 'User',
        amount: price,
        type: 'DEBIT',
        isCredit: false,
        reason: 'VIP membership purchase',
        description: `VIP Premium — ${durationDays} days (${bonusPercent}% deposit bonus)`,
        vipPurchase: true,
        walletType: 'DEPOSIT',
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    functions.logger.info(`[VIP] ${uid} purchased VIP for ₹${price}, expires ${new Date(expiresAt).toISOString()}`);

    return {
        success: true,
        message: `VIP activated! Enjoy ${bonusPercent}% bonus on all deposits for ${durationDays} days.`,
        vip: {
            active: true,
            expiresAt,
            bonusPercent,
            daysRemaining: durationDays
        }
    };
});

// Export helper for use by payments.js
exports.isVipActive = isVipActive;
