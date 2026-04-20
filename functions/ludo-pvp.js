/**
 * ludo-pvp.js — Real-Time P2P Ludo Match Cloud Functions
 *
 * Handles wallet integration for real-time matches between two players.
 * Creates a shared game room in Firebase RTDB for state synchronization.
 *
 * Exports: startLudoPvPMatch, completeLudoPvPMatch
 */

const {
    admin, db,
    onCall, HttpsError,
    assertAuth, deductBalance, getLudoCommission, assertNotBanned,
    sendPush, checkAndCreditReferral,
    logEvent
} = require('./helpers');

const VALID_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// Initial piece positions: -1 = in base (not on board), matches engine POS_BASE
const INITIAL_PIECES = [-1, -1, -1, -1];

// ─── 1. Start PvP Match ─────────────────────────────────────
// Called by the JOINER (player who claimed the queue entry).
// Deducts balance from both players, creates a shared game room.

exports.startLudoPvPMatch = onCall(async (request) => {
    const joinerUid = assertAuth(request);
    await assertNotBanned(joinerUid);

    const { opponentUid, amount, joinerName, opponentName } = request.data;

    // Validate inputs
    if (!opponentUid || typeof opponentUid !== 'string') {
        throw new HttpsError('invalid-argument', 'opponentUid is required');
    }
    if (!amount || !VALID_AMOUNTS.includes(amount)) {
        throw new HttpsError('invalid-argument',
            `Invalid amount. Must be one of: ${VALID_AMOUNTS.join(', ')}`);
    }
    if (joinerUid === opponentUid) {
        throw new HttpsError('invalid-argument', 'Cannot play against yourself');
    }

    // Deduct balance from JOINER
    const joinerDeduction = await deductBalance(joinerUid, amount);
    if (!joinerDeduction) {
        throw new HttpsError('failed-precondition',
            'Insufficient balance. Please add funds.');
    }

    // Deduct balance from HOST (opponent)
    const hostDeduction = await deductBalance(opponentUid, amount);
    if (!hostDeduction) {
        // Refund joiner since host can't pay
        await db.ref(`users/${joinerUid}`).transaction(user => {
            if (!user) return user;
            user.depositBalance = (user.depositBalance || 0) + joinerDeduction.depositDeducted;
            user.winningBalance = (user.winningBalance || 0) + joinerDeduction.winningDeducted;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        });
        throw new HttpsError('failed-precondition',
            'Opponent has insufficient balance. Match cancelled.');
    }

    // Calculate commission
    const commissionPercent = await getLudoCommission();
    const poolAmount = amount * 2;
    const commission = Math.floor(poolAmount * (commissionPercent / 100));
    const winAmount = poolAmount - commission;

    // Create match room
    const roomRef = db.ref('ludo_rooms').push();
    const matchId = roomRef.key;

    // HOST = RED (first to queue), JOINER = BLUE (claimed the entry)
    const roomData = {
        matchId,
        redUid: opponentUid,
        blueUid: joinerUid,
        redName: opponentName || 'Player',
        blueName: joinerName || 'Player',
        amount,
        commissionPercent,
        commission,
        winAmount,
        status: 'IN_PROGRESS',
        currentTurn: 'RED',
        diceValue: null,
        mustRollDice: true,
        consecutiveSixes: 0,
        players: {
            RED: { pieces: INITIAL_PIECES },
            BLUE: { pieces: INITIAL_PIECES }
        },
        lastMove: null,
        winner: null,
        createdAt: admin.database.ServerValue.TIMESTAMP
    };

    await roomRef.set(roomData);

    // Log wallet transactions for both players
    const timestamp = admin.database.ServerValue.TIMESTAMP;

    const joinerTxnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + joinerTxnKey).set({
        userId: joinerUid,
        amount,
        type: 'DEBIT',
        isCredit: false,
        reason: `Ludo Arena Entry (🪙 ${amount})`,
        description: 'Ludo Arena Entry',
        ludoPvPMatchId: matchId,
        depositDeducted: joinerDeduction.depositDeducted,
        winningDeducted: joinerDeduction.winningDeducted,
        status: 'SUCCESS',
        timestamp
    });

    const hostTxnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + hostTxnKey).set({
        userId: opponentUid,
        amount,
        type: 'DEBIT',
        isCredit: false,
        reason: `Ludo Arena Entry (🪙 ${amount})`,
        description: 'Ludo Arena Entry',
        ludoPvPMatchId: matchId,
        depositDeducted: hostDeduction.depositDeducted,
        winningDeducted: hostDeduction.winningDeducted,
        status: 'SUCCESS',
        timestamp
    });

    // Update stats for both
    await db.ref(`users/${joinerUid}/stats/matchesPlayed`).set(
        admin.database.ServerValue.increment(1)
    );
    await db.ref(`users/${opponentUid}/stats/matchesPlayed`).set(
        admin.database.ServerValue.increment(1)
    );

    logEvent('startLudoPvPMatch', 'info',
        `PvP match started: ${opponentUid} (RED) vs ${joinerUid} (BLUE)`,
        { matchId, amount, redUid: opponentUid, blueUid: joinerUid });

    return {
        success: true,
        matchId,
        winAmount
    };
});

// ─── 2. Complete PvP Match ──────────────────────────────────
// Called by the client when a game ends (winner determined locally).
// Uses a transaction to prevent double-completion.

exports.completeLudoPvPMatch = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId, winner } = request.data;

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');
    if (!winner || !['RED', 'BLUE'].includes(winner)) {
        throw new HttpsError('invalid-argument', 'winner must be RED or BLUE');
    }

    const roomRef = db.ref('ludo_rooms/' + matchId);

    // Atomically complete the match
    const txn = await roomRef.transaction(room => {
        if (!room) return null;
        // Verify caller is a participant
        if (room.redUid !== uid && room.blueUid !== uid) return;
        // Prevent double-completion
        if (room.status !== 'IN_PROGRESS') return;

        room.status = 'COMPLETED';
        room.winner = winner;
        room.completedAt = Date.now();
        return room;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError('failed-precondition',
            'Match not found, already completed, or unauthorized');
    }

    const room = txn.snapshot.val();
    const winnerUid = winner === 'RED' ? room.redUid : room.blueUid;
    const loserUid = winner === 'RED' ? room.blueUid : room.redUid;
    const winAmount = room.winAmount;

    // Credit winner's winning balance
    await db.ref(`users/${winnerUid}`).transaction(user => {
        if (!user) return user;
        user.winningBalance = (user.winningBalance || 0) + winAmount;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    });

    // Log wallet transaction (credit)
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: winnerUid,
        amount: winAmount,
        type: 'CREDIT',
        isCredit: true,
        reason: `Ludo Arena Won (🪙 ${winAmount})`,
        description: 'Ludo Arena Won',
        ludoPvPMatchId: matchId,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Check referrals for both
    checkAndCreditReferral(winnerUid).catch(() => { });
    checkAndCreditReferral(loserUid).catch(() => { });

    logEvent('completeLudoPvPMatch', 'info',
        `PvP match completed: ${winnerUid} wins`,
        { matchId, winner, winnerUid, loserUid, winAmount });

    return { success: true, winner, winnerUid, winAmount };
});
