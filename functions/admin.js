/**
 * admin.js — Admin-only Cloud Functions
 * Exports: adminLogin, adminWalletUpdate, adminRejectWithdrawal, adminCancelLudoMatch,
 *          adminResolveLudoDispute, lookupEmailByMobile
 */

const {
    functions, admin, db,
    assertAuth, assertAdmin, sendPush, refundPlayer, getLudoCommission
} = require('./helpers');

// ─── Admin Login (Custom Token Auth) ────────────────────────

exports.adminLogin = functions.https.onCall(async (data) => {
    const { username, passwordHash } = data;

    if (!username || !passwordHash) {
        throw new functions.https.HttpsError('invalid-argument', 'Username and password required');
    }

    let foundUid = null;
    let role = '';
    let permissions = {};
    let foundUsername = '';

    // Check Main Admins
    const adminsSnap = await db.ref('admins').orderByChild('username').equalTo(username).once('value');
    if (adminsSnap.exists()) {
        adminsSnap.forEach(child => {
            const data = child.val();
            if (data.passwordHash === passwordHash) {
                foundUid = child.key;
                foundUsername = data.username;
                role = 'MAIN_ADMIN';
            }
        });
    }

    // Check Moderators if not found as admin
    if (!foundUid) {
        const modsSnap = await db.ref('moderators').orderByChild('username').equalTo(username).once('value');
        if (modsSnap.exists()) {
            modsSnap.forEach(child => {
                const data = child.val();
                if (data.passwordHash === passwordHash && data.isActive) {
                    foundUid = child.key;
                    foundUsername = data.username;
                    role = 'MODERATOR';
                }
            });
        }
    }

    if (!foundUid) {
        throw new functions.https.HttpsError('not-found', 'Invalid credentials');
    }

    // Fetch permissions for moderators
    if (role === 'MODERATOR') {
        const permSnap = await db.ref('admin_permissions/' + foundUid).once('value');
        permissions = permSnap.val() || {};
    }

    // Create Firebase Custom Auth Token — this makes auth.uid = foundUid
    // so security rules checking root.child('admins').child(auth.uid) will work
    const customToken = await admin.auth().createCustomToken(foundUid, {
        role: role,
        isAdmin: role === 'MAIN_ADMIN'
    });

    // Update last login
    const loginPath = role === 'MAIN_ADMIN' ? 'admins' : 'moderators';
    await db.ref(`${loginPath}/${foundUid}/lastLogin`).set(admin.database.ServerValue.TIMESTAMP);

    return {
        success: true,
        token: customToken,
        uid: foundUid,
        username: foundUsername,
        role: role,
        permissions: permissions
    };
});

// ─── Admin Wallet Credit / Debit ────────────────────────────

exports.adminWalletUpdate = functions.https.onCall(async (data, context) => {
    const adminUid = await assertAdmin(context);
    const { targetUid, amount, action, reason } = data;

    if (!targetUid || !amount || amount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'targetUid and positive amount required');
    }
    if (!['CREDIT', 'DEBIT'].includes(action)) {
        throw new functions.https.HttpsError('invalid-argument', 'action must be CREDIT or DEBIT');
    }

    // Get user info
    const userSnap = await db.ref('users/' + targetUid).once('value');
    const pUser = userSnap.val();
    if (!pUser) throw new functions.https.HttpsError('not-found', 'User not found');

    // Atomic balance update
    const txn = await db.ref(`users/${targetUid}/depositBalance`).transaction(bal => {
        const b = bal || 0;
        if (action === 'DEBIT' && b < amount) return; // Abort
        return action === 'CREDIT' ? b + amount : b - amount;
    });

    if (!txn.committed) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient deposit balance');
    }

    const newBal = txn.snapshot.val() || 0;
    const oldBal = action === 'CREDIT' ? newBal - amount : newBal + amount;

    // Deposit record
    const depositKey = db.ref('deposits').push().key;
    await db.ref('deposits/' + depositKey).set({
        userId: targetUid,
        userName: pUser.fullName || pUser.username || 'User',
        amount, source: 'ADMIN', status: 'SUCCESS',
        createdAt: admin.database.ServerValue.TIMESTAMP,
        completedAt: admin.database.ServerValue.TIMESTAMP,
        adminId: adminUid,
        reason: reason || '',
        balanceBefore: oldBal,
        balanceAfter: newBal
    });

    // Wallet transaction
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: targetUid,
        amount, type: action,
        reason: reason || '',
        timestamp: admin.database.ServerValue.TIMESTAMP,
        adminId: adminUid
    });

    return { success: true, newBalance: newBal };
});

