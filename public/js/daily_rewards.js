// JeetoPlay — Daily Rewards / Login Streak
// Auto-triggers on login, shows premium popup, handles claim

const DR_DEFAULT_REWARDS = [1, 1, 2, 2, 3, 5, 9];

/**
 * Get today's date string in IST (India Standard Time)
 */
function getDRTodayIST() {
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return istDate.toISOString().split('T')[0];
}

function getDRYesterdayIST() {
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
    return istDate.toISOString().split('T')[0];
}

/**
 * Check if daily reward is available — called after auth
 */
window.checkDailyReward = async function () {
    if (!state.user) return;

    try {
        // Check if feature is enabled
        const configSnap = await db.ref('daily_rewards_config').once('value');
        const config = configSnap.val() || {};
        if (config.enabled === false) return;

        const rewards = config.rewards || DR_DEFAULT_REWARDS;
        const today = getDRTodayIST();
        const yesterday = getDRYesterdayIST();

        // Get user's daily reward state
        const rewardSnap = await db.ref(`users/${state.user.uid}/dailyReward`).once('value');
        const rewardData = rewardSnap.val();

        // Already claimed today — don't show
        if (rewardData && rewardData.lastClaimDate === today) return;

        // Calculate which day to show
        let showDay;
        if (!rewardData) {
            showDay = 1; // First ever
        } else if (rewardData.lastClaimDate === yesterday) {
            showDay = (rewardData.currentDay || 0) + 1;
            if (showDay > rewards.length) showDay = 1;
        } else {
            showDay = 1; // Streak broken
        }

        // Show the popup
        renderDailyRewardPopup(rewards, showDay, rewardData);
    } catch (err) {
        console.error('[DailyReward] Check error:', err);
    }
};

/**
 * Render the 7-day streak circles + popup
 */
