/**
 * coupons.js — Coupon / Promo Code Cloud Functions
 * Exports: redeemCoupon, adminCreateCoupon, adminToggleCoupon
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertAdmin, assertNotBanned, logEvent
} = require('./helpers');

// ─── User: Redeem Coupon ────────────────────────────────────

exports.redeemCoupon = onCall(async (request) => {
    const uid = assertAuth(request);
    const userData = await assertNotBanned(uid); // Returns user data — reuse it

    const code = (request.data.code || '').trim().toUpperCase();
    if (!code || code.length < 3 || code.length > 20) {
        throw new HttpsError('invalid-argument', 'Invalid coupon code');
    }

    // Find coupon by code
    const couponSnap = await db.ref('coupons')
        .orderByChild('code')
        .equalTo(code)
        .limitToFirst(1)
        .once('value');

    if (!couponSnap.exists()) {
        throw new HttpsError('not-found', 'Invalid coupon code');
    }

    // Get coupon data
    let couponId, coupon;
    couponSnap.forEach(child => {
        couponId = child.key;
        coupon = child.val();
    });

    // Validate coupon state
    if (!coupon.active) {
        throw new HttpsError('failed-precondition', 'This coupon is no longer active');
    }

    if (coupon.expiresAt && coupon.expiresAt > 0 && Date.now() > coupon.expiresAt) {
        throw new HttpsError('failed-precondition', 'This coupon has expired');
    }

    // Atomic check + increment of usedCount to prevent race condition
    let usedCountIncremented = false;
    if (coupon.maxUses > 0) {
        const usageRef = db.ref(`coupons/${couponId}/usedCount`);
        const usageTxn = await usageRef.transaction(currentCount => {
            const count = currentCount || 0;
            if (count >= coupon.maxUses) {
                return; // Abort — limit reached
            }
            return count + 1;
        }, undefined, false);

        if (!usageTxn.committed) {
            throw new HttpsError('failed-precondition', 'This coupon has reached its usage limit');
        }
        usedCountIncremented = true;
    }

    // Check minimum deposit requirement
    if (coupon.minDeposit && coupon.minDeposit > 0) {
        const depositsSnap = await db.ref('deposits')
            .orderByChild('userId')
            .equalTo(uid)
            .once('value');
        let totalDeposited = 0;
        if (depositsSnap.exists()) {
            depositsSnap.forEach(child => {
                const dep = child.val();
                if (dep.status === 'SUCCESS' || dep.status === 'COMPLETED') {
                    totalDeposited += parseFloat(dep.amount || 0);
                }
            });
        }
        if (totalDeposited < coupon.minDeposit) {
            // Rollback usedCount if it was incremented
            if (usedCountIncremented) {
                await db.ref(`coupons/${couponId}/usedCount`).transaction(c => Math.max(0, (c || 1) - 1));
            }
            throw new HttpsError('failed-precondition',
                `Minimum lifetime deposit of 🪙 ${coupon.minDeposit} required to use this coupon`);
        }
    }

    // ─── ATOMIC CLAIM: Prevent double-redemption race condition ───
    // Use transaction on redemption record — if it already exists, abort
    const redemptionRef = db.ref(`coupon_redemptions/${couponId}/${uid}`);
    const claimTxn = await redemptionRef.transaction(existing => {
        if (existing) {
            return; // Abort — already redeemed (someone beat us)
        }
        return { claimed: true }; // Claim the slot atomically
    }, undefined, false);

    if (!claimTxn.committed) {
        // Rollback usedCount if it was incremented
        if (usedCountIncremented) {
            await db.ref(`coupons/${couponId}/usedCount`).transaction(c => Math.max(0, (c || 1) - 1));
        }
        throw new HttpsError('already-exists', 'You have already used this coupon');
    }

    // Calculate bonus
    let bonusAmount = 0;
    if (coupon.type === 'FLAT') {
        bonusAmount = coupon.value;
    } else if (coupon.type === 'PERCENTAGE') {
        // For percentage coupons without a deposit context, use maxBonus as the bonus
        bonusAmount = coupon.maxBonus || coupon.value;
    } else {
        bonusAmount = coupon.value; // fallback to flat
    }

    bonusAmount = Math.round(bonusAmount * 100) / 100;
    if (bonusAmount <= 0) {
        // Rollback claim and usedCount
        await redemptionRef.remove();
        if (usedCountIncremented) {
            await db.ref(`coupons/${couponId}/usedCount`).transaction(c => Math.max(0, (c || 1) - 1));
        }
        throw new HttpsError('internal', 'Invalid coupon configuration');
    }

    // Credit bonus to deposit balance + update walletBalance atomically
    const balTxn = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) return null;
        user.depositBalance = (user.depositBalance || 0) + bonusAmount;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    }, undefined, false);

    if (!balTxn.committed) {
        // Rollback claim and usedCount
        await redemptionRef.remove();
        if (usedCountIncremented) {
            await db.ref(`coupons/${couponId}/usedCount`).transaction(c => Math.max(0, (c || 1) - 1));
        }
        throw new HttpsError('internal', 'Failed to credit bonus — please try again');
    }

    // Finalize redemption record with full details
    await redemptionRef.set({
        amount: bonusAmount,
        redeemedAt: admin.database.ServerValue.TIMESTAMP,
        couponCode: code
    });

    // Create wallet transaction
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref(`wallet_transactions/${txnKey}`).set({
        userId: uid,
        userName: userData.fullName || userData.username || 'User',
        amount: bonusAmount,
        type: 'CREDIT',
        isCredit: true,
        reason: `Promo code bonus: ${code}`,
        description: `Coupon ${code} — 🪙 ${bonusAmount} bonus credited`,
        couponCode: code,
        couponId: couponId,
        couponBonus: bonusAmount,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Increment global usage count (only for unlimited coupons — limited ones already incremented atomically above)
    if (!coupon.maxUses || coupon.maxUses <= 0) {
        await db.ref(`coupons/${couponId}/usedCount`).transaction(count => (count || 0) + 1);
    }

    functions.logger.info(`[redeemCoupon] ${uid} redeemed ${code}, bonus=₹${bonusAmount}`);

    return {
        success: true,
        bonusAmount,
        message: `🪙 ${bonusAmount} bonus credited to your wallet!`
    };
});


// ─── Admin: Create Coupon ───────────────────────────────────

exports.adminCreateCoupon = onCall(async (request) => {
    const adminUid = await assertAdmin(request);

    const {
        code: rawCode,
        type = 'FLAT',
        value = 0,
        maxBonus = 0,
        minDeposit = 0,
        maxUses = 0,
        maxPerUser = 1,
        expiresAt = 0,
        description = ''
    } = request.data;

    // Validate type
    if (!['FLAT', 'PERCENTAGE'].includes(type)) {
        throw new HttpsError('invalid-argument', 'Type must be FLAT or PERCENTAGE');
    }

    // Validate value
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) {
        throw new HttpsError('invalid-argument', 'Value must be a positive number');
    }
    if (type === 'PERCENTAGE' && numValue > 100) {
        throw new HttpsError('invalid-argument', 'Percentage cannot exceed 100%');
    }

    // Generate or validate code
    let code = (rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) {
        // Auto-generate 8 character code
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }

    if (code.length < 3 || code.length > 20) {
        throw new HttpsError('invalid-argument', 'Code must be 3-20 characters');
    }

    // Check for duplicate code
    const existingSnap = await db.ref('coupons')
        .orderByChild('code')
        .equalTo(code)
        .limitToFirst(1)
        .once('value');

    if (existingSnap.exists()) {
        throw new HttpsError('already-exists', `Coupon code "${code}" already exists`);
    }

    // Create coupon
    const couponRef = db.ref('coupons').push();
    const couponData = {
        code,
        type,
        value: numValue,
        maxBonus: parseFloat(maxBonus) || 0,
        minDeposit: parseFloat(minDeposit) || 0,
        maxUses: parseInt(maxUses) || 0,
        maxPerUser: parseInt(maxPerUser) || 1,
        usedCount: 0,
        active: true,
        expiresAt: parseInt(expiresAt) || 0,
        description: description.trim() || `${type === 'PERCENTAGE' ? numValue + '%' : '🪙 ' + numValue} bonus`,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        createdBy: adminUid
    };

    await couponRef.set(couponData);

    // Log admin action
    await db.ref('admin_logs').push({
        action: 'CREATE_COUPON',
        adminId: adminUid,
        details: { couponId: couponRef.key, code, type, value: numValue },
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    functions.logger.info(`[adminCreateCoupon] Admin ${adminUid} created coupon ${code}`);

    return {
        success: true,
        couponId: couponRef.key,
        code,
        message: `Coupon "${code}" created successfully`
    };
});


// ─── Admin: Toggle Coupon Active/Inactive ───────────────────

exports.adminToggleCoupon = onCall(async (request) => {
    const adminUid = await assertAdmin(request);

    const { couponId, active } = request.data;
    if (!couponId) {
        throw new HttpsError('invalid-argument', 'Coupon ID required');
    }

    const couponSnap = await db.ref(`coupons/${couponId}`).once('value');
    if (!couponSnap.exists()) {
        throw new HttpsError('not-found', 'Coupon not found');
    }

    const newActive = active !== undefined ? !!active : !couponSnap.val().active;
    await db.ref(`coupons/${couponId}/active`).set(newActive);

    // Log admin action
    await db.ref('admin_logs').push({
        action: newActive ? 'ENABLE_COUPON' : 'DISABLE_COUPON',
        adminId: adminUid,
        details: { couponId, code: couponSnap.val().code },
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    functions.logger.info(`[adminToggleCoupon] Admin ${adminUid} ${newActive ? 'enabled' : 'disabled'} coupon ${couponSnap.val().code}`);

    return { success: true, active: newActive };
});