// ─── Admin Reject Withdrawal (with refund) ──────────────────

exports.adminRejectWithdrawal = functions.https.onCall(async (data, context) => {
    const adminUid = await assertAdmin(context);
    const { withdrawalId, reason } = data;

    if (!withdrawalId) throw new functions.https.HttpsError('invalid-argument', 'withdrawalId required');

    const wSnap = await db.ref('withdrawals/' + withdrawalId).once('value');
    const w = wSnap.val();
    if (!w) throw new functions.https.HttpsError('not-found', 'Withdrawal not found');

    // Refund
    await db.ref(`users/${w.userId}/winningBalance`).transaction(b => (b || 0) + w.amount);

    // Update withdrawal
    await db.ref('withdrawals/' + withdrawalId).update({
        status: 'REJECTED',
        processedAt: admin.database.ServerValue.TIMESTAMP,
        processedBy: adminUid,
        adminNote: reason || ''
    });

    // Notify user
    await sendPush(w.userId, `❌ Withdrawal Update — ₹${w.amount}`, `Your ₹${w.amount} withdrawal request was not approved${reason ? ': ' + reason : ''}. The amount has been refunded to your wallet balance.`, { type: 'WITHDRAWAL_REJECTED' });

    return { success: true };
});

// ─── Admin Cancel Ludo Match ────────────────────────────────

exports.adminCancelLudoMatch = functions.https.onCall(async (data, context) => {
    const adminUid = await assertAdmin(context);
    const { matchId, reason } = data;

    if (!matchId) throw new functions.https.HttpsError('invalid-argument', 'matchId required');

    const matchRef = db.ref('ludo_matches/' + matchId);

    const txn = await matchRef.transaction(match => {
        if (!match) return null; // Return null to retry (cold start)
        if (match.status === 'COMPLETED' || match.status === 'CANCELLED') return;
        match.status = 'CANCELLING';
        match.cancelledBy = 'admin';
        match.cancelledAt = Date.now();
        match.adminCancelledBy = adminUid;
        return match;
    }, undefined, false); // applyLocally: false — force server read

    if (!txn.committed) {
        throw new functions.https.HttpsError('failed-precondition', 'Cannot cancel');
    }

    const matchData = txn.snapshot.val();

    // Refund both players
    await refundPlayer(matchData.creator, matchId, matchData.amount, 'Admin Cancelled Ludo Match (Refund)');
    if (matchData.acceptor?.uid) {
        await refundPlayer(matchData.acceptor, matchId, matchData.amount, 'Admin Cancelled Ludo Match (Refund)');
    }

    await matchRef.update({
        status: 'CANCELLED',
        cancelReason: reason || 'Cancelled by admin'
    });

    // Notify players
    const shortIdAC = matchId.slice(-6).toUpperCase();
    await sendPush(matchData.creator.uid, `🔄 Admin: Match #${shortIdAC} Cancelled — ₹${matchData.amount} Refunded`, `Your ₹${matchData.amount} Ludo match (#${shortIdAC}) was reviewed and cancelled by admin${reason ? ': ' + reason : ''}. Entry fee refunded.`, { type: 'LUDO_CANCELLED', matchId });
    if (matchData.acceptor?.uid) {
        await sendPush(matchData.acceptor.uid, `🔄 Admin: Match #${shortIdAC} Cancelled — ₹${matchData.amount} Refunded`, `Your ₹${matchData.amount} Ludo match (#${shortIdAC}) was reviewed and cancelled by admin${reason ? ': ' + reason : ''}. Entry fee refunded.`, { type: 'LUDO_CANCELLED', matchId });
    }

    return { success: true };
});

// ─── Admin Resolve Ludo Dispute Push ────────────────────────

