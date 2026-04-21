// JeetoPlay — Deposit & Payment
// Auto-extracted from app.html

window.openDepositModal = async () => {
    // Reset modal state
    document.getElementById('deposit-modal').classList.remove('hidden');
    document.getElementById('deposit-step-1').classList.remove('hidden');
    document.getElementById('deposit-step-2').classList.add('hidden');
    document.getElementById('deposit-step-3').classList.add('hidden');

    // Reset selection state
    document.getElementById('selected-deposit-amount').value = '';
    document.getElementById('selected-amount-display').classList.add('hidden');

    // Disable proceed button until selection
    const proceedBtn = document.getElementById('deposit-proceed-btn');
    proceedBtn.disabled = true;
    proceedBtn.style.opacity = '0.5';
    proceedBtn.textContent = 'Select an Amount';

    await loadDepositSlabs();
};

// Load deposit slabs from Firebase config
async function loadDepositSlabs() {
    const container = document.getElementById('deposit-slabs');
    container.innerHTML = ''; // Clear slabs
    // Remove any existing custom amount section (prevents duplicates on re-render)
    const existingCustom = document.getElementById('custom-deposit-section');
    if (existingCustom) existingCustom.remove();
    // Remove any existing bonus banner
    const existingBanner = document.getElementById('deposit-bonus-banner');
    if (existingBanner) existingBanner.remove();

    try {
        const [payRes, bonusRes] = await Promise.all([
            supa.from('platform_config').select('value').eq('key', 'payments').single(),
            supa.from('platform_config').select('value').eq('key', 'deposit_bonus').single()
        ]);
        const config = payRes.data?.value || {};
        const bonusConfig = bonusRes.data?.value || {};
        const slabs = config.deposit_slabs || [50, 100, 200, 500, 1000];
        const minDeposit = config.min_deposit || 10;
        const maxDeposit = config.max_deposit || 9999;

        // Store limits and bonus config for validation
        depositState.minDeposit = minDeposit;
        depositState.maxDeposit = maxDeposit;
        depositState.bonusConfig = bonusConfig;

        const bonusEnabled = bonusConfig.enabled === true && bonusConfig.percentage > 0;

        // Show deposit bonus banner if enabled
        if (bonusEnabled) {
            const banner = document.createElement('div');
            banner.id = 'deposit-bonus-banner';
            banner.style.cssText = 'background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(251,191,36,0.06)); border: 1px solid rgba(245,158,11,0.25); border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; animation: fadeIn 0.4s ease;';
            banner.innerHTML = `
                <div style="width: 34px; height: 34px; background: linear-gradient(135deg, #f59e0b, #fbbf24); border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; animation: pulse 2s infinite;">
                    <i class="fa-solid fa-gift" style="color: #000; font-size: 0.9rem;"></i>
                </div>
                <div>
                    <div style="font-size: 0.82rem; font-weight: 700; color: #fbbf24;">🎉 ${bonusConfig.percentage}% Deposit Bonus Active!</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">Get extra coins on every deposit${bonusConfig.maxBonus > 0 ? ' (max ₹' + bonusConfig.maxBonus + ')' : ''}</div>
                </div>
            `;
            container.parentElement.insertBefore(banner, container);
        }

        slabs.sort((a, b) => a - b);

        slabs.forEach(amount => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline';
            btn.style.cssText = 'padding: 15px 10px; font-size: 1rem; position: relative; overflow: visible;';

            if (bonusEnabled) {
                let bonus = Math.floor(amount * bonusConfig.percentage / 100);
                if (bonusConfig.maxBonus > 0 && bonus > bonusConfig.maxBonus) bonus = bonusConfig.maxBonus;
                if (bonus > 0) {
                    btn.innerHTML = `<span>🪙 ${amount}</span><span style="position: absolute; top: -8px; right: -6px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 10px; white-space: nowrap; box-shadow: 0 2px 8px rgba(245,158,11,0.4); animation: pulse 2s infinite;">+₹${bonus}</span>`;
                } else {
                    btn.textContent = '🪙 ' + amount;
                }
            } else {
                btn.textContent = '🪙 ' + amount;
            }

            btn.onclick = (e) => selectDepositAmount(amount, e.currentTarget);
            container.appendChild(btn);
        });

        // Add custom amount input section
        const customSection = document.createElement('div');
        customSection.id = 'custom-deposit-section';
        customSection.style.cssText = 'margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06);';
        customSection.innerHTML = `
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-pen-to-square" style="color: var(--primary); font-size: 0.75rem;"></i>
                Or enter custom amount
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <div style="position: relative; flex: 1; max-width: 200px;">
                    <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-weight: 700; font-size: 0.9rem;">₹</span>
                    <input type="number" id="custom-deposit-amount" 
                        placeholder="Enter amount" 
                        min="${minDeposit}" 
                        max="${maxDeposit}" 
                        style="width: 100%; padding: 12px 12px 12px 28px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: var(--text); font-size: 1rem; font-weight: 600; outline: none; transition: border-color 0.2s;"
                        oninput="onCustomAmountInput(this)"
                        onfocus="this.style.borderColor='rgba(0,255,136,0.4)'"
                        onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
                    >
                </div>
                <button class="btn btn-primary" id="custom-amount-btn" onclick="applyCustomAmount()" 
                    style="padding: 12px 18px; font-size: 0.88rem; white-space: nowrap; opacity: 0.5; pointer-events: none;">
                    Apply
                </button>
            </div>
            <div id="custom-amount-hint" style="font-size: 0.72rem; color: var(--text-muted); margin-top: 5px;">
                Min: ₹${minDeposit} · Max: ₹${maxDeposit}
            </div>
        `;
        container.parentElement.appendChild(customSection);

    } catch (e) {
        console.error('Failed to load slabs:', e);
        depositState.minDeposit = 10;
        depositState.maxDeposit = 9999;
        depositState.bonusConfig = {};
        [50, 100, 200, 500, 1000].forEach(amount => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline';
            btn.style.cssText = 'padding: 15px; font-size: 1rem;';
            btn.textContent = '🪙 ' + amount;
            btn.onclick = (e) => selectDepositAmount(amount, e.target);
            container.appendChild(btn);
        });
    }
}

// Calculate deposit bonus for display
function getDepositBonus(amount) {
    const bc = depositState.bonusConfig || {};
    if (bc.enabled !== true || !bc.percentage || bc.percentage <= 0) return 0;
    let bonus = Math.floor(amount * bc.percentage / 100);
    if (bc.maxBonus > 0 && bonus > bc.maxBonus) bonus = bc.maxBonus;
    return bonus;
}

// Select amount (from slab button)
function selectDepositAmount(amount, btnEl) {
    // Store selected amount
    document.getElementById('selected-deposit-amount').value = amount;
    depositState.amount = amount;

    // Calculate bonus
    const bonus = getDepositBonus(amount);

    // Show selected amount display with bonus breakdown
    document.getElementById('selected-amount-display').classList.remove('hidden');
    const displayEl = document.getElementById('display-amount');
    if (bonus > 0) {
        displayEl.innerHTML = `🪙 ${amount} <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 600;">+ 🎁 ${bonus} bonus</span>`;
    } else {
        displayEl.textContent = '🪙 ' + amount;
    }

    // Enable proceed button
    const proceedBtn = document.getElementById('deposit-proceed-btn');
    proceedBtn.disabled = false;
    proceedBtn.style.opacity = '1';
    if (bonus > 0) {
        proceedBtn.innerHTML = `Buy ${amount} Coins <span style="font-size: 0.75rem; opacity: 0.85;">(+${bonus} bonus)</span>`;
    } else {
        proceedBtn.textContent = 'Buy ' + amount + ' Coins';
    }

    // Highlight selected slab button
    const btns = document.querySelectorAll('#deposit-slabs button');
    btns.forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
    });
    if (btnEl) {
        btnEl.classList.remove('btn-outline');
        btnEl.classList.add('btn-primary');
    }

    // Clear custom amount field (user chose a slab)
    const customInput = document.getElementById('custom-deposit-amount');
    if (customInput) customInput.value = '';
    const customBtn = document.getElementById('custom-amount-btn');
    if (customBtn) { customBtn.style.opacity = '0.5'; customBtn.style.pointerEvents = 'none'; }
}

