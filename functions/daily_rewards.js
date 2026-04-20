/**
 * daily_rewards.js — Daily Login Streak Cloud Functions
 * Exports: claimDailyReward
 */

const {
    functions, admin, db,
    onCall, HttpsError,
    assertAuth, assertNotBanned, logEvent
} = require('./helpers');

// Default rewards per day (₹) — Day 1 through Day 7
// Weekly total: ₹23 × 4.3 weeks ≈ ₹99/month cap
const DEFAULT_REWARDS = [1, 1, 2, 2, 3, 5, 9];

/**
 * Get today's date string in IST (India Standard Time)
 * Using IST ensures consistency since all users are in India
 */
function getTodayIST() {
    const now = new Date();
    // IST = UTC + 5:30
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    return istDate.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

/**
 * Get yesterday's date string in IST
 */
function getYesterdayIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset - 24 * 60 * 60 * 1000);
    return istDate.toISOString().split('T')[0];
}

// ─── User: Claim Daily Reward ───────────────────────────────

exports.claimDailyReward = onCall(async (request) => {
    const uid = assertAuth(request);
    const userData = await assertNotBanned(uid);

    // Check if daily rewards are enabled
    const configSnap = await db.ref('daily_rewards_config').once('value');
    const config = configSnap.val() || {};

    if (config.enabled === false) {
        throw new HttpsError('failed-precondition', 'Daily rewards are currently disabled');
    }

    const rewards = config.rewards || DEFAULT_REWARDS;
    const today = getTodayIST();
    const yesterday = getYesterdayIST();

    // ─── ATOMIC CLAIM: Prevent double-claim race condition ───
    const rewardRef = db.ref(`users/${uid}/dailyReward`);
    let bonusAmount = 0;
    let claimedDay = 0;
    let newStreakCount = 0;

    const claimTxn = await rewardRef.transaction(current => {
        if (!current) {
            // First ever claim — Day 1
            bonusAmount = rewards[0] || 5;
            claimedDay = 1;
            newStreakCount = 1;
            return {
                currentDay: 1,
                lastClaimDate: today,
                streakCount: 1,
                totalEarned: bonusAmount
            };
        }

        // Already claimed today
        if (current.lastClaimDate === today) {
            return; // Abort transaction
        }

        // Determine streak continuity
        let nextDay;
        if (current.lastClaimDate === yesterday) {
            // Consecutive day — continue streak
            nextDay = (current.currentDay || 0) + 1;
            if (nextDay > rewards.length) {
                nextDay = 1; // Cycle reset after day 7
            }
            newStreakCount = (current.streakCount || 0) + 1;
        } else {
            // Streak broken — reset to Day 1
            nextDay = 1;
            newStreakCount = 1; // Reset streak count
        }

        bonusAmount = rewards[nextDay - 1] || 5;
        claimedDay = nextDay;

        return {
            currentDay: nextDay,
            lastClaimDate: today,
            streakCount: newStreakCount,
            totalEarned: (current.totalEarned || 0) + bonusAmount
        };
    }, undefined, false);

    if (!claimTxn.committed) {
        throw new HttpsError('already-exists', 'You have already claimed today\'s reward');
    }

    // Credit bonus to deposit balance atomically
    const balTxn = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) return null;
        user.depositBalance = (user.depositBalance || 0) + bonusAmount;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    }, undefined, false);

    if (!balTxn.committed) {
        // Rollback the daily reward claim
        await rewardRef.transaction(current => {
            if (!current) return current;
            if (newStreakCount <= 1) {
                // First-ever claim failed — remove the node entirely
                return null;
            }
            // Restore previous state
            current.currentDay = claimedDay === 1 ? rewards.length : (claimedDay - 1);
            current.lastClaimDate = yesterday; // Previous claim was yesterday (streak continuing)
            current.streakCount = Math.max(0, (current.streakCount || 1) - 1);
            current.totalEarned = Math.max(0, (current.totalEarned || bonusAmount) - bonusAmount);
            return current;
        });
        throw new HttpsError('internal', 'Failed to credit reward — please try again');
    }

    // Create wallet transaction
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref(`wallet_transactions/${txnKey}`).set({
        userId: uid,
        userName: userData.fullName || userData.username || 'User',
        amount: bonusAmount,
        type: 'CREDIT',
        isCredit: true,
        reason: `Daily reward: Day ${claimedDay}`,
        description: `Day ${claimedDay} login streak — 🪙 ${bonusAmount} bonus`,
        dailyRewardDay: claimedDay,
        dailyRewardBonus: bonusAmount,
        status: 'SUCCESS',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    functions.logger.info(`[claimDailyReward] ${uid} claimed Day ${claimedDay}, bonus=₹${bonusAmount}`);

    return {
        success: true,
        bonusAmount,
        day: claimedDay,
        totalDays: rewards.length,
        streakCount: newStreakCount,
        message: `Day ${claimedDay} reward: 🪙 ${bonusAmount} credited!`
    };
});
