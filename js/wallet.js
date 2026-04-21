// JeetoPlay — Wallet & Transactions
// Auto-extracted from app.html

// XSS sanitization utility
function escapeHtmlWallet(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Mask UPI ID for privacy display (e.g., 'rajesh@upi' → 'r****@upi')
function maskUPI(upi) {
    if (!upi || !upi.includes('@')) return '';
    const [name, provider] = upi.split('@');
    if (name.length <= 2) return name[0] + '***@' + provider;
    return name[0] + '****@' + provider;
}

async function loadWalletTransactions() {
    const container = document.getElementById('wallet-txn-history');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

    try {
        // Get limit from selector
        const limitSelect = document.getElementById('txn-limit-select');
        const limitValue = limitSelect?.value || '20';

        // Supabase: fetch transactions for this user, filtered and sorted server-side
        const { data: txnRows, error: txnErr } = await supa.from('transactions')
            .select('*')
            .eq('user_uid', state.user.uid)
            .order('created_at', { ascending: false })
            .limit(limitValue === 'all' ? 1000 : parseInt(limitValue));

        if (txnErr || !txnRows || txnRows.length === 0) {
            container.innerHTML = `
                <div style="padding: 30px; text-align: center; color: var(--text-muted);">
                    <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5;"></i>
                    <p>No transactions yet</p>
                </div>
            `;
            return;
        }

        let transactions = txnRows.map(t => ({
            id: t.id,
            type: t.type,
            amount: parseFloat(t.amount || 0),
            description: t.description,
            reason: t.description,
            status: t.status,
            timestamp: t.created_at ? new Date(t.created_at).getTime() : 0,
            userId: t.user_uid,
            matchId: t.match_id,
            balanceType: t.balance_type,
            fromDeposit: parseFloat(t.from_deposit || 0),
            fromWinning: parseFloat(t.from_winning || 0),
            isCredit: ['CREDIT', 'DEPOSIT', 'ADMIN_CREDIT', 'MATCH_WINNING', 'TOURNAMENT_PRIZE'].includes(t.type),
            // Preserve any extra fields stored in description JSON
            ...((() => { try { return JSON.parse(t.description); } catch(e) { return {}; } })())
        })).filter(txn => {
            // Filter: skip incomplete deposit transactions
            if (txn.type !== 'WITHDRAW' && txn.type !== 'WITHDRAWAL') {
                const skipStatuses = ['FAILED', 'PENDING', 'CANCELLED', 'EXPIRED', 'VERIFICATION_PENDING'];
                if (skipStatuses.includes(txn.status)) return false;
            }
            return true;
        });

        // Already sorted and limited by Supabase query

        container.innerHTML = '';
        transactions.forEach(txn => {
            const row = document.createElement('div');
            const isWithdrawal = txn.type === 'WITHDRAW' || txn.type === 'WITHDRAWAL';
            row.style.cssText = 'padding: 12px 15px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;';

            // Format reason with professional labels
            let displayReason = formatTransactionReason(txn.description || txn.reason, txn);
            let icon = getTransactionIcon(txn);
            let walletBadge = getWalletBadge(txn);
            let withdrawalStatusHtml = isWithdrawal ? getWithdrawalStatusTracker(txn) : '';

            // Handle all credit types including admin credits and match winnings
            const isCredit = txn.isCredit === true || txn.type === 'CREDIT' || txn.type === 'DEPOSIT' || txn.type === 'ADMIN_CREDIT' || txn.type === 'MATCH_WINNING';
            const colorClass = isCredit ? 'var(--success)' : '#ef4444';
            const iconBg = isCredit ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            const sign = isCredit ? '+' : '-';

            // Withdrawal-specific icon colors based on status
            let wIconBg = iconBg;
            let wColorClass = colorClass;
            if (isWithdrawal) {
                const wStatus = (txn.status || 'PENDING').toUpperCase();
                if (wStatus === 'COMPLETED') {
                    wIconBg = 'rgba(16, 185, 129, 0.15)';
                    wColorClass = '#10b981';
                } else if (wStatus === 'APPROVED') {
                    wIconBg = 'rgba(59, 130, 246, 0.15)';
                    wColorClass = '#3b82f6';
                } else if (wStatus === 'REJECTED') {
                    wIconBg = 'rgba(239, 68, 68, 0.15)';
                    wColorClass = '#ef4444';
                } else {
                    wIconBg = 'rgba(251, 191, 36, 0.15)';
                    wColorClass = '#fbbf24';
                }
            }

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
                    <div style="width: 40px; height: 40px; border-radius: 50%; background: ${isWithdrawal ? wIconBg : iconBg}; display: flex; align-items: center; justify-content: center; color: ${isWithdrawal ? wColorClass : colorClass};">
                        <i class="${icon}"></i>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 0.9rem; font-weight: 500; margin-bottom: 2px;">${displayReason}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <span>${timeStr}</span>
                            ${walletBadge}
                        </div>
                        ${withdrawalStatusHtml}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; font-size: 1rem; color: ${colorClass};">
                        ${sign}${formatCoin(isWithdrawal && txn.feeAmount > 0 ? txn.payoutAmount : txn.amount)}
                    </div>
                    ${isWithdrawal && txn.feeAmount > 0 ? `<div style="font-size: 0.68rem; color: #fbbf24; font-weight: 500; margin-top: 1px;">Fee: ${formatCoin(txn.feeAmount)}</div>` : ''}
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
    // ── 0. Withdrawal transactions — status-aware labels ──
    if (txn.type === 'WITHDRAW' || txn.type === 'WITHDRAWAL') {
        const upi = txn.upiId || '';
        const maskedUPI = upi ? maskUPI(upi) : '';
        const upiSuffix = maskedUPI ? ` · ${maskedUPI}` : '';
        const wStatus = (txn.status || 'PENDING').toUpperCase();
        if (wStatus === 'COMPLETED') return `💸 Withdrawal Sent${upiSuffix}`;
        if (wStatus === 'APPROVED') return `✅ Withdrawal Approved${upiSuffix}`;
        if (wStatus === 'REJECTED') return `❌ Withdrawal Rejected`;
        return `🏧 Withdrawal Request${upiSuffix}`;
    }

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

    // ── 2. Ludo P2P transactions (ludoMatchId field) ──
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

    // ── 2b. Ludo Arena transactions (ludoAIMatchId field) ──
    if (txn.ludoAIMatchId || txn.ludoPvPMatchId) {
        const matchKey = txn.ludoAIMatchId || txn.ludoPvPMatchId;
        const shortId = matchKey.slice(-6).toUpperCase();
        const label = 'Ludo';
        const rLower = (txn.reason || '').toLowerCase();
        if (rLower.includes('refund') || rLower.includes('cancel')) return `↩️ ${label} Refund #${shortId}`;
        if (txn.isCredit) return `🏆 ${label} Won #${shortId}`;
        return `🎲 ${label} Entry #${shortId}`;
    }

    // ── 3. Tournament transactions (tournamentId field) ──
    if (txn.tournamentId) {
        const rLower = (txn.reason || '').toLowerCase();
        // Prize winning — check type first (most specific)
        if (txn.type === 'TOURNAMENT_PRIZE') {
            const placeLabel = txn.place ? ` (#${txn.place})` : '';
            return `🏆 Tournament Win${placeLabel}`;
        }
        // Refund — cancelled tournaments or admin refunds
        if (txn.type === 'TOURNAMENT_REFUND' || rLower.includes('refund') || rLower.includes('cancel')) {
            return `↩️ Tournament Refund`;
        }
        // Entry fee debit
        if (!txn.isCredit) {
            return `🏅 Tournament Entry`;
        }
        // Fallback for any other credit
        return `🏆 Tournament Won`;
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
    if (rLower.includes('watch') && rLower.includes('earn')) return '📺 Watch & Earn';
    if (rLower.includes('ad reward')) return '📺 Ad Reward';
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
    // Withdrawal-specific icons based on status
    if (txn.type === 'WITHDRAW' || txn.type === 'WITHDRAWAL') {
        const wStatus = (txn.status || 'PENDING').toUpperCase();
        if (wStatus === 'COMPLETED') return 'fa-solid fa-circle-check';
        if (wStatus === 'APPROVED') return 'fa-solid fa-hourglass-half';
        if (wStatus === 'REJECTED') return 'fa-solid fa-circle-xmark';
        if (wStatus === 'FLAGGED') return 'fa-solid fa-shield-halved';
        return 'fa-solid fa-clock';
    }

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
    if (txn.ludoAIMatchId || txn.ludoPvPMatchId) {
        const rLower = (txn.reason || '').toLowerCase();
        if (rLower.includes('refund') || rLower.includes('cancel')) return 'fa-solid fa-rotate-left';
        if (txn.isCredit) return 'fa-solid fa-trophy';
        return 'fa-solid fa-dice';
    }
    if (txn.tournamentId) {
        if (txn.type === 'TOURNAMENT_PRIZE') return 'fa-solid fa-trophy';
        if (txn.type === 'TOURNAMENT_REFUND' || (txn.reason || '').toLowerCase().includes('refund')) return 'fa-solid fa-rotate-left';
        if (txn.isCredit) return 'fa-solid fa-trophy';
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
    if (reason.includes('watch') && reason.includes('earn')) return 'fa-solid fa-tv';
    if (reason.includes('ad reward')) return 'fa-solid fa-tv';
    if (reason.includes('winning') || reason.includes('prize') || reason.includes('reward')) return 'fa-solid fa-trophy';
    if (reason.includes('deposit')) return 'fa-solid fa-wallet';
    if (reason.includes('withdraw')) return 'fa-solid fa-money-bill-transfer';
    if (reason.includes('promo') || reason.includes('coupon')) return 'fa-solid fa-ticket';

    return txn.type === 'CREDIT' ? 'fa-solid fa-arrow-down' : 'fa-solid fa-arrow-up';
}

// Get wallet badge (Deposit/Winning)
function getWalletBadge(txn) {
    // Withdrawal transactions — show Winnings badge (source wallet)
    if (txn.type === 'WITHDRAW' || txn.type === 'WITHDRAWAL') {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 191, 36, 0.2); color: #fbbf24;">Winnings</span>';
    }

    // Game-specific badges — show game type
    if (txn.matchId) {
        const mode = txn.matchType || '';
        return `<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(99, 102, 241, 0.2); color: #818cf8;">eSports${mode ? ' ' + mode : ''}</span>`;
    }
    if (txn.ludoMatchId) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(251, 146, 60, 0.2); color: #fb923c;">Ludo</span>';
    }
    if (txn.ludoAIMatchId || txn.ludoPvPMatchId) {
        const label = 'Ludo';
        return `<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(16, 185, 129, 0.2); color: #10b981;">${label}</span>`;
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

    // Watch & Earn ad reward badge
    const txnReason = (txn.reason || '').toLowerCase();
    if (txnReason.includes('watch') && txnReason.includes('earn')) {
        return '<span style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; background: rgba(16, 185, 129, 0.2); color: #10b981;">Ad Reward</span>';
    }

    return '';
}

// Premium withdrawal status tracker with stepper UI
function getWithdrawalStatusTracker(txn) {
    const status = (txn.status || 'PENDING').toUpperCase();

    // Status config: icon, color, label, description
    const statusConfig = {
        'PENDING': {
            icon: 'fa-solid fa-clock',
            color: '#fbbf24',
            bg: 'rgba(251, 191, 36, 0.1)',
            border: 'rgba(251, 191, 36, 0.25)',
            label: 'Pending Review',
            desc: 'Your withdrawal is being reviewed',
            pulseClass: 'wd-pulse-pending'
        },
        'FLAGGED': {
            icon: 'fa-solid fa-shield-halved',
            color: '#f59e0b',
            bg: 'rgba(245, 158, 11, 0.1)',
            border: 'rgba(245, 158, 11, 0.25)',
            label: 'Under Review',
            desc: 'Additional verification in progress',
            pulseClass: 'wd-pulse-pending'
        },
        'APPROVED': {
            icon: 'fa-solid fa-circle-check',
            color: '#3b82f6',
            bg: 'rgba(59, 130, 246, 0.08)',
            border: 'rgba(59, 130, 246, 0.25)',
            label: 'Approved',
            desc: 'Payment is being processed',
            pulseClass: 'wd-pulse-approved'
        },
        'COMPLETED': {
            icon: 'fa-solid fa-check-double',
            color: '#10b981',
            bg: 'rgba(16, 185, 129, 0.08)',
            border: 'rgba(16, 185, 129, 0.2)',
            label: 'Completed',
            desc: 'Amount sent to your account',
            pulseClass: ''
        },
        'REJECTED': {
            icon: 'fa-solid fa-circle-xmark',
            color: '#ef4444',
            bg: 'rgba(239, 68, 68, 0.08)',
            border: 'rgba(239, 68, 68, 0.2)',
            label: 'Rejected',
            desc: 'Amount refunded to wallet',
            pulseClass: ''
        }
    };

    const cfg = statusConfig[status] || statusConfig['PENDING'];

    // Build stepper dots for active statuses
    const steps = ['PENDING', 'APPROVED', 'COMPLETED'];
    const isRejected = status === 'REJECTED';
    const isFlagged = status === 'FLAGGED';
    const currentStepIdx = isRejected ? -1 : (isFlagged ? 0 : steps.indexOf(status));

    let stepperHtml = '';
    if (!isRejected) {
        const stepItems = steps.map((step, idx) => {
            const isActive = idx <= currentStepIdx;
            const isCurrent = idx === currentStepIdx;
            const dotColor = isActive ? cfg.color : 'rgba(255,255,255,0.15)';
            const dotSize = isCurrent ? '8px' : '5px';
            const glow = isCurrent ? `box-shadow: 0 0 6px ${cfg.color}40;` : '';
            return `<span style="width: ${dotSize}; height: ${dotSize}; border-radius: 50%; background: ${dotColor}; display: inline-block; transition: all 0.3s; ${glow}"></span>`;
        });

        // Connect dots with lines
        const lineItems = [];
        for (let i = 0; i < stepItems.length; i++) {
            lineItems.push(stepItems[i]);
            if (i < stepItems.length - 1) {
                const lineFilled = i < currentStepIdx;
                const lineColor = lineFilled ? cfg.color : 'rgba(255,255,255,0.1)';
                lineItems.push(`<span style="flex: 1; height: 2px; background: ${lineColor}; border-radius: 1px; max-width: 18px;"></span>`);
            }
        }
        stepperHtml = `
            <div style="display: flex; align-items: center; gap: 3px; margin-right: 8px;">
                ${lineItems.join('')}
            </div>`;
    }

    // Pulse animation for pending/approved (inline keyframe via class)
    const pulseStyle = cfg.pulseClass ? `animation: wdStatusPulse 2s ease-in-out infinite;` : '';

    return `
        <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 8px; background: ${cfg.bg}; border: 1px solid ${cfg.border}; width: fit-content; max-width: 100%;">
            ${stepperHtml}
            <i class="${cfg.icon}" style="font-size: 0.7rem; color: ${cfg.color}; ${pulseStyle}"></i>
            <span style="font-size: 0.68rem; font-weight: 600; color: ${cfg.color}; letter-spacing: 0.3px;">${cfg.label}</span>
        </div>`;
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

    // Fetch and show dynamic min amount + fee config
    let minWithdrawal = 10;
    let feePercent = 0;
    try {
        const { data: cfgData } = await supa.from('platform_config').select('value').eq('key', 'payments').single();
        const payments = cfgData?.value || {};
        if (payments.min_withdrawal) minWithdrawal = parseInt(payments.min_withdrawal) || 10;
        if (payments.withdrawal_fee_percent) feePercent = parseFloat(payments.withdrawal_fee_percent) || 0;
    } catch (e) { /* use fallback */ }

    // Store fee config on window for real-time preview
    window._withdrawFeePercent = feePercent;

    const amountInput = document.getElementById('withdraw-amount');
    amountInput.min = minWithdrawal;
    amountInput.placeholder = `Min ${minWithdrawal} coins`;

    // Get the breakdown card elements from HTML
    const breakdownCard = document.getElementById('withdraw-fee-breakdown');
    const wbAmount = document.getElementById('wb-amount');
    const wbFeeRow = document.getElementById('wb-fee-row');
    const wbFeePct = document.getElementById('wb-fee-pct');
    const wbFee = document.getElementById('wb-fee');
    const wbPayout = document.getElementById('wb-payout');

    // Hide breakdown initially
    if (breakdownCard) breakdownCard.style.display = 'none';

    // Real-time breakdown update on input
    amountInput.oninput = function () {
        const val = parseInt(this.value) || 0;
        if (val > 0) {
            const fee = feePercent > 0 ? Math.round(val * (feePercent / 100) * 100) / 100 : 0;
            const payout = Math.round((val - fee) * 100) / 100;

            if (breakdownCard) breakdownCard.style.display = 'block';
            if (wbAmount) wbAmount.innerHTML = formatCoin(val);
            if (wbFeePct) wbFeePct.textContent = feePercent;
            if (wbFee) wbFee.innerHTML = `- ${formatCoin(fee)}`;
            if (wbPayout) wbPayout.innerHTML = formatCoin(payout);

            // Show/hide fee row based on whether fee is active
            if (wbFeeRow) wbFeeRow.style.display = feePercent > 0 ? 'flex' : 'none';
        } else {
            if (breakdownCard) breakdownCard.style.display = 'none';
        }
    };

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
        const { data: cfgData } = await supa.from('platform_config').select('value').eq('key', 'payments').single();
        const payments = cfgData?.value || {};
        if (payments.min_withdrawal) {
            minWithdrawal = parseInt(payments.min_withdrawal) || 10;
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

        // Show fee details in success message
        const feeInfo = result.data.feeAmount > 0
            ? ` (Fee: ${formatCoinText(result.data.feeAmount)}, Payout: ${formatCoinText(result.data.payoutAmount)})`
            : '';
        showToast(`Withdrawal request submitted!${feeInfo} You will be notified once processed.`, 'success');

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