// Custom amount input handler
function onCustomAmountInput(input) {
    const val = parseInt(input.value);
    const minDeposit = depositState.minDeposit || 10;
    const maxDeposit = depositState.maxDeposit || 9999;
    const hint = document.getElementById('custom-amount-hint');
    const applyBtn = document.getElementById('custom-amount-btn');

    if (val && val >= minDeposit && val <= maxDeposit) {
        // Valid
        if (hint) { hint.textContent = `₹${val} coins`; hint.style.color = 'var(--primary)'; }
        if (applyBtn) { applyBtn.style.opacity = '1'; applyBtn.style.pointerEvents = 'auto'; }
        input.style.borderColor = 'rgba(0,255,136,0.4)';
    } else if (val && val > maxDeposit) {
        // Too high
        if (hint) { hint.textContent = `Maximum: ₹${maxDeposit}`; hint.style.color = '#ef4444'; }
        if (applyBtn) { applyBtn.style.opacity = '0.5'; applyBtn.style.pointerEvents = 'none'; }
        input.style.borderColor = 'rgba(239,68,68,0.4)';
    } else if (val && val < minDeposit) {
        // Too low
        if (hint) { hint.textContent = `Minimum: ₹${minDeposit}`; hint.style.color = '#ef4444'; }
        if (applyBtn) { applyBtn.style.opacity = '0.5'; applyBtn.style.pointerEvents = 'none'; }
        input.style.borderColor = 'rgba(239,68,68,0.4)';
    } else {
        // Empty
        if (hint) { hint.textContent = `Min: ₹${minDeposit} · Max: ₹${maxDeposit}`; hint.style.color = 'var(--text-muted)'; }
        if (applyBtn) { applyBtn.style.opacity = '0.5'; applyBtn.style.pointerEvents = 'none'; }
        input.style.borderColor = 'rgba(255,255,255,0.1)';
    }
}

// Apply custom amount
function applyCustomAmount() {
    const input = document.getElementById('custom-deposit-amount');
    const val = parseInt(input?.value);
    const minDeposit = depositState.minDeposit || 10;
    const maxDeposit = depositState.maxDeposit || 9999;

    if (!val || val < minDeposit) {
        showToast(`Minimum deposit is ₹${minDeposit}`, 'error');
        return;
    }
    if (val > maxDeposit) {
        showToast(`Maximum deposit is ₹${maxDeposit}`, 'error');
        return;
    }

    // Deselect all slab buttons
    const btns = document.querySelectorAll('#deposit-slabs button');
    btns.forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
    });

    // Set the custom amount
    document.getElementById('selected-deposit-amount').value = val;
    depositState.amount = val;

    // Calculate bonus
    const bonus = getDepositBonus(val);

    document.getElementById('selected-amount-display').classList.remove('hidden');
    const displayEl = document.getElementById('display-amount');
    if (bonus > 0) {
        displayEl.innerHTML = `🪙 ${val} <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 600;">+ 🎁 ${bonus} bonus</span>`;
    } else {
        displayEl.textContent = '🪙 ' + val;
    }

    const proceedBtn = document.getElementById('deposit-proceed-btn');
    proceedBtn.disabled = false;
    proceedBtn.style.opacity = '1';
    if (bonus > 0) {
        proceedBtn.innerHTML = `Buy ${val} Coins <span style="font-size: 0.75rem; opacity: 0.85;">(+${bonus} bonus)</span>`;
    } else {
        proceedBtn.textContent = 'Buy ' + val + ' Coins';
    }

    const bonusText = bonus > 0 ? ` (+₹${bonus} bonus!)` : '';
    showToast(`₹${val} selected${bonusText}`, 'success');
}

// Proceed to payment — Universal Payment Flow
window.proceedToPayment = async () => {
    const amount = parseInt(document.getElementById('selected-deposit-amount').value);
    if (!amount || amount < 1) {
        return showToast('Please select a deposit amount first', 'error');
    }

    // Enforce max deposit limit (catches any bypassed frontend validation)
    const maxDeposit = depositState.maxDeposit || 9999;
    if (amount > maxDeposit) {
        return showToast(`Maximum deposit is ₹${maxDeposit}`, 'error');
    }

    depositState.amount = amount;
    showToast('Initiating payment...', 'info');

    try {
        const { data: payRow } = await supa.from('platform_config').select('value').eq('key', 'payments').single();
        const config = payRow?.value || {};
        const { data: depRow } = await supa.from('platform_config').select('value').eq('key', 'deposit_options').single();
        const depositsEnabled = depRow?.value?.enabled !== false;

        if (!config.gateway_enabled) return showToast('Payment gateway is not enabled. Contact support.', 'error');
        if (!depositsEnabled) return showToast('Deposits are currently disabled.', 'error');

        const txnId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
        depositState.transactionId = txnId;
        const activeGateway = config.active_gateway || 'manual';

        // ⚠️ SECURITY: wallet_transactions record is now created SERVER-SIDE
        // in createPaymentApi (prevents client from tampering with the amount).
        // For manual gateway, we still create client-side since there's no API call.

        if (activeGateway === 'manual') {
            // Manual UPI: validate UPI ID is configured
            if (!config.upi_id) {
                console.warn('[Deposit] Manual UPI selected but upi_id not configured');
                // Still allow — showManualUpiPayment uses fallback 'merchant@upi'
            }
            // Create record in Supabase (admin verifies manually anyway)
            await supa.from('transactions').upsert({
                id: txnId,
                user_uid: state.user.uid,
                type: 'DEPOSIT',
                amount: amount,
                status: 'PENDING',
                description: 'Deposit',
                balance_type: 'manual',
                created_at: new Date().toISOString()
            });
            showManualUpiPayment(config, amount, txnId);
        } else if (activeGateway === 'zapupi') {
            if (!config.zapupi_token) throw new Error('ZapUPI gateway is not configured. Please contact support.');
            const res = await fetch('https://zrucdzkgrmtwhykvplqs.supabase.co/functions/v1/create-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, mobile: state.userData.phone || "9999999999", order_id: txnId, gateway_type: 'zapupi', userId: state.user.uid })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[UPM] ZapUPI API error:', res.status, errText.substring(0, 300));
                try { const errJson = JSON.parse(errText); if (errJson.error) throw new Error(errJson.error); } catch (pe) { if (pe.message && !pe.message.includes('JSON')) throw pe; }
                throw new Error('Payment server error (' + res.status + '). Please try again or contact support.');
            }
            let data;
            try {
                const rawText = await res.text();
                data = JSON.parse(rawText);
            } catch (parseErr) {
                console.error('[UPM] ZapUPI response not valid JSON:', parseErr.message);
                throw new Error('Payment gateway returned an invalid response. Please try again later.');
            }
            console.log('[UPM] ZapUPI create-order response:', JSON.stringify(data));
            if (data.status === 'success' && data.payment_url) {
                console.log('[UPM] autoCheckUrl:', data.auto_check_every_2_sec || 'NOT PROVIDED — using fallback polling');
                showUniversalPaymentModal({ paymentUrl: data.payment_url, autoCheckUrl: data.auto_check_every_2_sec, orderId: data.order_id || txnId, amount, txnId, config, gateway: 'zapupi' });
            } else throw new Error(data.message || data.error || "Failed to create ZapUPI order");
        } else if (activeGateway === 'tranzupi') {
            if (!config.tranzupi_token) throw new Error('TranzUPI gateway is not configured. Please contact support.');
            const res = await fetch('https://zrucdzkgrmtwhykvplqs.supabase.co/functions/v1/create-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, mobile: state.userData.phone || "9999999999", order_id: txnId, gateway_type: 'tranzupi', userId: state.user.uid })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[UPM] TranzUPI API error:', res.status, errText.substring(0, 300));
                try { const errJson = JSON.parse(errText); if (errJson.error) throw new Error(errJson.error); } catch (pe) { if (pe.message && !pe.message.includes('JSON')) throw pe; }
                throw new Error('Payment server error (' + res.status + '). Please try again or contact support.');
            }
            let data;
            try {
                const rawText = await res.text();
                data = JSON.parse(rawText);
            } catch (parseErr) {
                console.error('[UPM] TranzUPI response not valid JSON:', parseErr.message);
                throw new Error('Payment gateway returned an invalid response. Please try again later.');
            }
            console.log('[UPM] TranzUPI create-order response:', JSON.stringify(data));
            if (data.status === true && data.result && data.result.payment_url) {
                // Use TranzUPI's numeric orderId for polling, our internal txnId for wallet ops
                const tranzupiOrderId = data._tranzupiOrderId || data.result.orderId || txnId;
                showUniversalPaymentModal({ paymentUrl: data.result.payment_url, autoCheckUrl: null, orderId: tranzupiOrderId, amount, txnId, config, gateway: 'tranzupi' });
            } else throw new Error(data.message || data.error || "Failed to create TranzUPI order");
        } else if (activeGateway === 'custom') {
            if (!config.gateway_endpoint) throw new Error('Custom gateway is not configured. Please contact support.');
            const res = await fetch('https://zrucdzkgrmtwhykvplqs.supabase.co/functions/v1/create-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, mobile: state.userData.phone || "9999999999", order_id: txnId, gateway_type: 'custom', gateway_endpoint: config.gateway_endpoint, api_key: config.api_key, secret_key: config.secret_key, userId: state.user.uid })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[UPM] Custom gateway API error:', res.status, errText.substring(0, 300));
                try { const errJson = JSON.parse(errText); if (errJson.error) throw new Error(errJson.error); } catch (pe) { if (pe.message && !pe.message.includes('JSON')) throw pe; }
                throw new Error('Payment server error (' + res.status + '). Please try again or contact support.');
            }
            let data;
            try {
                const rawText = await res.text();
                data = JSON.parse(rawText);
            } catch (parseErr) {
                console.error('[UPM] Custom gateway response not valid JSON:', parseErr.message);
                throw new Error('Payment gateway returned an invalid response. Please try again later.');
            }
            if (data.status === true && data.result && data.result.payment_url) {
                showUniversalPaymentModal({ paymentUrl: data.result.payment_url, autoCheckUrl: null, orderId: txnId, amount, txnId, config, gateway: 'custom' });
            } else throw new Error(data.message || data.error || "Failed to create order");
        } else {
            // Unknown gateway — might happen during mid-transition. Show clear message.
            console.error('[Deposit] Unknown gateway type:', activeGateway);
            throw new Error('Payment method is being updated. Please try again in a moment.');
        }
    } catch (e) {
        console.error('Payment init error:', e);
        showToast('Failed: ' + e.message, 'error');
    }
};