function renderDailyRewardPopup(rewards, todayDay, rewardData) {
    const container = document.getElementById('daily-reward-days');
    if (!container) return;

    const streakCount = rewardData ? (rewardData.streakCount || 0) : 0;
    const previousDay = rewardData ? (rewardData.currentDay || 0) : 0;

    // Determine which days are "claimed" in current cycle
    // If streak is continuing, days before todayDay are claimed
    // If streak broke (todayDay === 1 and previousDay > 1), nothing is claimed
    const streakContinuing = todayDay > 1;

    container.innerHTML = '';

    for (let i = 1; i <= rewards.length; i++) {
        const amount = rewards[i - 1];
        const circle = document.createElement('div');
        circle.className = 'dr-day-circle';

        if (i === todayDay) {
            // Today — claimable
            circle.classList.add('dr-day-today');
            circle.innerHTML = `
                <span class="dr-day-amount">🪙${amount}</span>
                <span class="dr-day-label">Day ${i}</span>
            `;
        } else if (streakContinuing && i < todayDay) {
            // Already claimed in this cycle
            circle.classList.add('dr-day-claimed');
            circle.innerHTML = `
                <i class="fa-solid fa-check" style="font-size:0.8rem;"></i>
                <span class="dr-day-label">Day ${i}</span>
            `;
        } else {
            // Future / locked
            circle.classList.add('dr-day-locked');
            circle.innerHTML = `
                <span class="dr-day-amount">🪙${amount}</span>
                <span class="dr-day-label">Day ${i}</span>
            `;
        }

        // Day 7 jackpot glow
        if (i === rewards.length && i !== todayDay) {
            circle.style.border = '1px solid rgba(236,72,153,0.3)';
            circle.title = '🎰 Jackpot Day!';
        }

        container.appendChild(circle);
    }

    // Update amount display
    const todayAmount = rewards[todayDay - 1] || 1;
    document.getElementById('daily-reward-amount').textContent = `🪙 ${todayAmount}`;
    document.getElementById('daily-reward-day-label').textContent =
        todayDay === rewards.length ? `Day ${todayDay} — 🎰 Jackpot!` : `Day ${todayDay} Reward`;
    document.getElementById('daily-reward-streak').textContent =
        streakCount > 0 ? `🔥 ${streakCount} day streak` : '🔥 Start your streak today!';

    // Reset claim button
    const btn = document.getElementById('daily-reward-claim-btn');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-hand-sparkles"></i> Claim Reward';
    btn.style.opacity = '1';

    // Show modal
    const modal = document.getElementById('daily-reward-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

/**
 * Close daily reward popup
 */
window.closeDailyReward = function () {
    const modal = document.getElementById('daily-reward-modal');
    modal.style.display = 'none';
    modal.classList.add('hidden');
};

/**
 * Claim today's reward — calls Cloud Function
 */
window.claimDailyRewardUI = async function () {
    const btn = document.getElementById('daily-reward-claim-btn');
    if (btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Claiming...';

    try {
        const claimFn = functions.httpsCallable('claimDailyReward');
        const result = await claimFn({});
        const data = result.data;

        // Success animation
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        btn.innerHTML = `<i class="fa-solid fa-check-circle"></i> 🪙 ${data.bonusAmount} Claimed!`;

        // Update streak text
        document.getElementById('daily-reward-streak').textContent =
            `🔥 ${data.streakCount} day streak`;

        // Mark today's circle as claimed
        const circles = document.querySelectorAll('#daily-reward-days .dr-day-circle');
        circles.forEach((c, idx) => {
            if (idx === data.day - 1) {
                c.className = 'dr-day-circle dr-day-claimed';
                c.style.transform = 'scale(1.15)';
                c.innerHTML = `
                    <i class="fa-solid fa-check" style="font-size:0.8rem;"></i>
                    <span class="dr-day-label">Day ${data.day}</span>
                `;
            }
        });

        // Confetti burst!
        spawnConfetti();

        // Update balance in header
        if (typeof updateUIHeader === 'function') updateUIHeader();

        // Show toast
        if (typeof showToast === 'function') {
            showToast(`🪙 ${data.bonusAmount} daily reward claimed! 🎁`, 'success');
        }

        // Auto close after 2.5s
        setTimeout(() => closeDailyReward(), 2500);

    } catch (err) {
        console.error('[DailyReward] Claim error:', err);
        btn.disabled = false;
        btn.style.background = 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)';

        if (err.code === 'already-exists') {
            btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Already Claimed Today';
            btn.disabled = true;
            setTimeout(() => closeDailyReward(), 1500);
        } else {
            btn.innerHTML = '<i class="fa-solid fa-hand-sparkles"></i> Claim Reward';
            if (typeof showToast === 'function') {
                showToast(err.message || 'Failed to claim reward', 'error');
            }
        }
    }
};

/**
 * Spawn confetti particles on successful claim
 */
function spawnConfetti() {
    const card = document.getElementById('daily-reward-card');
    if (!card) return;

    const colors = ['#a855f7', '#ec4899', '#10b981', '#fbbf24', '#3b82f6', '#ef4444'];
    const emojis = ['🎉', '✨', '💰', '🎁', '⭐', '🔥'];

    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        const isEmoji = Math.random() > 0.5;

        particle.textContent = isEmoji ? emojis[Math.floor(Math.random() * emojis.length)] : '';
        particle.style.cssText = `
            position: absolute;
            ${isEmoji ? 'font-size: 1.2rem;' : `
                width: 8px; height: 8px; border-radius: 50%;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
            `}
            left: ${20 + Math.random() * 60}%;
            bottom: 40%;
            pointer-events: none;
            animation: confetti ${0.8 + Math.random() * 0.8}s ease-out forwards;
            animation-delay: ${Math.random() * 0.3}s;
            z-index: 100;
        `;
        card.appendChild(particle);

        // Cleanup
        setTimeout(() => particle.remove(), 2000);
    }
}
