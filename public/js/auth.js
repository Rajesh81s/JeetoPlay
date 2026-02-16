// JeetoPlay — Authentication
// Auto-extracted from app.html

// Password hashing utility
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// --- AUTH STATE MANAGEMENT (SINGLE SOURCE OF TRUTH) ---
let userDataListener = null; // Track active listener to prevent duplicates

auth.onAuthStateChanged(user => {
    console.log('[AUTH] onAuthStateChanged fired:', user ? user.uid : 'null');

    // Clear any existing listener
    if (userDataListener && state.user) {
        console.log('[AUTH] Clearing previous listener for:', state.user.uid);
        db.ref('users/' + state.user.uid).off('value', userDataListener);
        userDataListener = null;
    }

    if (user) {
        state.user = user;
        console.log('[AUTH] User is logged in:', user.uid);

        // ⚡ PROGRESSIVE LOADING: Show app shell IMMEDIATELY (before user data loads)
        // This reduces perceived load time from ~3-5s to ~1s
        showAppShell();

        // Update last active timestamp (non-blocking)
        db.ref('users/' + user.uid + '/lastActive').set(firebase.database.ServerValue.TIMESTAMP);

        // Fetch user data in background
        console.log('[AUTH] Setting up user data listener for:', user.uid);
        userDataListener = db.ref('users/' + user.uid).on('value', snap => {
            console.log('[AUTH] User data snapshot received, exists:', snap.exists());
            if (snap.exists()) {
                state.userData = snap.val();
                console.log('[AUTH] User data loaded:', state.userData.fullName || state.userData.email);

                if (state.userData.isBlocked) {
                    console.log('[AUTH] User is blocked, signing out');
                    state.user = null;
                    state.userData = null;
                    auth.signOut();
                    showToast('Your account has been blocked. Contact support.', 'error');
                } else {
                    // Update UI with real data (replaces loading placeholders)
                    updateUIHeader();

                    // Push notifications: native bridge for Android app, web FCM for browsers
                    if (typeof AndroidNative !== 'undefined' && AndroidNative.isNativeApp()) {
                        // Running inside Android WebView — use native FCM
                        console.log('[FCM] Native Android app detected, passing UID to native bridge');
                        AndroidNative.setUserUid(user.uid);
                    } else {
                        // Running in browser — use web FCM
                        requestNotificationPermission();
                    }

                    // Check for pending deposits from app refresh/reload
                    if (typeof checkPendingDeposit === 'function') checkPendingDeposit();

                    // Check onboarding tutorial FIRST (once per session, for new users)
                    if (!window._onboardingChecked) {
                        window._onboardingChecked = true;
                        setTimeout(() => {
                            if (typeof checkOnboarding === 'function') checkOnboarding();
                        }, 1500);
                    }

                    // Check daily reward AFTER onboarding (delayed, skip if onboarding is showing)
                    if (!window._dailyRewardChecked) {
                        window._dailyRewardChecked = true;
                        setTimeout(() => {
                            // Don't show daily reward if onboarding overlay is active
                            if (document.getElementById('onboarding-overlay')) return;
                            if (typeof checkDailyReward === 'function') checkDailyReward();
                        }, 2500);
                    }

                    // Load theme preference from user profile
                    if (typeof loadThemePreference === 'function') loadThemePreference();
                }
            } else {
                // User data missing - wait for it (signup writes this)
                console.log('[AUTH] User data not found yet, waiting...');
            }
        }, (error) => {
            console.error('[AUTH] Error listening to user data:', error);
            showToast('Error loading user data', 'error');
        });
    } else {
        console.log('[AUTH] User logged out');
        if (userDataListener && state.user) {
            db.ref('users/' + state.user.uid).off('value', userDataListener);
            userDataListener = null;
        }
        // LOGGED OUT - Clear all state immediately
        // Clear native Android FCM bridge
        if (typeof AndroidNative !== 'undefined' && AndroidNative.isNativeApp()) {
            AndroidNative.clearUserUid();
        }
        state.user = null;
        state.userData = null;
        window._dailyRewardChecked = false;

        // Clear any cached form data
        const loginForm = document.getElementById('login-form');
        const signupForm = document.getElementById('signup-form');
        if (loginForm) loginForm.reset();
        if (signupForm) signupForm.reset();

        // Reset to login view
        document.getElementById('login-form-container').classList.remove('hidden');
        document.getElementById('signup-form-container').classList.add('hidden');

        // Show auth screen
        showAuth();
    }
});

