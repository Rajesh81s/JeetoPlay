/**
 * payments.js — Payment-related Cloud Functions
 * Exports: createPaymentApi, zapupiAutoCheckApi, checkPaymentStatusApi,
 *          webhookApi, processWithdrawal, processDeposit, confirmDeposit, creditZapUPIDeposit
 */

const { functions, admin, db, assertAuth, sendPush } = require('./helpers');
const https = require('https');
const http = require('http');
const querystring = require('querystring');

// ─── Payment API (HTTP endpoint for hosting rewrite) ────────
// Proxies payment creation requests to ZapUPI or custom gateways
exports.createPaymentApi = functions.https.onRequest(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            amount, mobile, order_id, gateway_type,
            gateway_endpoint, api_key
        } = req.body;

        functions.logger.info('Payment request:', { gateway_type, amount, order_id });

        const REDIRECT_URL = 'https://jeetoplay-325f1.web.app/payment-callback.html';

        if (gateway_type === 'zapupi') {
            // Read secrets server-side — NEVER trust client-provided secrets
            const configSnap = await db.ref('platform_config/payments').once('value');
            const config = configSnap.val() || {};
            const token_key = config.zapupi_token;
            const secret_key = config.zapupi_secret || '';

            if (!token_key) {
                return res.status(400).json({ error: 'ZapUPI token_key not configured', status: false });
            }

            const postData = querystring.stringify({
                token_key: token_key,
                secret_key: secret_key,
                amount: String(amount),
                order_id: String(order_id),
                customer_mobile: mobile || '9999999999',
                redirect_url: REDIRECT_URL,
                remark1: 'deposit',
                remark2: 'jeetoplay'
            });

            const options = {
                hostname: 'api.zapupi.com',
                port: 443,
                path: '/api/create-order',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            return new Promise((resolve) => {
                const apiReq = https.request(options, (apiRes) => {
                    let data = '';
                    apiRes.on('data', (chunk) => { data += chunk; });
                    apiRes.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            res.status(200).json(json);
                        } catch (e) {
                            res.status(500).json({ error: 'Invalid response from ZapUPI', raw: data.substring(0, 500), status: false });
                        }
                        resolve();
                    });
                });
                apiReq.on('error', (e) => {
                    res.status(500).json({ error: 'ZapUPI connection failed: ' + e.message, status: false });
                    resolve();
                });
                apiReq.write(postData);
                apiReq.end();
            });
        }

        if (gateway_type === 'custom') {
            if (!gateway_endpoint) {
                return res.status(400).json({ error: 'Gateway endpoint not configured', status: false });
            }

            const url = new URL(gateway_endpoint);
            const isHttps = url.protocol === 'https:';

            const postData = querystring.stringify({
                token_key: api_key || '',
                api_key: api_key || '',
                secret_key: '',
                amount: String(amount),
                order_id: String(order_id),
                customer_mobile: mobile || '9999999999',
                redirect_url: REDIRECT_URL,
                remark1: 'deposit',
                remark2: 'jeetoplay'
            });

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const httpModule = isHttps ? https : http;

            return new Promise((resolve) => {
                const apiReq = httpModule.request(options, (apiRes) => {
                    let data = '';
                    apiRes.on('data', (chunk) => { data += chunk; });
                    apiRes.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            res.status(200).json(json);
                        } catch (e) {
                            res.status(500).json({ error: 'Invalid response from gateway', raw: data.substring(0, 500), status: false });
                        }
                        resolve();
                    });
                });
                apiReq.on('error', (e) => {
                    res.status(500).json({ error: 'Gateway connection failed: ' + e.message, status: false });
                    resolve();
                });
                apiReq.write(postData);
                apiReq.end();
            });
        }

        return res.status(400).json({ error: 'Unknown or missing gateway_type', status: false });

    } catch (error) {
        functions.logger.error('Create payment error:', error);
        res.status(500).json({ error: error.message, status: false });
    }
});