// Show manual UPI payment modal
function showManualUpiPayment(config, amount, txnId) {
    const upiId = config.upi_id || 'merchant@upi';
    const merchantName = config.merchant_name || 'JeetoPlay';

    const modalContent = document.getElementById('deposit-modal-content');
    if (!modalContent) {
        console.error('[Deposit] deposit-modal-content element not found in DOM');
        showToast('Payment UI error. Please refresh the app and try again.', 'error');
        return;
    }

    modalContent.innerHTML = `
        <div style="padding: 16px 12px;">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #00ff88, #00cc6a); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; box-shadow: 0 4px 20px rgba(0,255,136,0.25);">
                    <i class="fa-solid fa-indian-rupee-sign" style="color: #0a0a0f; font-size: 1.2rem; font-weight: 800;"></i>
                </div>
                <h3 style="margin: 0 0 4px; font-size: 1.1rem; font-weight: 700; color: var(--text);">Pay via UPI</h3>
                <div style="font-size: 0.75rem; color: var(--text-muted);">Scan QR or pay to UPI ID below</div>
            </div>

            <!-- Amount Card -->
            <div style="background: linear-gradient(135deg, rgba(0,255,136,0.08), rgba(0,255,136,0.02)); border: 1px solid rgba(0,255,136,0.15); border-radius: 14px; padding: 14px; margin-bottom: 16px; text-align: center;">
                <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Amount to Pay</div>
                <div style="font-size: 1.8rem; font-weight: 800; color: #00ff88; text-shadow: 0 0 20px rgba(0,255,136,0.2);">₹${amount}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">= 🪙 ${amount} coins</div>
            </div>

            ${config.upi_qr_image ? `
            <!-- QR Code Display -->
            <div style="margin-bottom: 16px;">
                <div style="background: linear-gradient(135deg, #ffffff, #f8f9fa); border-radius: 16px; padding: 14px; position: relative; overflow: hidden; max-width: 220px; margin: 0 auto; box-shadow: 0 4px 24px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(0,255,136,0.1);">
                    <!-- Corner accents -->
                    <div style="position: absolute; top: 6px; left: 6px; width: 18px; height: 18px; border-top: 3px solid #00cc6a; border-left: 3px solid #00cc6a; border-radius: 4px 0 0 0;"></div>
                    <div style="position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; border-top: 3px solid #00cc6a; border-right: 3px solid #00cc6a; border-radius: 0 4px 0 0;"></div>
                    <div style="position: absolute; bottom: 6px; left: 6px; width: 18px; height: 18px; border-bottom: 3px solid #00cc6a; border-left: 3px solid #00cc6a; border-radius: 0 0 0 4px;"></div>
                    <div style="position: absolute; bottom: 6px; right: 6px; width: 18px; height: 18px; border-bottom: 3px solid #00cc6a; border-right: 3px solid #00cc6a; border-radius: 0 0 4px 0;"></div>
                    <img src="${config.upi_qr_image}" alt="UPI QR Code" style="width: 100%; height: auto; display: block; border-radius: 8px;">
                </div>
                <div style="text-align: center; margin-top: 10px;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px;">
                        <i class="fa-solid fa-qrcode" style="color: var(--primary); font-size: 0.7rem;"></i>
                        <span style="font-size: 0.72rem; color: var(--text-muted);">Scan with any UPI app to pay</span>
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button onclick="viewQrFullscreen()" style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.18); color: #818cf8; padding: 7px 14px; border-radius: 8px; font-size: 0.72rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                            <i class="fa-solid fa-expand"></i> View Full
                        </button>
                        <button onclick="downloadQrImage()" style="background: rgba(0,255,136,0.08); border: 1px solid rgba(0,255,136,0.18); color: #00ff88; padding: 7px 14px; border-radius: 8px; font-size: 0.72rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                            <i class="fa-solid fa-download"></i> Save QR
                        </button>
                    </div>
                </div>
            </div>

            <!-- Divider -->
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                <div style="flex: 1; height: 1px; background: linear-gradient(to right, transparent, var(--border), transparent);"></div>
                <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">or pay to</span>
                <div style="flex: 1; height: 1px; background: linear-gradient(to right, transparent, var(--border), transparent);"></div>
            </div>
            ` : ''}

            <!-- UPI ID Card -->
            <div style="background: linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02)); border: 1px solid rgba(99,102,241,0.12); border-radius: 12px; padding: 14px; margin-bottom: 16px;">
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 6px; text-align: center;">UPI ID</div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <span id="upi-display" style="font-size: 1rem; font-weight: 700; color: var(--text); letter-spacing: 0.3px;">${upiId}</span>
                    <button onclick="copyUpiIdToClipboard('${upiId}')" style="background: linear-gradient(135deg, rgba(0,255,136,0.12), rgba(0,255,136,0.05)); border: 1px solid rgba(0,255,136,0.2); color: var(--primary); padding: 6px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                </div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; text-align: center;">${merchantName}</div>
            </div>

            <!-- Steps -->
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px;">
                <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.7;">
                    <div style="display: flex; gap: 8px; margin-bottom: 4px;"><span style="color: var(--primary); font-weight: 700;">1.</span> ${config.upi_qr_image ? 'Scan QR code or open' : 'Open'} any UPI app</div>
                    <div style="display: flex; gap: 8px; margin-bottom: 4px;"><span style="color: var(--primary); font-weight: 700;">2.</span> Pay ₹${amount} to the above UPI ID</div>
                    <div style="display: flex; gap: 8px;"><span style="color: var(--primary); font-weight: 700;">3.</span> Enter the UTR/Reference number below</div>
                </div>
            </div>
            
            <!-- UTR Input -->
            <div style="margin-bottom: 14px;">
                <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 6px;">UTR / Reference Number</label>
                <input type="text" id="manual-utr-input" class="form-input" placeholder="Enter 12-digit UTR number" style="font-size: 1rem; padding: 14px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); text-align: center; letter-spacing: 1px; font-weight: 600;">
            </div>
            
            <!-- Submit Button -->
            <button onclick="submitManualPayment('${txnId}')" style="width: 100%; padding: 15px; background: linear-gradient(135deg, #00ff88, #00cc6a); color: #0a0a0f; border: none; border-radius: 12px; font-size: 0.95rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 15px rgba(0,255,136,0.25); transition: transform 0.15s, box-shadow 0.15s;" onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'">
                <i class="fa-solid fa-check-circle"></i> I've Paid — Submit for Verification
            </button>
            
            <!-- Cancel -->
            <button onclick="closeDepositModal()" style="width: 100%; margin-top: 10px; padding: 12px; background: transparent; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: var(--text-muted); font-size: 0.85rem; cursor: pointer;">
                Cancel
            </button>
        </div>
    `;
}

