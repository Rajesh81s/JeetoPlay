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
    container.innerHTML = ''; // Clear

    try {
        const snap = await db.ref('platform_config/payments/deposit_slabs').once('value');
        const slabs = snap.val() || [50, 100, 200, 500, 1000];

        slabs.sort((a, b) => a - b);

        slabs.forEach(amount => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline';
            btn.style.cssText = 'padding: 15px; font-size: 1rem;';
            btn.textContent = '🪙 ' + amount;
            btn.onclick = () => selectDepositAmount(amount);
            container.appendChild(btn);
        });
    } catch (e) {
        console.error('Failed to load slabs:', e);
        // Default slabs
        [50, 100, 200, 500, 1000].forEach(amount => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline';
            btn.style.cssText = 'padding: 15px; font-size: 1rem;';
            btn.textContent = '🪙 ' + amount;
            btn.onclick = () => selectDepositAmount(amount);
            container.appendChild(btn);
        });
    }
}

// Select amount
function selectDepositAmount(amount) {
    // Store selected amount
    document.getElementById('selected-deposit-amount').value = amount;
    depositState.amount = amount;

    // Show selected amount display
    document.getElementById('selected-amount-display').classList.remove('hidden');
    document.getElementById('display-amount').textContent = '🪙 ' + amount;

    // Enable proceed button
    const proceedBtn = document.getElementById('deposit-proceed-btn');
    proceedBtn.disabled = false;
    proceedBtn.style.opacity = '1';
    proceedBtn.textContent = 'Buy ' + amount + ' Coins';

    // Highlight selected button
    const btns = document.querySelectorAll('#deposit-slabs button');
    btns.forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
    });
    event.target.classList.remove('btn-outline');
    event.target.classList.add('btn-primary');
}

// Proceed to payment — Universal Payment Flow
window.proceedToPayment = async () => {
    const amount = parseInt(document.getElementById('selected-deposit-amount').value);
    if (!amount || amount < 1) {
        return showToast('Please select a deposit amount first', 'error');
    }

    depositState.amount = amount;
    showToast('Initiating payment...', 'info');

    try {
        const configSnap = await db.ref('platform_config/payments').once('value');
        const config = configSnap.val() || {};
        const depositSnap = await db.ref('platform_config/deposit_options/enabled').once('value');
        const depositsEnabled = depositSnap.val() !== false;

        if (!config.gateway_enabled) return showToast('Payment gateway is not enabled. Contact support.', 'error');
        if (!depositsEnabled) return showToast('Deposits are currently disabled.', 'error');

        const txnId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
        depositState.transactionId = txnId;
        const activeGateway = config.active_gateway || 'manual';

        await db.ref('wallet_transactions/' + txnId).set({
            userId: state.user.uid,
            amount: amount,
            type: 'DEPOSIT',
            status: 'PENDING',
            reason: 'Deposit',
            gateway: activeGateway,
            created_at: firebase.database.ServerValue.TIMESTAMP,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });

        if (activeGateway === 'manual') {
            showManualUpiPayment(config, amount, txnId);
        } else if (activeGateway === 'zapupi') {
            if (!config.zapupi_token) throw new Error('ZapUPI token not configured. Contact admin.');
            const res = await fetch('/api/create_payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, mobile: state.userData.phone || "9999999999", order_id: txnId, gateway_type: 'zapupi' })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[UPM] ZapUPI API error:', res.status, errText.substring(0, 300));
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
        } else if (activeGateway === 'custom') {
            if (!config.gateway_endpoint) throw new Error('Gateway API endpoint not configured. Contact admin.');
            const res = await fetch('/api/create_payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, mobile: state.userData.phone || "9999999999", order_id: txnId, gateway_type: 'custom', gateway_endpoint: config.gateway_endpoint, api_key: config.api_key, secret_key: config.secret_key })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[UPM] Custom gateway API error:', res.status, errText.substring(0, 300));
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
        } else throw new Error('Unknown gateway type: ' + activeGateway);
    } catch (e) {
        console.error('Payment init error:', e);
        showToast('Failed: ' + e.message, 'error');
    }
};

