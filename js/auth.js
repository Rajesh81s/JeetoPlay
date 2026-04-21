// JeetoPlay — Authentication (OTP via MSG91 Widget SDK)
// MSG91 Widget handles OTP sending/verification on client side
// Server only verifies the MSG91 access token and issues Firebase Custom Auth token

// ═══ OTP STATE ═══
let otpResendTimer = null;
let otpResendSeconds = 30;
let otpPhoneNumber = '';
let msg91Widget = null; // MSG91 widget instance

// ═══ MSG91 WIDGET CONFIGURATION ═══
const MSG91_WIDGET_ID = '3663456e4572353230343833';
const MSG91_TOKEN_AUTH = '504852TU9Dpz4f69cbdaddP1';

// Initialize widget immediately
initMSG91Widget();

// Initialize MSG91 Widget with exposed methods
function initMSG91Widget() {
    if (!MSG91_TOKEN_AUTH) {
        console.warn('[MSG91] Cannot init widget — no tokenAuth');
        return;
    }

    const configuration = {
        widgetId: MSG91_WIDGET_ID,
        tokenAuth: MSG91_TOKEN_AUTH,
        exposeMethods: true,
        success: (data) => {
            console.log('[MSG91] OTP verified via widget, access token received');
            // OTP verified by MSG91! Now verify server-side and get Firebase token
            handleMSG91Success(data);
        },
        failure: (error) => {
            console.error('[MSG91] Widget error:', error);
            // Show user-friendly message instead of raw error
            showToast(getFriendlyOTPError(error), 'error');
            // Reset verify button so user can try again
            resetVerifyButton();
            // Clear OTP fields for fresh re-entry
            clearOTPInputs();
        }
    };

    // Load MSG91 OTP script
    (function loadOtpScript(urls) {
        let i = 0;
        function attempt() {
            const s = document.createElement('script');
            s.src = urls[i];
            s.async = true;
            s.onload = () => {
                console.log('[MSG91] Script loaded from:', urls[i]);
                if (typeof window.initSendOTP === 'function') {
                    window.initSendOTP(configuration);
                    console.log('[MSG91] Widget initialized');
                }
            };
            s.onerror = () => {
                i++;
                if (i < urls.length) attempt();
                else console.error('[MSG91] All script URLs failed');
            };
            document.head.appendChild(s);
        }
        attempt();
    })([
        'https://verify.msg91.com/otp-provider.js',
        'https://verify.phone91.com/otp-provider.js'
    ]);
}

// Handle MSG91 success (OTP verified on client side)
async function handleMSG91Success(data) {
    const accessToken = data.message || data.token || data;
    console.log('[MSG91] Processing verified token for phone:', otpPhoneNumber);

    // Show verifying state
    const verifyBtn = document.getElementById('otp-verify-btn');
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
    }

    try {
        // Call Supabase Edge Function to verify MSG91 token and get Firebase Custom Auth token
        const res = await fetch('https://zrucdzkgrmtwhykvplqs.supabase.co/functions/v1/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: otpPhoneNumber,
                accessToken: typeof accessToken === 'string' ? accessToken : JSON.stringify(accessToken)
            })
        });
        const result = await res.json();
        if (!res.ok || result.error) {
            throw new Error(result.error || 'Verification failed');
        }

        console.log('[OTP] Server verified, signing in with Firebase custom token');

        // Sign in with Firebase Custom Auth token
        await auth.signInWithCustomToken(result.token);
        showToast('Verified successfully! 🎮', 'success');
        // onAuthStateChanged will handle the rest
    } catch (err) {
        console.error('[OTP] Server verification error:', err);
        showToast(getFriendlyOTPError(err), 'error');
        // Clear OTP fields so user can re-enter correct code
        clearOTPInputs();
    } finally {
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify & Login';
        }
    }
}

// ═══ AUTH STATE MANAGEMENT (SINGLE SOURCE OF TRUTH) ═══
let userDataListener = null;