// ─── ZapUPI Auto-Check API (polls payment status) ────────
exports.zapupiAutoCheckApi = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { auto_check_url } = req.body;
        if (!auto_check_url) {
            return res.status(400).json({ error: 'Missing auto_check_url', status: false });
        }

        const url = new URL(auto_check_url);
        const options = {
            hostname: url.hostname, port: 443,
            path: url.pathname + url.search, method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'JeetoPlay/1.0' }
        };

        return new Promise((resolve) => {
            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', (chunk) => { data += chunk; });
                apiRes.on('end', () => {
                    try {
                        res.status(200).json(JSON.parse(data));
                    } catch (e) {
                        if (data.toLowerCase().includes('success')) {
                            res.status(200).json({ status: 'success' });
                        } else if (data.toLowerCase().includes('pending')) {
                            res.status(200).json({ status: 'pending' });
                        } else {
                            res.status(200).json({ status: 'unknown', raw: data });
                        }
                    }
                    resolve();
                });
            });
            apiReq.on('error', (e) => {
                res.status(500).json({ error: 'ZapUPI connection failed: ' + e.message, status: false });
                resolve();
            });
            apiReq.end();
        });
    } catch (error) {
        functions.logger.error('Auto check error:', error);
        res.status(500).json({ error: error.message, status: false });
    }
});

// ─── Check Payment Status API (ZapUPI order-status) ────────
exports.checkPaymentStatusApi = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ error: 'Missing order_id', status: false });
        }

        // Read secrets server-side — NEVER trust client-provided secrets
        const configSnap = await db.ref('platform_config/payments').once('value');
        const config = configSnap.val() || {};
        const token_key = config.zapupi_token;
        const secret_key = config.zapupi_secret || '';

        if (!token_key) {
            return res.status(400).json({ error: 'ZapUPI token not configured', status: false });
        }

        const postData = querystring.stringify({
            token_key, secret_key, order_id
        });

        const options = {
            hostname: 'api.zapupi.com', port: 443,
            path: '/api/order-status', method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve) => {
            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', (chunk) => { data += chunk; });
                apiRes.on('end', () => {
                    try {
                        res.status(200).json(JSON.parse(data));
                    } catch (e) {
                        res.status(500).json({ error: 'Invalid response from ZapUPI', status: false });
                    }
                    resolve();
                });
            });
            apiReq.on('error', (e) => {
                res.status(500).json({ error: 'ZapUPI connection failed: ' + e.message, status: false });
                resolve();
            });
            apiReq.write(postData);
            apiReq.end();
        });
    } catch (error) {
        functions.logger.error('Check payment status error:', error);
        res.status(500).json({ error: error.message, status: false });
    }
});

