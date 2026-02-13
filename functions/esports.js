/**
 * esports.js — eSports Cloud Functions
 * Exports: joinEsportsMatch
 */

const {
    functions, admin, db,
    assertAuth, sendPush, deductBalance
} = require('./helpers');

// ─── Join eSports Match ─────────────────────────────────────

exports.joinEsportsMatch = functions.https.onCall(async (data, context) => {
    const uid = assertAuth(context);
    const { matchId, ign, slotsToBook, selectedSlots, gameId } = data;

    if (!matchId) throw new functions.https.HttpsError('invalid-argument', 'matchId required');
    if (!ign) throw new functions.https.HttpsError('invalid-argument', 'IGN required');

    const matchRef = db.ref('esports_matches/' + matchId);

    // Determine if this is a Duo/Squad booking (slotsToBook) or Solo join (selectedSlots)
    const isDuoSquad = Array.isArray(slotsToBook) && slotsToBook.length > 0;
    const isSolo = !isDuoSquad;
    const slotsCount = isDuoSquad ? slotsToBook.length : (Array.isArray(selectedSlots) ? selectedSlots.length : 1);

    // Atomically reserve slots
    const slotTxn = await matchRef.transaction(match => {
        if (!match) return null; // Return null to retry (cold start)
        if (match.status !== 'UPCOMING') return;
        if (!match.participants) match.participants = {};

        if (isDuoSquad) {
            // Duo/Squad: check specific team/position slots
            for (const slot of slotsToBook) {
                const slotKey = `team_${slot.team}_${slot.position}`;
                if (match.participants[slotKey]) return; // Slot taken
            }
            const timestamp = Date.now();
            slotsToBook.forEach((slot, index) => {
                const slotKey = `team_${slot.team}_${slot.position}`;
                match.participants[slotKey] = {
                    bookedBy: uid,
                    ign: Array.isArray(ign) ? ign[index] : ign,
                    joinedAt: timestamp,
                    teamNumber: slot.team,
                    slotPosition: slot.position,
                    slotIndex: index + 1,
                    pending: true
                };
            });
        } else {
            // Solo: check if user already joined
            if (match.participants[uid]) return;
            const currentCount = Object.keys(match.participants).length;
            const maxSlots = match.maxParticipants || 100;
            if (currentCount + slotsCount > maxSlots) return;

            // Check specific slots if provided
            if (Array.isArray(selectedSlots) && selectedSlots.length > 0 && match.type === 'Solo') {
                for (const slotNum of selectedSlots) {
                    const slotTaken = Object.values(match.participants).some(
                        p => p.slotNumber === slotNum || p.teamNumber === slotNum
                    );
                    if (slotTaken) return;
                }
            }

            const nextSlotNum = currentCount + 1;
            match.participants[uid] = {
                ign: ign,
                joinedAt: Date.now(),
                slotNumber: (Array.isArray(selectedSlots) && selectedSlots[0]) || nextSlotNum,
                slotsBooked: slotsCount,
                bookedBy: uid,
                pending: true
            };
            if (Array.isArray(selectedSlots) && selectedSlots.length > 1) {
                match.participants[uid].selectedSlots = selectedSlots;
            }
        }
        return match;
    }, undefined, false); // applyLocally: false — force server read

    if (!slotTxn.committed) {
        throw new functions.https.HttpsError('failed-precondition', 'Slot(s) not available');
    }

    const matchData = slotTxn.snapshot.val();
    const entryFee = (matchData.entryFee || 0) * slotsCount;

    // Deduct balance atomically
    const deduction = await deductBalance(uid, entryFee);
    if (!deduction) {
        // Rollback slot reservation
        if (isDuoSquad) {
            const rollback = {};
            slotsToBook.forEach(slot => {
                rollback[`participants/team_${slot.team}_${slot.position}`] = null;
            });
            await matchRef.update(rollback);
        } else {
            await matchRef.child(`participants/${uid}`).remove();
        }
        throw new functions.https.HttpsError('failed-precondition', `Insufficient balance. Entry fee: ₹${entryFee}`);
    }

    // Confirm slots + log transaction
    const confirmUpdates = {};
    if (isDuoSquad) {
        slotsToBook.forEach(slot => {
            const slotKey = `team_${slot.team}_${slot.position}`;
            confirmUpdates[`participants/${slotKey}/pending`] = null;
            confirmUpdates[`participants/${slotKey}/confirmed`] = true;
            confirmUpdates[`participants/${slotKey}/depositDeducted`] = deduction.depositDeducted / slotsCount;
            confirmUpdates[`participants/${slotKey}/winningDeducted`] = deduction.winningDeducted / slotsCount;
        });
    } else {
        confirmUpdates[`participants/${uid}/pending`] = null;
        confirmUpdates[`participants/${uid}/confirmed`] = true;
        confirmUpdates[`participants/${uid}/depositDeducted`] = deduction.depositDeducted;
        confirmUpdates[`participants/${uid}/winningDeducted`] = deduction.winningDeducted;
    }
    await matchRef.update(confirmUpdates);

    const userAfter = deduction.userAfter;
    await db.ref('wallet_transactions').push({
        userId: uid,
        userName: userAfter.fullName || userAfter.username || 'User',
        amount: entryFee,
        type: 'DEBIT',
        isCredit: false,
        description: `${matchData.gameName || matchData.title || 'Match'} (${slotsCount} slot${slotsCount > 1 ? 's' : ''})`,
        reason: `Joined Match: ${matchData.title || matchId}`,
        gameName: matchData.gameName || '',
        matchId: matchId,
        slotsBooked: slotsCount,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Save IGN for this game
    if (gameId) {
        await db.ref(`users/${uid}/gameIGNs/${gameId}`).set(Array.isArray(ign) ? ign[0] : ign);
    }

    // Push notification: eSports slot booking confirmed
    const gameName = matchData.gameName || matchData.title || 'eSports Match';
    const shortIdE = matchId.slice(-6).toUpperCase();
    sendPush(uid, `🎯 Slot Confirmed — ${gameName} #${shortIdE}`, `You're in! ₹${entryFee} deducted. Match ID: #${shortIdE}. We'll remind you 30 min before start. Good luck!`, { type: 'ESPORTS_SLOT_BOOKED', matchId }).catch(() => { });

    return {
        success: true,
        depositDeducted: deduction.depositDeducted,
        winningDeducted: deduction.winningDeducted,
        newDepositBalance: userAfter.depositBalance || 0,
        newWinningBalance: userAfter.winningBalance || 0
    };
});
