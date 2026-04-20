// JeetoPlay — Spin Wheel / Lucky Draw
// Premium CSS-animated wheel with weighted server-side prizes

const SW_DEFAULT_SEGMENTS = [
    { label: '🪙 1', color: '#3b82f6', textColor: '#fff' },
    { label: '🪙 2', color: '#8b5cf6', textColor: '#fff' },
    { label: 'Better Luck', color: '#374151', textColor: '#9ca3af' },
    { label: '🪙 3', color: '#06b6d4', textColor: '#fff' },
    { label: '🪙 5', color: '#10b981', textColor: '#fff' },
    { label: '+1 Spin', color: '#f59e0b', textColor: '#000' },
    { label: '🪙 7', color: '#ec4899', textColor: '#fff' },
    { label: '🪙 10 🎰', color: '#ef4444', textColor: '#fff' }
];

let swIsSpinning = false;
let swCurrentRotation = 0;

/**
 * Load spin wheel data when Earn tab opens
 */
window.loadSpinWheel = async function () {
    if (!state.user) return;

    try {
        // Load config
        const configSnap = await db.ref('spin_wheel_config').once('value');
        const config = configSnap.val() || {};

        if (config.enabled === false) {
            const container = document.getElementById('spin-wheel-section');
            if (container) container.style.display = 'none';
            return;
        }

        const container = document.getElementById('spin-wheel-section');
        if (container) container.style.display = 'block';

        // Load user spin data
        const spinSnap = await db.ref(`users/${state.user.uid}/spinData`).once('value');
        const spinData = spinSnap.val() || {};

        updateSpinUI(spinData);
        renderWheel(config.segments || null);
    } catch (err) {
        console.error('[SpinWheel] Load error:', err);
    }
};

/**
 * Update spin count display
 */
function updateSpinUI(spinData) {
    const today = getSWTodayIST();
    const freeAvailable = spinData.freeSpinUsedDate !== today;
    const extraSpins = spinData.extraSpins || 0;
    const totalSpins = (freeAvailable ? 1 : 0) + extraSpins;

    // Spin count badge
    const badge = document.getElementById('sw-spin-count');
    if (badge) {
        badge.textContent = totalSpins;
        badge.style.background = totalSpins > 0
            ? 'linear-gradient(135deg, #ec4899, #a855f7)'
            : 'rgba(255,255,255,0.1)';
    }

    // Spin label
    const label = document.getElementById('sw-spin-label');
    if (label) {
        label.textContent = totalSpins > 0
            ? `${totalSpins} spin${totalSpins > 1 ? 's' : ''} available`
            : 'No spins left';
    }

    // Button state
    const btn = document.getElementById('sw-spin-btn');
    if (btn) {
        btn.disabled = totalSpins === 0 || swIsSpinning;
        btn.style.opacity = (totalSpins === 0 && !swIsSpinning) ? '0.5' : '1';
    }

    // Stats
    const totalEl = document.getElementById('sw-total-spins');
    if (totalEl) totalEl.textContent = spinData.totalSpins || 0;
    const wonEl = document.getElementById('sw-total-won');
    if (wonEl) wonEl.textContent = '🪙 ' + (spinData.totalWon || 0);
}

function getSWTodayIST() {
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return istDate.toISOString().split('T')[0];
}

/**
 * Render wheel SVG with segments
 */
function renderWheel(configSegments) {
    const wheel = document.getElementById('sw-wheel');
    if (!wheel) return;

    const segments = configSegments || SW_DEFAULT_SEGMENTS;
    const count = segments.length;
    const angle = 360 / count;

    let svg = '';
    for (let i = 0; i < count; i++) {
        const startAngle = i * angle - 90;
        const endAngle = startAngle + angle;
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = 150 + 140 * Math.cos(startRad);
        const y1 = 150 + 140 * Math.sin(startRad);
        const x2 = 150 + 140 * Math.cos(endRad);
        const y2 = 150 + 140 * Math.sin(endRad);
        const largeArc = angle > 180 ? 1 : 0;

        const seg = configSegments ? configSegments[i] : SW_DEFAULT_SEGMENTS[i];
        const color = seg.color || SW_DEFAULT_SEGMENTS[i % SW_DEFAULT_SEGMENTS.length].color;
        const textColor = seg.textColor || '#fff';

        // Segment path — thick dark borders to clearly separate segments
        svg += `<path d="M150,150 L${x1},${y1} A140,140 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" stroke="#0f172a" stroke-width="3"/>`;

        // Label — positioned at midpoint of arc
        const midAngle = startAngle + angle / 2;
        const midRad = (midAngle * Math.PI) / 180;
        const labelX = 150 + 95 * Math.cos(midRad);
        const labelY = 150 + 95 * Math.sin(midRad);
        const label = seg.label || SW_DEFAULT_SEGMENTS[i % SW_DEFAULT_SEGMENTS.length].label;

        svg += `<text x="${labelX}" y="${labelY}" fill="${textColor}" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${midAngle}, ${labelX}, ${labelY})">${label}</text>`;
    }

    wheel.innerHTML = svg;
}

/**
 * Spin the wheel — calls Cloud Function, then animates
 */