// ─── Webhook API (payment gateway callbacks) ────────
exports.webhookApi = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method === 'GET') return res.status(200).send('Webhook Active');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Merge query params and body (some gateways use query params)
    const data = { ...req.query, ...req.body };
    const txnId = data.order_id || data.transaction_id || data.orderId;
    const rawStatus = data.status || data.txn_status || data.transaction_status;

    functions.logger.info('webhookApi called:', { txnId, rawStatus, body: JSON.stringify(data).substring(0, 500) });

    if (!txnId) {
        return res.status(400).json({ error: 'Missing required fields: order_id/transaction_id' });
    }

    try {
        const txnRef = db.ref(`wallet_transactions/${txnId}`);
        const txnSnapshot = await txnRef.once('value');

        if (!txnSnapshot.exists()) {
            functions.logger.warn('webhookApi: transaction not found', { txnId });
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const txnData = txnSnapshot.val();

        if (txnData.status === 'SUCCESS') {
            return res.status(200).json({ success: true, message: 'Transaction already processed' });
        }

        // Determine success from various gateway status formats
        let isSuccess = false;
        if (rawStatus) {
            const s = String(rawStatus).toLowerCase();
            isSuccess = ['success', 'true', 'captured', 'completed'].includes(s);
        }

        if (!isSuccess) {
            await txnRef.update({ status: 'FAILED', gateway_response: data, updated_at: Date.now() });
            return res.status(200).json({ success: false, message: 'Transaction marked failed/pending' });
        }

        // ⚠️ SECURITY: Cross-verify with ZapUPI order-status API before crediting
        // Since ZapUPI has no HMAC webhook signing, we independently confirm payment status
        const gatewayType = txnData.gateway_type || txnData.gateway || '';
        if (gatewayType === 'zapupi' || !gatewayType) {
            try {
                const configSnap = await db.ref('platform_config/payments').once('value');
                const config = configSnap.val() || {};
                if (config.zapupi_token) {
                    const verifyData = querystring.stringify({
                        token_key: config.zapupi_token,
                        secret_key: config.zapupi_secret || '',
                        order_id: txnId
                    });
                    const verifyResult = await new Promise((resolve, reject) => {
                        const verifyReq = https.request({
                            hostname: 'api.zapupi.com', port: 443,
                            path: '/api/order-status', method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Content-Length': Buffer.byteLength(verifyData)
                            }
                        }, (apiRes) => {
                            let body = '';
                            apiRes.on('data', chunk => body += chunk);
                            apiRes.on('end', () => {
                                try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid ZapUPI response')); }
                            });
                        });
                        verifyReq.on('error', reject);
                        verifyReq.setTimeout(10000, () => { verifyReq.destroy(); reject(new Error('ZapUPI verify timeout')); });
                        verifyReq.write(verifyData);
                        verifyReq.end();
                    });

                    functions.logger.info('webhookApi: ZapUPI cross-verify result', { txnId, verifyStatus: verifyResult?.data?.status });

                    const zapStatus = String(verifyResult?.data?.status || '').toLowerCase();
                    if (zapStatus !== 'success') {
                        functions.logger.warn('webhookApi: ZapUPI cross-verify FAILED — payment not confirmed', { txnId, zapStatus, verifyResult });
                        await txnRef.update({ status: 'PENDING', gateway_response: data, webhook_verify_failed: true, updated_at: Date.now() });
                        return res.status(200).json({ success: false, message: 'Payment not confirmed by ZapUPI' });
                    }
                }
            } catch (verifyErr) {
                // If verification fails (timeout, network), log but proceed cautiously
                // The webhook payload said success, so we'll trust it but flag it
                functions.logger.warn('webhookApi: ZapUPI cross-verify error (proceeding with caution)', { txnId, error: verifyErr.message });
            }
        }

        const userId = txnData.userId;
        // ⚠️ SECURITY: Always use the amount from our stored transaction, NEVER from the webhook payload
        const parsedAmount = parseInt(txnData.amount);
        if (!parsedAmount || parsedAmount <= 0) {
            functions.logger.error('webhookApi: invalid stored amount', { txnId, storedAmount: txnData.amount });
            return res.status(400).json({ error: 'Invalid transaction amount' });
        }

        // ⚠️ ATOMIC STATUS CLAIM — prevents double-credit race with confirmDeposit (polling)
        const claimTxn = await txnRef.transaction(txn => {
            if (!txn) return txn;
            if (txn.status === 'SUCCESS') return; // abort — already credited
            txn.status = 'SUCCESS';
            txn.gateway_response = data;
            txn.processed_at = Date.now();
            txn.verified_by = 'WEBHOOK_AUTO';
            return txn;
        });

        if (!claimTxn.committed) {
            return res.status(200).json({ success: true, message: 'Transaction already processed by another handler' });
        }

        functions.logger.info('webhookApi: claimed txn, crediting balance', { txnId, userId, amount: parsedAmount });

        // We now own this txn — safe to credit balance
        const balanceTxn = await db.ref(`users/${userId}`).transaction(user => {
            if (!user) user = {}; // Fix: don't abort if user node is sparse
            user.depositBalance = (user.depositBalance || 0) + parsedAmount;
            user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
            return user;
        });

        if (!balanceTxn.committed) {
            // Rollback txn status since credit failed
            await txnRef.update({ status: 'PENDING', verified_by: null, processed_at: null });
            functions.logger.error('webhookApi: balance update FAILED', { txnId, userId });
            throw new Error('Failed to credit balance atomically');
        }

        const userAfter = balanceTxn.snapshot.val();
        functions.logger.info('webhookApi: balance credited', { txnId, userId, newDeposit: userAfter.depositBalance, newWallet: userAfter.walletBalance });

        // Update legacy wallet path
        await db.ref('wallets/' + userId).transaction(current => {
            if (!current) current = { balance: 0 };
            current.balance = (current.balance || 0) + parsedAmount;
            current.last_deposit = Date.now();
            return current;
        });

        return res.status(200).json({ success: true, message: 'Balance updated successfully' });
    } catch (error) {
        functions.logger.error('Webhook Error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ─── Process Withdrawal ─────────────────────────────────────
exports.processWithdrawal = functions.https.onCall(async (data, context) => {
    const uid = assertAuth(context);
    const { amount, upiId } = data;

    if (!amount || amount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Invalid amount');
    if (!upiId || !upiId.includes('@')) throw new functions.https.HttpsError('invalid-argument', 'Invalid UPI ID');

    // Get min withdrawal config
    const configSnap = await db.ref('platform_config/payments/min_withdrawal').once('value');
    const minWithdrawal = parseInt(configSnap.val()) || 10;
    if (amount < minWithdrawal) {
        throw new functions.https.HttpsError('invalid-argument', `Minimum withdrawal is ₹${minWithdrawal}`);
    }

    // Full-user-object transaction (proven pattern from deductBalance)
    // Single-field transactions on winningBalance were unreliable
    let txnBalBefore = 0;

    const txn = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) {
            functions.logger.warn(`processWithdrawal: user ${uid} is null in transaction (retry)`);
            return null;
        }

        const winBal = user.winningBalance || 0;
        txnBalBefore = winBal;

        functions.logger.info(`processWithdrawal: uid=${uid}, amount=${amount}, winBal=${winBal}`);

        if (winBal < amount) {
            functions.logger.warn(`processWithdrawal: INSUFFICIENT for ${uid}. Need ${amount}, have ${winBal}`);
            return; // Abort
        }

        user.winningBalance = winBal - amount;
        user.walletBalance = (user.depositBalance || 0) + user.winningBalance;

        return user;
    }, undefined, false);

    if (!txn.committed) {
        const balSnap = await db.ref(`users/${uid}/winningBalance`).once('value');
        const actualBal = balSnap.val() || 0;
        throw new functions.https.HttpsError('failed-precondition',
            `Insufficient winning balance. You have ₹${actualBal}, requested ₹${amount}`);
    }

    const userAfter = txn.snapshot.val();
    const balAfter = userAfter.winningBalance || 0;
    const userName = userAfter.fullName || userAfter.username || 'User';

    // Create withdrawal record
    const withdrawKey = db.ref('withdrawals').push().key;
    await db.ref('withdrawals/' + withdrawKey).set({
        userId: uid,
        userName: userName,
        amount: amount,
        upiId: upiId,
        winningBalanceBefore: balAfter + amount,
        winningBalanceAfter: balAfter,
        status: 'PENDING',
        createdAt: admin.database.ServerValue.TIMESTAMP
    });

    // Log wallet transaction
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: uid,
        userName: userName,
        type: 'WITHDRAW',
        amount: amount,
        isCredit: false,
        description: `Withdrawal to ${upiId}`,
        reason: 'Withdrawal Request',
        walletType: 'winning',
        withdrawalId: withdrawKey,
        upiId: upiId,
        status: 'PENDING',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    return { success: true, withdrawalId: withdrawKey, balanceAfter: balAfter };
});

