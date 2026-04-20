/**
 * spin_wheel.js — Spin Wheel / Lucky Draw Cloud Functions
 * Exports: spinWheel
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertNotBanned, logEvent
} = require('./helpers');

// Default 8 segments — weighted prizes
// Expected value: ~₹0.80/spin (optimized for platform sustainability)
const DEFAULT_SEGMENTS = [
    { label: '🪙 1', prize: 1, weight: 30, type: 'CASH' },
    { label: '🪙 2', prize: 2, weight: 18, type: 'CASH' },
    { label: 'Better Luck', prize: 0, weight: 35, type: 'NONE' },
    { label: '🪙 3', prize: 3, weight: 8, type: 'CASH' },
    { label: '🪙 5', prize: 5, weight: 3, type: 'CASH' },
    { label: '+1 Spin', prize: 1, weight: 3.5, type: 'SPIN' },
    { label: '🪙 7', prize: 7, weight: 2, type: 'CASH' },
    { label: '🪙 10 Jackpot', prize: 10, weight: 0.5, type: 'CASH' }
];

/**
 * Get today's date string in IST
 */
function getTodayIST() {
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return istDate.toISOString().split('T')[0];
}

/**
 * Weighted random selection — returns segment index
 */
function weightedRandom(segments) {
    const totalWeight = segments.reduce((sum, s) => sum + (s.weight || 1), 0);
    let rand = Math.random() * totalWeight;

    for (let i = 0; i < segments.length; i++) {
        rand -= segments[i].weight || 1;
        if (rand <= 0) return i;
    }
    return segments.length - 1; // Fallback
}

// ─── User: Spin the Wheel ──────────────────────────────────

exports.spinWheel = onCall(async (request) => {
    const uid = assertAuth(request);
    const userData = await assertNotBanned(uid);

    // Check if spin wheel is enabled
    const configSnap = await db.ref('spin_wheel_config').once('value');
    const config = configSnap.val() || {};

    if (config.enabled === false) {
        throw new HttpsError('failed-precondition', 'Spin wheel is currently disabled');
    }

    const segments = config.segments || DEFAULT_SEGMENTS;
    const today = getTodayIST();

    // ─── ATOMIC SPIN: Check & consume spin token ───
    const spinRef = db.ref(`users/${uid}/spinData`);
    let spinType = ''; // 'FREE' or 'EXTRA'

    const spinTxn = await spinRef.transaction(current => {
        if (!current) {
            // First ever spin — use free spin
            spinType = 'FREE';
            return {
                freeSpinUsedDate: today,
                extraSpins: 0,
                totalSpins: 1,
                totalWon: 0
            };
        }

        // Check free spin availability
        if (current.freeSpinUsedDate !== today) {
            spinType = 'FREE';
            current.freeSpinUsedDate = today;
            current.totalSpins = (current.totalSpins || 0) + 1;
            return current;
        }

        // Free spin used — check extra spins
        if ((current.extraSpins || 0) > 0) {
            spinType = 'EXTRA';
            current.extraSpins = current.extraSpins - 1;
            current.totalSpins = (current.totalSpins || 0) + 1;
            return current;
        }

        // No spins available
        return; // Abort
    }, undefined, false);

    if (!spinTxn.committed) {
        throw new HttpsError('resource-exhausted',
            'No spins available! Come back tomorrow for a free spin, or play matches to earn more.');
    }

    // ─── Server-side weighted random prize selection ───
    const winIndex = weightedRandom(segments);
    const wonSegment = segments[winIndex];
    const prizeType = wonSegment.type || 'NONE';
    const prizeAmount = wonSegment.prize || 0;

    // ─── Award prize based on type ───
    if (prizeType === 'CASH' && prizeAmount > 0) {
        // Credit to deposit balance
        const balTxn = await db.ref(`users/${uid}`).transaction(user => {
            if (!user) return null;
            user.depositBalance = (user.depositBalance || 0) + prizeAmount;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        }, undefined, false);

        if (!balTxn.committed) {
            // Rollback spin consumption
            await spinRef.transaction(current => {
                if (!current) return current;
                if (spinType === 'FREE') {
                    // Reset free spin — set to yesterday so it's available again
                    current.freeSpinUsedDate = '';
                } else {
                    current.extraSpins = (current.extraSpins || 0) + 1;
                }
                current.totalSpins = Math.max(0, (current.totalSpins || 1) - 1);
                return current;
            });
            throw new HttpsError('internal', 'Failed to award prize — please try again');
        }

        // Update totalWon
        await spinRef.transaction(current => {
            if (!current) return current;
            current.totalWon = (current.totalWon || 0) + prizeAmount;
            return current;
        });

        // Wallet transaction
        const txnKey = db.ref('wallet_transactions').push().key;
        await db.ref(`wallet_transactions/${txnKey}`).set({
            userId: uid,
            userName: userData.fullName || userData.username || 'User',
            amount: prizeAmount,
            type: 'CREDIT',
            isCredit: true,
            reason: `Spin wheel: ${wonSegment.label}`,
            description: `Lucky spin — won ${wonSegment.label}!`,
            spinWheelPrize: prizeAmount,
            spinWheelSegment: wonSegment.label,
            walletType: 'DEPOSIT',
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

    } else if (prizeType === 'SPIN') {
        // Award extra spin(s)
        await spinRef.transaction(current => {
            if (!current) return current;
            current.extraSpins = (current.extraSpins || 0) + (prizeAmount || 1);
            return current;
        });
    }
    // prizeType === 'NONE' — "Better Luck" — nothing to award

    // Get updated spin data for response
    const updatedSnap = await spinRef.once('value');
    const updatedData = updatedSnap.val() || {};

    functions.logger.info(`[spinWheel] ${uid} spun (${spinType}), won segment ${winIndex}: ${wonSegment.label}`);

    return {
        success: true,
        winIndex,
        segment: wonSegment,
        totalSegments: segments.length,
        prizeType,
        prizeAmount: prizeType === 'CASH' ? prizeAmount : 0,
        message: prizeType === 'NONE'
            ? 'Better luck next time!'
            : prizeType === 'SPIN'
                ? `You won ${prizeAmount} extra spin${prizeAmount > 1 ? 's' : ''}!`
                : `You won ${wonSegment.label}!`,
        spinData: {
            freeSpinAvailable: updatedData.freeSpinUsedDate !== today,
            extraSpins: updatedData.extraSpins || 0,
            totalSpins: updatedData.totalSpins || 0,
            totalWon: updatedData.totalWon || 0
        }
    };
});