window.spinTheWheel = async function () {
    if (swIsSpinning) return;
    const btn = document.getElementById('sw-spin-btn');
    if (btn && btn.disabled) return;

    swIsSpinning = true;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const spinFn = functions.httpsCallable('spinWheel');
        const result = await spinFn({});
        const data = result.data;

        // Calculate target rotation to land on winning segment
        const segCount = data.totalSegments || SW_DEFAULT_SEGMENTS.length;
        const segAngle = 360 / segCount;

        // The pointer is at 12 o'clock. Segments are drawn clockwise from top.
        // Segment N center is at (N * segAngle + segAngle/2)° clockwise from top.
        // To land on segment N: final wheel rotation must equal (360 - segCenter).
        const segCenter = data.winIndex * segAngle + segAngle / 2;
        const targetStop = 360 - segCenter; // ABSOLUTE final position (mod 360)

        // Small jitter within ±20% — always lands clearly inside the segment
        const jitter = (Math.random() - 0.5) * segAngle * 0.2;

        // Normalize current position to avoid floating-point overflow
        const baseRotation = swCurrentRotation % 360;

        // Calculate shortest forward delta from current position to target
        let delta = (targetStop + jitter) - baseRotation;
        if (delta < 0) delta += 360; // Always rotate forward (clockwise)

        // Add full spins (5-7) for visual drama
        const fullSpins = 5 + Math.floor(Math.random() * 3);
        const finalRotation = baseRotation + delta + fullSpins * 360;

        // Animate the wheel
        const wheelContainer = document.getElementById('sw-wheel-container');
        if (wheelContainer) {
            // Snap to current visual position without transition
            wheelContainer.style.transition = 'none';
            wheelContainer.style.transform = `rotate(${baseRotation}deg)`;
            void wheelContainer.offsetHeight; // Force reflow

            // Wait for transitionend to show result (not setTimeout)
            const onSpinEnd = () => {
                wheelContainer.removeEventListener('transitionend', onSpinEnd);
                clearTimeout(spinFallbackTimer);
                finishSpin(data, btn);
            };
            wheelContainer.addEventListener('transitionend', onSpinEnd, { once: true });

            // Fallback timeout in case transitionend doesn't fire
            const spinFallbackTimer = setTimeout(() => {
                wheelContainer.removeEventListener('transitionend', onSpinEnd);
                finishSpin(data, btn);
            }, 5000);

            // Start spin animation
            wheelContainer.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
            wheelContainer.style.transform = `rotate(${finalRotation}deg)`;
        }

        swCurrentRotation = finalRotation;

    } catch (err) {
        console.error('[SpinWheel] Spin error:', err);
        swIsSpinning = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
            btn.style.opacity = '1';
        }

        if (err.code === 'resource-exhausted') {
            showSpinMessage('No spins left! Come back tomorrow 🎰', 'info');
        } else {
            showSpinMessage(err.message || 'Spin failed', 'error');
        }
    }
};

/**
 * Called when spin animation completes (via transitionend)
 * Ensures result shows ONLY after wheel has fully stopped
 */
function finishSpin(data, btn) {
    swIsSpinning = false;
    showSpinResult(data);
    updateSpinUI(data.spinData);

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        btn.disabled = !data.spinData.freeSpinAvailable && (data.spinData.extraSpins || 0) === 0;
        btn.style.opacity = btn.disabled ? '0.5' : '1';
    }

    // Update balance in header
    if (data.prizeType === 'CASH' && typeof updateUIHeader === 'function') {
        updateUIHeader();
    }
}

/**
 * Show prize result popup
 */
function showSpinResult(data) {
    const popup = document.getElementById('sw-result-popup');
    if (!popup) return;

    const icon = document.getElementById('sw-result-icon');
    const title = document.getElementById('sw-result-title');
    const desc = document.getElementById('sw-result-desc');

    if (data.prizeType === 'CASH') {
        icon.innerHTML = '💰';
        icon.style.animation = 'pulse 1s infinite';
        title.textContent = `You won ${data.segment.label}!`;
        title.style.color = '#10b981';
        desc.textContent = `🪙 ${data.prizeAmount} coins added to your wallet!`;
    } else if (data.prizeType === 'SPIN') {
        icon.innerHTML = '🎰';
        icon.style.animation = 'pulse 1s infinite';
        title.textContent = 'Extra Spin!';
        title.style.color = '#f59e0b';
        desc.textContent = data.message;
    } else {
        icon.innerHTML = '😅';
        icon.style.animation = 'none';
        title.textContent = 'Better Luck!';
        title.style.color = '#9ca3af';
        desc.textContent = 'Try again tomorrow!';
    }

    popup.classList.remove('hidden');
    popup.style.display = 'flex';

    // Auto-close after 3s
    setTimeout(() => closeSpinResult(), 3000);
}

window.closeSpinResult = function () {
    const popup = document.getElementById('sw-result-popup');
    if (popup) {
        popup.style.display = 'none';
        popup.classList.add('hidden');
    }
};

function showSpinMessage(msg, type) {
    if (typeof showToast === 'function') {
        showToast(msg, type);
    }
}
