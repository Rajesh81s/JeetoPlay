/**
 * ludo-ai.js — In-App Ludo AI Match Cloud Functions
 *
 * Handles wallet integration for Ludo matches played against AI inside the app.
 * Separate from the existing P2P ludo.js (Ludo King matches).
 *
 * Exports: startLudoAIMatch, completeLudoAIMatch
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, deductBalance, getLudoCommission, assertNotBanned,
    logEvent
} = require('./helpers');

// Valid bet amounts
const VALID_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// ─── 1. Start Ludo AI Match ─────────────────────────────────

exports.startLudoAIMatch = onCall(async (request) => {
    const uid = assertAuth(request);
    await assertNotBanned(uid);

    const { amount } = request.data;

    // Validate amount
    if (!amount || !VALID_AMOUNTS.includes(amount)) {
        throw new HttpsError('invalid-argument',
            `Invalid amount. Must be one of: ${VALID_AMOUNTS.join(', ')}`);
    }

    // Deduct balance (deposit first, then winning)
    const deduction = await deductBalance(uid, amount);
    if (!deduction) {
        throw new HttpsError('failed-precondition',
            'Insufficient balance. Please add funds to your wallet.');
    }

    // Get commission rate
    const commissionPercent = await getLudoCommission();
    const poolAmount = amount * 2; // Player bet + "AI bet" (house money)
    const commission = Math.floor(poolAmount * (commissionPercent / 100));
    const winAmount = poolAmount - commission;

    // Create match record
    const matchRef = db.ref('ludo_ai_matches').push();
    const matchId = matchRef.key;

    await matchRef.set({
        uid,
        amount,
        status: 'IN_PROGRESS',
        winner: null,
        commissionPercent,
        commission,
        winAmount,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        completedAt: null
    });

    // Log wallet transaction (debit)
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: uid,
        amount,
        type: 'DEBIT',
        isCredit: false,
        reason: `Ludo Arena Entry (🪙 ${amount})`,
        description: `Ludo Arena Entry`,
        ludoAIMatchId: matchId,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Update stats
    await db.ref(`users/${uid}/stats/matchesPlayed`).set(
        admin.database.ServerValue.increment(1)
    );

    logEvent('startLudoAIMatch', 'info', `Match started for ${uid}`, { uid, matchId, amount });

    return {
        success: true,
        matchId,
        winAmount,
        balanceAfter: {
            deposit: deduction.userAfter.depositBalance || 0,
            winning: deduction.userAfter.winningBalance || 0,
            total: deduction.userAfter.walletBalance || 0
        }
    };
});

// ─── 2. Complete Ludo AI Match ──────────────────────────────

exports.completeLudoAIMatch = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId, winner } = request.data;

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');
    if (!winner || !['PLAYER', 'AI'].includes(winner)) {
        throw new HttpsError('invalid-argument', 'winner must be PLAYER or AI');
    }

    const matchRef = db.ref('ludo_ai_matches/' + matchId);

    // Atomically complete the match (prevent double-completion)
    const txn = await matchRef.transaction(match => {
        if (!match) return null;
        if (match.uid !== uid) return; // Abort — not the match owner
        if (match.status !== 'IN_PROGRESS') return; // Abort — already completed
        match.status = 'COMPLETED';
        match.winner = winner;
        match.completedAt = Date.now();
        return match;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError('failed-precondition',
            'Match not found, already completed, or unauthorized');
    }

    const match = txn.snapshot.val();

    // If player won — credit winning balance
    if (winner === 'PLAYER') {
        const winAmount = match.winAmount;

        await db.ref(`users/${uid}`).transaction(user => {
            if (!user) return user;
            user.winningBalance = (user.winningBalance || 0) + winAmount;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        });

        // Log wallet transaction (credit)
        const txnKey = db.ref('wallet_transactions').push().key;
        await db.ref('wallet_transactions/' + txnKey).set({
            userId: uid,
            amount: winAmount,
            type: 'CREDIT',
            isCredit: true,
            reason: `Ludo Arena Won (🪙 ${winAmount})`,
            description: `Ludo Arena Won`,
            ludoAIMatchId: matchId,
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        logEvent('completeLudoAIMatch', 'info', `Player won match ${matchId}`, { uid, matchId, winner, winAmount });

        return { success: true, winner: 'PLAYER', winAmount };
    }

    // AI won — no credit, money stays with platform
    logEvent('completeLudoAIMatch', 'info', `AI won match ${matchId}`, { uid, matchId, winner: 'AI', lostAmount: match.amount });

    return { success: true, winner: 'AI', lostAmount: match.amount };
});
