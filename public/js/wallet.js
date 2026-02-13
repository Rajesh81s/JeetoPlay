// JeetoPlay — Wallet & Transactions
// Auto-extracted from app.html

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
                    ${sign}₹${txn.amount}
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
    // Handle cases where reason is missing or generic
    if (!reason) {
        if (txn.type === 'DEPOSIT') return 'Deposit Money';
        if (txn.type === 'WITHDRAW') return 'Withdrawal Request';
        if (txn.type === 'CREDIT') return 'Credited';
        if (txn.type === 'ADMIN_CREDIT') return '💰 Admin Credit';
        if (txn.type === 'ADMIN_DEBIT') return '⚠️ Admin Debit';
        if (txn.type === 'MATCH_WINNING') return '🏆 Match Reward';
        if (txn.type === 'REWARD_ADJUSTMENT') return '⚙️ Reward Adjustment';
        return 'Debited';
    }

    const rLower = reason.toLowerCase();

    // Admin related
    if (rLower.includes('admin') && (rLower.includes('credit') || rLower.includes('deposit') || rLower.includes('add'))) {
        return '💰 Admin Credit';
    }

    // Match related - use game details if available
    if (rLower.includes('joined match') || rLower.includes('join match')) {
        const matchName = reason.replace(/joined match:?/i, '').replace(/join match:?/i, '').trim();
        return '🎮 ' + (matchName || 'Match Joined');
    }
    if (rLower.includes('refund')) {
        if (rLower.includes('withdrawal') || rLower.includes('withdraw')) {
            return '💳 Withdrawal Refund';
        }
        return '↩️ Match Refund';
    }

    // Match winnings - show game name and match ID if available
    if (txn.type === 'MATCH_WINNING' || txn.type === 'REWARD_ADJUSTMENT') {
        const gameName = txn.gameName || '';
        const matchType = txn.matchType || '';
        const matchShortId = txn.matchShortId || '';
        const isWinning = txn.isCredit !== false && txn.type === 'MATCH_WINNING';

        if (gameName && matchShortId) {
            const emoji = isWinning ? '🏆' : '⚙️';
            const typeText = matchType ? ` ${matchType}` : '';
            return `${emoji} ${gameName}${typeText} #${matchShortId}`;
        }
        return isWinning ? '🏆 Match Reward' : '⚙️ Reward Adjustment';
    }

    // Legacy match winning detection
    if (rLower.includes('winning') || rLower.includes('prize') || rLower.includes('reward')) {
        return '🏆 Match Reward';
    }
    if (rLower.includes('kill reward')) {
        return '🎯 Kill Reward';
    }

    // Deposits
    if (rLower.includes('deposit')) {
        return '💳 Deposit Money';
    }

    // Withdrawals
    if (rLower.includes('withdraw')) {
        return '🏧 Withdrawal Request';
    }

    // Result adjustment
    if (rLower.includes('result') && rLower.includes('adjust')) {
        return '⚙️ Result Adjustment';
    }

    // Fallback: Capitalize first letter
    return reason.charAt(0).toUpperCase() + reason.slice(1);
}

// Get appropriate icon for transaction type
function getTransactionIcon(txn) {
    const reason = (txn.description || txn.reason || '').toLowerCase();

    // Check type first for admin and match transactions
    if (txn.type === 'ADMIN_CREDIT' || txn.type === 'ADMIN_DEBIT') return 'fa-solid fa-user-shield';
    if (txn.type === 'MATCH_WINNING' || txn.type === 'REWARD_ADJUSTMENT') return 'fa-solid fa-trophy';

    if (reason.includes('admin')) return 'fa-solid fa-user-shield';
    if (reason.includes('match') || reason.includes('join')) return 'fa-solid fa-gamepad';
    if (reason.includes('refund') && (reason.includes('withdrawal') || reason.includes('withdraw'))) return 'fa-solid fa-money-bill-transfer';
    if (reason.includes('refund')) return 'fa-solid fa-rotate-left';
    if (reason.includes('winning') || reason.includes('prize') || reason.includes('reward')) return 'fa-solid fa-trophy';
    if (reason.includes('deposit')) return 'fa-solid fa-wallet';
    if (reason.includes('withdraw')) return 'fa-solid fa-money-bill-transfer';

    return txn.type === 'CREDIT' ? 'fa-solid fa-arrow-down' : 'fa-solid fa-arrow-up';
}

// Get wallet badge (Deposit/Winning)
function getWalletBadge(txn) {
    // Check if we have deposit/winning refund info
    if (txn.depositRefund > 0 && txn.winningRefund > 0) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(99, 102, 241, 0.2); color: #818cf8;">Both</span>';
    }
    if (txn.depositRefund > 0 || (txn.balanceAfter?.deposit !== txn.balanceBefore?.deposit)) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(16, 185, 129, 0.2); color: var(--success);">Deposit</span>';
    }
    if (txn.winningRefund > 0 || (txn.balanceAfter?.winning !== txn.balanceBefore?.winning)) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 191, 36, 0.2); color: #fbbf24;">Winnings</span>';
    }

    // Default based on transaction type
    if (txn.type === 'CREDIT' && (txn.reason || '').toLowerCase().includes('winning')) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 191, 36, 0.2); color: #fbbf24;">Winnings</span>';
    }

    return '';
}

// Profile menu helper functions
// Profile menu helper functions

// --- WALLET FUNCTIONS ---\n        // Main wallet functions are defined later in the file

window.openWithdrawModal = async function () {
    const winningBal = state.userData?.winningBalance || 0;
    document.getElementById('withdraw-available').innerText = '₹' + winningBal;
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
    amountInput.placeholder = `Min ₹${minWithdrawal}`;

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

                showToast('₹' + amount + ' deposited successfully!', 'success');
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
        console.warn('Could not fetch min_withdrawal config, using default ₹10');
    }

    if (!amount || amount < minWithdrawal) {
        return showToast(`Minimum withdrawal is ₹${minWithdrawal}`, 'error');
    }
    if (amount > winningBal) {
        return showToast(`Insufficient winning balance. You have ₹${winningBal}`, 'error');
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
window.viewMatchResults = async function (matchId) {
    const listEl = document.getElementById('match-results-list');
    listEl.innerHTML = '<div style="text-align:center; padding:20px;">Loading...</div>';
    document.getElementById('match-results-modal').classList.remove('hidden');

    try {
        const matchSnap = await db.ref('esports_matches/' + matchId).once('value');
        const match = matchSnap.val();

        document.getElementById('result-match-title').innerText = match?.title || 'Match Results';

        const participants = match?.participants || {};
        const results = match?.results || {};

        if (Object.keys(results).length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Results not yet declared</div>';
            return;
        }

        listEl.innerHTML = '';

        // Sort by position
        const sortedResults = Object.entries(results).sort((a, b) => (a[1].position || 999) - (b[1].position || 999));

        sortedResults.forEach(([pKey, result], idx) => {
            const participant = participants[pKey] || {};
            const item = document.createElement('div');
            item.style.padding = '12px';
            item.style.borderBottom = '1px solid var(--border)';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';

            const positionIcon = result.position <= 3 ? ['🥇', '🥈', '🥉'][result.position - 1] : '#' + result.position;

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                        ${positionIcon}
                    </div>
                    <div>
                        <div style="font-weight: 600;">${participant.ign || 'Player'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">Kills: ${result.kills || 0}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 700; color: var(--primary);">₹${result.reward || 0}</div>
                </div>
            `;
            listEl.appendChild(item);
        });
    } catch (err) {
        listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--danger);">Error loading results</div>';
    }
};

