#!/usr/bin/env node
// One-time script: Subscribe existing users' FCM tokens to their personal topics
// Run: node functions/subscribe-existing-users.js

const admin = require('firebase-admin');

// Initialize with default credentials
const serviceAccount = require('./service-account-key.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://jeetoplay-325f1-default-rtdb.asia-southeast1.firebasedatabase.app'
});

async function subscribeExistingUsers() {
    const db = admin.database();

    console.log('Fetching all users...');
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val();

    if (!users) {
        console.log('No users found');
        process.exit(0);
    }

    let total = 0, subscribed = 0, noToken = 0, failed = 0;

    for (const [uid, userData] of Object.entries(users)) {
        total++;
        const token = userData.fcmToken;

        if (!token || typeof token !== 'string') {
            noToken++;
            console.log(`  [SKIP] ${uid} — no FCM token`);
            continue;
        }

        const personalTopic = `user_${uid}`;

        try {
            // Subscribe to personal topic
            const result = await admin.messaging().subscribeToTopic(token, personalTopic);

            if (result.failureCount > 0) {
                console.log(`  [FAIL] ${uid} — subscription failed:`, JSON.stringify(result.errors));
                failed++;
            } else {
                console.log(`  [OK]   ${uid} → ${personalTopic}`);
                subscribed++;
            }

            // Also ensure all_users subscription
            await admin.messaging().subscribeToTopic(token, 'all_users');

        } catch (err) {
            console.log(`  [ERR]  ${uid} — ${err.message}`);
            failed++;

            // Remove invalid tokens
            if (err.code === 'messaging/registration-token-not-registered' ||
                err.code === 'messaging/invalid-registration-token') {
                await db.ref(`users/${uid}/fcmToken`).remove();
                console.log(`         Removed stale token for ${uid}`);
            }
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Total users:       ${total}`);
    console.log(`Subscribed:        ${subscribed}`);
    console.log(`No token (skipped): ${noToken}`);
    console.log(`Failed:            ${failed}`);

    process.exit(0);
}

subscribeExistingUsers().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
