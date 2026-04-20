/**
 * payments.js — Payment-related Cloud Functions
 * Exports: createPaymentApi, zapupiAutoCheckApi, checkPaymentStatusApi,
 *          webhookApi, processWithdrawal, processDeposit, confirmDeposit, creditZapUPIDeposit
 */

const { functions, admin, db, assertAuth, sendPush, checkRateLimit, assertNotBanned, onCall, onRequest, HttpsError, logEvent } = require('./helpers');
const { syncTransaction, syncWithdrawal, syncUserProfile } = require('./supabase-sync');
const https = require('https');
const http = require('http');
const querystring = require('querystring');

// ─── Payment API (HTTP endpoint for hosting rewrite) ────────
// Proxies payment creation requests to ZapUPI or custom gateways
exports.createPaymentApi = onRequest({ cors: true }, async (req, res) => {
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
            gateway_endpoint, api_key, userId
        } = req.body;

        // ⚠️ SECURITY: Validate amount server-side (prevents client tampering)
        const parsedAmount = parseInt(amount);
        if (!parsedAmount || parsedAmount <= 0 || !Number.isInteger(parsedAmount)) {
            return res.status(400).json({ error: 'Invalid amount', status: false });
        }
        if (!order_id) {
            return res.status(400).json({ error: 'Missing order_id', status: false });
        }
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId', status: false });
        }

        // ⚠️ SECURITY: Enforce min/max deposit from admin config
        const [minConfigSnap, maxConfigSnap] = await Promise.all([
            db.ref('platform_config/payments/min_deposit').once('value'),
            db.ref('platform_config/payments/max_deposit').once('value')
        ]);
        const minDeposit = minConfigSnap.val() || 1;
        const maxDeposit = maxConfigSnap.val() || 9999;
        if (parsedAmount < minDeposit) {
            return res.status(400).json({ error: `Minimum deposit is ₹${minDeposit}`, status: false });
        }
        if (parsedAmount > maxDeposit) {
            functions.logger.warn(`[BLOCKED] Deposit amount ₹${parsedAmount} exceeds max ₹${maxDeposit} for user ${userId}`);
            return res.status(400).json({ error: `Maximum deposit is ₹${maxDeposit}`, status: false });
        }

        functions.logger.info('Payment request:', { gateway_type, amount: parsedAmount, order_id, userId });

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

            // ⚠️ SECURITY: Create wallet_transactions record SERVER-SIDE
            // This prevents clients from tampering with the amount in the DB
            await db.ref('wallet_transactions/' + String(order_id)).set({
                userId: userId,
                amount: parsedAmount,
                type: 'DEPOSIT',
                status: 'PENDING',
                reason: 'Deposit',
                gateway: 'zapupi',
                gateway_type: 'zapupi',
                created_at: admin.database.ServerValue.TIMESTAMP,
                timestamp: admin.database.ServerValue.TIMESTAMP
            });

            const postData = querystring.stringify({
                token_key: token_key,
                secret_key: secret_key,
                amount: String(parsedAmount),
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

        if (gateway_type === 'tranzupi') {
            // Read token server-side — NEVER trust client-provided secrets
            const configSnap = await db.ref('platform_config/payments').once('value');
            const config = configSnap.val() || {};
            const tranzupi_token = config.tranzupi_token;

            if (!tranzupi_token) {
                return res.status(400).json({ error: 'TranzUPI token not configured', status: false });
            }

            // TranzUPI requires numeric-only order_id and plain digits for mobile
            const sanitizedMobile = String(mobile || '9999999999').replace(/\D/g, '').slice(-10) || '9999999999';
            // Use our order_id directly — strip any non-numeric chars for TranzUPI compatibility
            const tranzupiOrderId = String(order_id).replace(/\D/g, '') || String(Date.now());

            // ⚠️ SECURITY: Create wallet_transactions record SERVER-SIDE
            await db.ref('wallet_transactions/' + String(order_id)).set({
                userId: userId,
                amount: parsedAmount,
                type: 'DEPOSIT',
                status: 'PENDING',
                reason: 'Deposit',
                gateway: 'tranzupi',
                gateway_type: 'tranzupi',
                tranzupi_order_id: tranzupiOrderId,
                created_at: admin.database.ServerValue.TIMESTAMP,
                timestamp: admin.database.ServerValue.TIMESTAMP
            });

            // ⚠️ TranzUPI requires form-urlencoded (NOT JSON despite their docs showing JSON)
            const postBody = querystring.stringify({
                customer_mobile: sanitizedMobile,
                user_token: tranzupi_token,
                amount: String(parsedAmount) + '.00',
                order_id: tranzupiOrderId,
                redirect_url: REDIRECT_URL,
                remark1: 'deposit',
                remark2: String(order_id)
            });

            functions.logger.info('TranzUPI create-order request:', { tranzupiOrderId, internalTxnId: order_id, amount: parsedAmount, mobile: sanitizedMobile });

            const options = {
                hostname: 'tranzupi.com',
                port: 443,
                path: '/api/create-order',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postBody)
                }
            };

            return new Promise((resolve) => {
                const apiReq = https.request(options, (apiRes) => {
                    let data = '';
                    apiRes.on('data', (chunk) => { data += chunk; });
                    apiRes.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            functions.logger.info('TranzUPI create-order response:', { order_id, response: JSON.stringify(json).substring(0, 500) });
                            // Include our internal txnId in response for frontend mapping
                            json._internalTxnId = order_id;
                            json._tranzupiOrderId = tranzupiOrderId;
                            res.status(200).json(json);
                        } catch (e) {
                            res.status(500).json({ error: 'Invalid response from TranzUPI', raw: data.substring(0, 500), status: false });
                        }
                        resolve();
                    });
                });
                apiReq.on('error', (e) => {
                    res.status(500).json({ error: 'TranzUPI connection failed: ' + e.message, status: false });
                    resolve();
                });
                apiReq.setTimeout(15000, () => { apiReq.destroy(); });
                apiReq.write(postBody);
                apiReq.end();
            });
        }

        if (gateway_type === 'custom') {
            if (!gateway_endpoint) {
                return res.status(400).json({ error: 'Gateway endpoint not configured', status: false });
            }

            // ⚠️ SECURITY: Create wallet_transactions record SERVER-SIDE
            await db.ref('wallet_transactions/' + String(order_id)).set({
                userId: userId,
                amount: parsedAmount,
                type: 'DEPOSIT',
                status: 'PENDING',
                reason: 'Deposit',
                gateway: 'custom',
                gateway_type: 'custom',
                created_at: admin.database.ServerValue.TIMESTAMP,
                timestamp: admin.database.ServerValue.TIMESTAMP
            });

            const url = new URL(gateway_endpoint);
            const isHttps = url.protocol === 'https:';

            const postData = querystring.stringify({
                token_key: api_key || '',
                api_key: api_key || '',
                secret_key: '',
                amount: String(parsedAmount),
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
exports.zapupiAutoCheckApi = onRequest({ cors: true }, async (req, res) => {
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

// ─── Check Payment Status API (ZapUPI / TranzUPI order-status) ────────
exports.checkPaymentStatusApi = onRequest({ cors: true }, async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { order_id, gateway_type } = req.body;
        if (!order_id) {
            return res.status(400).json({ error: 'Missing order_id', status: false });
        }

        // Read secrets server-side — NEVER trust client-provided secrets
        const configSnap = await db.ref('platform_config/payments').once('value');
        const config = configSnap.val() || {};

        // ─── TranzUPI Check Order Status ───
        if (gateway_type === 'tranzupi' || config.active_gateway === 'tranzupi') {
            const tranzupi_token = config.tranzupi_token;
            if (!tranzupi_token) {
                return res.status(400).json({ error: 'TranzUPI token not configured', status: false });
            }

            const postBody = querystring.stringify({
                user_token: tranzupi_token,
                order_id: String(order_id)
            });

            const options = {
                hostname: 'tranzupi.com', port: 443,
                path: '/api/check-order-status', method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postBody)
                }
            };

            return new Promise((resolve) => {
                const apiReq = https.request(options, (apiRes) => {
                    let data = '';
                    apiRes.on('data', (chunk) => { data += chunk; });
                    apiRes.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            functions.logger.info('TranzUPI check-order-status response:', { order_id, response: JSON.stringify(json).substring(0, 500) });
                            res.status(200).json(json);
                        } catch (e) {
                            res.status(500).json({ error: 'Invalid response from TranzUPI', status: false });
                        }
                        resolve();
                    });
                });
                apiReq.on('error', (e) => {
                    res.status(500).json({ error: 'TranzUPI connection failed: ' + e.message, status: false });
                    resolve();
                });
                apiReq.setTimeout(10000, () => { apiReq.destroy(); });
                apiReq.write(postBody);
                apiReq.end();
            });
        }

        // ─── ZapUPI Check Order Status (legacy) ───
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
exports.webhookApi = onRequest({ cors: true }, async (req, res) => {
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

    logEvent('webhookApi', 'info', 'Webhook received', { txnId, rawStatus });
    functions.logger.info('webhookApi called:', { txnId, rawStatus, body: JSON.stringify(data).substring(0, 500) });

    if (!txnId) {
        return res.status(400).json({ error: 'Missing required fields: order_id/transaction_id' });
    }

    try {
        let txnRef = db.ref(`wallet_transactions/${txnId}`);
        let txnSnapshot = await txnRef.once('value');
        let actualTxnId = txnId;

        // Fallback: TranzUPI sends their numeric orderId in webhook,
        // but we store transactions under our internal txnId.
        // Search by tranzupi_order_id field to find the correct record.
        if (!txnSnapshot.exists()) {
            functions.logger.info('webhookApi: direct lookup failed, searching by tranzupi_order_id', { txnId });
            const searchSnap = await db.ref('wallet_transactions')
                .orderByChild('tranzupi_order_id')
                .equalTo(txnId)
                .limitToFirst(1)
                .once('value');
            
            if (searchSnap.exists()) {
                const entries = searchSnap.val();
                const foundKey = Object.keys(entries)[0];
                actualTxnId = foundKey;
                txnRef = db.ref(`wallet_transactions/${foundKey}`);
                txnSnapshot = await db.ref(`wallet_transactions/${foundKey}`).once('value');
                functions.logger.info('webhookApi: found transaction via tranzupi_order_id lookup', { tranzupiOrderId: txnId, internalTxnId: foundKey });
            } else {
                functions.logger.warn('webhookApi: transaction not found by any lookup', { txnId });
                return res.status(404).json({ error: 'Transaction not found' });
            }
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
            // ── Don't blindly mark FAILED for known gateways ──
            // UPI payments can temporarily report "failure" during settlement.
            // Keep as PENDING to allow: delayed webhook retries, recovery polling, and admin review.
            // The recovery polling (confirmDeposit) will continue checking TranzUPI API
            // and only credits when the API actually confirms SUCCESS.
            const failGateway = txnData.gateway_type || txnData.gateway || '';

            if (failGateway === 'tranzupi' || failGateway === 'zapupi') {
                functions.logger.info('webhookApi: Non-success webhook for known gateway, keeping PENDING for verification', {
                    txnId: actualTxnId, webhookStatus: rawStatus, gateway: failGateway
                });
                await txnRef.update({
                    gateway_response: data,
                    webhook_status: rawStatus,
                    webhook_failure_at: Date.now(),
                    updated_at: Date.now()
                });
                return res.status(200).json({ success: false, message: 'Payment status uncertain, keeping pending for verification' });
            }

            // Unknown/other gateway — mark FAILED as before (no recovery mechanism for these)
            await txnRef.update({ status: 'FAILED', gateway_response: data, updated_at: Date.now() });
            return res.status(200).json({ success: false, message: 'Transaction marked failed' });
        }

        // ⚠️ SECURITY: Cross-verify with gateway order-status API before crediting
        // Since these gateways have no HMAC webhook signing, we independently confirm payment status
        const gatewayType = txnData.gateway_type || txnData.gateway || '';

        // ─── TranzUPI Cross-Verification ───
        if (gatewayType === 'tranzupi') {
            try {
                const configSnap = await db.ref('platform_config/payments').once('value');
                const config = configSnap.val() || {};
                if (config.tranzupi_token) {
                    // Use stored TranzUPI orderId (numeric), NOT our internal txnId
                    const tranzupiOrderId = txnData.tranzupi_order_id || String(txnId).replace(/\D/g, '') || txnId;
                    const verifyBody = querystring.stringify({
                        user_token: config.tranzupi_token,
                        order_id: tranzupiOrderId
                    });
                    const verifyResult = await new Promise((resolve, reject) => {
                        const verifyReq = https.request({
                            hostname: 'tranzupi.com', port: 443,
                            path: '/api/check-order-status', method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Content-Length': Buffer.byteLength(verifyBody)
                            }
                        }, (apiRes) => {
                            let body = '';
                            apiRes.on('data', chunk => body += chunk);
                            apiRes.on('end', () => {
                                try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid TranzUPI response')); }
                            });
                        });
                        verifyReq.on('error', reject);
                        verifyReq.setTimeout(10000, () => { verifyReq.destroy(); reject(new Error('TranzUPI verify timeout')); });
                        verifyReq.write(verifyBody);
                        verifyReq.end();
                    });

                    functions.logger.info('webhookApi: TranzUPI cross-verify result', { txnId, verifyResult: JSON.stringify(verifyResult).substring(0, 300) });

                    const tranzStatus = String(verifyResult?.status || '').toUpperCase();
                    const tranzTxnStatus = String(verifyResult?.result?.status || verifyResult?.result?.txnStatus || '').toUpperCase();
                    // TranzUPI returns outer status 'COMPLETED' (not 'SUCCESS') when txn is done
                    const outerOk = (tranzStatus === 'SUCCESS' || tranzStatus === 'COMPLETED');
                    const innerOk = (tranzTxnStatus === 'SUCCESS' || tranzTxnStatus === 'COMPLETED');
                    if (!outerOk || !innerOk) {
                        functions.logger.warn('webhookApi: TranzUPI cross-verify FAILED — payment not confirmed', { txnId, tranzStatus, tranzTxnStatus, verifyResult });
                        await txnRef.update({ status: 'PENDING', gateway_response: data, webhook_verify_failed: true, updated_at: Date.now() });
                        return res.status(200).json({ success: false, message: 'Payment not confirmed by TranzUPI' });
                    }
                }
            } catch (verifyErr) {
                functions.logger.warn('webhookApi: TranzUPI cross-verify error (proceeding with caution)', { txnId, error: verifyErr.message });
            }
        }

        // ─── ZapUPI Cross-Verification (legacy) ───
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

        // ─── VIP Deposit Bonus ───
        let vipBonus = 0;
        try {
            const [vipConfigSnap, vipUserSnap] = await Promise.all([
                db.ref('platform_config/vip').once('value'),
                db.ref(`users/${userId}/vip`).once('value')
            ]);
            const vipConfig = vipConfigSnap.val() || {};
            const vipUser = vipUserSnap.val();
            if (vipConfig.enabled !== false && vipUser && vipUser.active && vipUser.expiresAt > Date.now()) {
                const bonusPct = vipConfig.bonusPercent || 5;
                vipBonus = Math.max(1, Math.round(parsedAmount * bonusPct / 100));
            }
        } catch (e) {
            functions.logger.warn('webhookApi: VIP check failed (non-critical)', e.message);
        }

        // ─── Global Deposit Bonus (for ALL users) ───
        let globalDepositBonus = 0;
        try {
            const depBonusSnap = await db.ref('platform_config/deposit_bonus').once('value');
            const depBonusConfig = depBonusSnap.val() || {};
            if (depBonusConfig.enabled === true && depBonusConfig.percentage > 0) {
                globalDepositBonus = Math.floor(parsedAmount * depBonusConfig.percentage / 100);
                // Apply max cap if configured (0 = no cap)
                if (depBonusConfig.maxBonus > 0 && globalDepositBonus > depBonusConfig.maxBonus) {
                    globalDepositBonus = depBonusConfig.maxBonus;
                }
            }
        } catch (e) {
            functions.logger.warn('webhookApi: Global deposit bonus check failed (non-critical)', e.message);
        }

        // We now own this txn — safe to credit balance
        const totalCredit = parsedAmount + vipBonus + globalDepositBonus;
        const balanceTxn = await db.ref(`users/${userId}`).transaction(user => {
            if (!user) user = {};
            user.depositBalance = (user.depositBalance || 0) + totalCredit;
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
        functions.logger.info('webhookApi: balance credited', { txnId, userId, newDeposit: userAfter.depositBalance, newWallet: userAfter.walletBalance, vipBonus, globalDepositBonus });

        // Log VIP bonus as separate wallet transaction
        if (vipBonus > 0) {
            const bonusTxnKey = db.ref('wallet_transactions').push().key;
            await db.ref(`wallet_transactions/${bonusTxnKey}`).set({
                userId,
                amount: vipBonus,
                type: 'CREDIT',
                isCredit: true,
                reason: `VIP deposit bonus (${parsedAmount} × ${vipBonus > 0 ? Math.round(vipBonus / parsedAmount * 100) : 0}%)`,
                description: `VIP bonus on 🪙 ${parsedAmount} deposit`,
                vipBonus: vipBonus,
                linkedTxnId: txnId,
                walletType: 'DEPOSIT',
                status: 'SUCCESS',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });
        }

        // Log global deposit bonus as separate wallet transaction
        if (globalDepositBonus > 0) {
            const depBonusTxnKey = db.ref('wallet_transactions').push().key;
            await db.ref(`wallet_transactions/${depBonusTxnKey}`).set({
                userId,
                amount: globalDepositBonus,
                type: 'CREDIT',
                isCredit: true,
                reason: `Deposit bonus (${parsedAmount} × ${Math.round(globalDepositBonus / parsedAmount * 100)}%)`,
                description: `🎁 Deposit bonus on 🪙 ${parsedAmount} deposit`,
                depositBonus: globalDepositBonus,
                linkedTxnId: txnId,
                walletType: 'DEPOSIT',
                status: 'SUCCESS',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });
        }

        // Update legacy wallet path
        await db.ref('wallets/' + userId).transaction(current => {
            if (!current) current = { balance: 0 };
            current.balance = (current.balance || 0) + totalCredit;
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
exports.processWithdrawal = onCall(async (request) => {
    const uid = assertAuth(request);
    const { amount, upiId } = request.data;

    // ── Rate limit: max 3 withdrawal attempts per hour ──
    await checkRateLimit(uid, 'withdrawal', 3, 60 * 60 * 1000);

    // ── Server-side ban enforcement ──
    const bannedCheckUser = await assertNotBanned(uid);

    if (!amount || amount <= 0) throw new HttpsError('invalid-argument', 'Invalid amount');
    if (!upiId || !upiId.includes('@')) throw new HttpsError('invalid-argument', 'Invalid UPI ID');
    logEvent('processWithdrawal', 'info', 'Withdrawal requested', { uid, amount, upiId });

    // ── Fetch all withdrawal configs in parallel (user data already from assertNotBanned) ──
    const [minSnap, maxSnap, dailyLimitSnap, dailyAmountSnap, minAgeSnap, feePercentSnap, minFeeSnap, maxFeeSnap] = await Promise.all([
        db.ref('platform_config/payments/min_withdrawal').once('value'),
        db.ref('platform_config/payments/max_withdrawal').once('value'),
        db.ref('platform_config/payments/daily_withdrawal_limit').once('value'),
        db.ref('platform_config/payments/daily_withdrawal_amount').once('value'),
        db.ref('platform_config/payments/min_account_age_hours').once('value'),
        db.ref('platform_config/payments/withdrawal_fee_percent').once('value'),
        db.ref('platform_config/payments/withdrawal_fee_min').once('value'),
        db.ref('platform_config/payments/withdrawal_fee_max').once('value')
    ]);

    const minWithdrawal = parseInt(minSnap.val()) || 10;
    const maxWithdrawal = parseInt(maxSnap.val()) || 25000;
    const dailyLimit = parseInt(dailyLimitSnap.val()) || 3;
    const dailyAmountCap = parseInt(dailyAmountSnap.val()) || 50000;
    const minAccountAgeHours = parseInt(minAgeSnap.val()) || 24;
    const withdrawalFeePercent = parseFloat(feePercentSnap.val()) || 0;
    const withdrawalFeeMin = parseFloat(minFeeSnap.val()) || 0;
    const withdrawalFeeMax = parseFloat(maxFeeSnap.val()) || 0;
    const userData = bannedCheckUser;


    // ── Check 1: Min amount ──
    if (amount < minWithdrawal) {
        throw new HttpsError('invalid-argument', `Minimum withdrawal is 🪙 ${minWithdrawal}`);
    }

    // ── Check 2: Max single withdrawal ──
    if (amount > maxWithdrawal) {
        throw new HttpsError('invalid-argument', `Maximum single withdrawal is 🪙 ${maxWithdrawal}`);
    }

    // ── Check 3: Account age requirement ──
    const accountCreatedAt = userData.createdAt || 0;
    const accountAgeMs = Date.now() - accountCreatedAt;
    const minAgeMs = minAccountAgeHours * 60 * 60 * 1000;
    if (accountCreatedAt > 0 && accountAgeMs < minAgeMs) {
        const hoursLeft = Math.ceil((minAgeMs - accountAgeMs) / (60 * 60 * 1000));
        throw new HttpsError('failed-precondition',
            `Account must be at least ${minAccountAgeHours} hours old to withdraw. Try again in ${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}.`);
    }

    // ── Check 4: Daily withdrawal count + total ──
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const todayWithdrawals = await db.ref('withdrawals')
        .orderByChild('userId')
        .equalTo(uid)
        .once('value');

    let dailyCount = 0;
    let dailyTotal = 0;
    if (todayWithdrawals.exists()) {
        todayWithdrawals.forEach(child => {
            const w = child.val();
            // Count only today's non-rejected withdrawals
            if (w.createdAt >= todayMs && w.status !== 'REJECTED') {
                dailyCount++;
                dailyTotal += (w.amount || 0);
            }
        });
    }

    if (dailyCount >= dailyLimit) {
        throw new HttpsError('resource-exhausted',
            `Daily withdrawal limit reached (${dailyLimit} per day). Try again tomorrow.`);
    }

    if (dailyTotal + amount > dailyAmountCap) {
        const remaining = dailyAmountCap - dailyTotal;
        throw new HttpsError('resource-exhausted',
            `Daily withdrawal amount limit is 🪙 ${dailyAmountCap}. You've already withdrawn 🪙 ${dailyTotal} today.${remaining > 0 ? ` You can withdraw up to 🪙 ${remaining} more.` : ''}`);
    }

    // ── Calculate withdrawal processing fee ──
    let feeAmount = 0;
    if (withdrawalFeePercent > 0) {
        feeAmount = Math.round(amount * (withdrawalFeePercent / 100) * 100) / 100;
        // Apply min/max fee bounds if configured
        if (withdrawalFeeMin > 0 && feeAmount < withdrawalFeeMin) feeAmount = withdrawalFeeMin;
        if (withdrawalFeeMax > 0 && feeAmount > withdrawalFeeMax) feeAmount = withdrawalFeeMax;
        // Fee cannot exceed withdrawal amount
        if (feeAmount >= amount) feeAmount = Math.floor(amount * 0.5);
    }
    const payoutAmount = Math.round((amount - feeAmount) * 100) / 100;

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

        functions.logger.info(`processWithdrawal: uid=${uid}, amount=${amount}, fee=${feeAmount}, payout=${payoutAmount}, winBal=${winBal}`);

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
        throw new HttpsError('failed-precondition',
            `Insufficient winning balance. You have 🪙 ${actualBal}, requested 🪙 ${amount}`);
    }

    const userAfter = txn.snapshot.val();
    const balAfter = userAfter.winningBalance || 0;
    const userName = userAfter.fullName || userAfter.username || 'User';

    // ── Fraud Detection Flags ──
    const fraudFlags = new Set();

    // Flag 1: Rapid cashout — any deposit within 1 hour
    const recentDeposits = await db.ref('deposits')
        .orderByChild('userId')
        .equalTo(uid)
        .once('value');
    if (recentDeposits.exists()) {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        recentDeposits.forEach(child => {
            const dep = child.val();
            if (dep.status === 'SUCCESS' && dep.createdAt && dep.createdAt > oneHourAgo) {
                fraudFlags.add('RAPID_CASHOUT');
            }
        });
    }

    // Flag 2: New account (under 48 hours old)
    if (accountCreatedAt > 0 && (Date.now() - accountCreatedAt) < 48 * 60 * 60 * 1000) {
        fraudFlags.add('NEW_ACCOUNT');
    }

    // Flag 3: High velocity — 3+ withdrawals today to different UPIs
    if (dailyCount >= 2) {
        const upiSet = new Set();
        if (todayWithdrawals.exists()) {
            todayWithdrawals.forEach(child => {
                const w = child.val();
                if (w.createdAt >= todayMs && w.status !== 'REJECTED' && w.upiId) {
                    upiSet.add(w.upiId);
                }
            });
        }
        upiSet.add(upiId); // Add current withdrawal UPI
        if (upiSet.size >= 3) {
            fraudFlags.add('MULTI_UPI');
        }
    }

    // Flag 4: Large amount (over 50% of max withdrawal)
    if (amount > maxWithdrawal * 0.5) {
        fraudFlags.add('LARGE_AMOUNT');
    }

    // Determine status: FLAGGED if any fraud flags, otherwise PENDING
    const flagsArray = [...fraudFlags]; // Convert Set to Array for DB and logging
    const withdrawalStatus = flagsArray.length > 0 ? 'FLAGGED' : 'PENDING';

    if (flagsArray.length > 0) {
        functions.logger.warn(`[FRAUD] Withdrawal flagged for ${uid}: ${flagsArray.join(', ')} — amount: ₹${amount}, upi: ${upiId}`);
    }

    // Create withdrawal record
    const withdrawKey = db.ref('withdrawals').push().key;
    const withdrawalRecord = {
        userId: uid,
        userName: userName,
        amount: amount,
        feePercent: withdrawalFeePercent,
        feeAmount: feeAmount,
        payoutAmount: payoutAmount,
        upiId: upiId,
        winningBalanceBefore: balAfter + amount,
        winningBalanceAfter: balAfter,
        status: withdrawalStatus,
        createdAt: admin.database.ServerValue.TIMESTAMP
    };

    if (flagsArray.length > 0) {
        withdrawalRecord.fraudFlags = flagsArray;
        withdrawalRecord.flaggedAt = admin.database.ServerValue.TIMESTAMP;
    }

    await db.ref('withdrawals/' + withdrawKey).set(withdrawalRecord);

    // Track platform fee revenue
    if (feeAmount > 0) {
        await db.ref('stats/withdrawalFeeRevenue').set(
            admin.database.ServerValue.increment(feeAmount)
        );
    }

    // Log wallet transaction
    const feeLabel = feeAmount > 0 ? ` (Fee: 🪙 ${feeAmount}, Payout: 🪙 ${payoutAmount})` : '';
    const txnKey = db.ref('wallet_transactions').push().key;
    await db.ref('wallet_transactions/' + txnKey).set({
        userId: uid,
        userName: userName,
        type: 'WITHDRAW',
        amount: amount,
        feeAmount: feeAmount,
        payoutAmount: payoutAmount,
        isCredit: false,
        description: `Withdrawal to ${upiId}${feeLabel}`,
        reason: 'Withdrawal Request',
        walletType: 'winning',
        withdrawalId: withdrawKey,
        upiId: upiId,
        status: 'PENDING',
        timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Save UPI ID to user profile for auto-fill on next withdrawal
    await db.ref(`users/${uid}/upiId`).set(upiId);

    // ── Sync to Supabase (dual-write) ──
    syncWithdrawal(withdrawKey, {
        userId: uid, amount, payoutAmount, feeAmount,
        status: flagsArray.length > 0 ? 'flagged' : 'pending',
        upiId, timestamp: Date.now()
    });
    syncTransaction(txnKey, {
        userId: uid, type: 'WITHDRAW', amount,
        reason: `Withdrawal to ${upiId}${feeLabel}`,
        status: 'PENDING', timestamp: Date.now()
    });
    syncUserProfile(uid, { winningBalance: balAfter });

    return {
        success: true,
        withdrawalId: withdrawKey,
        balanceAfter: balAfter,
        feeAmount: feeAmount,
        feePercent: withdrawalFeePercent,
        payoutAmount: payoutAmount
    };
});

// ─── Process Deposit (simulated) ────────────────────────────
exports.processDeposit = onCall(async (request) => {
    const uid = assertAuth(request);
    const { amount, depositId } = request.data;

    if (!amount || amount < 1) throw new HttpsError('invalid-argument', 'Invalid amount');

    // Credit deposit balance + sync walletBalance atomically
    const txn = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) user = {};
        user.depositBalance = (user.depositBalance || 0) + amount;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    });

    if (!txn.committed) {
        throw new HttpsError('internal', 'Failed to credit balance');
    }
    const userAfter = txn.snapshot.val();
    const newBal = userAfter.depositBalance || 0;

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
const _confirmDepositHandler = async (request) => {
    const uid = assertAuth(request);
    const { txnId, utr } = request.data;

    // ── Rate limit: max 5 deposit confirmations per 10 minutes ──
    await checkRateLimit(uid, 'confirm_deposit', 5, 10 * 60 * 1000);

    // ── Server-side ban enforcement ──
    await assertNotBanned(uid);

    functions.logger.info('confirmDeposit called:', { uid, txnId, utr, gateway_type: request.data.gateway_type });

    if (!txnId) {
        throw new HttpsError('invalid-argument', 'txnId is required');
    }

    // Verify ownership and get stored transaction data
    const existingTxn = await db.ref('wallet_transactions/' + txnId).once('value');
    if (!existingTxn.exists()) {
        throw new HttpsError('not-found', 'Transaction not found');
    }
    const existingTxnData = existingTxn.val();
    if (existingTxnData.userId !== uid) {
        functions.logger.warn('confirmDeposit: ownership mismatch', { txnId, txnUserId: existingTxnData.userId, callerUid: uid });
        throw new HttpsError('permission-denied', 'Transaction does not belong to you');
    }

    // ⚠️ SECURITY: Always use the amount from our stored transaction, NEVER from the client
    const parsedAmount = parseInt(existingTxnData.amount);
    if (!parsedAmount || parsedAmount <= 0) {
        throw new HttpsError('invalid-argument', 'Invalid transaction amount');
    }

    // ⚠️ SECURITY: Cross-verify with gateway before crediting (prevents fake success claims)
    const gatewayType = existingTxnData.gateway_type || existingTxnData.gateway || '';

    // ─── TranzUPI Cross-Verification ───
    if (gatewayType === 'tranzupi') {
        try {
            const configSnap = await db.ref('platform_config/payments').once('value');
            const config = configSnap.val() || {};
            if (config.tranzupi_token) {
                // Use stored TranzUPI orderId (numeric), NOT our internal txnId
                const tranzupiOrderId = existingTxnData.tranzupi_order_id || String(txnId).replace(/\D/g, '') || txnId;
                const verifyBody = querystring.stringify({
                    user_token: config.tranzupi_token,
                    order_id: tranzupiOrderId
                });
                const verifyResult = await new Promise((resolve, reject) => {
                    const verifyReq = https.request({
                        hostname: 'tranzupi.com', port: 443,
                        path: '/api/check-order-status', method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': Buffer.byteLength(verifyBody)
                        }
                    }, (apiRes) => {
                        let body = '';
                        apiRes.on('data', chunk => body += chunk);
                        apiRes.on('end', () => {
                            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid TranzUPI response')); }
                        });
                    });
                    verifyReq.on('error', reject);
                    verifyReq.setTimeout(10000, () => { verifyReq.destroy(); reject(new Error('TranzUPI verify timeout')); });
                    verifyReq.write(verifyBody);
                    verifyReq.end();
                });

                functions.logger.info('confirmDeposit: TranzUPI cross-verify result', { txnId, verifyResult: JSON.stringify(verifyResult).substring(0, 300) });

                const tranzStatus = String(verifyResult?.status || '').toUpperCase();
                const tranzTxnStatus = String(verifyResult?.result?.status || verifyResult?.result?.txnStatus || '').toUpperCase();
                // TranzUPI returns outer status 'COMPLETED' (not 'SUCCESS') when txn is done
                const outerOk = (tranzStatus === 'SUCCESS' || tranzStatus === 'COMPLETED');
                const innerOk = (tranzTxnStatus === 'SUCCESS' || tranzTxnStatus === 'COMPLETED');
                if (!outerOk || !innerOk) {
                    functions.logger.warn('confirmDeposit: TranzUPI says payment NOT confirmed', { txnId, tranzStatus, tranzTxnStatus, verifyResult });
                    throw new HttpsError('failed-precondition', 'Payment not confirmed by TranzUPI. Status: ' + (tranzTxnStatus || tranzStatus));
                }
            }
        } catch (verifyErr) {
            if (verifyErr instanceof HttpsError) throw verifyErr;
            functions.logger.error('confirmDeposit: TranzUPI verification failed', { txnId, error: verifyErr.message });
            throw new HttpsError('unavailable', 'Unable to verify payment with TranzUPI. Please try again.');
        }
    }

    // ─── ZapUPI Cross-Verification (legacy) ───
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
                    throw new HttpsError('failed-precondition', 'Payment not confirmed by payment gateway. Status: ' + zapStatus);
                }
            }
        } catch (verifyErr) {
            if (verifyErr instanceof HttpsError) throw verifyErr;
            // Network/timeout errors — do NOT proceed, reject the credit
            functions.logger.error('confirmDeposit: ZapUPI verification failed', { txnId, error: verifyErr.message });
            throw new HttpsError('unavailable', 'Unable to verify payment with gateway. Please try again.');
        }
    }

    // ⚠️ ATOMIC STATUS CLAIM — prevents double-credit race with webhookApi
    const claimTxn = await db.ref('wallet_transactions/' + txnId).transaction(txn => {
        if (!txn) return txn;
        if (txn.status === 'SUCCESS') return; // abort — already credited (by webhook or another call)
        txn.status = 'SUCCESS';
        txn.utr = utr || 'AUTO_VERIFIED';
        txn.verified_at = Date.now();
        txn.verified_by = (request.data.gateway_type || existingTxnData.gateway_type) ? `${request.data.gateway_type || existingTxnData.gateway_type}_AUTO` : 'AUTO';
        return txn;
    });

    if (!claimTxn.committed) {
        functions.logger.info('confirmDeposit: already credited or not found', { txnId, committed: claimTxn.committed });
        return { success: true, alreadyCredited: true };
    }

    functions.logger.info('confirmDeposit: claimed txn, crediting balance', { txnId, uid, amount: parsedAmount });

    // ─── VIP Deposit Bonus ───
    let vipBonus = 0;
    try {
        const [vipConfigSnap, vipUserSnap] = await Promise.all([
            db.ref('platform_config/vip').once('value'),
            db.ref(`users/${uid}/vip`).once('value')
        ]);
        const vipConfig = vipConfigSnap.val() || {};
        const vipUser = vipUserSnap.val();
        if (vipConfig.enabled !== false && vipUser && vipUser.active && vipUser.expiresAt > Date.now()) {
            const bonusPct = vipConfig.bonusPercent || 5;
            vipBonus = Math.max(1, Math.round(parsedAmount * bonusPct / 100));
        }
    } catch (e) {
        functions.logger.warn('confirmDeposit: VIP check failed (non-critical)', e.message);
    }

    // ─── Global Deposit Bonus (for ALL users) ───
    let globalDepositBonus = 0;
    try {
        const depBonusSnap = await db.ref('platform_config/deposit_bonus').once('value');
        const depBonusConfig = depBonusSnap.val() || {};
        if (depBonusConfig.enabled === true && depBonusConfig.percentage > 0) {
            globalDepositBonus = Math.floor(parsedAmount * depBonusConfig.percentage / 100);
            // Apply max cap if configured (0 = no cap)
            if (depBonusConfig.maxBonus > 0 && globalDepositBonus > depBonusConfig.maxBonus) {
                globalDepositBonus = depBonusConfig.maxBonus;
            }
        }
    } catch (e) {
        functions.logger.warn('confirmDeposit: Global deposit bonus check failed (non-critical)', e.message);
    }

    // We now own this txn — safe to credit balance
    const totalCredit = parsedAmount + vipBonus + globalDepositBonus;
    const balanceTxnResult = await db.ref(`users/${uid}`).transaction(user => {
        if (!user) {
            user = {};
        }
        user.depositBalance = (user.depositBalance || 0) + totalCredit;
        user.walletBalance = (user.depositBalance || 0) + (user.winningBalance || 0);
        return user;
    });

    if (!balanceTxnResult.committed) {
        functions.logger.error('confirmDeposit: balance update FAILED', { txnId, uid, committed: balanceTxnResult.committed });
        // Rollback txn status
        await db.ref('wallet_transactions/' + txnId).update({ status: 'PENDING', utr: null, verified_at: null, verified_by: null });
        throw new HttpsError('internal', 'Failed to credit balance');
    }

    const userAfterDeposit = balanceTxnResult.snapshot.val();
    functions.logger.info('confirmDeposit: balance credited successfully', { txnId, uid, newDepositBalance: userAfterDeposit.depositBalance, newWalletBalance: userAfterDeposit.walletBalance, vipBonus, globalDepositBonus });

    // Log VIP bonus as separate wallet transaction
    if (vipBonus > 0) {
        const bonusTxnKey = db.ref('wallet_transactions').push().key;
        await db.ref(`wallet_transactions/${bonusTxnKey}`).set({
            userId: uid,
            amount: vipBonus,
            type: 'CREDIT',
            isCredit: true,
            reason: `VIP deposit bonus (${parsedAmount} × ${vipBonus > 0 ? Math.round(vipBonus / parsedAmount * 100) : 0}%)`,
            description: `VIP bonus on 🪙 ${parsedAmount} deposit`,
            vipBonus: vipBonus,
            linkedTxnId: txnId,
            walletType: 'DEPOSIT',
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });
    }

    // Log global deposit bonus as separate wallet transaction
    if (globalDepositBonus > 0) {
        const depBonusTxnKey = db.ref('wallet_transactions').push().key;
        await db.ref(`wallet_transactions/${depBonusTxnKey}`).set({
            userId: uid,
            amount: globalDepositBonus,
            type: 'CREDIT',
            isCredit: true,
            reason: `Deposit bonus (${parsedAmount} × ${Math.round(globalDepositBonus / parsedAmount * 100)}%)`,
            description: `🎁 Deposit bonus on 🪙 ${parsedAmount} deposit`,
            depositBonus: globalDepositBonus,
            linkedTxnId: txnId,
            walletType: 'DEPOSIT',
            status: 'SUCCESS',
            timestamp: admin.database.ServerValue.TIMESTAMP
        });
    }

    // Update legacy wallet
    await db.ref('wallets/' + uid).transaction(current => {
        if (!current) current = { balance: 0 };
        current.balance = (current.balance || 0) + totalCredit;
        current.last_deposit = Date.now();
        return current;
    });

    // Push notification: Deposit confirmed
    const bonusParts = [];
    if (vipBonus > 0) bonusParts.push(`🪙 ${vipBonus} VIP bonus`);
    if (globalDepositBonus > 0) bonusParts.push(`🪙 ${globalDepositBonus} deposit bonus`);
    const bonusText = bonusParts.length > 0 ? ` (+ ${bonusParts.join(' + ')}!)` : '';
    sendPush(uid, `💰 🪙 ${parsedAmount} Added to Wallet`, `🪙 ${parsedAmount} deposited successfully${bonusText}! Your new balance is ready — explore Ludo challenges and eSports tournaments now.`, { type: 'DEPOSIT_SUCCESS', amount: String(parsedAmount) }).catch(() => { });

    return {
        success: true,
        newDepositBalance: userAfterDeposit.depositBalance || 0,
        newWalletBalance: userAfterDeposit.walletBalance || 0
    };
};

exports.confirmDeposit = onCall(_confirmDepositHandler);
exports.creditZapUPIDeposit = onCall(_confirmDepositHandler); // backward compat