auth.onAuthStateChanged(user => {
    console.log('[AUTH] onAuthStateChanged fired:', user ? user.uid : 'null');

    if (userDataListener) {
        clearInterval(userDataListener);
        userDataListener = null;
    }

    if (user) {
        state.user = user;
        console.log('[AUTH] User is logged in:', user.uid);

        // Load user data from Supabase
        async function loadUserData() {
            try {
                const { data: profile } = await supa.from('profiles')
                    .select('*')
                    .eq('uid', user.uid)
                    .single();

                if (profile) {
                    // Map Supabase profile to state.userData format
                    state.userData = {
                        fullName: profile.full_name || profile.username || '',
                        username: profile.username || '',
                        mobile: profile.phone || '',
                        email: profile.email || '',
                        depositBalance: parseFloat(profile.deposit_balance) || 0,
                        winningBalance: parseFloat(profile.winning_balance) || 0,
                        walletBalance: (parseFloat(profile.deposit_balance) || 0) + (parseFloat(profile.winning_balance) || 0),
                        isBlocked: profile.is_blocked || false,
                        referralCode: profile.referral_code || '',
                        referredBy: profile.referred_by || null,
                        vip_data: profile.vip_data || {},
                        spin_data: profile.spin_data || {},
                        gameIGNs: profile.game_igns || {},
                        createdAt: profile.created_at,
                        phone: profile.phone || ''
                    };

                    if (!state.userData.fullName || state.userData.fullName.trim() === '') {
                        console.log('[AUTH] User has incomplete profile, forcing completion');
                        showProfileCompletionOverlay(user);
                        return;
                    }

                    const profileOverlay = document.getElementById('otp-profile-overlay');
                    if (profileOverlay) profileOverlay.classList.add('hidden');

                    showAppShell();

                    if (state.userData.isBlocked) {
                        state.user = null;
                        state.userData = null;
                        auth.signOut();
                        showToast('Your account has been blocked. Contact support.', 'error');
                    } else {
                        updateUIHeader();

                        if (!window._sessionInitDone) {
                            window._sessionInitDone = true;
                            console.log('[AUTH] Running one-time session init');

                            // Update last active in Supabase
                            supa.from('profiles').update({ last_active: new Date().toISOString() }).eq('uid', user.uid);

                            if (typeof AndroidNative !== 'undefined' && AndroidNative.isNativeApp()) {
                                AndroidNative.setUserUid(user.uid);
                            } else {
                                requestNotificationPermission();
                            }

                            if (typeof checkPendingDeposit === 'function') checkPendingDeposit();
                            if (typeof loadThemePreference === 'function') loadThemePreference();

                            setTimeout(() => {
                                if (typeof checkOnboarding === 'function') checkOnboarding();
                            }, 1500);

                            setTimeout(() => {
                                if (document.getElementById('onboarding-overlay')) return;
                                if (typeof checkDailyReward === 'function') checkDailyReward();
                            }, 2500);
                        }
                    }
                } else {
                    console.log('[AUTH] New user detected (no profile in Supabase), enforcing profile completion');
                    showProfileCompletionOverlay(user);
                }
            } catch (err) {
                console.error('[AUTH] Error loading user data:', err);
                showToast('Error loading user data', 'error');
            }
        }

        // Load immediately, then poll every 30s for balance updates
        loadUserData();
        userDataListener = setInterval(loadUserData, 30000);
    } else {
        console.log('[AUTH] User logged out');
        if (userDataListener) {
            clearInterval(userDataListener);
            userDataListener = null;
        }
        if (typeof AndroidNative !== 'undefined' && AndroidNative.isNativeApp()) {
            AndroidNative.clearUserUid();
        }
        state.user = null;
        state.userData = null;

        // Reset all app state flags (prevents stale guards on re-login)
        if (typeof resetAppFlags === 'function') resetAppFlags();

        // Detach home real-time listeners
        if (typeof detachHomeListeners === 'function') detachHomeListeners();

        // Clean up profile overlay blockers (in case session expired mid-profile-completion)
        removeProfileOverlayBlockers();
        const profileOverlay = document.getElementById('otp-profile-overlay');
        if (profileOverlay) profileOverlay.classList.add('hidden');

        resetOTPFlow();
        showAuth();
    }
});

