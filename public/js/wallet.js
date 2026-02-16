// JeetoPlay — Wallet & Transactions
// Auto-extracted from app.html

// XSS sanitization utility
function escapeHtmlWallet(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function loadWalletTransactions() {
    const container = document.getElementById('wallet-txn-history');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

    try {
        // Get limit from selector
        const limitSelect = document.getElementById('txn-limit-select');
        const limitValue = limitSelect?.value || '20';

        // IMPORTANT: Fetch ALL transactions for user, then sort and limit in JS
        // Firebase's limitToLast() with orderByChild doesn't work correctly for mixed key formats
        let query = db.ref('wallet_transactions')
            .orderByChild('userId')
            .equalTo(state.user.uid);

        const snap = await query.once('value');

        if (!snap.exists()) {
            container.innerHTML = `
                <div style="padding: 30px; text-align: center; color: var(--text-muted);">
                    <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5;"></i>
                    <p>No transactions yet</p>
                </div>
            `;
            return;
        }

        let transactions = [];
        snap.forEach(child => {
            const txn = { id: child.key, ...child.val() };
            // Filter: only show deposits that reached SUCCESS
            // Keep withdrawals in any status (money already deducted)
            // Skip PENDING, FAILED, CANCELLED, EXPIRED deposits
            if (txn.type !== 'WITHDRAW' && txn.type !== 'WITHDRAWAL') {
                const skipStatuses = ['FAILED', 'PENDING', 'CANCELLED', 'EXPIRED', 'VERIFICATION_PENDING'];
                if (skipStatuses.includes(txn.status)) {
                    return; // Skip incomplete deposit transactions
                }
            }
            transactions.push(txn);
        });

        // Sort by timestamp descending (most recent first)
        transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Apply limit AFTER sorting (not in Firebase query)
        if (limitValue !== 'all') {
            const limit = parseInt(limitValue);
            transactions = transactions.slice(0, limit);
        }

        container.innerHTML = '';
        transactions.forEach(txn => {
            const row = document.createElement('div');
            row.style.cssText = 'padding: 12px 15px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;';

            // Format reason with professional labels
            let displayReason = formatTransactionReason(txn.description || txn.reason, txn);
            let icon = getTransactionIcon(txn);
            let walletBadge = getWalletBadge(txn);

            // Handle all credit types including admin credits and match winnings
            const isCredit = txn.isCredit === true || txn.type === 'CREDIT' || txn.type === 'DEPOSIT' || txn.type === 'ADMIN_CREDIT' || txn.type === 'MATCH_WINNING';
            const colorClass = isCredit ? 'var(--success)' : '#ef4444';
            const iconBg = isCredit ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            const sign = isCredit ? '+' : '-';

            // Format timestamp
            const date = txn.timestamp ? new Date(txn.timestamp) : new Date();
            const timeStr = date.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });

            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <div style="width: 40px; height: 40px; border-radius: 50%; background: ${iconBg}; display: flex; align-items: center; justify-content: center; color: ${colorClass};">
                        <i class="${icon}"></i>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 0.9rem; font-weight: 500; margin-bottom: 2px;">${displayReason}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 8px; align-items: center;">
                            <span>${timeStr}</span>
                            ${walletBadge}
                        </div>
                    </div>
                </div>
                <div style="font-weight: 600; font-size: 1rem; color: ${colorClass};">
                    ${sign}${formatCoin(txn.amount)}
                </div>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        console.error('Load wallet transactions error:', err);
        container.innerHTML = `
            <div style="padding: 30px; text-align: center; color: var(--text-muted);">
                <i class="fa-solid fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 10px; color: #ef4444;"></i>
                <p>Error loading transactions</p>
            </div>
        `;
    }
}

// Format transaction reason with professional labels
function formatTransactionReason(reason, txn) {
    // ── 1. eSports transactions (matchId field) ──
    if (txn.matchId) {
        const gameName = txn.gameName || 'Match';
        const shortId = txn.matchShortId || txn.matchId.substring(0, 8).toUpperCase();
        const matchType = txn.matchType ? ` ${txn.matchType}` : '';

        if (txn.type === 'MATCH_WINNING') {
            return `🏆 ${gameName}${matchType} #${shortId}`;
        }
        if (txn.type === 'REWARD_ADJUSTMENT') {
            return `⚙️ ${gameName} #${shortId} Adjustment`;
        }
        // Match join (debit)
        const slots = txn.slotsBooked > 1 ? ` (${txn.slotsBooked} slots)` : '';
        return `🎮 ${gameName}${slots}`;
    }

    // ── 2. Ludo transactions (ludoMatchId field) ──
    if (txn.ludoMatchId) {
        const shortId = txn.ludoMatchId.slice(-6).toUpperCase();
        const rLower = (txn.reason || '').toLowerCase();
        // Check refund/cancel BEFORE isCredit — refunds are also credits
        if (rLower.includes('refund') || rLower.includes('cancel')) return `↩️ Ludo Refund #${shortId}`;
        if (txn.isCredit) {
            return `🎲 Ludo Won #${shortId}`;
        }
        if (rLower.includes('rematch')) return `🎲 Ludo Rematch #${shortId}`;
        if (rLower.includes('joined') || rLower.includes('join')) return `🎲 Ludo Joined #${shortId}`;
        if (rLower.includes('created') || rLower.includes('create')) return `🎲 Ludo Challenge #${shortId}`;
        return `🎲 Ludo #${shortId}`;
    }

    // ── 3. Tournament transactions (tournamentId field) ──
    if (txn.tournamentId) {
        const name = txn.gameName || txn.description?.replace(/Tournament.*?:/i, '').trim() || 'Tournament';
        if (txn.type === 'TOURNAMENT_REFUND' || txn.isCredit) {
            return `↩️ Tournament Refund`;
        }
        return `🏅 Tournament Entry`;
    }

    // ── 4. Admin wallet operations (adminId but NO game IDs) ──
    if (txn.adminId) {
        const isCredit = txn.isCredit === true || txn.type === 'CREDIT';
        const actionEmoji = isCredit ? '💰' : '🔻';
        const actionWord = isCredit ? 'Credit' : 'Debit';
        const adminReason = txn.reason ? ` • ${txn.reason}` : '';
        return `${actionEmoji} Admin ${actionWord}${adminReason}`;
    }

    // ── 5. Other known types ──
    if (!reason) {
        if (txn.type === 'DEPOSIT') return '💳 Deposit Money';
        if (txn.type === 'WITHDRAW' || txn.type === 'WITHDRAWAL') return '🏧 Withdrawal Request';
        if (txn.type === 'CREDIT') return 'Credited';
        if (txn.type === 'ADMIN_CREDIT') return '💰 Admin Credit';
        if (txn.type === 'ADMIN_DEBIT') return '🔻 Admin Debit';
        if (txn.type === 'MATCH_WINNING') return '🏆 Match Reward';
        if (txn.type === 'REWARD_ADJUSTMENT') return '⚙️ Reward Adjustment';
        return 'Debited';
    }

    const rLower = reason.toLowerCase();

    // Match related
    if (rLower.includes('joined match') || rLower.includes('join match')) {
        const matchName = reason.replace(/joined match:?/i, '').replace(/join match:?/i, '').trim();
        return '🎮 ' + (matchName || 'Match Joined');
    }
    if (rLower.includes('refund')) {
        if (rLower.includes('withdrawal') || rLower.includes('withdraw')) return '💳 Withdrawal Refund';
        if (rLower.includes('ludo')) return '↩️ Ludo Refund';
        return '↩️ Refund';
    }
    if (rLower.includes('winning') || rLower.includes('prize') || rLower.includes('reward')) return '🏆 Match Reward';
    if (rLower.includes('kill reward')) return '🎯 Kill Reward';
    if (rLower.includes('deposit')) return '💳 Deposit Money';
    if (rLower.includes('withdraw')) return '🏧 Withdrawal Request';
    if (rLower.includes('result') && rLower.includes('adjust')) return '⚙️ Result Adjustment';
    if (rLower.includes('promo code') || rLower.includes('coupon')) return '🎟️ Promo Bonus';

    // Fallback: Capitalize first letter
    return reason.charAt(0).toUpperCase() + reason.slice(1);
}

// Get appropriate icon for transaction type
function getTransactionIcon(txn) {
    // Game-specific icons first
    if (txn.matchId) {
        if (txn.type === 'MATCH_WINNING' || txn.type === 'REWARD_ADJUSTMENT') return 'fa-solid fa-trophy';
        return 'fa-solid fa-gamepad';
    }
    if (txn.ludoMatchId) {
        const rLower = (txn.reason || '').toLowerCase();
        if (rLower.includes('refund') || rLower.includes('cancel')) return 'fa-solid fa-rotate-left';
        if (txn.isCredit) return 'fa-solid fa-trophy';
        return 'fa-solid fa-dice';
    }
    if (txn.tournamentId) {
        if (txn.isCredit) return 'fa-solid fa-medal';
        return 'fa-solid fa-flag-checkered';
    }

    // Admin wallet operations
    if (txn.adminId) return 'fa-solid fa-user-shield';

    // Legacy type checks
    if (txn.type === 'ADMIN_CREDIT' || txn.type === 'ADMIN_DEBIT') return 'fa-solid fa-user-shield';
    if (txn.type === 'MATCH_WINNING' || txn.type === 'REWARD_ADJUSTMENT') return 'fa-solid fa-trophy';

    const reason = (txn.description || txn.reason || '').toLowerCase();
    if (reason.includes('match') || reason.includes('join')) return 'fa-solid fa-gamepad';
    if (reason.includes('refund') && (reason.includes('withdrawal') || reason.includes('withdraw'))) return 'fa-solid fa-money-bill-transfer';
    if (reason.includes('refund')) return 'fa-solid fa-rotate-left';
    if (reason.includes('daily reward') || txn.dailyRewardBonus > 0) return 'fa-solid fa-gift';
    if (reason.includes('spin wheel') || txn.spinWheelPrize > 0) return 'fa-solid fa-dharmachakra';
    if (reason.includes('vip') || txn.vipPurchase || txn.vipBonus > 0) return 'fa-solid fa-crown';
    if (reason.includes('winning') || reason.includes('prize') || reason.includes('reward')) return 'fa-solid fa-trophy';
    if (reason.includes('deposit')) return 'fa-solid fa-wallet';
    if (reason.includes('withdraw')) return 'fa-solid fa-money-bill-transfer';
    if (reason.includes('promo') || reason.includes('coupon')) return 'fa-solid fa-ticket';

    return txn.type === 'CREDIT' ? 'fa-solid fa-arrow-down' : 'fa-solid fa-arrow-up';
}

// Get wallet badge (Deposit/Winning)
function getWalletBadge(txn) {
    // Game-specific badges — show game type
    if (txn.matchId) {
        const mode = txn.matchType || '';
        return `<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(99, 102, 241, 0.2); color: #818cf8;">eSports${mode ? ' ' + mode : ''}</span>`;
    }
    if (txn.ludoMatchId) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 146, 60, 0.2); color: #fb923c;">Ludo</span>';
    }
    if (txn.tournamentId) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(168, 85, 247, 0.2); color: #a855f7;">Tournament</span>';
    }

    // Admin wallet operations — show wallet type
    if (txn.adminId && txn.walletType) {
        if (txn.walletType === 'winning') {
            return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 191, 36, 0.2); color: #fbbf24;">Winning</span>';
        }
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(77, 208, 225, 0.2); color: #4dd0e1;">Deposit</span>';
    }

    // Special transaction badges
    if (txn.depositRefund > 0 && txn.winningRefund > 0) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(99, 102, 241, 0.2); color: #818cf8;">Both</span>';
    }
    if (txn.couponBonus > 0) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(168, 85, 247, 0.2); color: #a855f7;">Promo Bonus</span>';
    }
    if (txn.vipBonus > 0) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(250, 204, 21, 0.2); color: #facc15;">VIP Bonus</span>';
    }
    if (txn.vipPurchase) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(250, 204, 21, 0.2); color: #facc15;">VIP Purchase</span>';
    }
    if (txn.spinWheelPrize > 0) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(236, 72, 153, 0.2); color: #ec4899;">Spin Prize</span>';
    }
    if (txn.dailyRewardBonus > 0) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 146, 60, 0.2); color: #fb923c;">Daily Bonus</span>';
    }

    // Default based on wallet type field or transaction type
    if (txn.walletType === 'winning' || (txn.type === 'CREDIT' && (txn.reason || '').toLowerCase().includes('winning'))) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 191, 36, 0.2); color: #fbbf24;">Winnings</span>';
    }

    return '';
}

