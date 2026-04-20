/**
 * ludo.js — Ludo game Cloud Functions
 * Exports: submitLudoResult, cancelLudoMatch, createLudoChallenge, acceptLudoChallenge
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, sendPush, getLudoCommission,
    deductBalance, refundPlayer, countUserLudoMatches, checkAndCreditReferral, assertNotBanned,
    logEvent
} = require('./helpers');

// ─── 1. Submit Ludo Result (LOST / WON / DISPUTE) ──────────

exports.submitLudoResult = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId, resultType, screenshotUrl } = request.data;

    // ── Server-side ban enforcement ──
    await assertNotBanned(uid);

    if (!matchId || !resultType) throw new HttpsError('invalid-argument', 'matchId and resultType required');
    logEvent('submitLudoResult', 'info', `${resultType} submitted`, { uid, matchId, resultType });

    const matchRef = db.ref('ludo_matches/' + matchId);

    // ── LOST ──────────────────────────────────
    if (resultType === 'LOST') {
        // Atomically claim the match to prevent race conditions
        const matchTxn = await matchRef.transaction(match => {
            if (!match) return null;
            if (!['ROOM_SHARED', 'IN_PROGRESS'].includes(match.status)) return; // Abort
            match.status = 'COMPLETING'; // Intermediate state to prevent races
            return match;
        }, undefined, false);

        if (!matchTxn.committed) {
            throw new HttpsError('failed-precondition', 'Cannot submit result in current state');
        }

        const match = matchTxn.snapshot.val();

        const isCreator = match.creator?.uid === uid;
        const isAcceptor = match.acceptor?.uid === uid;
        if (!isCreator && !isAcceptor) throw new HttpsError('permission-denied', 'Not a participant');

        const winnerUid = isCreator ? match.acceptor?.uid : match.creator?.uid;
        if (!winnerUid) throw new HttpsError('failed-precondition', 'Opponent not found');

        const role = isCreator ? 'creator' : 'acceptor';
        const commissionPercent = await getLudoCommission();
        const poolAmount = match.amount * 2;
        const commission = Math.floor(poolAmount * (commissionPercent / 100));
        const winAmount = poolAmount - commission;

        // Credit winner's winning balance + sync walletBalance atomically
        await db.ref(`users/${winnerUid}`).transaction(user => {
            if (!user) return user;
            user.winningBalance = (user.winningBalance || 0) + winAmount;
            user.walletBalance = (user.depositBalance || 0) + user.winningBalance;
            return user;
        });

        // Leaderboard stats — winner
        const autoWinStats = {};
        autoWinStats['stats/ludoWinnings'] = admin.database.ServerValue.increment(winAmount);
        autoWinStats['stats/totalWinnings'] = admin.database.ServerValue.increment(winAmount);
        autoWinStats['stats/matchesWon'] = admin.database.ServerValue.increment(1);
        autoWinStats['stats/matchesPlayed'] = admin.database.ServerValue.increment(1);
        await db.ref(`users/${winnerUid}`).update(autoWinStats);
        // Leaderboard stats — loser
        await db.ref(`users/${uid}`).update({ 'stats/matchesPlayed': admin.database.ServerValue.increment(1) });

        await matchRef.update({
            [`result/${role}`]: {
                type: 'LOST',
                screenshotUrl: screenshotUrl || null,
                submittedAt: admin.database.ServerValue.TIMESTAMP
            },
            status: 'COMPLETED',
            winner: winnerUid,
            winAmount,
            commission,
            resolutionReason: 'Opponent admitted defeat',
            completedAt: admin.database.ServerValue.TIMESTAMP
        });

        const winnerName = isCreator
            ? (match.acceptor.ludoKingUsername || 'Player')
            : (match.creator.ludoKingUsername || 'Player');
        const txnKey = db.ref('wallet_transactions').push().key;
        await db.ref('wallet_transactions/' + txnKey).set({
            userId: winnerUid, userName: winnerName, amount: winAmount,
            type: 'CREDIT', isCredit: true, reason: 'Ludo Match Won',
            description: `Won Ludo 🪙 ${match.amount} challenge`,
            ludoMatchId: matchId, status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        const shortId = matchId.slice(-6).toUpperCase();
        await sendPush(winnerUid, `🏆 You Won 🪙 ${winAmount}! #${shortId}`, `Your opponent admitted defeat in the 🪙 ${match.amount} Ludo match. 🪙 ${winAmount} winnings credited to your wallet instantly!`, { type: 'LUDO_WON', matchId, amount: String(winAmount) });

        // Check referral completion for both players
        checkAndCreditReferral(uid).catch(() => { });
        checkAndCreditReferral(winnerUid).catch(() => { });

        return { success: true, winAmount };
    }

    // ── WON ──────────────────────────────────
    if (resultType === 'WON') {
        const snap = await matchRef.once('value');
        const match = snap.val();
        if (!match) throw new HttpsError('not-found', 'Match not found');
        if (!['ROOM_SHARED', 'IN_PROGRESS'].includes(match.status)) {
            throw new HttpsError('failed-precondition', 'Cannot submit result in current state');
        }

        const isCreator = match.creator?.uid === uid;
        const isAcceptor = match.acceptor?.uid === uid;
        if (!isCreator && !isAcceptor) throw new HttpsError('permission-denied', 'Not a participant');

        const role = isCreator ? 'creator' : 'acceptor';
        const opponentResult = isCreator ? match.result?.acceptor : match.result?.creator;
        const resultData = {
            type: 'WON',
            screenshotUrl: screenshotUrl || null,
            submittedAt: admin.database.ServerValue.TIMESTAMP
        };

        // Opponent already said LOST — auto-resolve (this player wins)
        if (opponentResult?.type === 'LOST') {
            const commissionPercent = await getLudoCommission();
            const poolAmount = match.amount * 2;
            const commission = Math.floor(poolAmount * (commissionPercent / 100));
            const winAmount = poolAmount - commission;

            await db.ref(`users/${uid}`).transaction(user => {
                if (!user) return user;
                user.winningBalance = (user.winningBalance || 0) + winAmount;
                user.walletBalance = (user.depositBalance || 0) + user.winningBalance;
                return user;
            });

            // Leaderboard stats — winner
            const autoWinStats = {};
            autoWinStats['stats/ludoWinnings'] = admin.database.ServerValue.increment(winAmount);
            autoWinStats['stats/totalWinnings'] = admin.database.ServerValue.increment(winAmount);
            autoWinStats['stats/matchesWon'] = admin.database.ServerValue.increment(1);
            autoWinStats['stats/matchesPlayed'] = admin.database.ServerValue.increment(1);
            await db.ref(`users/${uid}`).update(autoWinStats);
            // Leaderboard stats — loser
            const loserUid = isCreator ? match.acceptor?.uid : match.creator?.uid;
            if (loserUid) await db.ref(`users/${loserUid}`).update({ 'stats/matchesPlayed': admin.database.ServerValue.increment(1) });

            await matchRef.update({
                status: 'COMPLETED', winner: uid,
                winAmount, commission,
                resolutionReason: 'Auto-resolved',
                completedAt: admin.database.ServerValue.TIMESTAMP
            });

            const winnerName = isCreator
                ? (match.creator.ludoKingUsername || 'Player')
                : (match.acceptor.ludoKingUsername || 'Player');
            const txnKey = db.ref('wallet_transactions').push().key;
            await db.ref('wallet_transactions/' + txnKey).set({
                userId: uid, userName: winnerName, amount: winAmount,
                type: 'CREDIT', isCredit: true, reason: 'Ludo Match Won',
                description: `Won Ludo 🪙 ${match.amount} challenge`,
                ludoMatchId: matchId, status: 'SUCCESS',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });

            const shortId2 = matchId.slice(-6).toUpperCase();
            await sendPush(uid, `🏆 You Won 🪙 ${winAmount}! #${shortId2}`, `Your opponent admitted defeat in the 🪙 ${match.amount} Ludo match. 🪙 ${winAmount} winnings credited to your wallet instantly!`, { type: 'LUDO_WON', matchId, amount: String(winAmount) });

            // Check referral completion for both players
            const opponentUid2 = isCreator ? match.acceptor?.uid : match.creator?.uid;
            checkAndCreditReferral(uid).catch(() => { });
            if (opponentUid2) checkAndCreditReferral(opponentUid2).catch(() => { });

            return { success: true, autoResolved: true, winAmount };
        }

        const updateData = { [`result/${role}`]: resultData };

        // Both claimed WON → DISPUTE
        if (opponentResult?.type === 'WON') {
            updateData.status = 'DISPUTED';
            updateData.disputeReason = 'Both players claimed to have won';
            updateData.disputedAt = admin.database.ServerValue.TIMESTAMP;

            const disputeKey = db.ref('disputes').push().key;
            await db.ref('disputes/' + disputeKey).set({
                matchId, type: 'LUDO', status: 'OPEN',
                reason: 'Both players claimed to have won',
                creatorUid: match.creator.uid,
                acceptorUid: match.acceptor.uid,
                amount: match.amount,
                createdAt: admin.database.ServerValue.TIMESTAMP
            });
        }

        // Opponent already submitted WON or DISPUTE → conflict → admin review
        if (opponentResult?.type === 'WON' || opponentResult?.type === 'DISPUTE') {
            updateData.status = 'DISPUTED';
            updateData.disputedAt = admin.database.ServerValue.TIMESTAMP;
            // Clean up pending dispute flags since it's now fully disputed
            updateData.pendingDispute = null;
            updateData.pendingDisputeBy = null;

            // Create dispute record if not already created for WON vs WON
            if (opponentResult?.type === 'DISPUTE') {
                // Opponent disputed, this player claimed WON → admin must decide
                const disputeKey = db.ref('disputes').push().key;
                await db.ref('disputes/' + disputeKey).set({
                    matchId, type: 'LUDO', status: 'OPEN',
                    reason: `One player claims WON, opponent raised dispute`,
                    creatorUid: match.creator.uid,
                    acceptorUid: match.acceptor.uid,
                    amount: match.amount,
                    createdAt: admin.database.ServerValue.TIMESTAMP
                });
            }
        } else {
            // First submission — set deadline for opponent
            updateData.disputeDeadline = Date.now() + (2 * 60 * 60 * 1000);
        }

        await matchRef.update(updateData);

        const opponentUid = isCreator ? match.acceptor?.uid : match.creator?.uid;
        const shortId3 = matchId.slice(-6).toUpperCase();
        if (opponentUid) {
            const msg = opponentResult?.type === 'WON'
                ? `⚠️ Both players claimed victory in Match #${shortId3} (🪙 ${match.amount}). Dispute created — admin will review within 24 hours.`
                : opponentResult?.type === 'DISPUTE'
                    ? `⚠️ Your opponent claims WON in Match #${shortId3} (🪙 ${match.amount}) despite your dispute. Admin will review within 24 hours.`
                    : `⚔️ Your opponent submitted their result for Match #${shortId3} (🪙 ${match.amount}). Submit yours within 2 hours!`;
            await sendPush(opponentUid, `🎯 Result Update — #${shortId3}`, msg, { type: 'LUDO_RESULT', matchId });
        }

        return { success: true, disputed: opponentResult?.type === 'WON' || opponentResult?.type === 'DISPUTE' };
    }

    // ── DISPUTE ─────────────────────────────
    if (resultType === 'DISPUTE') {
        const snap = await matchRef.once('value');
        const match = snap.val();
        if (!match) throw new HttpsError('not-found', 'Match not found');
        if (!['ROOM_SHARED', 'IN_PROGRESS'].includes(match.status)) {
            throw new HttpsError('failed-precondition', 'Cannot dispute in current state');
        }

        const isCreator = match.creator?.uid === uid;
        const isAcceptor = match.acceptor?.uid === uid;
        if (!isCreator && !isAcceptor) throw new HttpsError('permission-denied', 'Not a participant');

        const role = isCreator ? 'creator' : 'acceptor';
        const opponentResult = isCreator ? match.result?.acceptor : match.result?.creator;
        const resultData = {
            type: 'DISPUTE',
            screenshotUrl: screenshotUrl || null,
            submittedAt: admin.database.ServerValue.TIMESTAMP
        };

        // BOTH players raised DISPUTE → auto-cancel with full refunds
        if (opponentResult?.type === 'DISPUTE') {
            await matchRef.child(`result/${role}`).set(resultData);

            // Refund both players
            await refundPlayer(match.creator, matchId, match.amount, 'Ludo Match Cancelled - Both Disputed');
            await refundPlayer(match.acceptor, matchId, match.amount, 'Ludo Match Cancelled - Both Disputed');

            await matchRef.update({
                status: 'CANCELLED',
                cancelReason: 'Both players raised dispute - auto-cancelled with refunds',
                cancelledAt: admin.database.ServerValue.TIMESTAMP
            });

            const shortId4 = matchId.slice(-6).toUpperCase();
            await sendPush(match.creator.uid, `🔄 Match #${shortId4} Cancelled — 🪙 ${match.amount} Refunded`, `Both players disputed Match #${shortId4} (🪙 ${match.amount}). Full refund credited to your wallet.`, { type: 'LUDO_CANCELLED', matchId });
            await sendPush(match.acceptor.uid, `🔄 Match #${shortId4} Cancelled — 🪙 ${match.amount} Refunded`, `Both players disputed Match #${shortId4} (🪙 ${match.amount}). Full refund credited to your wallet.`, { type: 'LUDO_CANCELLED', matchId });

            return { success: true, dualDispute: true };
        }

        // Case 1: Opponent already submitted WON → conflicting results → admin review
        if (opponentResult?.type === 'WON') {
            await matchRef.update({
                [`result/${role}`]: resultData,
                status: 'DISPUTED',
                disputeReason: `${isCreator ? 'Creator' : 'Acceptor'} raised dispute against opponent's WON claim`,
                disputedAt: admin.database.ServerValue.TIMESTAMP
            });

            const disputeKey = db.ref('disputes').push().key;
            await db.ref('disputes/' + disputeKey).set({
                matchId, type: 'LUDO', status: 'OPEN',
                reason: `${isCreator ? 'Creator' : 'Acceptor'} disputes opponent's win claim`,
                raisedBy: uid,
                creatorUid: match.creator.uid,
                acceptorUid: match.acceptor.uid,
                amount: match.amount,
                createdAt: admin.database.ServerValue.TIMESTAMP
            });

            const opponentUid = isCreator ? match.acceptor?.uid : match.creator?.uid;
            if (opponentUid) {
                const shortId5 = matchId.slice(-6).toUpperCase();
                await sendPush(opponentUid, `⚠️ Dispute — Match #${shortId5}`, `Your opponent disputes your win claim in Match #${shortId5} (🪙 ${match.amount}). Admin will review screenshots and resolve within 24 hours.`, { type: 'LUDO_DISPUTED', matchId });
            }

            return { success: true, escalated: true };
        }

        // Case 2: First dispute (opponent hasn't responded yet)
        // DON'T change status — keep ROOM_SHARED/IN_PROGRESS so opponent can still submit their result
        // The checkDisputeTimeouts cron will auto-escalate after 2 hours if opponent doesn't respond
        await matchRef.update({
            [`result/${role}`]: resultData,
            disputeDeadline: Date.now() + (2 * 60 * 60 * 1000),
            pendingDispute: true,
            pendingDisputeBy: uid
        });

        const disputeKey = db.ref('disputes').push().key;
        await db.ref('disputes/' + disputeKey).set({
            matchId, type: 'LUDO', status: 'OPEN',
            reason: `${isCreator ? 'Creator' : 'Acceptor'} raised dispute`,
            raisedBy: uid,
            creatorUid: match.creator.uid,
            acceptorUid: match.acceptor.uid,
            amount: match.amount,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        const opponentUid = isCreator ? match.acceptor?.uid : match.creator?.uid;
        if (opponentUid) {
            const shortId6 = matchId.slice(-6).toUpperCase();
            await sendPush(opponentUid, `⚠️ Dispute — Match #${shortId6}`, `Your opponent raised a dispute on Match #${shortId6} (🪙 ${match.amount}). Submit your result within 2 hours or admin will review.`, { type: 'LUDO_DISPUTED', matchId });
        }

        return { success: true };
    }
});

// ─── 2. Cancel Ludo Match ───────────────────────────────────

exports.cancelLudoMatch = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId, cancelType } = request.data;

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    const matchRef = db.ref('ludo_matches/' + matchId);

    // ── Unilateral cancel (OPEN / PAIRED) ───
    if (cancelType === 'UNILATERAL' || !cancelType) {
        const txn = await matchRef.transaction(match => {
            if (!match) return null; // Return null to retry (cold start)
            if (match.status !== 'OPEN' && match.status !== 'PAIRED') return; // Abort

            const isCreator = match.creator?.uid === uid;
            const isAcceptor = match.acceptor?.uid === uid;
            if (!isCreator && !isAcceptor) return;
            if (match.status === 'OPEN' && !isCreator) return;

            match.status = 'CANCELLING';
            match.cancelledBy = uid;
            match.cancelledAt = Date.now();
            return match;
        }, undefined, false); // applyLocally: false — force server read

        if (!txn.committed) {
            throw new HttpsError('failed-precondition', 'Cannot cancel');
        }

        const matchData = txn.snapshot.val();
        const wasPaired = !!matchData.acceptor?.uid;

        // Refund creator
        await refundPlayer(matchData.creator, matchId, matchData.amount, 'Ludo Challenge Cancelled (Refund)');

        // Refund acceptor if paired
        if (wasPaired) {
            await refundPlayer(matchData.acceptor, matchId, matchData.amount, 'Ludo Challenge Cancelled (Refund)');
            // Notify opponent
            const opponentUid = matchData.creator?.uid === uid ? matchData.acceptor.uid : matchData.creator.uid;
            const shortIdC = matchId.slice(-6).toUpperCase();
            await sendPush(opponentUid, `🔄 Match #${shortIdC} Cancelled — 🪙 ${matchData.amount} Refunded`, `The 🪙 ${matchData.amount} Ludo challenge (#${shortIdC}) was cancelled by your opponent. Entry fee refunded to your wallet.`, { type: 'LUDO_CANCELLED', matchId });
        }

        // Finalize
        await matchRef.update({
            status: 'CANCELLED',
            cancelReason: wasPaired ? 'Cancelled before game started - both refunded' : 'Creator cancelled open challenge'
        });

        return { success: true };
    }

    // ── Mutual cancel request ───
    if (cancelType === 'MUTUAL_REQUEST') {
        const snap = await matchRef.once('value');
        const match = snap.val();
        if (!match) throw new HttpsError('not-found', 'Match not found');
        if (match.status !== 'ROOM_SHARED' && match.status !== 'IN_PROGRESS') {
            throw new HttpsError('failed-precondition', 'Mutual cancel only for active matches');
        }

        const isCreator = match.creator?.uid === uid;
        if (match.cancelRequest?.requestedBy === uid) {
            throw new HttpsError('already-exists', 'Already requested');
        }

        // If opponent already requested, treat as acceptance
        if (match.cancelRequest && match.cancelRequest.requestedBy !== uid) {
            return acceptMutualCancelInternal(matchId, uid, matchRef);
        }

        await matchRef.child('cancelRequest').set({
            requestedBy: uid,
            requestedByRole: isCreator ? 'creator' : 'acceptor',
            requestedAt: admin.database.ServerValue.TIMESTAMP
        });

        const opponentUid = isCreator ? match.acceptor?.uid : match.creator?.uid;
        const shortIdMC = matchId.slice(-6).toUpperCase();
        if (opponentUid) {
            await sendPush(opponentUid, `🤝 Cancel Request — Match #${shortIdMC}`, `Your opponent wants to mutually cancel Match #${shortIdMC} (🪙 ${match.amount}). Accept for a full refund, or reject to continue.`, { type: 'LUDO_CANCEL_REQUEST', matchId });
        }

        return { success: true, message: 'Cancel request sent' };
    }

    // ── Mutual cancel accept ───
    if (cancelType === 'MUTUAL_ACCEPT') {
        return acceptMutualCancelInternal(matchId, uid, matchRef);
    }

    // ── Mutual cancel reject ───
    if (cancelType === 'MUTUAL_REJECT') {
        await matchRef.child('cancelRequest').remove();
        return { success: true, message: 'Cancel request rejected' };
    }

    throw new HttpsError('invalid-argument', 'Invalid cancelType');
});

// Shared mutual cancel logic
async function acceptMutualCancelInternal(matchId, uid, matchRef) {
    const txn = await matchRef.transaction(match => {
        if (!match) return null; // Return null to retry (cold start)
        if (!match.cancelRequest) return;
        if (match.cancelRequest.requestedBy === uid) return;
        if (match.status !== 'ROOM_SHARED' && match.status !== 'IN_PROGRESS') return;

        match.status = 'CANCELLING';
        match.cancelledBy = 'mutual';
        match.cancelledAt = Date.now();
        return match;
    }, undefined, false); // applyLocally: false — force server read

    if (!txn.committed) {
        throw new HttpsError('failed-precondition', 'Cannot cancel');
    }

    const matchData = txn.snapshot.val();

    // Refund both
    await refundPlayer(matchData.creator, matchId, matchData.amount, 'Ludo Match Mutually Cancelled (Refund)');
    await refundPlayer(matchData.acceptor, matchId, matchData.amount, 'Ludo Match Mutually Cancelled (Refund)');

    await matchRef.update({
        status: 'CANCELLED',
        cancelReason: 'Both players agreed to mutual cancellation'
    });

    // Notify both
    const shortIdMA = matchId.slice(-6).toUpperCase();
    await sendPush(matchData.creator.uid, `🤝 Match #${shortIdMA} Cancelled — 🪙 ${matchData.amount} Refunded`, `Match #${shortIdMA} (🪙 ${matchData.amount}) was mutually cancelled. Full entry fee refunded to your wallet.`, { type: 'LUDO_CANCELLED', matchId });
    await sendPush(matchData.acceptor.uid, `🤝 Match #${shortIdMA} Cancelled — 🪙 ${matchData.amount} Refunded`, `Match #${shortIdMA} (🪙 ${matchData.amount}) was mutually cancelled. Full entry fee refunded to your wallet.`, { type: 'LUDO_CANCELLED', matchId });

    return { success: true };
}

// ─── 3a. Share Room Code (Server-Side) ──────────────────────

exports.shareRoomCode = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId, roomCode } = request.data;

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');
    if (!roomCode || roomCode.trim().length < 4 || roomCode.trim().length > 12) {
        throw new HttpsError('invalid-argument', 'Room code must be 4-12 characters');
    }

    const safeRoomCode = roomCode.trim();
    const matchRef = db.ref('ludo_matches/' + matchId);

    // Atomically transition PAIRED → ROOM_SHARED (only creator can)
    const txn = await matchRef.transaction(match => {
        if (!match) return null;
        if (match.status !== 'PAIRED') return; // Abort — wrong state
        if (match.creator?.uid !== uid) return; // Abort — only creator shares code
        match.status = 'ROOM_SHARED';
        match.roomCode = safeRoomCode;
        match.roomSharedAt = Date.now();
        return match;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError('failed-precondition', 'Cannot share room code in current state (you must be the creator and match must be PAIRED)');
    }

    const match = txn.snapshot.val();

    // Notify the acceptor
    const acceptorUid = match.acceptor?.uid;
    if (acceptorUid) {
        const shortId = matchId.slice(-6).toUpperCase();
        await sendPush(acceptorUid, `🎮 Room Code Shared — Match #${shortId}`,
            `Room code for 🪙 ${match.amount} match: ${safeRoomCode}. Join the Ludo King room now!`,
            { type: 'LUDO_ROOM_SHARED', matchId, roomCode: safeRoomCode });
    }

    return { success: true };
});

// ─── 3b. Start Ludo Game (Server-Side) ──────────────────────

exports.startLudoGame = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId } = request.data;

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    const matchRef = db.ref('ludo_matches/' + matchId);

    // Atomically transition ROOM_SHARED → IN_PROGRESS (either participant can)
    const txn = await matchRef.transaction(match => {
        if (!match) return null;
        if (match.status !== 'ROOM_SHARED') return; // Abort — wrong state
        if (match.creator?.uid !== uid && match.acceptor?.uid !== uid) return; // Abort — not a participant
        match.status = 'IN_PROGRESS';
        match.startedAt = Date.now();
        return match;
    }, undefined, false);

    if (!txn.committed) {
        throw new HttpsError('failed-precondition', 'Cannot start game in current state');
    }

    const match = txn.snapshot.val();

    // Set dispute deadline (2 hours from start)
    await matchRef.update({
        disputeDeadline: Date.now() + 2 * 60 * 60 * 1000
    });

    // Notify both players
    const shortId = matchId.slice(-6).toUpperCase();
    const creatorUid = match.creator?.uid;
    const acceptorUid = match.acceptor?.uid;
    const otherUid = uid === creatorUid ? acceptorUid : creatorUid;

    if (otherUid) {
        await sendPush(otherUid, `🎲 Game Started — Match #${shortId}`,
            `The 🪙 ${match.amount} Ludo match has started! Submit your result when finished.`,
            { type: 'LUDO_GAME_STARTED', matchId });
    }

    return { success: true };
});

// ─── 4. Create Ludo Challenge ───────────────────────────────

exports.createLudoChallenge = onCall(async (request) => {
    const uid = assertAuth(request);
    const { amount, ludoKingUsername } = request.data;

    // ── Server-side ban enforcement ──
    await assertNotBanned(uid);

    if (!amount || amount <= 0) throw new HttpsError('invalid-argument', 'Invalid amount');
    if (!Number.isInteger(amount)) throw new HttpsError('invalid-argument', 'Amount must be a whole number');
    if (!ludoKingUsername || ludoKingUsername.length < 2) {
        throw new HttpsError('invalid-argument', 'Ludo King username required');
    }

    // ── Anti-Spam: Fetch all configs in parallel ──
    const [minSnap, maxSnap, maxOpenSnap, maxActiveSnap, cooldownSnap, userSnap, commissionPercent] = await Promise.all([
        db.ref('platform_config/ludo_min_challenge').once('value'),
        db.ref('platform_config/ludo_max_challenge').once('value'),
        db.ref('platform_config/ludo_max_open_challenges').once('value'),
        db.ref('platform_config/ludo_max_active_matches').once('value'),
        db.ref('platform_config/ludo_create_cooldown_ms').once('value'),
        db.ref(`users/${uid}`).once('value'),
        getLudoCommission()
    ]);

    const minChallenge = parseInt(minSnap.val()) || 10;
    const maxChallenge = parseInt(maxSnap.val()) || 25000;
    const maxOpenChallenges = parseInt(maxOpenSnap.val()) || 3;
    const maxActiveMatches = parseInt(maxActiveSnap.val()) || 5;
    const cooldownMs = parseInt(cooldownSnap.val()) || 30000;
    const userData = userSnap.val() || {};
    const userName = userData.fullName || userData.username || 'User';

    // ── Check 1: Min amount ──
    if (amount < minChallenge) {
        throw new HttpsError('invalid-argument', `Minimum challenge is 🪙 ${minChallenge}`);
    }

    // ── Check 2: Max amount cap ──
    if (amount > maxChallenge) {
        throw new HttpsError('invalid-argument', `Maximum challenge is 🪙 ${maxChallenge}`);
    }

    // ── Check 3: Cooldown between creates ──
    const lastCreated = userData.lastChallengeCreatedAt || 0;
    const now = Date.now();
    if (now - lastCreated < cooldownMs) {
        const waitSec = Math.ceil((cooldownMs - (now - lastCreated)) / 1000);
        throw new HttpsError('resource-exhausted', `Please wait ${waitSec}s before creating another challenge`);
    }

    // ── Check 4: Max open (unpaired) challenges ──
    const openCount = await countUserLudoMatches(uid, ['OPEN']);
    if (openCount >= maxOpenChallenges) {
        throw new HttpsError('resource-exhausted',
            `You already have ${openCount} open challenges (max ${maxOpenChallenges}). Cancel one or wait for it to be accepted.`);
    }

    // ── Check 5: Max active matches total ──
    const activeCount = await countUserLudoMatches(uid, ['OPEN', 'PAIRED', 'ROOM_SHARED', 'IN_PROGRESS']);
    if (activeCount >= maxActiveMatches) {
        throw new HttpsError('resource-exhausted',
            `You have ${activeCount} active matches (max ${maxActiveMatches}). Complete or cancel existing matches first.`);
    }

    // ── All checks passed — Deduct balance atomically ──
    const deduction = await deductBalance(uid, amount);
    if (!deduction) {
        logEvent('createLudoChallenge', 'warn', 'Insufficient balance', { uid, amount });
        throw new HttpsError('failed-precondition', 'Insufficient balance');
    }
    logEvent('createLudoChallenge', 'info', 'Creating challenge', { uid, amount });

    // Create match + wallet transaction atomically
    const newKey = db.ref('ludo_matches').push().key;
    const txnKey = db.ref('wallet_transactions').push().key;
    const matchIdNum = Date.now().toString().slice(-10);

    const updates = {};
    const prizePool = Math.floor(amount * 2 * (1 - commissionPercent / 100));
    updates['/ludo_matches/' + newKey] = {
        matchId: matchIdNum,
        creator: {
            uid: uid,
            ludoKingUsername: ludoKingUsername,
            isVip: !!(userData.vip && userData.vip.active && userData.vip.expiresAt > Date.now()),
            depositDeducted: deduction.depositDeducted,
            winningDeducted: deduction.winningDeducted
        },
        amount: amount,
        prizePool: prizePool,
        commissionPercent: commissionPercent,
        status: 'OPEN',
        createdAt: admin.database.ServerValue.TIMESTAMP
    };
    updates['/wallet_transactions/' + txnKey] = {
        userId: uid,
        userName: userName,
        amount: amount,
        type: 'DEBIT',
        isCredit: false,
        reason: 'Created Ludo Challenge',
        description: `Ludo Challenge 🪙 ${amount}`,
        ludoMatchId: newKey,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    };
    // Also record cooldown timestamp
    updates[`/users/${uid}/lastChallengeCreatedAt`] = admin.database.ServerValue.TIMESTAMP;

    await db.ref().update(updates);

    // Save Ludo King username to user profile
    await db.ref(`users/${uid}/ludoKingUsername`).set(ludoKingUsername);

    return {
        success: true,
        matchKey: newKey,
        matchId: matchIdNum,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        newDepositBalance: deduction.userAfter.depositBalance || 0,
        newWinningBalance: deduction.userAfter.winningBalance || 0
    };
});

// ─── 4. Accept Ludo Challenge ──────────────────────────────

exports.acceptLudoChallenge = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId, ludoKingUsername } = request.data;

    // ── Server-side ban enforcement ──
    await assertNotBanned(uid);

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');
    if (!ludoKingUsername || ludoKingUsername.length < 2) {
        throw new HttpsError('invalid-argument', 'Ludo King username required');
    }

    // ── Anti-Spam: Max active matches check ──
    const maxActiveSnap = await db.ref('platform_config/ludo_max_active_matches').once('value');
    const maxActiveMatches = parseInt(maxActiveSnap.val()) || 5;
    const activeCount = await countUserLudoMatches(uid, ['OPEN', 'PAIRED', 'ROOM_SHARED', 'IN_PROGRESS']);
    if (activeCount >= maxActiveMatches) {
        throw new HttpsError('resource-exhausted',
            `You have ${activeCount} active matches (max ${maxActiveMatches}). Complete or cancel existing matches first.`);
    }

    const matchRef = db.ref('ludo_matches/' + matchId);

    // Atomically claim the match
    const matchTxn = await matchRef.transaction(match => {
        if (!match) return null; // Return null to retry (cold start)
        if (match.status !== 'OPEN') return;
        if (match.creator?.uid === uid) return; // Can't accept own
        if (match.acceptor) return; // Already accepted

        match.status = 'PAIRED';
        match.acceptor = {
            uid: uid,
            ludoKingUsername: ludoKingUsername,
            isVip: false // Will be updated after user data fetch
        };
        match.pairedAt = Date.now();
        return match;
    }, undefined, false); // applyLocally: false — force server read

    if (!matchTxn.committed) {
        throw new HttpsError('failed-precondition', 'Challenge no longer available');
    }

    const match = matchTxn.snapshot.val();
    const matchAmount = match.amount;

    // Deduct balance atomically
    const deduction = await deductBalance(uid, matchAmount);
    if (!deduction) {
        // Rollback match claim
        await matchRef.update({
            status: 'OPEN',
            acceptor: null,
            pairedAt: null
        });
        throw new HttpsError('failed-precondition', `Insufficient balance. Need 🪙 ${matchAmount}`);
    }

    // Store deduction info + log transaction
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const userData = userSnap.val() || {};
    const userName = userData.fullName || userData.username || 'User';

    const txnKey = db.ref('wallet_transactions').push().key;
    const updates = {};
    // Update acceptor VIP status from actual user data
    const acceptorIsVip = !!(userData.vip && userData.vip.active && userData.vip.expiresAt > Date.now());
    updates['/ludo_matches/' + matchId + '/acceptor/isVip'] = acceptorIsVip;
    updates['/ludo_matches/' + matchId + '/acceptor/depositDeducted'] = deduction.depositDeducted;
    updates['/ludo_matches/' + matchId + '/acceptor/winningDeducted'] = deduction.winningDeducted;
    updates['/wallet_transactions/' + txnKey] = {
        userId: uid,
        userName: userName,
        amount: matchAmount,
        type: 'DEBIT',
        isCredit: false,
        reason: 'Joined Ludo Challenge',
        description: `Ludo Challenge 🪙 ${matchAmount}`,
        ludoMatchId: matchId,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    };
    await db.ref().update(updates);

    // Save Ludo King username
    await db.ref(`users/${uid}/ludoKingUsername`).set(ludoKingUsername);

    // Notify creator
    const shortIdJ = matchId.slice(-6).toUpperCase();
    const acceptorName = ludoKingUsername || userSnap.val()?.username || 'Opponent';
    await sendPush(match.creator.uid, `🎮 Challenge Accepted! #${shortIdJ}`, `${acceptorName} accepted your 🪙 ${match.amount} Ludo challenge! Create a room in Ludo King and share the room code to start.`, { type: 'LUDO_PAIRED', matchId });

    return {
        success: true,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        newDepositBalance: deduction.userAfter.depositBalance || 0,
        newWinningBalance: deduction.userAfter.winningBalance || 0
    };
});

// ─── 5. Send Rematch Request ───────────────────────────────

exports.sendRematch = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId } = request.data;

    await assertNotBanned(uid);

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    // Fetch original match
    const origSnap = await db.ref('ludo_matches/' + matchId).once('value');
    const origMatch = origSnap.val();
    if (!origMatch) throw new HttpsError('not-found', 'Match not found');
    if (origMatch.status !== 'COMPLETED') {
        throw new HttpsError('failed-precondition', 'Can only rematch completed matches');
    }

    // Verify caller was a participant
    const isCreator = origMatch.creator?.uid === uid;
    const isAcceptor = origMatch.acceptor?.uid === uid;
    if (!isCreator && !isAcceptor) {
        throw new HttpsError('permission-denied', 'Not a participant of this match');
    }

    // Check if a rematch was already sent for this match
    const existingSnap = await db.ref('ludo_matches')
        .orderByChild('rematchFrom')
        .equalTo(matchId)
        .once('value');
    if (existingSnap.exists()) {
        let alreadyPending = false;
        existingSnap.forEach(child => {
            if (['REMATCH_PENDING', 'OPEN', 'PAIRED', 'ROOM_SHARED', 'IN_PROGRESS'].includes(child.val().status)) {
                alreadyPending = true;
            }
        });
        if (alreadyPending) {
            throw new HttpsError('already-exists', 'A rematch is already pending for this match');
        }
    }

    // Anti-spam: max active matches
    const maxActiveSnap = await db.ref('platform_config/ludo_max_active_matches').once('value');
    const maxActiveMatches = parseInt(maxActiveSnap.val()) || 5;
    const activeCount = await countUserLudoMatches(uid, ['OPEN', 'PAIRED', 'ROOM_SHARED', 'IN_PROGRESS', 'REMATCH_PENDING']);
    if (activeCount >= maxActiveMatches) {
        throw new HttpsError('resource-exhausted',
            `You have ${activeCount} active matches (max ${maxActiveMatches}). Complete or cancel existing matches first.`);
    }

    // Determine sender and opponent
    const sender = isCreator ? origMatch.creator : origMatch.acceptor;
    const opponent = isCreator ? origMatch.acceptor : origMatch.creator;

    // Create rematch match entry (NO balance deduction yet — happens on accept)
    const newKey = db.ref('ludo_matches').push().key;
    const matchIdNum = Date.now().toString().slice(-10);

    await db.ref('ludo_matches/' + newKey).set({
        matchId: matchIdNum,
        amount: origMatch.amount,
        status: 'REMATCH_PENDING',
        rematchFrom: matchId,
        rematchSender: uid,
        rematchReceiver: opponent.uid,
        creator: {
            uid: sender.uid,
            ludoKingUsername: sender.ludoKingUsername
        },
        acceptor: {
            uid: opponent.uid,
            ludoKingUsername: opponent.ludoKingUsername
        },
        createdAt: admin.database.ServerValue.TIMESTAMP,
        rematchExpiresAt: Date.now() + (5 * 60 * 1000) // 5 min expiry
    });

    // Mark original match as having a rematch
    await db.ref('ludo_matches/' + matchId + '/rematchId').set(newKey);

    // Notify opponent
    const senderName = sender.ludoKingUsername || 'Opponent';
    const shortId = newKey.slice(-6).toUpperCase();
    await sendPush(opponent.uid, `🔄 Rematch Request — 🪙 ${origMatch.amount}`,
        `${senderName} wants a rematch! Same 🪙 ${origMatch.amount} challenge. Tap to accept or decline.`,
        { type: 'LUDO_REMATCH_REQUEST', matchId: newKey });

    return { success: true, rematchId: newKey, matchId: matchIdNum };
});

// ─── 6. Accept Rematch ─────────────────────────────────────

exports.acceptRematch = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId } = request.data;

    await assertNotBanned(uid);

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    const matchRef = db.ref('ludo_matches/' + matchId);

    // Atomically claim the rematch
    const matchTxn = await matchRef.transaction(match => {
        if (!match) return null;
        if (match.status !== 'REMATCH_PENDING') return;
        if (match.rematchReceiver !== uid) return; // Only the receiver can accept

        // Check expiry
        if (match.rematchExpiresAt && Date.now() > match.rematchExpiresAt) return;

        match.status = 'ACCEPTING_REMATCH'; // Transitional status during balance deduction
        return match;
    }, undefined, false);

    if (!matchTxn.committed) {
        throw new HttpsError('failed-precondition', 'Rematch no longer available or expired');
    }

    const match = matchTxn.snapshot.val();
    const senderUid = match.rematchSender;
    const amount = match.amount;

    // Deduct balance from BOTH players
    const senderDeduction = await deductBalance(senderUid, amount);
    if (!senderDeduction) {
        // Rollback
        await matchRef.update({ status: 'CANCELLED', cancelReason: 'Sender has insufficient balance' });
        throw new HttpsError('failed-precondition', 'Rematch sender has insufficient balance. Rematch cancelled.');
    }

    const receiverDeduction = await deductBalance(uid, amount);
    if (!receiverDeduction) {
        // Refund sender and rollback
        await refundPlayer(
            { uid: senderUid, depositDeducted: senderDeduction.depositDeducted, winningDeducted: senderDeduction.winningDeducted },
            matchId, amount, 'Ludo Rematch Cancelled — Opponent has insufficient balance'
        );
        await matchRef.update({ status: 'CANCELLED', cancelReason: 'Receiver has insufficient balance' });
        throw new HttpsError('failed-precondition', `Insufficient balance. Need 🪙 ${amount}`);
    }

    // Update match to PAIRED with deduction info
    const senderIsCreator = match.creator?.uid === senderUid;

    const updateData = {
        status: 'PAIRED',
        pairedAt: admin.database.ServerValue.TIMESTAMP
    };

    // Store deduction details
    if (senderIsCreator) {
        updateData['creator/depositDeducted'] = senderDeduction.depositDeducted;
        updateData['creator/winningDeducted'] = senderDeduction.winningDeducted;
        updateData['acceptor/depositDeducted'] = receiverDeduction.depositDeducted;
        updateData['acceptor/winningDeducted'] = receiverDeduction.winningDeducted;
    } else {
        updateData['acceptor/depositDeducted'] = senderDeduction.depositDeducted;
        updateData['acceptor/winningDeducted'] = senderDeduction.winningDeducted;
        updateData['creator/depositDeducted'] = receiverDeduction.depositDeducted;
        updateData['creator/winningDeducted'] = receiverDeduction.winningDeducted;
    }

    await matchRef.update(updateData);

    // Log wallet transactions for both players
    const senderSnap = await db.ref(`users/${senderUid}`).once('value');
    const receiverSnap = await db.ref(`users/${uid}`).once('value');
    const senderName = senderSnap.val()?.fullName || senderSnap.val()?.username || 'User';
    const receiverName = receiverSnap.val()?.fullName || receiverSnap.val()?.username || 'User';

    const txnKey1 = db.ref('wallet_transactions').push().key;
    const txnKey2 = db.ref('wallet_transactions').push().key;
    const txnUpdates = {};
    txnUpdates['/wallet_transactions/' + txnKey1] = {
        userId: senderUid, userName: senderName,
        amount, type: 'DEBIT', isCredit: false,
        reason: 'Ludo Rematch', description: `Ludo Rematch 🪙 ${amount}`,
        ludoMatchId: matchId,
        depositDeducted: senderDeduction.depositDeducted,
        winningDeducted: senderDeduction.winningDeducted,
        status: 'SUCCESS', timestamp: admin.database.ServerValue.TIMESTAMP
    };
    txnUpdates['/wallet_transactions/' + txnKey2] = {
        userId: uid, userName: receiverName,
        amount, type: 'DEBIT', isCredit: false,
        reason: 'Ludo Rematch Accepted', description: `Ludo Rematch 🪙 ${amount}`,
        ludoMatchId: matchId,
        depositDeducted: receiverDeduction.depositDeducted,
        winningDeducted: receiverDeduction.winningDeducted,
        status: 'SUCCESS', timestamp: admin.database.ServerValue.TIMESTAMP
    };
    await db.ref().update(txnUpdates);

    // Notify sender
    const shortId = matchId.slice(-6).toUpperCase();
    const opponentLudoName = senderIsCreator
        ? (match.acceptor?.ludoKingUsername || 'Opponent')
        : (match.creator?.ludoKingUsername || 'Opponent');
    await sendPush(senderUid, `✅ Rematch Accepted! #${shortId}`,
        `${opponentLudoName} accepted the 🪙 ${amount} rematch! Create a room in Ludo King and share the room code.`,
        { type: 'LUDO_REMATCH_ACCEPTED', matchId });

    return {
        success: true,
        depositDeducted: receiverDeduction.depositDeducted,
        winningDeducted: receiverDeduction.winningDeducted,
        newDepositBalance: receiverDeduction.userAfter.depositBalance || 0,
        newWinningBalance: receiverDeduction.userAfter.winningBalance || 0
    };
});

// ─── 7. Decline Rematch ────────────────────────────────────

exports.declineRematch = onCall(async (request) => {
    const uid = assertAuth(request);
    const { matchId } = request.data;

    await assertNotBanned(uid);

    if (!matchId) throw new HttpsError('invalid-argument', 'matchId required');

    const matchRef = db.ref('ludo_matches/' + matchId);
    const snap = await matchRef.once('value');
    const match = snap.val();

    if (!match) throw new HttpsError('not-found', 'Match not found');
    if (match.status !== 'REMATCH_PENDING') {
        throw new HttpsError('failed-precondition', 'Rematch is not pending');
    }

    // Either player can decline
    if (match.rematchSender !== uid && match.rematchReceiver !== uid) {
        throw new HttpsError('permission-denied', 'Not a participant');
    }

    await matchRef.update({
        status: 'CANCELLED',
        cancelReason: uid === match.rematchSender ? 'Sender cancelled rematch' : 'Rematch declined',
        cancelledAt: admin.database.ServerValue.TIMESTAMP,
        cancelledBy: uid
    });

    // Notify the other player
    const otherUid = uid === match.rematchSender ? match.rematchReceiver : match.rematchSender;
    const declineMsg = uid === match.rematchSender ? 'cancelled the rematch request' : 'declined the rematch';
    await sendPush(otherUid, `❌ Rematch ${uid === match.rematchSender ? 'Cancelled' : 'Declined'}`,
        `The 🪙 ${match.amount} rematch was ${declineMsg}.`,
        { type: 'LUDO_REMATCH_DECLINED', matchId });

    return { success: true };
});