// ═══ SEND OTP (via MSG91 Widget) ═══
window.sendOTP = async function () {
    const phoneInput = document.getElementById('otp-phone-input');
    const sendBtn = document.getElementById('otp-send-btn');
    const mobile = phoneInput.value.trim().replace(/\D/g, '');

    if (!/^[6-9]\d{9}$/.test(mobile)) {
        showToast('Please enter a valid 10-digit mobile number', 'error');
        phoneInput.focus();
        return;
    }

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...';
    otpPhoneNumber = mobile;

    try {
        // Use MSG91 Widget to send OTP
        if (typeof window.sendOtp === 'function') {
            // MSG91 exposed method
            window.sendOtp('91' + mobile);
            console.log('[MSG91] sendOtp called for:', mobile);
        } else if (typeof window.msgOtpWidgetMethods !== 'undefined') {
            window.msgOtpWidgetMethods.sendOtp('91' + mobile);
            console.log('[MSG91] msgOtpWidgetMethods.sendOtp called');
        } else {
            throw new Error('MSG91 Widget not initialized. Please refresh and try again.');
        }

        // Show OTP verification step
        document.getElementById('otp-step-phone').classList.add('hidden');
        document.getElementById('otp-step-verify').classList.remove('hidden');

        const sentNumberEl = document.getElementById('otp-sent-number');
        if (sentNumberEl) {
            sentNumberEl.textContent = '+91 ' + mobile.replace(/(\d{5})(\d{5})/, '$1 $2');
        }

        const firstDigit = document.querySelector('.otp-digit[data-idx="0"]');
        if (firstDigit) setTimeout(() => firstDigit.focus(), 300);

        startResendTimer();
        showToast('OTP sent successfully!', 'success');
    } catch (err) {
        console.error('[OTP] Send error:', err);
        showToast(err.message || 'Failed to send OTP. Please try again.', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send OTP';
    }
};

// ═══ VERIFY OTP (via MSG91 Widget) ═══
window.verifyOTP = async function () {
    const verifyBtn = document.getElementById('otp-verify-btn');
    const digits = document.querySelectorAll('.otp-digit');
    let code = '';
    digits.forEach(d => code += d.value);

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
        showToast('Please enter the complete 6-digit OTP', 'error');
        const codeInputs = document.getElementById('otp-code-inputs');
        if (codeInputs) {
            codeInputs.classList.add('otp-shake');
            setTimeout(() => codeInputs.classList.remove('otp-shake'), 500);
        }
        return;
    }

    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    try {
        // Use MSG91 Widget to verify OTP
        if (typeof window.verifyOtp === 'function') {
            window.verifyOtp(code);
            console.log('[MSG91] verifyOtp called with code');
        } else if (typeof window.msgOtpWidgetMethods !== 'undefined') {
            window.msgOtpWidgetMethods.verifyOtp(code);
            console.log('[MSG91] msgOtpWidgetMethods.verifyOtp called');
        } else {
            throw new Error('MSG91 Widget not initialized. Please refresh and try again.');
        }
        // MSG91 Widget's success callback (handleMSG91Success) will handle the rest
    } catch (err) {
        console.error('[OTP] Verify error:', err);
        showToast(getFriendlyOTPError(err), 'error');
        resetVerifyButton();
        clearOTPInputs();
    }
};

// ═══ RESEND OTP ═══
window.resendOTP = async function () {
    const resendBtn = document.getElementById('otp-resend-btn');

    if (!otpPhoneNumber) {
        showToast('Please enter your phone number first', 'error');
        changeOTPNumber();
        return;
    }

    resendBtn.disabled = true;
    resendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

    try {
        if (typeof window.retryOtp === 'function') {
            window.retryOtp('text'); // 'text' for SMS retry
            console.log('[MSG91] retryOtp called');
        } else if (typeof window.sendOtp === 'function') {
            window.sendOtp('91' + otpPhoneNumber);
        } else {
            throw new Error('MSG91 Widget not initialized');
        }

        showToast('OTP resent successfully!', 'success');

        document.querySelectorAll('.otp-digit').forEach(d => { d.value = ''; d.classList.remove('filled'); });
        const firstDigit = document.querySelector('.otp-digit[data-idx="0"]');
        if (firstDigit) firstDigit.focus();

        startResendTimer();
    } catch (err) {
        console.error('[OTP] Resend error:', err);
        showToast(err.message || 'Failed to resend OTP.', 'error');
        resendBtn.disabled = false;
        resendBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Resend OTP';
    }
};