// Profile menu helper functions
// Profile menu helper functions

// --- WALLET FUNCTIONS ---\n        // Main wallet functions are defined later in the file

window.openWithdrawModal = async function () {
    const winningBal = state.userData?.winningBalance || 0;
    document.getElementById('withdraw-available').innerHTML = formatCoin(winningBal);
    document.getElementById('withdraw-amount').value = '';

    // Pre-fill UPI from profile if saved
    const savedUpi = state.userData?.upiId || '';
    document.getElementById('withdraw-upi').value = savedUpi;

    // Fetch and show dynamic min amount
    let minWithdrawal = 10;
    try {
        const cfgSnap = await db.ref('platform_config/payments/min_withdrawal').once('value');
        if (cfgSnap.exists()) minWithdrawal = parseInt(cfgSnap.val()) || 10;
    } catch (e) { /* use fallback */ }

    const amountInput = document.getElementById('withdraw-amount');
    amountInput.min = minWithdrawal;
    amountInput.placeholder = `Min ${minWithdrawal} coins`;

    document.getElementById('withdraw-modal').classList.remove('hidden');
};

window.processDeposit = async function () {
    const amount = parseInt(document.getElementById('deposit-amount').value);
    if (!amount || amount < 1) {
        return showToast('Please select a deposit amount', 'error');
    }

    showToast('Processing deposit...', 'success');
    closeModal('deposit-modal');

    try {
        const uid = state.user.uid;
        const currentDeposit = state.userData?.depositBalance || 0;

        // Create deposit record first (PENDING for gateway flow)
        const depositId = db.ref('deposits').push().key;
        await db.ref('deposits/' + depositId).set({
            userId: uid,
            userName: state.userData?.fullName || state.userData?.username || 'User',
            amount: amount,
            source: 'UPI_GATEWAY',
            status: 'PENDING',
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            balanceBefore: currentDeposit
        });

        // SIMULATED: In production, redirect to gateway here
        // For now, simulate successful payment after 1 second
        setTimeout(async () => {
            try {
                // Call Cloud Function for secure balance credit
                const processDepositFn = functions.httpsCallable('processDeposit');
                const result = await processDepositFn({ amount, depositId });

                // Update local state from server response
                state.userData.depositBalance = result.data.newBalance;
                updateUIHeader();

                showToast(formatCoinText(amount) + ' deposited successfully!', 'success');
            } catch (err) {
                await db.ref('deposits/' + depositId).update({ status: 'FAILED' });
                showToast('Deposit failed: ' + (err.message || 'Unknown error'), 'error');
            }
        }, 1000);

    } catch (err) {
        showToast('Deposit failed: ' + err.message, 'error');
    }
};

