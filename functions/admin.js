/**
 * admin.js — Admin-only Cloud Functions
 * Exports: adminLogin, adminWalletUpdate, adminRejectWithdrawal, adminCancelLudoMatch,
 *          adminResolveLudoDispute, lookupEmailByMobile, adminBanUser, adminUnbanUser
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertAdmin, sendPush, refundPlayer, getLudoCommission,
    logEvent
} = require('./helpers');

// ─── Admin Login (Custom Token Auth) ────────────────────────

exports.adminLogin = onCall(async (request) => {
    const { username, passwordHash } = request.data;

    if (!username || !passwordHash) {
        throw new HttpsError('invalid-argument', 'Username and password required');
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
        throw new HttpsError('not-found', 'Invalid credentials');
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

exports.adminWalletUpdate = onCall(async (request) => {
    const adminUid = await assertAdmin(request);
    const { targetUid, amount, action, reason, walletType } = request.data;

    if (!targetUid || !amount || amount <= 0) {
        throw new HttpsError('invalid-argument', 'targetUid and positive amount required');
    }
    if (!['CREDIT', 'DEBIT'].includes(action)) {
        throw new HttpsError('invalid-argument', 'action must be CREDIT or DEBIT');
    }

    // Determine which balance field to update (default: deposit for backward compat)
    const isWinning = walletType === 'winning';
    const balanceField = isWinning ? 'winningBalance' : 'depositBalance';
    const walletLabel = isWinning ? 'Winning' : 'Deposit';

    // Get user info
    const userSnap = await db.ref('users/' + targetUid).once('value');
    const pUser = userSnap.val();
    if (!pUser) throw new HttpsError('not-found', 'User not found');

    // Atomic balance update — single user transaction for consistency
    // Admin can debit into negative (for penalties, corrections, etc.)
    const txn = await db.ref(`users/${targetUid}`).transaction(user => {
        if (!user) return user;
        const currentBal = user[balanceField] || 0;
        user[balanceField] = action === 'CREDIT' ? currentBal + amount : currentBal - amount;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError('failed-precondition', 'Transaction failed — please retry');
    }

    const userAfterUpdate = txn.snapshot.val();
    const newBal = userAfterUpdate[balanceField] || 0;
    const oldBal = action === 'CREDIT' ? newBal - amount : newBal + amount;

    // Deposit record (for deposit wallet operations — keeps existing admin audit trail)
    if (!isWinning) {
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
    }

    // Wallet transaction — universal audit record for both wallet types
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: targetUid,
        userName: pUser.fullName || pUser.username || 'User',
        amount, type: action,
        isCredit: action === 'CREDIT',
        walletType: isWinning ? 'winning' : 'deposit',
        status: 'SUCCESS',
        reason: reason || '',
        description: `Admin ${action} (${walletLabel}): ₹${amount}`,
        balanceBefore: oldBal,
        balanceAfter: newBal,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        adminId: adminUid
    });

    return { success: true, newBalance: newBal, walletType: isWinning ? 'winning' : 'deposit' };
});

// ─── Admin Reject Withdrawal (with refund) ──────────────────

exports.adminRejectWithdrawal = onCall(async (request) => {
    const adminUid = await assertAdmin(request);
    const { withdrawalId, reason } = request.data;

    if (!withdrawalId) throw new HttpsError('invalid-argument', 'withdrawalId required');

    const wSnap = await db.ref('withdrawals/' + withdrawalId).once('value');
    const w = wSnap.val();
    if (!w) throw new HttpsError('not-found', 'Withdrawal not found');

    // Atomic claim — mark refundProcessed to prevent trigger from double-refunding
    const claimResult = await db.ref('withdrawals/' + withdrawalId).transaction(wd => {
        if (!wd) return wd;
        if (wd.refundProcessed) return; // Already refunded — abort
        wd.refundProcessed = true;
        wd.refundedAt = Date.now();
        return wd;
    });

    if (claimResult.committed) {
        // We claimed the refund — do the atomic balance credit
        await db.ref(`users/${w.userId}`).transaction(user => {
            if (!user) return user;
            user.winningBalance = (user.winningBalance || 0) + w.amount;
            user.walletBalance = (user.depositBalance || 0) + user.winningBalance;
            return user;
        });
    }

    // Update withdrawal status (this triggers onWithdrawalUpdate for logging + push)
    await db.ref('withdrawals/' + withdrawalId).update({
        status: 'REJECTED',
        processedAt: admin.database.ServerValue.TIMESTAMP,
        processedBy: adminUid,
        adminNote: reason || ''
    });

    // NOTE: Push notification & wallet_transaction logging are handled by
    // the onWithdrawalUpdate trigger in triggers.js — no need to duplicate here.

    return { success: true };
});

// ─── Admin Cancel Ludo Match ────────────────────────────────

exports.adminCancelLudoMatch = onCall(async (request) => {
    const adminUid = await assertAdmin(request);
    const { matchId, reason } = request.data;

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

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
        throw new HttpsError('failed-precondition', 'Cannot cancel');
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
    await sendPush(matchData.creator.uid, `🔄 Admin: Match #${shortIdAC} Cancelled — 🪙 ${matchData.amount} Refunded`, `Your 🪙 ${matchData.amount} Ludo match (#${shortIdAC}) was reviewed and cancelled by admin${reason ? ': ' + reason : ''}. Entry fee refunded.`, { type: 'LUDO_CANCELLED', matchId });
    if (matchData.acceptor?.uid) {
        await sendPush(matchData.acceptor.uid, `🔄 Admin: Match #${shortIdAC} Cancelled — 🪙 ${matchData.amount} Refunded`, `Your 🪙 ${matchData.amount} Ludo match (#${shortIdAC}) was reviewed and cancelled by admin${reason ? ': ' + reason : ''}. Entry fee refunded.`, { type: 'LUDO_CANCELLED', matchId });
    }

    return { success: true };
});

// ─── Admin Resolve Ludo Dispute Push ────────────────────────

exports.adminResolveLudoDispute = onCall(async (request) => {
    const adminUid = await assertAdmin(request);

    const { matchId, winnerId, resolution } = request.data;
    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    const matchRef = db.ref('ludo_matches/' + matchId);
    const matchSnap = await matchRef.once('value');
    const match = matchSnap.val();
    if (!match) throw new HttpsError('not-found', 'Match not found');

    // Prevent resolving already-resolved matches
    if (match.status === 'COMPLETED' || match.status === 'CANCELLED') {
        throw new HttpsError('failed-precondition', 'Match already resolved');
    }

    const creatorUid = match.creator?.uid;
    const acceptorUid = match.acceptor?.uid;
    const shortIdDR = matchId.slice(-6).toUpperCase();
    const amount = match.amount || 0;

    // Use dynamic commission rate (consistent with normal match flow)
    const commissionPercent = await getLudoCommission();

    // ── CASE 1: Admin declares a WINNER ──
    if (winnerId && (winnerId === creatorUid || winnerId === acceptorUid)) {
        const poolAmount = amount * 2;
        const commission = Math.floor(poolAmount * (commissionPercent / 100));
        const winAmount = poolAmount - commission;
        const loserUid = winnerId === creatorUid ? acceptorUid : creatorUid;

        // Credit winner's winning balance atomically
        await db.ref(`users/${winnerId}`).transaction(user => {
            if (!user) return user;
            user.winningBalance = (user.winningBalance || 0) + winAmount;
            user.walletBalance = (user.depositBalance || 0) + user.winningBalance;
            return user;
        });

        // Leaderboard stats — winner
        await db.ref(`users/${winnerId}`).update({
            'stats/ludoWinnings': admin.database.ServerValue.increment(winAmount),
            'stats/totalWinnings': admin.database.ServerValue.increment(winAmount),
            'stats/matchesWon': admin.database.ServerValue.increment(1),
            'stats/matchesPlayed': admin.database.ServerValue.increment(1)
        });
        // Leaderboard stats — loser
        if (loserUid) {
            await db.ref(`users/${loserUid}`).update({
                'stats/matchesPlayed': admin.database.ServerValue.increment(1)
            });
        }

        // Update match record
        await matchRef.update({
            status: 'COMPLETED',
            winner: winnerId,
            winAmount,
            commission,
            resolutionReason: resolution || 'Admin resolved dispute',
            resolvedBy: adminUid,
            completedAt: admin.database.ServerValue.TIMESTAMP
        });

        // Record wallet transaction
        const winnerName = winnerId === creatorUid
            ? (match.creator.ludoKingUsername || 'Player')
            : (match.acceptor.ludoKingUsername || 'Player');
        const txnKey = db.ref('wallet_transactions').push().key;
        await db.ref('wallet_transactions/' + txnKey).set({
            userId: winnerId, userName: winnerName, amount: winAmount,
            type: 'CREDIT', isCredit: true, reason: 'Ludo Dispute Won (Admin)',
            description: `Won Ludo 🪙 ${amount} challenge (dispute resolved by admin)`,
            ludoMatchId: matchId, status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // Update platform stats
        await db.ref('stats/ludoCommission').set(
            admin.database.ServerValue.increment(commission)
        );

        // Send push notifications
        const winnerMsg = `🏆 You won Match #${shortIdDR}! Admin reviewed the dispute and declared you the winner. 🪙 ${winAmount} credited to your wallet.`;
        const loserMsg = `Match #${shortIdDR} (🪙 ${amount}) dispute resolved. Admin declared your opponent as the winner after review.`;

        if (winnerId === creatorUid) {
            if (creatorUid) await sendPush(creatorUid, `✅ Dispute Resolved — Match #${shortIdDR}`, winnerMsg, { type: 'LUDO_DISPUTE_RESOLVED', matchId });
            if (acceptorUid) await sendPush(acceptorUid, `✅ Dispute Resolved — Match #${shortIdDR}`, loserMsg, { type: 'LUDO_DISPUTE_RESOLVED', matchId });
        } else {
            if (creatorUid) await sendPush(creatorUid, `✅ Dispute Resolved — Match #${shortIdDR}`, loserMsg, { type: 'LUDO_DISPUTE_RESOLVED', matchId });
            if (acceptorUid) await sendPush(acceptorUid, `✅ Dispute Resolved — Match #${shortIdDR}`, winnerMsg, { type: 'LUDO_DISPUTE_RESOLVED', matchId });
        }

        logEvent('adminResolveLudoDispute', 'info', `Dispute resolved — winner: ${winnerId}`, { matchId, winnerId, winAmount, adminUid });
        return { success: true, winAmount };
    }

    // ── CASE 2: Admin cancels with refund (no winner) ──
    // Refund both players
    await refundPlayer(match.creator, matchId, amount, 'Ludo Dispute Cancelled — Admin Refund');
    if (match.acceptor?.uid) {
        await refundPlayer(match.acceptor, matchId, amount, 'Ludo Dispute Cancelled — Admin Refund');
    }

    await matchRef.update({
        status: 'CANCELLED',
        cancelReason: resolution || 'Admin cancelled disputed match — both refunded',
        resolvedBy: adminUid,
        cancelledAt: admin.database.ServerValue.TIMESTAMP
    });

    const cancelMsg = `Match #${shortIdDR} (🪙 ${amount}) dispute resolved. ${resolution || 'Admin cancelled the match and refunded both players.'}`;
    if (creatorUid) await sendPush(creatorUid, `✅ Dispute Resolved — Match #${shortIdDR}`, cancelMsg, { type: 'LUDO_DISPUTE_RESOLVED', matchId });
    if (acceptorUid) await sendPush(acceptorUid, `✅ Dispute Resolved — Match #${shortIdDR}`, cancelMsg, { type: 'LUDO_DISPUTE_RESOLVED', matchId });

    logEvent('adminResolveLudoDispute', 'info', `Dispute cancelled & refunded`, { matchId, adminUid });
    return { success: true, refunded: true };
});

// ─── Public: Lookup email by mobile (for mobile login) ──────
// No auth required — needed before user can log in

exports.lookupEmailByMobile = onCall(async (request) => {
    let { mobile } = request.data;
    if (!mobile) {
        throw new HttpsError('invalid-argument', 'Mobile number required');
    }

    // Normalize: strip spaces, dashes, parens, +91, 91 prefix
    mobile = String(mobile).replace(/[\s\-\(\)]/g, '');
    if (mobile.startsWith('+91')) mobile = mobile.substring(3);
    else if (mobile.startsWith('91') && mobile.length === 12) mobile = mobile.substring(2);

    if (!/^[0-9]{10}$/.test(mobile)) {
        throw new HttpsError('invalid-argument', 'Valid 10-digit mobile required');
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
        throw new HttpsError('not-found', 'No account found with this mobile number');
    }

    let email = null;
    snap.forEach(child => { email = child.val().email; });

    if (!email) {
        throw new HttpsError('not-found', 'Account found but email is missing');
    }

    return { email };
});

// ─── Admin Ban/Suspend User ─────────────────────────────────

/**
 * Ban or warn a user. Supports:
 * - Permanent ban: duration = null
 * - Temp ban: duration = '1h', '24h', '7d', '30d'
 * - Warning: warning = true (auto-bans at 3 warnings)
 */