// ═══ CHANGE NUMBER ═══
window.changeOTPNumber = function () {
    resetOTPFlow();
    document.getElementById('otp-phone-input').focus();
};

// ═══ RESEND TIMER ═══
function startResendTimer() {
    const resendBtn = document.getElementById('otp-resend-btn');
    const timerEl = document.getElementById('otp-resend-timer');
    otpResendSeconds = 30;

    if (otpResendTimer) clearInterval(otpResendTimer);

    if (resendBtn) resendBtn.disabled = true;
    if (timerEl) timerEl.textContent = '(30s)';

    otpResendTimer = setInterval(() => {
        otpResendSeconds--;
        if (timerEl) timerEl.textContent = `(${otpResendSeconds}s)`;

        if (otpResendSeconds <= 0) {
            clearInterval(otpResendTimer);
            otpResendTimer = null;
            if (resendBtn) {
                resendBtn.disabled = false;
                resendBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Resend OTP';
            }
            if (timerEl) timerEl.textContent = '';
        }
    }, 1000);
}

// ═══ RESET OTP FLOW ═══
function resetOTPFlow() {
    const stepPhone = document.getElementById('otp-step-phone');
    const stepVerify = document.getElementById('otp-step-verify');
    if (stepPhone) stepPhone.classList.remove('hidden');
    if (stepVerify) stepVerify.classList.add('hidden');

    document.querySelectorAll('.otp-digit').forEach(d => { d.value = ''; d.classList.remove('filled'); });

    const sendBtn = document.getElementById('otp-send-btn');
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send OTP';
    }

    if (otpResendTimer) {
        clearInterval(otpResendTimer);
        otpResendTimer = null;
    }

    otpPhoneNumber = '';
}

// ═══ HELPER: Reset verify button to default state ═══
function resetVerifyButton() {
    const verifyBtn = document.getElementById('otp-verify-btn');
    if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Verify & Login';
    }
}

// ═══ HELPER: Clear OTP input fields for re-entry ═══
function clearOTPInputs() {
    document.querySelectorAll('.otp-digit').forEach(d => {
        d.value = '';
        d.classList.remove('filled');
    });
    const firstDigit = document.querySelector('.otp-digit[data-idx="0"]');
    if (firstDigit) setTimeout(() => firstDigit.focus(), 100);
}

// ═══ HELPER: Map raw error messages to user-friendly text ═══
function getFriendlyOTPError(error) {
    // Extract the error message string from various error formats
    let msg = '';
    if (typeof error === 'string') {
        msg = error.toLowerCase();
    } else if (error && error.message) {
        msg = error.message.toLowerCase();
    } else if (error && error.code) {
        msg = error.code.toLowerCase();
    }

    // Map known error patterns to friendly messages
    if (msg.includes('invalid') && (msg.includes('otp') || msg.includes('code') || msg.includes('verification'))) {
        return 'Invalid OTP. Please check and enter the correct code.';
    }
    if (msg.includes('expired') || msg.includes('timeout')) {
        return 'OTP has expired. Please request a new one.';
    }
    if (msg.includes('too-many-requests') || msg.includes('too many') || msg.includes('rate') || msg.includes('blocked')) {
        return 'Too many attempts. Please wait a moment and try again.';
    }
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connect')) {
        return 'Network error. Please check your connection and try again.';
    }
    if (msg.includes('not-found') || msg.includes('no user')) {
        return 'Verification failed. Please try again.';
    }
    if (msg.includes('permission') || msg.includes('denied')) {
        return 'OTP verification failed. Please try again.';
    }
    if (msg.includes('widget') || msg.includes('not initialized')) {
        return 'OTP service not ready. Please refresh the page and try again.';
    }
    if (msg.includes('internal') || msg.includes('server')) {
        return 'Something went wrong. Please try again.';
    }

    // Default fallback — never show raw error
    return 'Verification failed. Please try again.';
}