// View QR code in fullscreen overlay
window.viewQrFullscreen = function () {
    const qrImg = document.querySelector('#deposit-modal-content img[alt="UPI QR Code"]');
    if (!qrImg || !qrImg.src) { showToast('QR code not available', 'error'); return; }

    // Remove existing overlay if any
    document.getElementById('qr-fullscreen-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'qr-fullscreen-overlay';
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.92); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease;';
    overlay.innerHTML = `
        <div style="max-width: 320px; width: 100%; position: relative;">
            <div style="background: #fff; border-radius: 20px; padding: 18px; position: relative; box-shadow: 0 8px 40px rgba(0,255,136,0.15), 0 0 0 1px rgba(0,255,136,0.1);">
                <!-- Corner accents -->
                <div style="position: absolute; top: 8px; left: 8px; width: 24px; height: 24px; border-top: 4px solid #00cc6a; border-left: 4px solid #00cc6a; border-radius: 6px 0 0 0;"></div>
                <div style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-top: 4px solid #00cc6a; border-right: 4px solid #00cc6a; border-radius: 0 6px 0 0;"></div>
                <div style="position: absolute; bottom: 8px; left: 8px; width: 24px; height: 24px; border-bottom: 4px solid #00cc6a; border-left: 4px solid #00cc6a; border-radius: 0 0 0 6px;"></div>
                <div style="position: absolute; bottom: 8px; right: 8px; width: 24px; height: 24px; border-bottom: 4px solid #00cc6a; border-right: 4px solid #00cc6a; border-radius: 0 0 6px 0;"></div>
                <img src="${qrImg.src}" style="width: 100%; height: auto; display: block; border-radius: 10px;">
            </div>
            <div style="text-align: center; margin-top: 16px;">
                <div style="color: #fff; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Scan to Pay</div>
                <div style="color: rgba(255,255,255,0.5); font-size: 0.72rem;">Open any UPI app and scan this QR code</div>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 16px;">
                <button onclick="downloadQrImage()" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #00ff88, #00cc6a); color: #0a0a0f; border: none; border-radius: 10px; font-size: 0.82rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <i class="fa-solid fa-download"></i> Save QR
                </button>
                <button onclick="document.getElementById('qr-fullscreen-overlay').remove()" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #fff; border-radius: 10px; font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                    Close
                </button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// Download QR code as image file
window.downloadQrImage = function () {
    const qrImg = document.querySelector('#deposit-modal-content img[alt="UPI QR Code"]') 
        || document.querySelector('#qr-fullscreen-overlay img');
    if (!qrImg || !qrImg.src) { showToast('QR code not available', 'error'); return; }

    try {
        const link = document.createElement('a');
        link.download = 'JeetoPlay_UPI_QR.png';
        link.href = qrImg.src;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('📥 QR code saved!', 'success');
    } catch (e) {
        // Fallback: open in new tab
        window.open(qrImg.src, '_blank');
        showToast('QR opened in new tab — long press to save', 'info');
    }
};

// ═══════════════════════════════════════════════════════════
// UNIVERSAL PAYMENT MODAL — handles ZapUPI, Custom, all gateways
// ═══════════════════════════════════════════════════════════
let upmPollingInterval = null;
let upmPaymentWindow = null;
let upmFirebaseListener = null;
let upmSuccessShown = false;
const UPM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let upmTimeoutTimer = null;
let upmMessageListener = null; // postMessage listener from callback page

// === Recovery Verification State ===
// Guards and timers for post-refresh deposit recovery
let _checkPendingDepositRunning = false; // Prevents duplicate concurrent calls
let recoveryVerifyTimer = null;          // Periodic confirmDeposit retry timer
let recoveryVerifyCount = 0;             // Current retry count
const RECOVERY_VERIFY_INTERVAL = 60000;  // 60s between retries
const RECOVERY_VERIFY_MAX_RETRIES = 4;   // 4 retries after initial = 5 total (within rate limit of 5/10min)

function showUniversalPaymentModal(opts) {
    const { paymentUrl, autoCheckUrl, orderId, amount, txnId, config, gateway } = opts;
    upmSuccessShown = false; // Reset for new payment

    // Save pending deposit for app-refresh recovery
    localStorage.setItem('pending_deposit_txn', JSON.stringify({
        txnId, orderId, amount, gateway,
        userId: state.user?.uid || auth.currentUser?.uid,
        createdAt: Date.now()
    }));

    // Open payment URL in popup
    if (paymentUrl && paymentUrl !== '#') {
        upmPaymentWindow = window.open(paymentUrl, '_blank', 'width=420,height=700,scrollbars=yes');

        // Handle popup blocked — show clickable link inside the modal
        if (!upmPaymentWindow || upmPaymentWindow.closed) {
            console.warn('[UPM] Popup was blocked — showing inline link');
            setTimeout(() => {
                const payBtn = document.getElementById('upm-pay-btn');
                if (payBtn) {
                    payBtn.innerHTML = '🔗 Tap Here to Open Payment Page';
                    payBtn.onclick = () => {
                        upmPaymentWindow = window.open(paymentUrl, '_blank');
                    };
                }
                // Show a notice
                const statusBar = document.getElementById('upm-status-bar');
                if (statusBar) {
                    const notice = document.createElement('div');
                    notice.style.cssText = 'margin-top:10px;padding:10px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:10px;font-size:0.78rem;color:#fbbf24;text-align:center;';
                    notice.innerHTML = '⚠️ Popup was blocked. Tap the green button above to open the payment page.';
                    statusBar.after(notice);
                }
            }, 100);
        }
    }

    // Create modal
    let modal = document.getElementById('upm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'upm-modal';
        document.body.appendChild(modal);
    }

    const gatewayLabel = gateway === 'zapupi' ? 'ZapUPI' : gateway === 'tranzupi' ? 'TranzUPI' : gateway === 'custom' ? 'Payment Gateway' : 'Gateway';

    modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;">
            <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:24px;padding:30px;max-width:380px;width:100%;border:1px solid rgba(74,222,128,0.3);box-shadow:0 20px 60px rgba(0,0,0,0.5);position:relative;">
                <!-- Header -->
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="font-size:2.5rem;font-weight:700;color:#4ade80;">🪙 ${amount}</div>
                    <div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">Pay ₹${amount} via ${gatewayLabel}</div>
                    <div style="font-size:0.8rem;color:#6b7280;margin-top:4px;">via ${gatewayLabel} • #${String(txnId).slice(-6)}</div>
                </div>

                <!-- Steps Progress -->
                <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px;">
                    <div id="upm-step1" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.4);">
                        <span style="font-size:0.75rem;">1️⃣</span>
                        <span style="color:#4ade80;font-size:0.75rem;font-weight:600;">Pay</span>
                    </div>
                    <div style="display:flex;align-items:center;color:#6b7280;">→</div>
                    <div id="upm-step2" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);">
                        <span style="font-size:0.75rem;">2️⃣</span>
                        <span style="color:#60a5fa;font-size:0.75rem;font-weight:600;">Confirming</span>
                    </div>
                    <div style="display:flex;align-items:center;color:#6b7280;">→</div>
                    <div id="upm-step3" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);">
                        <span style="font-size:0.75rem;">3️⃣</span>
                        <span style="color:#9ca3af;font-size:0.75rem;font-weight:600;">Done</span>
                    </div>
                </div>

                <!-- Status Bar -->
                <div id="upm-status-bar" style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);border-radius:14px;padding:16px;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:10px;">
                    <div id="upm-spinner" style="width:18px;height:18px;border:2px solid #3b82f6;border-top-color:transparent;border-radius:50%;animation:upmSpin 1s linear infinite;"></div>
                    <span id="upm-status-text" style="color:#60a5fa;font-size:0.9rem;">Waiting for payment...</span>
                </div>

                <!-- Timer -->
                <div id="upm-timer" style="text-align:center;font-size:0.75rem;color:#6b7280;margin-bottom:16px;">⏱️ Expires in <span id="upm-countdown">10:00</span></div>

                <!-- Action Buttons -->
                <button id="upm-pay-btn" onclick="upmOpenPaymentPage()" style="width:100%;padding:14px;background:linear-gradient(135deg,#4ade80,#22c55e);border:none;border-radius:14px;color:#0f172a;font-weight:700;font-size:1rem;cursor:pointer;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px;">
                    🔗 Open Payment Page
                </button>

                <button onclick="closeUniversalPaymentModal()" style="width:100%;padding:12px;background:transparent;border:1px solid rgba(239,68,68,0.4);border-radius:14px;color:#ef4444;font-weight:600;cursor:pointer;font-size:0.9rem;">Cancel</button>

                <!-- Success overlay (hidden) -->
                <div id="upm-success-overlay" style="display:none;position:absolute;inset:0;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:24px;flex-direction:column;align-items:center;justify-content:center;z-index:10;overflow:hidden;">
                    <div id="upm-confetti" style="position:absolute;inset:0;pointer-events:none;"></div>
                    <div style="font-size:4rem;margin-bottom:12px;animation:upmBounce 0.6s ease;position:relative;z-index:2;">✅</div>
                    <div style="font-size:1.5rem;font-weight:700;color:#4ade80;margin-bottom:6px;position:relative;z-index:2;">Payment Successful!</div>
                    <div style="font-size:2.2rem;font-weight:800;color:white;position:relative;z-index:2;">🪙 ${amount} Coins Added</div>
                    <div style="font-size:0.85rem;color:#6b7280;margin-top:6px;position:relative;z-index:2;">Balance updated automatically</div>
                    <button onclick="closeUniversalPaymentModal()" style="margin-top:20px;padding:12px 40px;background:linear-gradient(135deg,#4ade80,#22c55e);border:none;border-radius:14px;color:#0f172a;font-weight:700;font-size:1rem;cursor:pointer;position:relative;z-index:2;animation:upmFadeIn 0.5s ease 1.5s both;">✓ Done</button>
                </div>
            </div>
        </div>
        <style>
            @keyframes upmSpin { to { transform: rotate(360deg); } }
            @keyframes upmBounce { 0%{transform:scale(0)} 50%{transform:scale(1.2)} 100%{transform:scale(1)} }
            @keyframes upmPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
            @keyframes upmFadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
            @keyframes upmConfettiFall { 0%{transform:translateY(-10px) rotate(0deg);opacity:1} 100%{transform:translateY(400px) rotate(720deg);opacity:0} }
            .upm-confetti-piece { position:absolute;width:8px;height:8px;border-radius:2px;animation:upmConfettiFall linear forwards; }
        </style>
    `;
    modal.style.display = 'block';

    // Store current opts for recovery
    modal._opts = opts;

    // === Firebase Realtime Listener — instant confirmation ===
    upmStartFirebaseListener(txnId, amount);

    // === postMessage Listener — callback page signals payment complete ===
    if (upmMessageListener) window.removeEventListener('message', upmMessageListener);
    upmMessageListener = (event) => {
        try {
            const msg = event.data;
            if (msg && msg.type === 'JEETOPLAY_PAYMENT_CALLBACK') {
                console.log('[UPM] Received postMessage from callback page:', JSON.stringify(msg));
                // Immediately trigger a status check and credit
                upmHandleCallbackSignal(orderId, txnId, amount, config, gateway);
            }
        } catch (e) { console.warn('[UPM] postMessage parse error:', e); }
    };
    window.addEventListener('message', upmMessageListener);

    // === Gateway-specific polling ===
    if (gateway === 'zapupi' && autoCheckUrl) {
        upmStartPolling(autoCheckUrl, txnId, amount, config);
    } else if (gateway === 'zapupi') {
        upmStartStatusPolling(orderId, txnId, amount, config);
    } else if (gateway === 'tranzupi') {
        upmStartTranzupiPolling(orderId, txnId, amount, config);
    }
    // Custom gateway: no polling needed — webhook updates DB, Firebase listener catches it

    // === Timeout ===
    upmStartTimeout(txnId);
}