// Toggle Auth
window.toggleAuthMode = function () {
    document.getElementById('login-form-container').classList.toggle('hidden');
    document.getElementById('signup-form-container').classList.toggle('hidden');
};

// Generate Unique 10-digit User ID
async function generateUserId() {
    let userId;
    let isUnique = false;

    while (!isUnique) {
        // Generate 10-digit number (1000000000 to 9999999999)
        userId = Math.floor(1000000000 + Math.random() * 9000000000).toString();

        // Check if this ID already exists
        const check = await db.ref('users').orderByChild('userId').equalTo(userId).once('value');
        if (!check.exists()) {
            isUnique = true;
        }
    }
    return userId;
}

// Signup
document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('signup-fullname').value.trim();
    const email = document.getElementById('signup-email').value.trim().toLowerCase();
    const password = document.getElementById('signup-password').value;
    const mobile = document.getElementById('signup-phone').value.trim();
    const referralCode = document.getElementById('signup-referral').value.trim().toUpperCase();
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // Validate password strength
    if (password.length < 6) {
        return showToast('Password must be at least 6 characters', 'error');
    }

    // Validate mobile format (10 digits)
    if (!/^[0-9]{10}$/.test(mobile)) {
        return showToast('Enter a valid 10-digit mobile number', 'error');
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showToast('Please enter a valid email address', 'error');
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...';

    let referrerUid = null;
    let createdUser = null;

    try {
        // Step 1: Create Firebase Auth account FIRST
        // (We must authenticate before querying the database due to security rules)
        createdUser = await auth.createUserWithEmailAndPassword(email, password);

        // Step 2: Now authenticated — check if mobile already exists
        const mobileCheck = await db.ref('users').orderByChild('mobile').equalTo(mobile).once('value');
        if (mobileCheck.exists()) {
            // Mobile taken — delete the just-created auth account
            await createdUser.user.delete();
            createdUser = null;
            throw { code: 'custom', message: 'Mobile number already registered' };
        }

        // Step 3: Validate referral code if provided
        if (referralCode) {
            const referrerSnap = await db.ref('users').orderByChild('referralCode').equalTo(referralCode).once('value');
            if (!referrerSnap.exists()) {
                // Invalid referral — delete auth account
                await createdUser.user.delete();
                createdUser = null;
                throw { code: 'custom', message: 'Invalid referral code' };
            }
            referrerSnap.forEach(child => { referrerUid = child.key; });
        }

        // Step 4: Generate unique referral code for this user
        const userReferralCode = (fullName.slice(0, 3).toUpperCase() + Math.random().toString(36).substring(2, 7).toUpperCase()).replace(/[^A-Z0-9]/g, 'X');

        // Step 4.5: Generate device fingerprint for anti-abuse
        const deviceFingerprint = btoa([
            navigator.userAgent,
            screen.width + 'x' + screen.height,
            screen.colorDepth,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            navigator.language,
            navigator.hardwareConcurrency || 0
        ].join('|')).slice(0, 40);

        // Step 5: Create user record in database
        const userData = {
            fullName,
            email,
            mobile,
            depositBalance: 0,
            winningBalance: 0,
            isBlocked: false,
            referralCode: userReferralCode,
            deviceFingerprint,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            lastActive: firebase.database.ServerValue.TIMESTAMP
        };

        // Add referredBy if referral code was used
        if (referrerUid) {
            userData.referredBy = referrerUid;
        }

        await db.ref('users/' + createdUser.user.uid).set(userData);

        // Process referral (PENDING — reward given after 3 games)
        if (referrerUid) {
            try {
                const processReferralFn = functions.httpsCallable('processReferralReward');
                await processReferralFn({ referrerUid, deviceFingerprint });
                // Server handles referrals/ record — no client write needed
            } catch (refErr) {
                console.error('Referral processing error:', refErr);
                // Don't block registration for referral errors
            }
        }

        showToast('Account created successfully!', 'success');
        // Auth state change will handle transition to app

    } catch (err) {
        // Clean up auth account if it was created but registration failed
        if (createdUser && err.code !== 'custom') {
            try { await createdUser.user.delete(); } catch (delErr) { console.error('Cleanup error:', delErr); }
        }
        // Handle custom errors or Firebase errors
        if (err.code === 'custom') {
            showToast(err.message, 'error');
        } else {
            showToast(getAuthErrorMessage(err), 'error');
        }
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Sign Up';
    }
});