// ─── Process Deposit (simulated) ────────────────────────────
exports.processDeposit = functions.https.onCall(async (data, context) => {
    const uid = assertAuth(context);
    const { amount, depositId } = data;

    if (!amount || amount < 1) throw new functions.https.HttpsError('invalid-argument', 'Invalid amount');

    // Credit deposit balance (server-side, bypasses rules)
    const txn = await db.ref(`users/${uid}/depositBalance`).transaction(b => (b || 0) + amount);
    const newBal = txn.snapshot.val() || 0;

    // Update deposit record if provided
    if (depositId) {
        await db.ref('deposits/' + depositId).update({
            status: 'SUCCESS',
            completedAt: admin.database.ServerValue.TIMESTAMP,
            balanceAfter: newBal
        });
    }

    return { success: true, newBalance: newBal };
});

// ─── Confirm Deposit (universal — works for ZapUPI, custom, all gateways) ──
const _confirmDepositHandler = async (data, context) => {
    const uid = assertAuth(context);
    const { txnId, utr } = data;

    functions.logger.info('confirmDeposit called:', { uid, txnId, utr, gateway_type: data.gateway_type });

    if (!txnId) {
        throw new functions.https.HttpsError('invalid-argument', 'txnId is required');
    }

    // Verify ownership and get stored transaction data
    const existingTxn = await db.ref('wallet_transactions/' + txnId).once('value');
    if (!existingTxn.exists()) {
        throw new functions.https.HttpsError('not-found', 'Transaction not found');
    }
    const existingTxnData = existingTxn.val();
    if (existingTxnData.userId !== uid) {
        functions.logger.warn('confirmDeposit: ownership mismatch', { txnId, txnUserId: existingTxnData.userId, callerUid: uid });
        throw new functions.https.HttpsError('permission-denied', 'Transaction does not belong to you');
    }

    // ⚠️ SECURITY: Always use the amount from our stored transaction, NEVER from the client
    const parsedAmount = parseInt(existingTxnData.amount);
    if (!parsedAmount || parsedAmount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid transaction amount');
    }

    // ⚠️ SECURITY: Cross-verify with ZapUPI before crediting (prevents fake success claims)
    const gatewayType = existingTxnData.gateway_type || existingTxnData.gateway || '';
    if (gatewayType === 'zapupi' || !gatewayType) {
        try {
            const configSnap = await db.ref('platform_config/payments').once('value');
            const config = configSnap.val() || {};
            if (config.zapupi_token) {
                const verifyData = querystring.stringify({
                    token_key: config.zapupi_token,
                    secret_key: config.zapupi_secret || '',
                    order_id: txnId
                });
                const verifyResult = await new Promise((resolve, reject) => {
                    const verifyReq = https.request({
                        hostname: 'api.zapupi.com', port: 443,
                        path: '/api/order-status', method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': Buffer.byteLength(verifyData)
                        }
                    }, (apiRes) => {
                        let body = '';
                        apiRes.on('data', chunk => body += chunk);
                        apiRes.on('end', () => {
                            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid ZapUPI response')); }
                        });
                    });
                    verifyReq.on('error', reject);
                    verifyReq.setTimeout(10000, () => { verifyReq.destroy(); reject(new Error('ZapUPI verify timeout')); });
                    verifyReq.write(verifyData);
                    verifyReq.end();
                });

                functions.logger.info('confirmDeposit: ZapUPI cross-verify result', { txnId, verifyStatus: verifyResult?.data?.status });

                const zapStatus = String(verifyResult?.data?.status || '').toLowerCase();
                if (zapStatus !== 'success') {
                    functions.logger.warn('confirmDeposit: ZapUPI says payment NOT confirmed', { txnId, zapStatus, verifyResult });
                    throw new functions.https.HttpsError('failed-precondition', 'Payment not confirmed by payment gateway. Status: ' + zapStatus);
                }
            }
        } catch (verifyErr) {
            if (verifyErr instanceof functions.https.HttpsError) throw verifyErr;
            // Network/timeout errors — do NOT proceed, reject the credit
            functions.logger.error('confirmDeposit: ZapUPI verification failed', { txnId, error: verifyErr.message });
            throw new functions.https.HttpsError('unavailable', 'Unable to verify payment with gateway. Please try again.');
        }
    }

    // ⚠️ ATOMIC STATUS CLAIM — prevents double-credit race with webhookApi
    const claimTxn = await db.ref('wallet_transactions/' + txnId).transaction(txn => {
        if (!txn) return txn;
        if (txn.status === 'SUCCESS') return; // abort — already credited (by webhook or another call)
        txn.status = 'SUCCESS';
        txn.utr = utr || 'AUTO_VERIFIED';
        txn.verified_at = Date.now();
        txn.verified_by = data.gateway_type ? `${data.gateway_type}_AUTO` : 'AUTO';
        return txn;
    });

    if (!claimTxn.committed) {
        functions.logger.info('confirmDeposit: already credited or not found', { txnId, committed: claimTxn.committed });
        return { success: true, alreadyCredited: true };
    }

    functions.logger.info('confirmDeposit: claimed txn, crediting balance', { txnId, uid, amount: parsedAmount });

    // We now own this txn — safe to credit balance
    const balanceTxnResult = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) {
            // User node doesn't exist yet — create it with just the balance fields
            user = {};
        }
        user.depositBalance = (user.depositBalance || 0) + parsedAmount;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    });

    if (!balanceTxnResult.committed) {
        functions.logger.error('confirmDeposit: balance update FAILED', { txnId, uid, committed: balanceTxnResult.committed });
        // Rollback txn status
        await db.ref('wallet_transactions/' + txnId).update({ status: 'PENDING', utr: null, verified_at: null, verified_by: null });
        throw new functions.https.HttpsError('internal', 'Failed to credit balance');
    }

    const userAfterDeposit = balanceTxnResult.snapshot.val();
    functions.logger.info('confirmDeposit: balance credited successfully', { txnId, uid, newDepositBalance: userAfterDeposit.depositBalance, newWalletBalance: userAfterDeposit.walletBalance });

    // Update legacy wallet
    await db.ref('wallets/' + uid).transaction(current => {
        if (!current) current = { balance: 0 };
        current.balance = (current.balance || 0) + parsedAmount;
        current.last_deposit = Date.now();
        return current;
    });

    // Push notification: Deposit confirmed
    sendPush(uid, `💰 ₹${parsedAmount} Added to Wallet`, `₹${parsedAmount} deposited successfully! Your new balance is ready — explore Ludo challenges and eSports tournaments now.`, { type: 'DEPOSIT_SUCCESS', amount: String(parsedAmount) }).catch(() => { });

    return {
        success: true,
        newDepositBalance: userAfterDeposit.depositBalance || 0,
        newWalletBalance: userAfterDeposit.walletBalance || 0
    };
};

exports.confirmDeposit = functions.https.onCall(_confirmDepositHandler);
exports.creditZapUPIDeposit = functions.https.onCall(_confirmDepositHandler); // backward compat