exports.adminResolveLudoDispute = functions.https.onCall(async (data, context) => {
    await assertAdmin(context);

    const { matchId, winnerId, resolution } = data;
    if (!matchId) throw new functions.https.HttpsError('invalid-argument', 'matchId required');

    const matchSnap = await db.ref('ludo_matches/' + matchId).once('value');
    const match = matchSnap.val();
    if (!match) throw new functions.https.HttpsError('not-found', 'Match not found');

    const creatorUid = match.creator?.uid;
    const acceptorUid = match.acceptor?.uid;
    const shortIdDR = matchId.slice(-6).toUpperCase();
    const amount = match.amount || 0;

    // Build specific messages based on resolution type
    let creatorMsg, acceptorMsg;
    if (winnerId === creatorUid) {
        const poolAmount = amount * 2;
        const commission = Math.ceil(poolAmount * 0.15);
        const winAmount = poolAmount - commission;
        creatorMsg = `🏆 You won Match #${shortIdDR}! Admin reviewed the dispute and declared you the winner. ₹${winAmount} credited to your wallet.`;
        acceptorMsg = `Match #${shortIdDR} (₹${amount}) dispute resolved. Admin declared your opponent as the winner after review.`;
    } else if (winnerId === acceptorUid) {
        const poolAmount = amount * 2;
        const commission = Math.ceil(poolAmount * 0.15);
        const winAmount = poolAmount - commission;
        creatorMsg = `Match #${shortIdDR} (₹${amount}) dispute resolved. Admin declared your opponent as the winner after review.`;
        acceptorMsg = `🏆 You won Match #${shortIdDR}! Admin reviewed the dispute and declared you the winner. ₹${winAmount} credited to your wallet.`;
    } else {
        // Cancelled/refunded
        creatorMsg = `Match #${shortIdDR} (₹${amount}) dispute resolved. ${resolution || 'Admin cancelled the match and refunded both players.'}`;
        acceptorMsg = creatorMsg;
    }

    if (creatorUid) {
        await sendPush(creatorUid, `✅ Dispute Resolved — Match #${shortIdDR}`,
            creatorMsg,
            { type: 'LUDO_DISPUTE_RESOLVED', matchId });
    }
    if (acceptorUid) {
        await sendPush(acceptorUid, `✅ Dispute Resolved — Match #${shortIdDR}`,
            acceptorMsg,
            { type: 'LUDO_DISPUTE_RESOLVED', matchId });
    }

    return { success: true };
});

// ─── Public: Lookup email by mobile (for mobile login) ──────
// No auth required — needed before user can log in

exports.lookupEmailByMobile = functions.https.onCall(async (data) => {
    let { mobile } = data;
    if (!mobile) {
        throw new functions.https.HttpsError('invalid-argument', 'Mobile number required');
    }

    // Normalize: strip spaces, dashes, parens, +91, 91 prefix
    mobile = String(mobile).replace(/[\s\-\(\)]/g, '');
    if (mobile.startsWith('+91')) mobile = mobile.substring(3);
    else if (mobile.startsWith('91') && mobile.length === 12) mobile = mobile.substring(2);

    if (!/^[0-9]{10}$/.test(mobile)) {
        throw new functions.https.HttpsError('invalid-argument', 'Valid 10-digit mobile required');
    }

    // Try exact 10-digit match first
    let snap = await db.ref('users').orderByChild('mobile').equalTo(mobile).once('value');

    // Fallback: try with +91 prefix (some users may have stored with country code)
    if (!snap.exists()) {
        snap = await db.ref('users').orderByChild('mobile').equalTo('+91' + mobile).once('value');
    }
    // Fallback: try with 91 prefix
    if (!snap.exists()) {
        snap = await db.ref('users').orderByChild('mobile').equalTo('91' + mobile).once('value');
    }

    if (!snap.exists()) {
        functions.logger.info('lookupEmailByMobile: no user found for mobile', { mobile });
        throw new functions.https.HttpsError('not-found', 'No account found with this mobile number');
    }

    let email = null;
    snap.forEach(child => { email = child.val().email; });

    if (!email) {
        throw new functions.https.HttpsError('not-found', 'Account found but email is missing');
    }

    return { email };
});