exports.adminBanUser = onCall(async (request) => {
    const adminUid = await assertAdmin(request);
    const { uid, reason, duration, warning } = request.data;

    if (!uid) throw new HttpsError('invalid-argument', 'User UID required');
    if (!reason) throw new HttpsError('invalid-argument', 'Reason required');

    const userRef = db.ref(`users/${uid}`);
    const userSnap = await userRef.once('value');
    if (!userSnap.exists()) throw new HttpsError('not-found', 'User not found');

    const userData = userSnap.val();
    const now = Date.now();

    if (warning) {
        // ── Issue Warning ──
        const currentWarnings = (userData.warningCount || 0) + 1;
        const updates = {
            warningCount: currentWarnings,
            lastWarningAt: now,
            lastWarningReason: reason
        };

        // Auto-ban at 3 warnings
        if (currentWarnings >= 3) {
            updates.isBlocked = true;
            updates.banReason = `Auto-banned: ${currentWarnings} warnings accumulated`;
            updates.bannedAt = now;
            updates.bannedBy = adminUid;
        }

        await userRef.update(updates);

        // Log to ban_history
        await db.ref(`ban_history/${uid}`).push({
            action: currentWarnings >= 3 ? 'AUTO_BAN' : 'WARNING',
            reason,
            warningNumber: currentWarnings,
            adminUid,
            timestamp: now
        });

        // Notify user
        const warnMsg = currentWarnings >= 3
            ? `⚠️ Your account has been suspended after ${currentWarnings} warnings. Reason: ${reason}`
            : `⚠️ Warning ${currentWarnings}/3: ${reason}. Your account may be suspended if warnings continue.`;
        await sendPush(uid, '⚠️ Account Warning', warnMsg, { type: 'ACCOUNT_WARNING' });

        return {
            success: true,
            action: currentWarnings >= 3 ? 'AUTO_BAN' : 'WARNING',
            warningCount: currentWarnings
        };
    }

    // ── Issue Ban (Permanent or Temp) ──
    const durationMap = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
    };

    const banDurationMs = duration ? durationMap[duration] : null;
    if (duration && !banDurationMs) {
        throw new HttpsError('invalid-argument',
            `Invalid duration. Use: ${Object.keys(durationMap).join(', ')} or omit for permanent`);
    }

    const banUpdate = {
        isBlocked: true,
        banReason: reason,
        bannedAt: now,
        bannedBy: adminUid
    };

    if (banDurationMs) {
        banUpdate.banExpiresAt = now + banDurationMs;
    } else {
        banUpdate.banExpiresAt = null; // Permanent
    }

    await userRef.update(banUpdate);

    // Log to ban_history
    await db.ref(`ban_history/${uid}`).push({
        action: 'BAN',
        reason,
        duration: duration || 'PERMANENT',
        expiresAt: banUpdate.banExpiresAt || null,
        adminUid,
        timestamp: now
    });

    // Notify user
    const banMsg = banDurationMs
        ? `Your account has been suspended for ${duration}. Reason: ${reason}`
        : `Your account has been permanently suspended. Reason: ${reason}`;
    await sendPush(uid, '🚫 Account Suspended', banMsg, { type: 'ACCOUNT_BANNED' });

    return {
        success: true,
        action: 'BAN',
        duration: duration || 'PERMANENT',
        expiresAt: banUpdate.banExpiresAt || null
    };
});

// ─── Admin Unban User ───────────────────────────────────────

exports.adminUnbanUser = onCall(async (request) => {
    const adminUid = await assertAdmin(request);
    const { uid, reason } = request.data;

    if (!uid) throw new HttpsError('invalid-argument', 'User UID required');

    const userRef = db.ref(`users/${uid}`);
    const userSnap = await userRef.once('value');
    if (!userSnap.exists()) throw new HttpsError('not-found', 'User not found');

    await userRef.update({
        isBlocked: false,
        banReason: null,
        banExpiresAt: null,
        bannedAt: null,
        bannedBy: null
    });

    // Log to ban_history
    await db.ref(`ban_history/${uid}`).push({
        action: 'UNBAN',
        reason: reason || 'Unbanned by admin',
        adminUid,
        timestamp: Date.now()
    });

    // Notify user
    await sendPush(uid, '✅ Account Restored', 'Your account suspension has been lifted.', { type: 'ACCOUNT_UNBANNED' });

    return { success: true };
});