// Open payment page (retry button)
window.upmOpenPaymentPage = () => {
    const modal = document.getElementById('upm-modal');
    if (modal?._opts?.paymentUrl) {
        upmPaymentWindow = window.open(modal._opts.paymentUrl, '_blank', 'width=420,height=700,scrollbars=yes');
    }
};

// === Supabase Transaction Status Listener (replaces Firebase Realtime) ===
function upmStartFirebaseListener(txnId, amount) {
    // Poll Supabase every 3 seconds for status change
    if (upmFirebaseListener) clearInterval(upmFirebaseListener);

    upmFirebaseListener = setInterval(async () => {
        try {
            const { data } = await supa.from('transactions').select('status').eq('id', txnId).single();
            if (!data) return;
            if (data.status === 'SUCCESS') {
                clearInterval(upmFirebaseListener);
                upmFirebaseListener = null;
                upmShowSuccess(txnId, amount);
            } else if (data.status === 'FAILED') {
                clearInterval(upmFirebaseListener);
                upmFirebaseListener = null;
                upmUpdateStatus('Payment failed. Please try again.', 'error');
                setTimeout(() => closeUniversalPaymentModal(), 3000);
            }
        } catch (e) { /* ignore polling errors */ }
    }, 3000);
}

// === ZapUPI Auto-Check Polling ===
let upmPollCount = 0;
const UPM_MAX_POLL = 120;

function upmStartPolling(autoCheckUrl, txnId, amount, config) {
    upmPollCount = 0;
    console.log('[UPM AutoCheck] Starting polling with URL:', autoCheckUrl);
    upmPollingInterval = setInterval(async () => {
        upmPollCount++;
        if (upmPollCount > UPM_MAX_POLL) { clearInterval(upmPollingInterval); return; }
        if (upmPollCount % 10 === 0) upmUpdateStatus(`Checking payment... (${upmPollCount}s)`, 'info');

        try {
            const response = await fetch('/api/zapupi_auto_check', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auto_check_url: autoCheckUrl })
            });
            if (!response.ok) { console.warn('[UPM AutoCheck] API returned', response.status); return; }
            let data;
            try { const rawText = await response.text(); data = JSON.parse(rawText); } catch (pe) { console.warn('[UPM AutoCheck] Non-JSON response'); return; }
            // Log every response for debugging
            if (upmPollCount % 3 === 1) console.log('[UPM AutoCheck #' + upmPollCount + '] Response:', JSON.stringify(data));

            // SECURITY: Only check inner payment status, NOT outer API response status
            const pl = (data.payment_status || '').toString().toLowerCase();
            const innerSl = (data.data?.status || '').toString().toLowerCase();

            if (pl === 'success' || innerSl === 'success') {
                console.log('[UPM AutoCheck] SUCCESS detected!', JSON.stringify(data));
                clearInterval(upmPollingInterval);
                await upmCreditWallet(txnId, amount, data.utr || data.data?.utr || data.txn_id || data.data?.txn_id || 'AUTO', 'zapupi');
            } else if (pl === 'failed' || innerSl === 'failed') {
                console.log('[UPM AutoCheck] FAILED detected.', JSON.stringify(data));
                clearInterval(upmPollingInterval);
                upmUpdateStatus('Payment failed. Please try again.', 'error');
                setTimeout(() => closeUniversalPaymentModal(), 3000);
            }
        } catch (e) { console.error('Poll error:', e); }
    }, 1000);
}

// === ZapUPI Order Status Polling (fallback) ===
function upmStartStatusPolling(orderId, txnId, amount, config) {
    upmPollCount = 0;
    upmPollingInterval = setInterval(async () => {
        upmPollCount++;
        if (upmPollCount > UPM_MAX_POLL) { clearInterval(upmPollingInterval); return; }
        if (upmPollCount % 10 === 0) upmUpdateStatus(`Checking status... (${upmPollCount * 1.5}s)`, 'info');

        try {
            const response = await fetch('/api/check_payment_status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId })
            });
            if (!response.ok) { console.warn('[UPM Poll] API returned', response.status); return; }
            let data;
            try { const rawText = await response.text(); data = JSON.parse(rawText); } catch (pe) { console.warn('[UPM Poll] Non-JSON response'); return; }

            // Log every 5th poll response for debugging
            if (upmPollCount % 5 === 1) console.log('[UPM Poll #' + upmPollCount + '] Response:', JSON.stringify(data));

            // SECURITY: Only trust inner data.status for payment confirmation
            // outerStatus just means the API call itself succeeded, NOT the payment
            const outerStatus = String(data.status || '').toLowerCase();
            const innerStatus = String(data.data?.status || data.data?.txn_status || data.data?.payment_status || '').toLowerCase();
            const isSuccess = innerStatus === 'success' || innerStatus === 'completed' || innerStatus === 'captured';
            const isFailed = innerStatus === 'failed' || innerStatus === 'expired' || outerStatus === 'failed';

            if (isSuccess) {
                console.log('[UPM] Payment SUCCESS detected! Response:', JSON.stringify(data));
                clearInterval(upmPollingInterval);
                const utr = data.data?.utr || data.data?.txn_id || data.utr || data.txn_id || 'AUTO';
                await upmCreditWallet(txnId, amount, utr, 'zapupi');
            } else if (isFailed) {
                console.log('[UPM] Payment FAILED detected. Response:', JSON.stringify(data));
                clearInterval(upmPollingInterval);
                upmUpdateStatus('Payment failed.', 'error');
                setTimeout(() => closeUniversalPaymentModal(), 3000);
            }
        } catch (e) { console.error('Status poll error:', e); }
    }, 1500);
}

