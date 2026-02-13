// JeetoPlay — Firebase Init & State
// Auto-extracted from app.html

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDnfA0q0BpkppZDGXHuRBSx8UNEJxddu6s",
    authDomain: "jeetoplay-325f1.firebaseapp.com",
    databaseURL: "https://jeetoplay-325f1-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "jeetoplay-325f1",
    storageBucket: "jeetoplay-325f1.firebasestorage.app",
    messagingSenderId: "450077839860",
    appId: "1:450077839860:web:57b342941db036bf7da9a1",
    measurementId: "G-B2XCRLH6DR"
};

let app, db, auth, functions, messaging;
try {
    app = firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    auth = firebase.auth();
    functions = firebase.functions();

    // Initialize FCM if supported
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        messaging = firebase.messaging();
        console.log('✅ Firebase Messaging initialized');
    }
} catch (e) {
    console.error("Firebase Init Error:", e);
}

// ==========================================
//  PUSH NOTIFICATION SETUP
// ==========================================

// VAPID Key - From Firebase Console
const VAPID_KEY = 'BGTi7lmUa6fSF8v74E-rIdsUP0UyPw0RytsfxpVqXx1NZK8l74774tPO-zuiTuugpqFykUMaDg5Vz17YaBPHEHQ';

async function requestNotificationPermission() {
    if (!messaging) return;

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted');
            await getAndSaveToken();
        } else {
            console.log('Notification permission denied');
        }
    } catch (e) {
        console.error('Notification permission error:', e);
    }
}

async function getAndSaveToken() {
    if (!messaging || !state.user) return;

    // If running inside native Android app, skip web token —
    // the native app handles FCM token via Java bridge (setUserUid)
    // Saving a web token here would OVERWRITE the native token
    if (typeof AndroidNative !== 'undefined' && AndroidNative.isNativeApp && AndroidNative.isNativeApp()) {
        console.log('[FCM] Running in native app — skipping web token (native handles FCM)');
        return;
    }

    try {
        const token = await messaging.getToken({ vapidKey: VAPID_KEY });
        if (token) {
            console.log('FCM Token:', token.substring(0, 20) + '...');

            // Save token to user's database record
            await db.ref('users/' + state.user.uid + '/fcmToken').set(token);
            console.log('FCM Token saved to database');

            // Subscribe to topics via Cloud Function
            try {
                const subscribeFn = firebase.functions().httpsCallable('subscribeToTopic');

                // 1) Subscribe to 'all_users' topic for broadcast notifications
                await subscribeFn({ token, topic: 'all_users' });
                console.log('[FCM] Subscribed to all_users topic');

                // 2) Subscribe to personal topic for targeted notifications
                // This ensures pushes reach ALL user's devices (web + native app)
                await subscribeFn({ token, topic: 'user_' + state.user.uid });
                console.log('[FCM] Subscribed to personal topic user_' + state.user.uid);
            } catch (topicErr) {
                console.warn('[FCM] Topic subscription failed (non-critical):', topicErr.message);
            }
        }
    } catch (e) {
        // Silent fail — don't show error toast to user
        // FCM is optional; app works fine without it
        console.warn('FCM token not available (notifications may not work):', e.code || e.message);
    }
}

// Handle foreground messages — premium slide-in notification
if (messaging) {
    messaging.onMessage((payload) => {
        console.log('Foreground message received:', payload);

        const title = payload.notification?.title || payload.data?.title || 'JeetoPlay';
        const body = payload.notification?.body || payload.data?.body || '';
        const type = payload.data?.type || 'general';

        // Determine icon & color by notification type
        let icon = 'fa-bell', color = '#00ff88';
        if (type.includes('LUDO')) { icon = 'fa-dice'; color = '#ff9f43'; }
        else if (type.includes('ESPORTS') || type.includes('MATCH')) { icon = 'fa-gamepad'; color = '#4dd0e1'; }
        else if (type.includes('WON') || type.includes('REWARD') || type.includes('REFERRAL')) { icon = 'fa-trophy'; color = '#ffd700'; }
        else if (type.includes('CANCEL') || type.includes('REJECT')) { icon = 'fa-circle-xmark'; color = '#ff6b6b'; }
        else if (type.includes('DISPUTE') || type.includes('ESCALAT')) { icon = 'fa-triangle-exclamation'; color = '#ff9f43'; }
        else if (type.includes('WITHDRAW') || type.includes('PAYMENT')) { icon = 'fa-wallet'; color = '#a78bfa'; }

        // Create premium slide-in card
        const card = document.createElement('div');
        card.className = 'push-notif-card';
        card.innerHTML = `
            <div style="display:flex;gap:12px;align-items:flex-start;">
                <div style="width:40px;height:40px;border-radius:12px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fa-solid ${icon}" style="color:${color};font-size:1rem;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.9rem;margin-bottom:2px;color:#fff;">${title}</div>
                    <div style="font-size:0.82rem;color:rgba(255,255,255,0.7);line-height:1.35;">${body}</div>
                </div>
                <button onclick="this.closest('.push-notif-card').remove()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:1.1rem;cursor:pointer;padding:0;line-height:1;">&times;</button>
            </div>
            <div class="push-notif-progress" style="position:absolute;bottom:0;left:0;height:3px;background:${color};width:100%;border-radius:0 0 16px 16px;animation:notifProgress 5s linear forwards;"></div>
        `;
        card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                card.remove();
                openNotificationSettings();
            }
        };

        document.body.appendChild(card);
        // Trigger slide-in animation
        requestAnimationFrame(() => { card.classList.add('visible'); });

        // Auto-dismiss
        setTimeout(() => {
            if (card.parentElement) {
                card.classList.remove('visible');
                setTimeout(() => card.remove(), 400);
            }
        }, 5500);
    });
}

const state = {
    user: null,
    userData: null,
    currentMatchId: null, // For joining
    selectedGameId: null // For eSports game filter
};