window.processWithdraw = async function () {
    // Prevent duplicate submissions
    if (window._withdrawInProgress) {
        return showToast('Withdrawal already in progress...', 'error');
    }

    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const upi = document.getElementById('withdraw-upi').value.trim();

    const winningBal = state.userData?.winningBalance || 0;

    // Fetch admin-configured minimum withdrawal
    let minWithdrawal = 10; // fallback
    try {
        const cfgSnap = await db.ref('platform_config/payments/min_withdrawal').once('value');
        if (cfgSnap.exists()) {
            minWithdrawal = parseInt(cfgSnap.val()) || 10;
        }
    } catch (e) {
        console.warn('Could not fetch min_withdrawal config, using default 10 coins');
    }

    if (!amount || amount < minWithdrawal) {
        return showToast(`Minimum withdrawal is ${formatCoinText(minWithdrawal)}`, 'error');
    }
    if (amount > winningBal) {
        return showToast(`Insufficient winning balance. You have ${formatCoinText(winningBal)}`, 'error');
    }
    if (!upi || !upi.includes('@')) {
        return showToast('Enter a valid UPI ID', 'error');
    }

    window._withdrawInProgress = true;

    try {
        // Call Cloud Function for secure withdrawal
        const processWithdrawalFn = functions.httpsCallable('processWithdrawal');
        const result = await processWithdrawalFn({ amount, upiId: upi });

        // Update local state from server response
        state.userData.winningBalance = result.data.balanceAfter;
        updateUIHeader();

        closeModal('withdraw-modal');
        showToast('Withdrawal request submitted! You will be notified once processed.', 'success');

        // Refresh transactions
        if (typeof loadWalletTransactions === 'function') {
            loadWalletTransactions();
        }
    } catch (err) {
        const msg = err.details || err.message || 'Unknown error';
        showToast('Withdrawal failed: ' + msg, 'error');
    } finally {
        window._withdrawInProgress = false;
    }
};