// === TranzUPI Order Status Polling ===
function upmStartTranzupiPolling(orderId, txnId, amount, config) {
    upmPollCount = 0;
    console.log('[UPM TranzUPI] Starting status polling for order:', orderId);
    upmPollingInterval = setInterval(async () => {
        upmPollCount++;
        if (upmPollCount > UPM_MAX_POLL) { clearInterval(upmPollingInterval); return; }
        if (upmPollCount % 10 === 0) upmUpdateStatus(`Checking payment... (${upmPollCount * 2}s)`, 'info');

        try {
            const response = await fetch('/api/check_payment_status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, gateway_type: 'tranzupi' })
            });
            if (!response.ok) { console.warn('[UPM TranzUPI] API returned', response.status); return; }
            let data;
            try { const rawText = await response.text(); data = JSON.parse(rawText); } catch (pe) { console.warn('[UPM TranzUPI] Non-JSON response'); return; }

            // Log every 5th poll for debugging
            if (upmPollCount % 5 === 1) console.log('[UPM TranzUPI #' + upmPollCount + '] Response:', JSON.stringify(data));

            // TranzUPI response: outer status is "COMPLETED" (not "SUCCESS") when txn is done
            // result.txnStatus becomes "SUCCESS"/"COMPLETED" after payment, result.status also
            const outerStatus = String(data.status || '').toUpperCase();
            const innerStatus = String(data.result?.status || '').toUpperCase();
            const txnStatus = String(data.result?.txnStatus || '').toUpperCase();

            const outerOk = (outerStatus === 'SUCCESS' || outerStatus === 'COMPLETED');
            const innerOk = (innerStatus === 'SUCCESS' || innerStatus === 'COMPLETED' || txnStatus === 'SUCCESS' || txnStatus === 'COMPLETED');
            const isSuccess = outerOk && innerOk;
            const isFailed = outerStatus === 'ERROR' || innerStatus === 'FAILED' || txnStatus === 'FAILED';

            if (isSuccess) {
                console.log('[UPM TranzUPI] Payment SUCCESS detected!', JSON.stringify(data));
                clearInterval(upmPollingInterval);
                const utr = data.result?.utr || data.result?.txn_id || 'AUTO';
                await upmCreditWallet(txnId, amount, utr, 'tranzupi');
            } else if (isFailed) {
                console.log('[UPM TranzUPI] Payment FAILED detected.', JSON.stringify(data));
                clearInterval(upmPollingInterval);
                upmUpdateStatus('Payment failed. Please try again.', 'error');
                setTimeout(() => closeUniversalPaymentModal(), 3000);
            }
        } catch (e) { console.error('TranzUPI poll error:', e); }
    }, 2000);
}

// === Callback Signal Handler (from payment-callback.html postMessage) ===
async function upmHandleCallbackSignal(orderId, txnId, amount, config, gateway) {
    if (upmSuccessShown) return; // Already handled
    console.log('[UPM Callback] Payment callback received — checking status immediately');
    upmUpdateStatus('Payment completed! Verifying...', 'info');

    // Close the payment popup
    if (upmPaymentWindow && !upmPaymentWindow.closed) {
        try { upmPaymentWindow.close(); } catch (e) { }
    }

    // Give TranzUPI 1.5s to process, then check
    await new Promise(r => setTimeout(r, 1500));

    if (gateway === 'tranzupi') {
        try {
            const response = await fetch('/api/check_payment_status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, gateway_type: 'tranzupi' })
            });
            if (response.ok) {
                const data = await response.json();
                console.log('[UPM Callback] TranzUPI status:', JSON.stringify(data));

                const outerStatus = String(data.status || '').toUpperCase();
                const innerStatus = String(data.result?.status || '').toUpperCase();
                const txnStatus = String(data.result?.txnStatus || '').toUpperCase();
                const outerOk = (outerStatus === 'SUCCESS' || outerStatus === 'COMPLETED');
                const innerOk = (innerStatus === 'SUCCESS' || innerStatus === 'COMPLETED' || txnStatus === 'SUCCESS' || txnStatus === 'COMPLETED');

                if (outerOk && innerOk) {
                    clearInterval(upmPollingInterval); upmPollingInterval = null;
                    const utr = data.result?.utr || data.result?.txn_id || 'AUTO';
                    await upmCreditWallet(txnId, amount, utr, 'tranzupi');
                    return;
                }
            }
        } catch (e) { console.warn('[UPM Callback] Status check error:', e.message); }
    }

    // If status check didn't confirm yet, the polling will catch it on next cycle
    console.log('[UPM Callback] Not confirmed yet — polling will continue');
}

// === Force-refresh user balance from Supabase ===
async function refreshUserBalance() {
    try {
        if (!state.user) return;
        const { data } = await supa.from('profiles').select('deposit_balance, winning_balance').eq('uid', state.user.uid).single();
        if (data) {
            state.userData.depositBalance = parseFloat(data.deposit_balance) || 0;
            state.userData.winningBalance = parseFloat(data.winning_balance) || 0;
            state.userData.walletBalance = state.userData.depositBalance + state.userData.winningBalance;
            if (typeof updateUIHeader === 'function') updateUIHeader();
            if (typeof renderWalletSection === 'function') renderWalletSection();
            if (typeof loadWalletTransactions === 'function') loadWalletTransactions();
        }
    } catch (e) {
        console.error('Balance refresh error:', e);
    }
}

// === Credit Wallet via Cloud Function ===
async function upmCreditWallet(txnId, amount, utr, gatewayType) {
    console.log('[UPM Credit] Starting credit for txn:', txnId, 'amount:', amount);
    let credited = false;

    // IMMEDIATELY stop the timeout timer to prevent it from expiring the transaction
    if (upmTimeoutTimer) { clearInterval(upmTimeoutTimer); upmTimeoutTimer = null; }
    if (upmPollingInterval) { clearInterval(upmPollingInterval); upmPollingInterval = null; }

    // Attempt 1: Firebase callable
    try {
        const confirmFn = functions.httpsCallable('confirmDeposit');
        const result = await confirmFn({ txnId, amount: parseInt(amount), utr: utr || 'AUTO_VERIFIED', gateway_type: gatewayType });
        const r = result.data;
        console.log('[UPM Credit] Callable success:', JSON.stringify(r));
        credited = true;
    } catch (e) {
        console.warn('[UPM Credit] Callable failed:', e.message, '— trying direct HTTP fallback');

        // Attempt 2: Direct HTTP call (bypasses FCM SDK issues)
        try {
            const idToken = await auth.currentUser.getIdToken();
            const resp = await fetch('https://us-central1-jeetoplay-325f1.cloudfunctions.net/confirmDeposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                body: JSON.stringify({ data: { txnId, amount: parseInt(amount), utr: utr || 'AUTO_VERIFIED', gateway_type: gatewayType } })
            });
            const respData = await resp.json();
            console.log('[UPM Credit] HTTP fallback response:', JSON.stringify(respData));
            if (respData.result?.success || respData.result?.alreadyCredited) {
                credited = true;
            }
        } catch (e2) {
            console.error('[UPM Credit] HTTP fallback also failed:', e2.message);
        }
    }

    if (credited) {
        console.log('[UPM Credit] Wallet credited successfully — showing success UI');
        // Show success UI and refresh balance
        upmShowSuccess(txnId, amount);
    } else {
        // Last resort: check if balance was updated by webhook
        try {
            const { data: txnCheck } = await supa.from('transactions').select('status').eq('id', txnId).single();
            if (txnCheck && txnCheck.status === 'SUCCESS') {
                console.log('[UPM Credit] Transaction already SUCCESS (credited by webhook)');
                upmShowSuccess(txnId, amount);
            } else {
                console.error('[UPM Credit] Failed to credit. Txn status:', txnCheck?.status);
                upmUpdateStatus('Payment received. Contact support if balance not updated.', 'error');
                // Still refresh balance in case webhook credited it
                await refreshUserBalance();
            }
        } catch (e3) {
            console.error('[UPM Credit] Status check failed:', e3.message);
            upmUpdateStatus('Payment received. Contact support if balance not updated.', 'error');
        }
    }
}

// === Show Success Animation ===
function upmShowSuccess(txnId, amount) {
    // Prevent duplicate calls (Firebase listener + credit callback + fallback can all fire)
    if (upmSuccessShown) return;
    upmSuccessShown = true;

    // Stop everything — use clearInterval consistently (timeout uses setInterval)
    if (upmPollingInterval) { clearInterval(upmPollingInterval); upmPollingInterval = null; }
    if (upmTimeoutTimer) { clearInterval(upmTimeoutTimer); upmTimeoutTimer = null; }
    if (recoveryVerifyTimer) { clearInterval(recoveryVerifyTimer); recoveryVerifyTimer = null; }
    if (upmFirebaseListener) { clearInterval(upmFirebaseListener); upmFirebaseListener = null; }

    // Update steps UI
    const s2 = document.getElementById('upm-step2');
    const s3 = document.getElementById('upm-step3');
    if (s2) { s2.style.background = 'rgba(74,222,128,0.15)'; s2.style.borderColor = 'rgba(74,222,128,0.4)'; s2.querySelector('span:last-child').style.color = '#4ade80'; }
    if (s3) { s3.style.background = 'rgba(74,222,128,0.15)'; s3.style.borderColor = 'rgba(74,222,128,0.4)'; s3.querySelector('span:last-child').style.color = '#4ade80'; }

    // Show success overlay with confetti
    const overlay = document.getElementById('upm-success-overlay');
    if (overlay) { overlay.style.display = 'flex'; }

    // Confetti burst 🎉
    const confettiBox = document.getElementById('upm-confetti');
    if (confettiBox) {
        const colors = ['#4ade80', '#22c55e', '#facc15', '#f97316', '#3b82f6', '#a855f7', '#ec4899', '#fff'];
        for (let i = 0; i < 40; i++) {
            const piece = document.createElement('div');
            piece.className = 'upm-confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.top = '-10px';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            piece.style.animationDelay = (Math.random() * 0.5) + 's';
            piece.style.width = (5 + Math.random() * 6) + 'px';
            piece.style.height = (5 + Math.random() * 6) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            confettiBox.appendChild(piece);
        }
    }

    // Haptic feedback for mobile
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // Force-refresh balance from Firebase
    refreshUserBalance();

    showToast(`🪙 ${amount} coins added to your wallet!`, 'success');
    localStorage.removeItem('pending_deposit_txn');

    // Close popup if open
    if (upmPaymentWindow && !upmPaymentWindow.closed) upmPaymentWindow.close();

    // Auto-close modal and navigate to wallet after 4s
    setTimeout(() => {
        closeUniversalPaymentModal();
        // Navigate to wallet section
        if (typeof navigateTo === 'function') {
            navigateTo('wallet');
        } else if (window.location.hash !== '#wallet') {
            window.location.hash = '#wallet';
        }
    }, 4000);
}

