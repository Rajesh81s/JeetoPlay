// JeetoPlay — Onboarding Tutorial
// First-time user walkthrough shown after registration

const ONBOARDING_STEPS = [
    {
        icon: '🎮',
        title: 'Welcome to JeetoPlay!',
        desc: 'Your skill-based gaming platform where you play, compete, and win real cash prizes.',
        color: '#00ff88'
    },
    {
        icon: '🏆',
        title: 'Browse & Join Games',
        desc: 'Pick from eSports or Ludo. Join matches with entry fees and win big prizes based on your skills.',
        color: '#3b82f6'
    },
    {
        icon: '🎁',
        title: 'Earn Daily Rewards',
        desc: 'Claim daily bonuses, spin the lucky wheel, and complete challenges to earn free rewards.',
        color: '#ec4899'
    },
    {
        icon: '💰',
        title: 'Instant Withdrawals',
        desc: 'Win cash and withdraw instantly to your UPI. Add money securely to start playing!',
        color: '#f59e0b'
    }
];

/**
 * Show onboarding tutorial overlay
 */
window.showOnboarding = function () {
    // Don't show if already on screen
    if (document.getElementById('onboarding-overlay')) return;

    let currentStep = 0;

    const overlay = document.createElement('div');
    overlay.id = 'onboarding-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;animation:ob-fade-in 0.4s ease;';

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ob-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ob-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes ob-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
        .ob-dot { width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.2);transition:all 0.3s ease; }
        .ob-dot.active { background:#fff;width:24px;border-radius:4px; }
    `;
    overlay.appendChild(style);

    function render() {
        const step = ONBOARDING_STEPS[currentStep];
        const isLast = currentStep === ONBOARDING_STEPS.length - 1;

        // Remove old content but keep style tag
        const existingContent = overlay.querySelector('.ob-content');
        if (existingContent) existingContent.remove();

        const content = document.createElement('div');
        content.className = 'ob-content';
        content.style.cssText = 'text-align:center;max-width:340px;width:100%;animation:ob-fade-in 0.3s ease;';

        content.innerHTML = `
            <!-- Icon -->
            <div style="font-size:4rem;margin-bottom:24px;animation:ob-bounce 2s ease infinite;">${step.icon}</div>

            <!-- Title -->
            <h2 style="color:${step.color};font-size:1.5rem;font-weight:800;margin:0 0 12px;letter-spacing:-0.5px;">${step.title}</h2>

            <!-- Description -->
            <p style="color:rgba(255,255,255,0.7);font-size:0.95rem;line-height:1.6;margin:0 0 40px;max-width:280px;margin-left:auto;margin-right:auto;">${step.desc}</p>

            <!-- Step counter -->
            <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:32px;">
                ${ONBOARDING_STEPS.map((_, i) =>
            `<div class="ob-dot ${i === currentStep ? 'active' : ''}"></div>`
        ).join('')}
            </div>

            <!-- Buttons -->
            <div style="display:flex;gap:12px;justify-content:center;">
                ${!isLast ? `
                    <button onclick="skipOnboarding()" style="padding:12px 24px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.5);font-weight:600;font-size:0.9rem;cursor:pointer;">Skip</button>
                    <button onclick="nextOnboardingStep()" style="padding:12px 32px;border-radius:12px;border:none;background:${step.color};color:#000;font-weight:700;font-size:0.9rem;cursor:pointer;box-shadow:0 4px 20px ${step.color}40;">Next →</button>
                ` : `
                    <button onclick="skipOnboarding()" style="padding:14px 48px;border-radius:14px;border:none;background:linear-gradient(135deg,#00ff88,#00d672);color:#000;font-weight:700;font-size:1rem;cursor:pointer;box-shadow:0 4px 24px rgba(0,255,136,0.3);width:100%;">
                        Let's Go! 🚀
                    </button>
                `}
            </div>
        `;

        overlay.appendChild(content);
    }

    window.nextOnboardingStep = function () {
        if (currentStep < ONBOARDING_STEPS.length - 1) {
            currentStep++;
            render();
        }
    };

    window.skipOnboarding = function () {
        overlay.style.transition = 'opacity 0.3s';
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
            // Mark onboarding complete
            if (state.user) {
                db.ref(`users/${state.user.uid}/onboardingComplete`).set(true);
            }
        }, 300);
    };

    // Touch swipe support
    let touchStartX = 0;
    overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });
    overlay.addEventListener('touchend', e => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 60) {
            if (diff > 0 && currentStep < ONBOARDING_STEPS.length - 1) {
                currentStep++;
                render();
            } else if (diff < 0 && currentStep > 0) {
                currentStep--;
                render();
            }
        }
    });

    render();
    document.body.appendChild(overlay);
};

/**
 * Check if onboarding should be shown (called after auth)
 */
window.checkOnboarding = async function () {
    if (!state.user) return;
    try {
        const snap = await db.ref(`users/${state.user.uid}/onboardingComplete`).once('value');
        if (!snap.val()) {
            // Guard: only show for accounts created in the last 5 minutes (new signups)
            // This prevents existing users from seeing onboarding after feature deployment
            const createdSnap = await db.ref(`users/${state.user.uid}/createdAt`).once('value');
            const createdAt = createdSnap.val();
            if (!createdAt || (Date.now() - createdAt) > 5 * 60 * 1000) {
                // Old account — silently mark as complete, don't show tutorial
                db.ref(`users/${state.user.uid}/onboardingComplete`).set(true).catch(() => { });
                return;
            }
            // New signup — show the tutorial
            setTimeout(() => showOnboarding(), 800);
        }
    } catch (e) {
        console.error('[Onboarding] Check error:', e);
    }
};