// ═══ OTP DIGIT INPUT HANDLERS ═══
document.addEventListener('DOMContentLoaded', () => {
    const digits = document.querySelectorAll('.otp-digit');

    digits.forEach((input, idx) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val.charAt(0) || '';

            if (val && idx < digits.length - 1) {
                digits[idx + 1].focus();
            }

            e.target.classList.toggle('filled', !!val);

            let code = '';
            digits.forEach(d => code += d.value);
            if (code.length === 6) {
                verifyOTP();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && idx > 0) {
                digits[idx - 1].focus();
                digits[idx - 1].value = '';
                digits[idx - 1].classList.remove('filled');
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
            if (pasted.length >= 1) {
                pasted.split('').forEach((char, i) => {
                    if (digits[i]) {
                        digits[i].value = char;
                        digits[i].classList.add('filled');
                    }
                });
                if (pasted.length === 6) {
                    digits[5].focus();
                    setTimeout(() => verifyOTP(), 200);
                } else if (pasted.length < 6) {
                    digits[pasted.length].focus();
                }
            }
        });

        input.addEventListener('focus', () => input.select());
    });
});

// ═══ PROFILE COMPLETION (New User) ═══
document.addEventListener('DOMContentLoaded', () => {
    const profileForm = document.getElementById('otp-profile-form');
    if (!profileForm) return;

    // Use click handler instead of submit — mobile browsers silently block submit if HTML5 validation fails
    const submitBtn = profileForm.querySelector('button[type="submit"]');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const fullName = document.getElementById('otp-profile-fullname').value.trim();
        const email = document.getElementById('otp-profile-email').value.trim().toLowerCase();
        const referralCode = document.getElementById('otp-profile-referral').value.trim().toUpperCase();
        const ageCheckbox = document.getElementById('otp-profile-age-verify');

        // JavaScript validation (not relying on HTML5 required attributes)
        if (!fullName) {
            showToast('Please enter your full name', 'error');
            document.getElementById('otp-profile-fullname').focus();
            return;
        }

        if (fullName.length < 2) {
            showToast('Name must be at least 2 characters', 'error');
            return;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('Please enter a valid email address', 'error');
            return;
        }

        if (ageCheckbox && !ageCheckbox.checked) {
            showToast('Please confirm you are 18+ to continue', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Setting up...';

        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');

            const mobile = user.phoneNumber ? user.phoneNumber.replace('+91', '') : otpPhoneNumber;
            let referrerUid = null;

            if (referralCode) {
                const { data: referrers } = await supa.from('profiles')
                    .select('uid')
                    .eq('referral_code', referralCode)
                    .limit(1);
                if (!referrers || referrers.length === 0) {
                    showToast('Invalid referral code', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> Start Playing';
                    return;
                }
                referrerUid = referrers[0].uid;
            }

            const userReferralCode = (fullName.slice(0, 3).toUpperCase() + Math.random().toString(36).substring(2, 7).toUpperCase()).replace(/[^A-Z0-9]/g, 'X');

            const deviceFingerprint = btoa([
                navigator.userAgent,
                screen.width + 'x' + screen.height,
                screen.colorDepth,
                Intl.DateTimeFormat().resolvedOptions().timeZone,
                navigator.language,
                navigator.hardwareConcurrency || 0
            ].join('|')).slice(0, 40);

            // Create profile in Supabase
            const mobile = user.phoneNumber ? user.phoneNumber.replace('+91', '') : otpPhoneNumber;
            await supa.from('profiles').upsert({
                uid: user.uid,
                full_name: fullName,
                username: fullName,
                phone: mobile,
                email: email || null,
                deposit_balance: 0,
                winning_balance: 0,
                is_blocked: false,
                referral_code: userReferralCode,
                referred_by: referrerUid || null,
                created_at: new Date().toISOString()
            });
            console.log('[AUTH] New user profile created in Supabase:', user.uid);

            // Remove overlay blockers
            removeProfileOverlayBlockers();

            if (referrerUid) {
                try {
                    const processReferralFn = functions.httpsCallable('processReferralReward');
                    await processReferralFn({ referrerUid, deviceFingerprint });
                } catch (refErr) {
                    console.error('Referral processing error:', refErr);
                }
            }

            showToast('Welcome to JeetoPlay! 🎮', 'success');
        } catch (err) {
            console.error('[AUTH] Profile completion error:', err);
            showToast('Error creating profile. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> Start Playing';
        }
    });
});

// ═══ MANDATORY PROFILE COMPLETION OVERLAY ═══
function showProfileCompletionOverlay(user) {
    const profileOverlay = document.getElementById('otp-profile-overlay');
    if (!profileOverlay) return;

    // Ensure auth view is hidden
    const authView = document.getElementById('auth-view');
    if (authView) authView.classList.add('hidden');

    // Hide splash screen if still visible
    const splash = document.getElementById('splash-screen');
    if (splash && splash.style.display !== 'none') {
        splash.classList.add('fade-out');
        setTimeout(() => splash.style.display = 'none', 300);
    }

    // Show app layout in background (for visual context) but do NOT call showAppShell()
    // — it would trigger loadHome/loadEsportsGames/loadChallenges prematurely
    document.getElementById('app-layout').classList.remove('hidden');

    // Show the overlay with highest z-index
    profileOverlay.classList.remove('hidden');
    profileOverlay.style.zIndex = '5000'; // Below toast (9999) but above app (1000)

    // Auto-populate phone number from OTP flow or Firebase auth
    const mobile = user.phoneNumber ? user.phoneNumber.replace('+91', '') : otpPhoneNumber;
    console.log('[AUTH] Profile overlay shown for:', mobile);

    // ═══ BLOCK ALL ESCAPE ROUTES ═══

    // 1. Prevent back button from closing overlay
    window.history.pushState({ profileCompletion: true }, '');
    window._profileBackHandler = function (e) {
        if (document.getElementById('otp-profile-overlay') && !document.getElementById('otp-profile-overlay').classList.contains('hidden')) {
            window.history.pushState({ profileCompletion: true }, '');
            showToast('Please complete your profile to continue', 'error');
        }
    };
    window.addEventListener('popstate', window._profileBackHandler);

    // 2. Prevent Escape key
    window._profileEscHandler = function (e) {
        if (e.key === 'Escape' && document.getElementById('otp-profile-overlay') && !document.getElementById('otp-profile-overlay').classList.contains('hidden')) {
            e.preventDefault();
            e.stopPropagation();
            showToast('Please complete your profile to continue', 'error');
        }
    };
    window.addEventListener('keydown', window._profileEscHandler, true);

    // 3. Prevent clicking outside the form
    profileOverlay.onclick = function (e) {
        if (e.target === profileOverlay) {
            showToast('Please complete your profile to continue', 'error');
        }
    };

    // Focus on fullname input
    setTimeout(() => {
        const nameInput = document.getElementById('otp-profile-fullname');
        if (nameInput) nameInput.focus();
    }, 500);
}

// Remove escape route blockers after profile is complete
function removeProfileOverlayBlockers() {
    if (window._profileBackHandler) {
        window.removeEventListener('popstate', window._profileBackHandler);
        window._profileBackHandler = null;
    }
    if (window._profileEscHandler) {
        window.removeEventListener('keydown', window._profileEscHandler, true);
        window._profileEscHandler = null;
    }
}

// ═══ LOGOUT ═══
window.logout = function () {
    removeProfileOverlayBlockers();
    auth.signOut();
};

// ═══ LEGACY COMPATIBILITY ═══
window.toggleAuthMode = function () {
    resetOTPFlow();
};
