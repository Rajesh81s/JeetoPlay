/**
 * otp.js — OTP Authentication via MSG91 Widget SDK
 *
 * MSG91 Widget handles OTP sending & verification on client side.
 * This Cloud Function only verifies the MSG91 access token server-side
 * and issues a Firebase Custom Auth token.
 *
 * Flow:
 *   1. Client → MSG91 Widget sends/verifies OTP
 *   2. Client gets MSG91 access-token
 *   3. Client calls verifyOTP(phone, accessToken) Cloud Function
 *   4. Cloud Function verifies token with MSG91 API
 *   5. Cloud Function finds/creates Firebase Auth user
 *   6. Cloud Function returns Firebase Custom Auth token
 *   7. Client signs in with signInWithCustomToken(token)
 */

const { admin, db, functions, onCall, HttpsError } = require('./helpers');

// ═══════════════════════════════════════════════════════════════
// VERIFY OTP (via MSG91 Access Token)
// ═══════════════════════════════════════════════════════════════

const verifyOTPFn = onCall(async (request) => {
    const phone = (request.data.phone || '').toString().replace(/\D/g, '');
    const accessToken = (request.data.accessToken || '').toString().trim();

    // Validate inputs
    if (!/^[6-9]\d{9}$/.test(phone)) {
        throw new HttpsError('invalid-argument', 'Invalid phone number.');
    }
    if (!accessToken) {
        throw new HttpsError('invalid-argument', 'Access token is required.');
    }

    // Get MSG91 auth key from database
    const apiKeySnap = await db.ref('platform_config/sms_api_key').once('value');
    const authKey = apiKeySnap.val();

    if (!authKey) {
        functions.logger.error('[OTP] No MSG91 auth key configured');
        throw new HttpsError('failed-precondition', 'OTP service not configured. Contact support.');
    }

    // Verify the MSG91 access token server-side
    try {
        const verifyResponse = await fetch('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                authkey: authKey,
                'access-token': accessToken
            })
        });

        const verifyResult = await verifyResponse.json();
        functions.logger.info(`[OTP] MSG91 verify response: ${JSON.stringify(verifyResult)}`);

        if (verifyResult.type === 'error' || verifyResult.message === 'Token expired' || !verifyResult.type || verifyResult.type !== 'success') {
            functions.logger.error(`[OTP] MSG91 token verification failed: ${verifyResult.message || 'Unknown error'}`);
            throw new HttpsError('permission-denied', 'OTP verification failed. Please try again.');
        }
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        functions.logger.error('[OTP] MSG91 verify error:', err.message);
        throw new HttpsError('internal', 'Verification failed. Please try again.');
    }

    // ✅ Token verified by MSG91! Now find or create Firebase Auth user
    let firebaseUser;
    const fullPhone = '+91' + phone;

    try {
        firebaseUser = await admin.auth().getUserByPhoneNumber(fullPhone);
        functions.logger.info(`[OTP] Existing user found: ${firebaseUser.uid} for ${phone}`);
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            firebaseUser = await admin.auth().createUser({
                phoneNumber: fullPhone,
                disabled: false
            });
            functions.logger.info(`[OTP] New user created: ${firebaseUser.uid} for ${phone}`);
        } else {
            functions.logger.error('[OTP] Error finding/creating user:', err.message);
            throw new HttpsError('internal', 'Authentication failed. Please try again.');
        }
    }

    // Generate Firebase Custom Auth token
    const customToken = await admin.auth().createCustomToken(firebaseUser.uid);
    functions.logger.info(`[OTP] Firebase custom token generated for ${firebaseUser.uid}`);

    return {
        success: true,
        token: customToken
    };
});

// ─── Exports ────────────────────────────────────────────────

module.exports = {
    verifyOTP: verifyOTPFn
};