// === Update Status Bar ===
function upmUpdateStatus(text, type = 'info') {
    const bar = document.getElementById('upm-status-bar');
    const txt = document.getElementById('upm-status-text');
    const spinner = document.getElementById('upm-spinner');

    if (txt) txt.textContent = text;
    if (type === 'success') {
        if (bar) { bar.style.background = 'rgba(74,222,128,0.15)'; bar.style.borderColor = 'rgba(74,222,128,0.5)'; }
        if (txt) txt.style.color = '#4ade80';
        if (spinner) spinner.style.display = 'none';
    } else if (type === 'error') {
        if (bar) { bar.style.background = 'rgba(239,68,68,0.15)'; bar.style.borderColor = 'rgba(239,68,68,0.5)'; }
        if (txt) txt.style.color = '#ef4444';
        if (spinner) spinner.style.display = 'none';
    }
}

// === Timeout ===
function upmStartTimeout(txnId) {
    let remaining = UPM_TIMEOUT_MS;
    const countdownEl = document.getElementById('upm-countdown');

    const tick = setInterval(() => {
        remaining -= 1000;
        if (remaining <= 0) {
            clearInterval(tick);
            upmUpdateStatus('Payment timed out. Check wallet or contact support.', 'error');
            supa.from('transactions').select('status').eq('id', txnId).single().then(({ data }) => {
                if (data?.status === 'PENDING') {
                    supa.from('transactions').update({ status: 'EXPIRED' }).eq('id', txnId);
                }
            });
            setTimeout(() => closeUniversalPaymentModal(), 4000);
            return;
        }
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        if (countdownEl) countdownEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);
    upmTimeoutTimer = tick;
}

// === Close Modal ===
window.closeUniversalPaymentModal = () => {
    // Stop all timers and listeners
    if (upmPollingInterval) { clearInterval(upmPollingInterval); upmPollingInterval = null; }
    if (upmTimeoutTimer) { clearInterval(upmTimeoutTimer); upmTimeoutTimer = null; }
    if (recoveryVerifyTimer) { clearInterval(recoveryVerifyTimer); recoveryVerifyTimer = null; }
    if (upmMessageListener) { window.removeEventListener('message', upmMessageListener); upmMessageListener = null; }

    // Clean up Supabase polling listener
    const pendingRaw = localStorage.getItem('pending_deposit_txn');
    const pending = pendingRaw ? JSON.parse(pendingRaw) : {};

    if (upmFirebaseListener) {
        clearInterval(upmFirebaseListener);
        upmFirebaseListener = null;
    }

    // NOTE: We do NOT mark the transaction as CANCELLED from client-side.
    // If the user paid, the webhook/polling will credit it server-side.
    // If the user didn't pay, the 10-minute server timeout will expire it.
    // This prevents accidental cancellation of valid payments.
    if (upmSuccessShown) {
        localStorage.removeItem('pending_deposit_txn');
    }

    if (upmPaymentWindow && !upmPaymentWindow.closed) upmPaymentWindow.close();
    upmPaymentWindow = null;

    const modal = document.getElementById('upm-modal');
    if (modal) modal.style.display = 'none';
};

// === Pending Deposit Recovery (runs on app load / visibility change) ===
// Enhanced: actively verifies with payment gateway via confirmDeposit,
// instead of passively waiting for webhook only.
function checkPendingDeposit() {
    // Guard: prevent duplicate concurrent calls (called from both window.load and auth.onAuthStateChanged)
    if (_checkPendingDepositRunning) return;

    // If recovery verification is already actively running (timer + Firebase listener),
    // don't start another round — it would waste rate limit budget and recreate the modal
    if (recoveryVerifyTimer) {
        console.log('[Recovery] Recovery verification already active, skipping');
        return;
    }

    const raw = localStorage.getItem('pending_deposit_txn');
    if (!raw) return;

    try {
        const pending = JSON.parse(raw);
        if (!pending.txnId || !pending.userId) { localStorage.removeItem('pending_deposit_txn'); return; }

        // Check if expired (older than 15 minutes)
        if (Date.now() - pending.createdAt > 15 * 60 * 1000) {
            localStorage.removeItem('pending_deposit_txn');
            return;
        }

        // Ensure user is authenticated before making DB/function calls
        if (!auth.currentUser) {
            console.log('[Recovery] Auth not ready yet, skipping checkPendingDeposit');
            return;
        }

        _checkPendingDepositRunning = true;

        supa.from('transactions').select('*').eq('id', pending.txnId).single().then(async ({ data: txn }) => {
            if (!txn) {
                localStorage.removeItem('pending_deposit_txn');
                _checkPendingDepositRunning = false;
                return;
            }

            if (txn.status === 'SUCCESS') {
                // Already credited (webhook or previous confirmation handled it)
                showToast(`🪙 ${txn.amount} deposit was successful!`, 'success');
                localStorage.removeItem('pending_deposit_txn');
                refreshUserBalance();
                _checkPendingDepositRunning = false;

            } else if (txn.status === 'PENDING') {
                // ── Active Recovery: try confirmDeposit immediately ──
                // This verifies payment status directly with the payment gateway (server-side)
                // If user didn't pay, gateway returns NOT PAID → no credit (safe)
                // If user paid, gateway returns SUCCESS → credit happens
                console.log('[Recovery] Found PENDING deposit, actively verifying with gateway...', pending.txnId);

                let immediateSuccess = false;
                try {
                    const confirmFn = functions.httpsCallable('confirmDeposit');
                    const result = await confirmFn({
                        txnId: pending.txnId,
                        amount: parseInt(pending.amount),
                        utr: 'RECOVERY_AUTO',
                        gateway_type: pending.gateway || ''
                    });
                    if (result.data?.success || result.data?.alreadyCredited) {
                        console.log('[Recovery] Immediate verification SUCCESS!');
                        immediateSuccess = true;
                        showToast(`🪙 ${pending.amount} coins added to your wallet!`, 'success');
                        localStorage.removeItem('pending_deposit_txn');
                        refreshUserBalance();
                    }
                } catch (e) {
                    // Expected if payment is genuinely still pending at gateway
                    console.log('[Recovery] Immediate verification not confirmed yet:', e.message);
                }

                if (!immediateSuccess) {
                    // Payment not confirmed yet — show recovery modal with Firebase listener
                    // + start periodic retries via confirmDeposit
                    showToast('Verifying your deposit...', 'info');
                    showUniversalPaymentModal({
                        paymentUrl: null, autoCheckUrl: null,
                        orderId: pending.orderId || pending.txnId,
                        amount: pending.amount, txnId: pending.txnId,
                        config: {}, gateway: 'recovery'
                    });
                    // Start periodic verification alongside the Firebase listener
                    startRecoveryVerification(pending.txnId, pending.amount, pending.gateway);
                }

                _checkPendingDepositRunning = false;

            } else {
                // EXPIRED, FAILED, etc.
                localStorage.removeItem('pending_deposit_txn');
                _checkPendingDepositRunning = false;
            }
        }).catch(err => {
            console.warn('[Recovery] Error during pending deposit check:', err.message);
            _checkPendingDepositRunning = false;
        });
    } catch (e) {
        localStorage.removeItem('pending_deposit_txn');
        _checkPendingDepositRunning = false;
    }
}

// === Recovery Verification Polling ===
// Periodically calls confirmDeposit during recovery to actively check with the payment gateway.
// The gateway is the source of truth — if user didn't pay, gateway returns NOT PAID, no credit.
// Respects rate limit: max 5 calls per 10 minutes (1 initial + 4 retries here).
function startRecoveryVerification(txnId, amount, gateway) {
    // Clean up any existing recovery timer
    if (recoveryVerifyTimer) { clearInterval(recoveryVerifyTimer); recoveryVerifyTimer = null; }
    recoveryVerifyCount = 0;

    console.log('[Recovery] Starting periodic verification every', RECOVERY_VERIFY_INTERVAL / 1000, 's, max', RECOVERY_VERIFY_MAX_RETRIES, 'retries');

    recoveryVerifyTimer = setInterval(async () => {
        recoveryVerifyCount++;

        // Stop if max retries reached or success already shown
        if (recoveryVerifyCount > RECOVERY_VERIFY_MAX_RETRIES || upmSuccessShown) {
            clearInterval(recoveryVerifyTimer);
            recoveryVerifyTimer = null;
            if (!upmSuccessShown) {
                console.log('[Recovery] Max retries reached. Relying on Firebase listener/webhook.');
            }
            return;
        }

        console.log(`[Recovery] Verification retry ${recoveryVerifyCount}/${RECOVERY_VERIFY_MAX_RETRIES} for txn: ${txnId}`);

        try {
            // Quick DB check first: webhook may have already credited
            const { data: txnCheck } = await supa.from('transactions').select('status').eq('id', txnId).single();
            if (txnCheck && txnCheck.status === 'SUCCESS') {
                console.log('[Recovery] Transaction already SUCCESS (webhook credited)');
                clearInterval(recoveryVerifyTimer);
                recoveryVerifyTimer = null;
                upmShowSuccess(txnId, amount);
                return;
            }

            // Call confirmDeposit for server-side gateway cross-verification
            const confirmFn = functions.httpsCallable('confirmDeposit');
            const result = await confirmFn({
                txnId: txnId,
                amount: parseInt(amount),
                utr: 'RECOVERY_AUTO',
                gateway_type: gateway || ''
            });

            if (result.data?.success || result.data?.alreadyCredited) {
                console.log('[Recovery] Retry verification SUCCESS!');
                clearInterval(recoveryVerifyTimer);
                recoveryVerifyTimer = null;
                upmShowSuccess(txnId, amount);
            }
        } catch (e) {
            // Expected if payment is genuinely not completed yet at gateway
            console.log(`[Recovery] Retry ${recoveryVerifyCount} not confirmed:`, e.message);
        }
    }, RECOVERY_VERIFY_INTERVAL);
}

// Backward compat aliases
window.closeZapUPIModal = window.closeUniversalPaymentModal;

// Copy UPI ID helper
window.copyUpiIdToClipboard = (upiId) => {
    navigator.clipboard.writeText(upiId).then(() => {
        showToast('UPI ID copied!', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
};


window.submitManualPayment = async (txnId) => {
    const utr = document.getElementById('manual-utr-input').value.trim();
    if (!utr || utr.length < 10) {
        return showToast('Please enter a valid UTR/Reference number', 'error');
    }

    try {
        await supa.from('transactions').update({
            status: 'VERIFICATION_PENDING',
            description: JSON.stringify({ utr: utr, submitted_at: Date.now() })
        }).eq('id', txnId);

        showToast('Payment submitted! Awaiting admin verification.', 'success');
        closeDepositModal();

    } catch (e) {
        showToast('Failed to submit: ' + e.message, 'error');
    }
};

// Copy UPI ID
window.copyUpiId = () => {
    const upiId = document.getElementById('pay-upi-id').textContent;
    navigator.clipboard.writeText(upiId).then(() => {
        showToast('UPI ID copied!', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
};

// Submit payment confirmation
window.submitPaymentConfirmation = async () => {
    const utr = document.getElementById('payment-utr').value.trim();
    if (!utr) {
        return showToast('Please enter UTR/Reference number', 'error');
    }

    try {
        // Update transaction with UTR
        await supa.from('transactions').update({
            status: 'VERIFICATION_PENDING',
            description: JSON.stringify({ utr: utr, submitted_at: Date.now() })
        }).eq('id', depositState.transactionId);

        // Show confirmation
        document.getElementById('deposit-step-2').classList.add('hidden');
        document.getElementById('deposit-step-3').classList.remove('hidden');

        showToast('Payment submitted for verification', 'success');

    } catch (e) {
        console.error('Submit confirmation error:', e);
        showToast('Failed to submit: ' + e.message, 'error');
    }
};

// Close deposit modal — uses safe access since showManualUpiPayment replaces inner content
window.closeDepositModal = () => {
    const modal = document.getElementById('deposit-modal');
    if (modal) modal.classList.add('hidden');

    // These elements may not exist if manual UPI replaced the modal content
    const paymentUtr = document.getElementById('payment-utr');
    if (paymentUtr) paymentUtr.value = '';
    const customAmount = document.getElementById('custom-deposit-amount');
    if (customAmount) customAmount.value = '';

    // Restore original deposit modal content so next open works correctly
    const modalContent = document.getElementById('deposit-modal-content');
    if (modalContent && !document.getElementById('deposit-step-1')) {
        // Modal inner HTML was replaced by showManualUpiPayment — restore original structure
        modalContent.innerHTML = `
            <h3 style="margin-bottom: 1rem;"><i class="fa-solid fa-wallet text-primary"></i> Buy Coins</h3>
            <div id="deposit-step-1">
                <p class="text-muted" style="margin-bottom: 1rem;">Select coins to buy: <span style="color: var(--primary); font-weight: 600; font-size: 0.8rem;">1 Coin = ₹1</span></p>
                <input type="hidden" id="selected-deposit-amount" value="">
                <div id="deposit-slabs" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 1.5rem;"></div>
                <div id="selected-amount-display" class="hidden" style="background: linear-gradient(135deg, rgba(0,255,136,0.1), rgba(0,255,136,0.05)); border: 1px solid var(--primary); border-radius: 12px; padding: 15px; margin-bottom: 1rem; text-align: center;">
                    <span style="color: var(--text-muted); font-size: 0.85rem;">You're buying</span>
                    <div style="font-size: 1.8rem; font-weight: 700; color: var(--primary);" id="display-amount">🪙 0</div>
                </div>
                <button id="deposit-proceed-btn" class="btn btn-primary btn-block" onclick="proceedToPayment()" disabled style="opacity: 0.5;">Select an Amount</button>
            </div>
            <div id="deposit-step-2" class="hidden">
                <div style="text-align: center; padding: 1rem;">
                    <i class="fa-solid fa-qrcode" style="font-size: 3rem; color: var(--primary); margin-bottom: 1rem;"></i>
                    <p style="font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem;">Pay ₹<span id="pay-amount">0</span> <span style="font-size: 0.8rem; color: rgba(255,255,255,0.6);">(for 🪙 <span id="pay-coins-amount">0</span> coins)</span></p>
                    <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 1rem;">Transaction ID: <span id="pay-txn-id">-</span></p>
                    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                        <p style="font-weight: 600; margin-bottom: 0.5rem;">UPI ID:</p>
                        <p id="pay-upi-id" style="font-size: 1.1rem; color: var(--primary); cursor: pointer;" onclick="copyUpiId()">-</p>
                        <button class="btn btn-outline btn-sm" style="margin-top: 0.5rem;" onclick="copyUpiId()"><i class="fa-solid fa-copy"></i> Copy</button>
                    </div>
                    <a id="upi-deep-link" href="#" class="btn btn-primary btn-block" style="margin-bottom: 1rem;"><i class="fa-brands fa-google-pay"></i> Open UPI App</a>
                    <p class="text-muted" style="font-size: 0.8rem;">After payment, enter the UTR/Reference number below:</p>
                    <input type="text" id="payment-utr" class="input" placeholder="Enter UTR/Reference Number" style="width: 100%; margin: 0.5rem 0;">
                    <button class="btn btn-success btn-block" onclick="submitPaymentConfirmation()"><i class="fa-solid fa-check"></i> I've Made Payment</button>
                </div>
            </div>
            <div id="deposit-step-3" class="hidden">
                <div style="text-align: center; padding: 2rem;">
                    <i class="fa-solid fa-clock" style="font-size: 3rem; color: var(--warning); margin-bottom: 1rem;"></i>
                    <h4>Payment Pending Verification</h4>
                    <p class="text-muted" style="margin-top: 0.5rem;">Your payment is being verified. Balance will be updated shortly.</p>
                </div>
            </div>
            <button class="btn btn-outline btn-block" style="margin-top: 1rem;" onclick="closeDepositModal()">Close</button>
        `;
    }

    depositState = { amount: 0, transactionId: null, upiId: null, upiLink: null };
};


// Listen for visibility change (Mobile App Switch) — check pending deposits
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log('App visible, checking pending payments...');
        if (typeof checkPendingDeposit === 'function') checkPendingDeposit();
    }
});

// Check on load
window.addEventListener('load', () => {
    // Small delay to ensure firebase/state is ready
    setTimeout(() => { if (typeof checkPendingDeposit === 'function') checkPendingDeposit(); }, 1000);

    // Handle hash navigation (e.g., /#wallet from payment callback)
    setTimeout(() => {
        if (window.location.hash === '#wallet') {
            // Navigate to wallet section
            const walletBtn = document.querySelector('[onclick*="renderWalletSection"]') ||
                document.querySelector('[data-section="wallet"]') ||
                document.getElementById('wallet-nav');
            if (walletBtn) walletBtn.click();
            // Clear hash
            history.replaceState(null, '', window.location.pathname);
        }
    }, 1500);
});

