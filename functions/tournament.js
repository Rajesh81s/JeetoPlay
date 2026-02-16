/**
 * tournament.js — Tournament Cloud Functions
 * 
 * Secure, server-side tournament operations for user-facing actions.
 * Admin actions (create, bracket gen, result submission) are handled
 * directly via Firebase client SDK in admin_panel.html.
 * 
 * Exports:
 *   registerForTournament    — User joins a tournament (deducts entry fee)
 *   unregisterFromTournament — User leaves during REGISTRATION phase (refund)
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, sendPush, deductBalance, checkRateLimit, assertNotBanned, logEvent
} = require('./helpers');

// ─── Register For Tournament ────────────────────────────────

exports.registerForTournament = onCall(async (request) => {
    const uid = assertAuth(request);
    const { tournamentId, ign } = request.data;

    // Rate limit: max 5 registration attempts per 5 minutes
    await checkRateLimit(uid, 'tournament_register', 5, 5 * 60 * 1000);

    // Ban check
    await assertNotBanned(uid);

    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
    if (!ign || typeof ign !== 'string' || ign.trim().length < 2) {
        throw new HttpsError('invalid-argument', 'Valid IGN required (min 2 chars)');
    }

    const tournRef = db.ref('tournaments/' + tournamentId);

    // Atomically register the participant
    const txn = await tournRef.transaction(tournament => {
        if (!tournament) return null; // Retry on cold start

        // Validate status
        if (tournament.status !== 'REGISTRATION') return; // Abort

        // Validate registration window
        const now = Date.now();
        if (now < tournament.registrationOpens) return; // Not open yet
        if (now >= tournament.registrationCloses) return; // Closed

        // Check capacity
        if (!tournament.participants) tournament.participants = {};
        const currentCount = Object.keys(tournament.participants).length;
        if (currentCount >= tournament.maxParticipants) return; // Full

        // Check if already registered
        if (tournament.participants[uid]) return; // Already in

        // Register
        tournament.participants[uid] = {
            ign: ign.trim(),
            registeredAt: now,
            uid: uid
        };
        tournament.registeredCount = currentCount + 1;

        return tournament;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError(
            'failed-precondition',
            'Registration failed. Tournament may be full, closed, or you are already registered.'
        );
    }

    const tournamentData = txn.snapshot.val();
    const entryFee = tournamentData.entryFee || 0;

    // Deduct entry fee atomically (if > 0)
    if (entryFee > 0) {
        const deduction = await deductBalance(uid, entryFee);
        if (!deduction) {
            // Rollback registration
            await tournRef.transaction(t => {
                if (!t) return null;
                if (t.participants && t.participants[uid]) {
                    delete t.participants[uid];
                    t.registeredCount = Math.max(0, (t.registeredCount || 1) - 1);
                }
                return t;
            });
            throw new HttpsError(
                'failed-precondition',
                `Insufficient balance. Entry fee: 🪙 ${entryFee}`
            );
        }

        // Record deposit and winning amounts deducted for precise refunds
        await tournRef.child(`participants/${uid}`).update({
            depositDeducted: deduction.depositDeducted,
            winningDeducted: deduction.winningDeducted,
            confirmed: true
        });

        // Log transaction
        await db.ref('wallet_transactions').push({
            userId: uid,
            userName: deduction.userAfter.fullName || deduction.userAfter.username || 'User',
            amount: entryFee,
            type: 'DEBIT',
            isCredit: false,
            description: `Tournament Entry: ${tournamentData.title || 'Tournament'}`,
            reason: `Joined Tournament: ${tournamentData.title || tournamentId}`,
            gameName: tournamentData.gameName || '',
            tournamentId: tournamentId,
            depositDeducted: deduction.depositDeducted,
            winningDeducted: deduction.winningDeducted,
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        // Send notification
        const shortId = tournamentId.slice(-6).toUpperCase();
        sendPush(
            uid,
            `🏆 Tournament Registered — ${tournamentData.gameName || 'Tournament'}`,
            `You're in "${tournamentData.title}"! 🪙 ${entryFee} deducted. ${tournamentData.registeredCount}/${tournamentData.maxParticipants} slots filled. Good luck!`,
            { type: 'TOURNAMENT_REGISTERED', tournamentId }
        ).catch(() => { });

        return {
            success: true,
            depositDeducted: deduction.depositDeducted,
            winningDeducted: deduction.winningDeducted,
            newDepositBalance: deduction.userAfter.depositBalance || 0,
            newWinningBalance: deduction.userAfter.winningBalance || 0
        };
    } else {
        // Free tournament — no balance deduction needed
        await tournRef.child(`participants/${uid}`).update({ confirmed: true });

        sendPush(
            uid,
            `🏆 Tournament Registered — ${tournamentData.gameName || 'Tournament'}`,
            `You're in "${tournamentData.title}"! Free entry. ${tournamentData.registeredCount}/${tournamentData.maxParticipants} slots filled. Good luck!`,
            { type: 'TOURNAMENT_REGISTERED', tournamentId }
        ).catch(() => { });

        return {
            success: true,
            depositDeducted: 0,
            winningDeducted: 0,
            newDepositBalance: 0,
            newWinningBalance: 0
        };
    }
});

// ─── Unregister From Tournament ─────────────────────────────

exports.unregisterFromTournament = onCall(async (request) => {
    const uid = assertAuth(request);
    const { tournamentId } = request.data;
    logEvent('unregisterFromTournament', 'info', 'Unregistration attempt', { uid, tournamentId });

    // Rate limit
    await checkRateLimit(uid, 'tournament_unregister', 5, 5 * 60 * 1000);

    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');

    const tournRef = db.ref('tournaments/' + tournamentId);
    const snap = await tournRef.once('value');
    if (!snap.exists()) {
        throw new HttpsError('not-found', 'Tournament not found');
    }

    const tournament = snap.val();

    // Can only unregister during REGISTRATION phase
    if (tournament.status !== 'REGISTRATION') {
        throw new HttpsError(
            'failed-precondition',
            'Cannot unregister after registration has closed.'
        );
    }

    // Check if user is registered
    const participant = tournament.participants?.[uid];
    if (!participant) {
        throw new HttpsError('not-found', 'You are not registered in this tournament');
    }

    const entryFee = tournament.entryFee || 0;

    // STEP 1: Remove participant FIRST (atomic) — prevents refund-without-removal race
    const removeResult = await tournRef.transaction(t => {
        if (!t) return null;
        // Re-validate status inside transaction (may have changed since read)
        if (t.status !== 'REGISTRATION') return; // Abort
        if (t.participants && t.participants[uid]) {
            delete t.participants[uid];
            t.registeredCount = Math.max(0, (t.registeredCount || 1) - 1);
        }
        return t;
    }, undefined, false);

    if (!removeResult.committed) {
        throw new HttpsError(
            'failed-precondition',
            'Cannot unregister — tournament status may have changed.'
        );
    }

    // STEP 2: Refund entry fee using precise deposit/winning split
    if (entryFee > 0) {
        const depositRefund = participant.depositDeducted || 0;
        const winningRefund = participant.winningDeducted || 0;

        const refundPromises = [];

        // Legacy fallback: if no split data recorded, refund full amount to deposit (conservative)
        const depRefund = (depositRefund === 0 && winningRefund === 0) ? entryFee : depositRefund;
        const winRefund = (depositRefund === 0 && winningRefund === 0) ? 0 : winningRefund;

        await db.ref(`users/${uid}`).transaction(user => {
            if (!user) return user;
            if (depRefund > 0) user.depositBalance = (user.depositBalance || 0) + depRefund;
            if (winRefund > 0) user.winningBalance = (user.winningBalance || 0) + winRefund;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        });

        // Log refund transaction
        await db.ref('wallet_transactions').push({
            userId: uid,
            amount: entryFee,
            type: 'TOURNAMENT_REFUND',
            isCredit: true,
            description: `Tournament Withdrawal: ${tournament.title || 'Tournament'}`,
            reason: `Left Tournament: ${tournament.title || tournamentId}`,
            tournamentId: tournamentId,
            depositRefunded: depositRefund,
            winningRefunded: winningRefund,
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });
    }

    // Send notification
    sendPush(
        uid,
        `Tournament Left — ${tournament.gameName || 'Tournament'}`,
        entryFee > 0
            ? `You left "${tournament.title}". 🪙 ${entryFee} has been refunded to your wallet.`
            : `You left "${tournament.title}".`,
        { type: 'TOURNAMENT_UNREGISTERED', tournamentId }
    ).catch(() => { });

    return {
        success: true,
        refundedAmount: entryFee,
        message: entryFee > 0 ? `🪙 ${entryFee} refunded to your wallet` : 'Unregistered successfully'
    };
});