// --- VIEW MATCH RESULTS ---
// NOTE: viewMatchResults is now defined in esports.js with enhanced UI
// (position rewards, user highlighting, team mode support).
// The function is global (window.viewMatchResults) and esports.js loads after wallet.js.

// ─── Coupon / Promo Code Redemption ─────────────────────────

window.redeemCouponCode = async function () {
    const input = document.getElementById('promo-code-input');
    const btn = document.getElementById('apply-promo-btn');
    const resultDiv = document.getElementById('promo-result');
    const code = (input?.value || '').trim();

    if (!code || code.length < 3) {
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(239, 68, 68, 0.1)';
        resultDiv.style.color = '#ef4444';
        resultDiv.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Enter a valid promo code';
        return;
    }

    // Disable button & show loading
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    resultDiv.style.display = 'none';

    try {
        const redeemFn = functions.httpsCallable('redeemCoupon');
        const result = await redeemFn({ code });

        // Show success
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(16, 185, 129, 0.12)';
        resultDiv.style.color = '#10b981';
        resultDiv.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${result.data.message}`;

        // Clear input
        input.value = '';

        // Refresh balance from server
        const userSnap = await db.ref('users/' + state.user.uid).once('value');
        const userData = userSnap.val();
        if (userData) {
            state.userData.depositBalance = userData.depositBalance || 0;
            state.userData.winningBalance = userData.winningBalance || 0;
            updateUIHeader();

            // Also update wallet view balances if visible
            const depEl = document.getElementById('wallet-deposit-bal');
            const winEl = document.getElementById('wallet-winning-bal');
            const totEl = document.getElementById('wallet-total-bal');
            if (depEl) depEl.innerHTML = formatCoin(userData.depositBalance || 0);
            if (winEl) winEl.innerHTML = formatCoin(userData.winningBalance || 0);
            if (totEl) totEl.innerHTML = formatCoin((userData.depositBalance || 0) + (userData.winningBalance || 0));
        }

        // Refresh transactions
        if (typeof loadWalletTransactions === 'function') {
            loadWalletTransactions();
        }

        showToast(`🎟️ ${formatCoinText(result.data.bonusAmount)} bonus credited!`, 'success');

    } catch (err) {
        const msg = err.details || err.message || 'Failed to redeem coupon';
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'rgba(239, 68, 68, 0.1)';
        resultDiv.style.color = '#ef4444';
        resultDiv.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${msg}`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Apply';
    }
};
