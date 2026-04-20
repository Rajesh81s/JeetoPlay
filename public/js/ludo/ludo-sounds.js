/**
 * ludo-sounds.js — JeetoPlay Ludo Sound & Haptics System
 * 
 * Generates all game sounds using Web Audio API (no external files needed).
 * Provides haptic feedback via the Vibration API for mobile devices.
 *
 * Sound catalog:
 *   - Dice roll: rattling shake
 *   - Dice land: satisfying thud
 *   - Piece move: soft slide tap
 *   - Piece enter: pop sound
 *   - Piece capture: dramatic hit
 *   - Piece finish: triumphant chime
 *   - Extra turn: bonus ding
 *   - Three sixes: buzzer
 *   - Game win: victory fanfare
 *   - Game lose: sad tone
 *   - Button tap: UI feedback
 */

'use strict';

const LudoSounds = (() => {
    let audioCtx = null;
    let enabled = true;
    let hapticsEnabled = true;

    // Lazy-init AudioContext (requires user gesture on mobile)
    function getCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // ─── Utility ────────────────────────────────────────────

    function playTone(frequency, duration, type = 'sine', volume = 0.3, delay = 0) {
        if (!enabled) return;
        try {
            const ctx = getCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = type;
            osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
            gain.gain.setValueAtTime(0, ctx.currentTime + delay);
            gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + delay + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + duration);
        } catch (e) { /* AudioContext not supported */ }
    }

    function playNoise(duration, volume = 0.15, delay = 0) {
        if (!enabled) return;
        try {
            const ctx = getCtx();
            const bufferSize = ctx.sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.5;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 3000;
            filter.Q.value = 0.5;
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(volume, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
            noise.start(ctx.currentTime + delay);
            noise.stop(ctx.currentTime + delay + duration);
        } catch (e) { /* */ }
    }

    function vibrate(pattern) {
        if (!hapticsEnabled) return;
        try {
            if (navigator.vibrate) navigator.vibrate(pattern);
        } catch (e) { /* Not supported */ }
    }

    // ─── Sound Effects ──────────────────────────────────────

    function diceRoll() {
        // Rapid rattling noise for dice shake
        playNoise(0.08, 0.12, 0);
        playNoise(0.06, 0.10, 0.1);
        playNoise(0.05, 0.08, 0.18);
        playNoise(0.04, 0.06, 0.25);
        vibrate(30);
    }

    function diceLand(value) {
        // Satisfying thud + tone based on value
        playNoise(0.05, 0.2, 0);
        playTone(200 + value * 50, 0.12, 'triangle', 0.25);
        vibrate(value === 6 ? [20, 30, 20] : 15);
    }

    function pieceMove() {
        // Soft sliding tap
        playTone(600, 0.06, 'sine', 0.12);
        playTone(800, 0.04, 'sine', 0.08, 0.04);
    }

    function pieceEnter() {
        // Pop sound - piece enters the board
        playTone(500, 0.08, 'sine', 0.2);
        playTone(700, 0.06, 'sine', 0.15, 0.06);
        playTone(900, 0.05, 'sine', 0.1, 0.1);
        vibrate(25);
    }

    function pieceCapture() {
        // Dramatic impact
        playNoise(0.08, 0.3, 0);
        playTone(150, 0.15, 'sawtooth', 0.2);
        playTone(100, 0.20, 'square', 0.12, 0.08);
        vibrate([30, 40, 50]);
    }

    function pieceFinish() {
        // Triumphant ascending chime
        playTone(523, 0.12, 'sine', 0.2);          // C5
        playTone(659, 0.12, 'sine', 0.2, 0.1);     // E5
        playTone(784, 0.12, 'sine', 0.2, 0.2);     // G5
        playTone(1047, 0.20, 'sine', 0.25, 0.3);   // C6
        vibrate([20, 30, 20, 30, 40]);
    }

    function extraTurn() {
        // Bonus ding
        playTone(880, 0.1, 'sine', 0.18);
        playTone(1100, 0.15, 'sine', 0.15, 0.08);
        vibrate([15, 20, 15]);
    }

    function threeSixes() {
        // Buzzer - descending sad tones
        playTone(400, 0.15, 'square', 0.15);
        playTone(300, 0.15, 'square', 0.12, 0.15);
        playTone(200, 0.25, 'square', 0.10, 0.30);
        vibrate([50, 30, 50]);
    }

    function gameWin() {
        // Victory fanfare
        playTone(523, 0.15, 'sine', 0.2);          // C
        playTone(659, 0.15, 'sine', 0.2, 0.15);    // E
        playTone(784, 0.15, 'sine', 0.2, 0.30);    // G
        playTone(1047, 0.3, 'sine', 0.3, 0.45);    // C6
        playTone(1175, 0.15, 'sine', 0.2, 0.60);   // D6
        playTone(1319, 0.4, 'sine', 0.35, 0.75);   // E6
        vibrate([30, 50, 30, 50, 30, 100]);
    }

    function gameLose() {
        // Sad descending tones
        playTone(400, 0.2, 'triangle', 0.15);
        playTone(350, 0.2, 'triangle', 0.12, 0.2);
        playTone(300, 0.3, 'triangle', 0.10, 0.4);
        vibrate([40, 80, 40]);
    }

    function buttonTap() {
        // UI click feedback
        playTone(800, 0.03, 'sine', 0.1);
        vibrate(10);
    }

    function noMoves() {
        // Short buzzer for no valid moves
        playTone(250, 0.12, 'square', 0.1);
        playTone(200, 0.15, 'square', 0.08, 0.12);
    }

    // ─── Controls ───────────────────────────────────────────

    function toggle(on) { enabled = on; }
    function toggleHaptics(on) { hapticsEnabled = on; }
    function isEnabled() { return enabled; }

    // Auto-unlock AudioContext on first user interaction
    function unlock() {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        } else if (!audioCtx) {
            getCtx();
        }
    }

    return {
        diceRoll, diceLand, pieceMove, pieceEnter, pieceCapture,
        pieceFinish, extraTurn, threeSixes, gameWin, gameLose,
        buttonTap, noMoves, toggle, toggleHaptics, isEnabled, unlock
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LudoSounds;
} else if (typeof window !== 'undefined') {
    window.LudoSounds = LudoSounds;
    // Unlock audio on first touch/click
    document.addEventListener('touchstart', LudoSounds.unlock, { once: true });
    document.addEventListener('click', LudoSounds.unlock, { once: true });
}