// Translate Firebase auth errors to user-friendly messages
function getAuthErrorMessage(error) {
    const errorCode = error.code || '';
    const errorMessages = {
        'auth/invalid-email': 'Please enter a valid email address',
        'auth/user-disabled': 'This account has been disabled',
        'auth/user-not-found': 'Invalid email or password',
        'auth/wrong-password': 'Invalid email or password',
        'auth/invalid-credential': 'Invalid email or password',
        'auth/invalid-login-credentials': 'Invalid email or password',
        'auth/email-already-in-use': 'This email is already registered',
        'auth/weak-password': 'Password must be at least 6 characters',
        'auth/network-request-failed': 'Network error. Please check your connection',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later',
        'auth/operation-not-allowed': 'Login is temporarily disabled'
    };
    return errorMessages[errorCode] || 'Login failed. Please try again.';
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // Validation
    if (!identifier || !password) {
        return showToast('Please fill in all fields', 'error');
    }

    // Normalize mobile input: strip +91, 91, spaces, dashes
    let normalizedMobile = identifier.replace(/[\s\-\(\)]/g, ''); // remove spaces/dashes/parens
    if (normalizedMobile.startsWith('+91')) normalizedMobile = normalizedMobile.substring(3);
    else if (normalizedMobile.startsWith('91') && normalizedMobile.length === 12) normalizedMobile = normalizedMobile.substring(2);

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...';

    try {
        // Detect if identifier is mobile (10 digits after normalization)
        const isMobile = /^[0-9]{10}$/.test(normalizedMobile);

        let email;
        if (isMobile) {
            // Use Cloud Function to look up email by mobile
            try {
                const lookupFn = functions.httpsCallable('lookupEmailByMobile');
                const result = await lookupFn({ mobile: normalizedMobile });
                email = result.data.email;
                if (!email) {
                    throw { code: 'auth/user-not-found' };
                }
            } catch (lookupErr) {
                console.error('Mobile lookup error:', lookupErr.code, lookupErr.message, lookupErr);
                // Firebase Cloud Functions error codes are prefixed: 'functions/not-found'
                const errCode = lookupErr.code || '';
                if (errCode === 'not-found' || errCode === 'functions/not-found' || errCode.includes('not-found') ||
                    lookupErr.message?.includes('not-found') || lookupErr.message?.includes('No account found')) {
                    throw { code: 'auth/user-not-found' };
                }
                throw { code: 'auth/network-request-failed' };
            }
        } else {
            email = identifier;
        }

        await auth.signInWithEmailAndPassword(email, password);
        showToast('Login successful!', 'success');

    } catch (err) {
        console.error('Login error:', err);
        showToast(getAuthErrorMessage(err), 'error');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Login';
    }
});

window.logout = function () { auth.signOut(); };