// Show manual UPI payment modal
function showManualUpiPayment(config, amount, txnId) {
    const upiId = config.upi_id || 'merchant@upi';
    const merchantName = config.merchant_name || 'JeetoPlay';

    document.getElementById('deposit-modal-content').innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <h3 style="margin-bottom: 20px; color: var(--primary);">💳 Pay via UPI</h3>
            
            <div style="background: var(--bg-hover); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 10px;">Amount to Pay</div>
                <div style="font-size: 2rem; font-weight: 700; color: var(--success);">₹${amount}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">= 🪙 ${amount} coins</div>
            </div>
            
            <div style="background: var(--bg-hover); padding: 15px; border-radius: 12px; margin-bottom: 20px;">
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">UPI ID</div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <span id="upi-display" style="font-size: 1.1rem; font-weight: 600; color: var(--text);">${upiId}</span>
                    <button onclick="copyUpiIdToClipboard('${upiId}')" class="btn btn-sm" style="padding: 5px 12px; font-size: 0.8rem;">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 5px;">${merchantName}</div>
            </div>
            
            <div style="text-align: left; margin-bottom: 20px;">
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px;">
                    <strong>Steps:</strong><br>
                    1. Open any UPI app (PhonePe, GPay, Paytm)<br>
                    2. Pay ₹${amount} to the above UPI ID (= 🪙 ${amount} coins)<br>
                    3. Enter the UTR/Reference number below
                </p>
            </div>
            
            <div class="form-group" style="margin-bottom: 15px;">
                <label class="form-label" style="text-align: left;">UTR / Reference Number</label>
                <input type="text" id="manual-utr-input" class="form-input" placeholder="Enter 12-digit UTR" style="font-size: 1rem;">
            </div>
            
            <button onclick="submitManualPayment('${txnId}')" class="btn btn-primary" style="width: 100%; padding: 15px; font-size: 1rem;">
                <i class="fa-solid fa-check"></i> I've Paid - Submit for Verification
            </button>
            
            <button onclick="closeDepositModal()" class="btn" style="width: 100%; margin-top: 10px; background: transparent; border: 1px solid var(--border);">
                Cancel
            </button>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════
// UNIVERSAL PAYMENT MODAL — handles ZapUPI, Custom, all gateways
// ═══════════════════════════════════════════════════════════
let upmPollingInterval = null;
let upmPaymentWindow = null;
let upmFirebaseListener = null;
let upmSuccessShown = false;
const UPM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let upmTimeoutTimer = null;

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
    }

    // Create modal
    let modal = document.getElementById('upm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'upm-modal';
        document.body.appendChild(modal);
    }

    const gatewayLabel = gateway === 'zapupi' ? 'ZapUPI' : gateway === 'custom' ? 'Payment Gateway' : 'Gateway';

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

    // === Gateway-specific polling ===
    if (gateway === 'zapupi' && autoCheckUrl) {
        upmStartPolling(autoCheckUrl, txnId, amount, config);
    } else if (gateway === 'zapupi') {
        upmStartStatusPolling(orderId, txnId, amount, config);
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

// === Firebase Realtime Listener ===
function upmStartFirebaseListener(txnId, amount) {
    if (upmFirebaseListener) db.ref('wallet_transactions/' + txnId).off('value', upmFirebaseListener);

    upmFirebaseListener = db.ref('wallet_transactions/' + txnId).on('value', snap => {
        const txn = snap.val();
        if (!txn) return;

        if (txn.status === 'SUCCESS') {
            upmShowSuccess(txnId, amount);
        } else if (txn.status === 'FAILED') {
            upmUpdateStatus('Payment failed. Please try again.', 'error');
            setTimeout(() => closeUniversalPaymentModal(), 3000);
        }
    });
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

// === Force-refresh user balance from Firebase ===
async function refreshUserBalance() {
    try {
        if (!state.user) return;
        const snap = await db.ref('users/' + state.user.uid).once('value');
        if (snap.exists()) {
            const fresh = snap.val();
            state.userData.depositBalance = fresh.depositBalance || 0;
            state.userData.winningBalance = fresh.winningBalance || 0;
            state.userData.walletBalance = (fresh.depositBalance || 0) + (fresh.winningBalance || 0);
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
            const snap = await db.ref('wallet_transactions/' + txnId).once('value');
            const txn = snap.val();
            if (txn && txn.status === 'SUCCESS') {
                console.log('[UPM Credit] Transaction already SUCCESS (credited by webhook)');
                upmShowSuccess(txnId, amount);
            } else {
                console.error('[UPM Credit] Failed to credit. Txn status:', txn?.status);
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
    if (upmFirebaseListener) { db.ref('wallet_transactions/' + txnId).off('value', upmFirebaseListener); upmFirebaseListener = null; }

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

    // Auto-close after 5s (user can also click "Done" button)
    setTimeout(() => closeUniversalPaymentModal(), 5000);
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
            db.ref('wallet_transactions/' + txnId).once('value').then(snap => {
                if (snap.val()?.status === 'PENDING') {
                    db.ref('wallet_transactions/' + txnId).update({ status: 'EXPIRED', expired_at: firebase.database.ServerValue.TIMESTAMP });
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
    if (upmPollingInterval) { clearInterval(upmPollingInterval); upmPollingInterval = null; }
    if (upmTimeoutTimer) { clearInterval(upmTimeoutTimer); upmTimeoutTimer = null; }

    // If user manually cancels and payment wasn't successful, mark as CANCELLED
    const pendingRaw = localStorage.getItem('pending_deposit_txn');
    const pending = pendingRaw ? JSON.parse(pendingRaw) : {};

    if (upmFirebaseListener) {
        if (pending.txnId) db.ref('wallet_transactions/' + pending.txnId).off('value', upmFirebaseListener);
        upmFirebaseListener = null;
    }

    // Set CANCELLED status if transaction is still PENDING (user chose to cancel)
    if (pending.txnId && !upmSuccessShown) {
        db.ref('wallet_transactions/' + pending.txnId).once('value').then(snap => {
            const txn = snap.val();
            if (txn && txn.status === 'PENDING') {
                db.ref('wallet_transactions/' + pending.txnId).update({
                    status: 'CANCELLED',
                    cancelled_at: firebase.database.ServerValue.TIMESTAMP,
                    cancelled_by: 'USER'
                });
            }
        }).catch(() => { });
        localStorage.removeItem('pending_deposit_txn');
    }

    if (upmPaymentWindow && !upmPaymentWindow.closed) upmPaymentWindow.close();
    upmPaymentWindow = null;

    const modal = document.getElementById('upm-modal');
    if (modal) modal.style.display = 'none';
};

// === Pending Deposit Recovery (runs on app load) ===
function checkPendingDeposit() {
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

        db.ref('wallet_transactions/' + pending.txnId).once('value').then(snap => {
            const txn = snap.val();
            if (!txn) { localStorage.removeItem('pending_deposit_txn'); return; }

            if (txn.status === 'SUCCESS') {
                showToast(`🪙 ${txn.amount} deposit was successful!`, 'success');
                localStorage.removeItem('pending_deposit_txn');
                if (typeof renderWalletSection === 'function') renderWalletSection();
                if (typeof updateUIHeader === 'function') updateUIHeader();
            } else if (txn.status === 'PENDING') {
                // SECURITY: Use 'recovery' gateway so NO auto-polling starts
                // Only the Firebase realtime listener will detect webhook-confirmed payments
                showToast('You have a pending deposit. Monitoring...', 'info');
                showUniversalPaymentModal({
                    paymentUrl: null, autoCheckUrl: null,
                    orderId: pending.orderId || pending.txnId,
                    amount: pending.amount, txnId: pending.txnId,
                    config: {}, gateway: 'recovery'
                });
            } else {
                // EXPIRED, FAILED, etc.
                localStorage.removeItem('pending_deposit_txn');
            }
        });
    } catch (e) {
        localStorage.removeItem('pending_deposit_txn');
    }
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
        await db.ref('wallet_transactions/' + txnId).update({
            utr: utr,
            status: 'VERIFICATION_PENDING',
            submitted_at: firebase.database.ServerValue.TIMESTAMP
        });

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
        await db.ref('wallet_transactions/' + depositState.transactionId).update({
            utr: utr,
            status: 'VERIFICATION_PENDING',
            submitted_at: firebase.database.ServerValue.TIMESTAMP
        });

        // Show confirmation
        document.getElementById('deposit-step-2').classList.add('hidden');
        document.getElementById('deposit-step-3').classList.remove('hidden');

        showToast('Payment submitted for verification', 'success');

    } catch (e) {
        console.error('Submit confirmation error:', e);
        showToast('Failed to submit: ' + e.message, 'error');
    }
};

// Close deposit modal
window.closeDepositModal = () => {
    document.getElementById('deposit-modal').classList.add('hidden');
    document.getElementById('payment-utr').value = '';
    document.getElementById('custom-deposit-amount').value = '';
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

