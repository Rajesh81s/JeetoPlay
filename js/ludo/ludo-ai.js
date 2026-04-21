/**
 * ludo-ai.js — JeetoPlay Ludo AI (Production-Grade Architecture v2)
 *
 * Layered AI architecture:
 *   ┌─────────────────────────────────────────────┐
 *   │  AIContext (per-match state, 4-player ready) │
 *   ├─────────────────────────────────────────────┤
 *   │  DifficultyProfile (tier-driven config)      │
 *   ├─────────────────────────────────────────────┤
 *   │  MoodProfile (per-match personality)         │
 *   ├─────────────────────────────────────────────┤
 *   │  GamePhaseModifier (EARLY/MID/LATE)          │
 *   ├─────────────────────────────────────────────┤
 *   │  MomentumEngine (comeback balancing)         │
 *   ├─────────────────────────────────────────────┤
 *   │  DecisionEngine (weighted move selection)    │
 *   ├─────────────────────────────────────────────┤
 *   │  DiceEngine (weighted partial-bias rolls)    │
 *   ├─────────────────────────────────────────────┤
 *   │  Observability (dev-mode logging + sims)     │
 *   └─────────────────────────────────────────────┘
 *
 * Rules:
 *   - ludo-engine.js remains the sole rule authority
 *   - AI only influences decision scoring and dice weighting
 *   - No hardcoded RED/BLUE assumptions (4-player ready)
 *   - All decisions < 5ms compute time
 */

'use strict';

// ─── Cached Engine Reference (performance) ──────────────────
let _engine = null;
function getEngine() {
    if (_engine) return _engine;
    _engine = (typeof LudoEngine !== 'undefined') ? LudoEngine :
        (typeof require !== 'undefined' ? require('./ludo-engine') : null);
    return _engine;
}

// ═══════════════════════════════════════════════════════════════
//  1. GAME PHASE DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Game phases drive subtle weight shifts across the match lifecycle.
 * Phase is determined by the AI's own board state.
 *
 * EARLY_GAME:  0–1 tokens active on board → focus on getting pieces out
 * MID_GAME:    2+ tokens active, none in home column → balanced strategy
 * LATE_GAME:   any token in home column OR ≥2 finished → race to finish
 */
const GAME_PHASES = {
    EARLY_GAME: 'EARLY_GAME',
    MID_GAME: 'MID_GAME',
    LATE_GAME: 'LATE_GAME'
};

/**
 * Phase weight modifiers — applied multiplicatively to scored categories.
 * Values close to 1.0 for subtle influence only.
 */
const PHASE_MODIFIERS = {
    EARLY_GAME: {
        captureMod: 0.85,   // Lower capture urgency early
        safetyMod: 1.15,   // Play safe while getting pieces out
        finishMod: 1.0,
        enterMod: 1.25,   // Prioritize getting tokens on board
        dangerMod: 0.90,   // Less afraid of danger early (expected)
        advanceMod: 0.95
    },
    MID_GAME: {
        captureMod: 1.0,
        safetyMod: 1.0,
        finishMod: 1.0,
        enterMod: 1.0,
        dangerMod: 1.0,
        advanceMod: 1.0
    },
    LATE_GAME: {
        captureMod: 0.90,   // Captures less important, focus on finishing
        safetyMod: 1.10,   // Protect advanced pieces
        finishMod: 1.20,   // Aggressively push to finish
        enterMod: 0.80,   // Less need to bring new pieces out
        dangerMod: 1.25,   // Strongly avoid losing advanced pieces
        advanceMod: 1.15    // Push pieces forward faster
    }
};

/**
 * Determine current game phase for a player.
 * @param {Object} state — game state
 * @param {string} player — any player color
 * @returns {string} EARLY_GAME | MID_GAME | LATE_GAME
 */
function getGamePhase(state, player) {
    const Engine = getEngine();
    if (!Engine) return GAME_PHASES.MID_GAME;

    const pieces = state.players[player].pieces;
    const onBoard = Engine.countOnBoard(state, player);
    const finished = Engine.countFinished(state, player);
    const inHomeCol = pieces.filter(p =>
        p >= Engine.BOARD_SIZE && p < Engine.BOARD_SIZE + Engine.HOME_COLUMN_LENGTH
    ).length;

    // Late game: any piece in home column OR 2+ finished
    if (inHomeCol > 0 || finished >= 2) return GAME_PHASES.LATE_GAME;

    // Early game: 0–1 tokens on the board
    if (onBoard <= 1) return GAME_PHASES.EARLY_GAME;

    return GAME_PHASES.MID_GAME;
}

// ═══════════════════════════════════════════════════════════════
//  2. DIFFICULTY PROFILES
// ═══════════════════════════════════════════════════════════════

/**
 * Structured config objects controlling AI behavior per tier.
 *
 * decisionWindow:   Score gap from top to include in eligible pool
 * sharpness:        Exponent for weighted random (score^sharpness)
 * mistakeRate:      Probability of controlled imperfection
 * maxBiasChain:     Max consecutive biased dice before forcing fair
 * captureBonus:     Multiplier on capture scores
 * safetyBonus:      Multiplier on safety scores
 * enterBonus:       Multiplier on base-exit scores
 * finishBonus:      Multiplier on finish/home-entry scores
 * spreadBonus:      Flat bonus for spreading tokens
 * closeScoreDrift:  Threshold for coin-flip between top-2 moves
 * riskTolerance:    Multiplier on danger penalties (lower = more cautious)
 * timingVariance:   Multiplier range on delay randomness
 * moodIntensity:    Scale factor for mood modifiers (lower = subtler moods)
 */
const DIFFICULTY_PROFILES = {
    LOW_STAKES: {
        decisionWindow: 120,
        sharpness: 1.1,
        mistakeRate: 0.12,
        maxBiasChain: 1,
        captureBonus: 1.0,
        safetyBonus: 1.20,
        enterBonus: 1.25,
        finishBonus: 1.0,
        spreadBonus: 50,
        closeScoreDrift: 50,
        riskTolerance: 0.70,
        timingVariance: 1.20,
        moodIntensity: 1.0
    },
    MID_STAKES: {
        decisionWindow: 70,
        sharpness: 1.5,
        mistakeRate: 0.06,
        maxBiasChain: 2,
        captureBonus: 1.15,
        safetyBonus: 1.05,
        enterBonus: 1.0,
        finishBonus: 1.05,
        spreadBonus: 25,
        closeScoreDrift: 40,
        riskTolerance: 0.85,
        timingVariance: 1.0,
        moodIntensity: 0.75
    },
    HIGH_STAKES: {
        decisionWindow: 35,
        sharpness: 2.0,
        mistakeRate: 0.02,
        maxBiasChain: 3,
        captureBonus: 1.30,
        safetyBonus: 0.95,
        enterBonus: 0.90,
        finishBonus: 1.10,
        spreadBonus: 10,
        closeScoreDrift: 25,
        riskTolerance: 1.0,
        timingVariance: 0.85,
        moodIntensity: 0.50
    }
};

/**
 * Map a bet amount to its difficulty profile.
 * @param {number} entryAmount — coin bet (10–5000)
 * @returns {Object} Difficulty profile config
 */
function getDifficultyProfile(entryAmount) {
    if (entryAmount <= 100) return DIFFICULTY_PROFILES.LOW_STAKES;
    if (entryAmount <= 500) return DIFFICULTY_PROFILES.MID_STAKES;
    return DIFFICULTY_PROFILES.HIGH_STAKES;
}

// ═══════════════════════════════════════════════════════════════
//  3. MOOD SYSTEM — per-match personality with intensity scaling
// ═══════════════════════════════════════════════════════════════

/**
 * Base mood modifiers. These are scaled by profile.moodIntensity
 * so HIGH_STAKES games have subtler personality shifts.
 *
 * captureMod  — capture scoring multiplier
 * safetyMod   — safety scoring multiplier
 * finishMod   — finish/home-entry scoring multiplier
 * enterMod    — base-exit scoring multiplier
 */
const AI_MOODS = {
    AGGRESSIVE: { captureMod: 1.08, safetyMod: 0.92, finishMod: 1.0, enterMod: 1.05, label: 'Aggressive' },
    DEFENSIVE: { captureMod: 0.92, safetyMod: 1.10, finishMod: 1.03, enterMod: 0.97, label: 'Defensive' },
    RUNNER: { captureMod: 0.95, safetyMod: 0.97, finishMod: 1.12, enterMod: 0.93, label: 'Runner' },
    STACKER: { captureMod: 0.97, safetyMod: 1.10, finishMod: 0.97, enterMod: 1.08, label: 'Stacker' }
};

const MOOD_KEYS = Object.keys(AI_MOODS);

/**
 * Get a mood's effective modifiers, scaled by intensity.
 * At moodIntensity=1.0, full effect. At 0.5, half the deviation.
 * @param {Object} baseMood — raw mood from AI_MOODS
 * @param {number} intensity — from profile.moodIntensity (0–1)
 * @returns {Object} Scaled mood modifiers
 */
function scaleMood(baseMood, intensity) {
    if (!baseMood || intensity >= 1.0) return baseMood;
    return {
        captureMod: 1 + (baseMood.captureMod - 1) * intensity,
        safetyMod: 1 + (baseMood.safetyMod - 1) * intensity,
        finishMod: 1 + (baseMood.finishMod - 1) * intensity,
        enterMod: 1 + (baseMood.enterMod - 1) * intensity,
        label: baseMood.label
    };
}

// ═══════════════════════════════════════════════════════════════
//  4. AI CONTEXT — per-match state (4-player ready)
// ═══════════════════════════════════════════════════════════════

/**
 * Create per-match AI context. Call once when a match starts.
 *
 * Designed for N-player support:
 *   - `aiPlayer` is the color the AI controls (any valid color)
 *   - `opponents` is an array of opponent color strings
 *   - No hardcoded RED/BLUE assumptions
 *
 * @param {number} betAmount — coin bet for this match
 * @param {string} [aiPlayer] — color AI controls (default: contextual)
 * @param {string[]} [opponents] — opponent color(s)
 * @returns {Object} AIContext
 */
function createAIContext(betAmount, aiPlayer, opponents) {
    const profile = getDifficultyProfile(betAmount);
    const moodKey = MOOD_KEYS[Math.floor(Math.random() * MOOD_KEYS.length)];
    const baseMood = AI_MOODS[moodKey];
    const scaledMood = scaleMood(baseMood, profile.moodIntensity);

    return {
        betAmount: betAmount || 0,
        profile,
        baseMood,
        mood: scaledMood,
        moodKey,
        aiPlayer: aiPlayer || null,
        opponents: opponents || [],

        // Tracking
        biasChainCount: 0,
        lastMoveTypes: [],
        turnCount: 0,
        momentum: 0,           // ∈ [-1, +1]: positive = AI ahead, negative = AI behind

        // Debug stats
        stats: {
            totalTurns: 0,
            biasTriggered: 0,
            mistakesMade: 0,
            driftDecisions: 0,
            phaseCounts: { EARLY_GAME: 0, MID_GAME: 0, LATE_GAME: 0 }
        }
    };
}

// ═══════════════════════════════════════════════════════════════
//  5. MOMENTUM ENGINE — natural match flow balancing
// ═══════════════════════════════════════════════════════════════

/**
 * Update momentum based on board state comparison.
 * momentum ∈ [-1, +1]:
 *   +1 = AI is dominating (far ahead)
 *    0 = even game
 *   -1 = AI is losing badly
 *
 * @param {Object} state — game state
 * @param {Object} ctx — AIContext
 */
function updateMomentum(state, ctx) {
    const Engine = getEngine();
    if (!Engine || !ctx) return;

    const aiPlayer = ctx.aiPlayer || state.currentTurn;
    const players = Object.keys(state.players);
    const opponentPlayers = players.filter(p => p !== aiPlayer);

    if (opponentPlayers.length === 0) return;

    const aiProgress = Engine.getPlayerProgress(state, aiPlayer);

    // Average opponent progress (supports N players)
    let oppProgressSum = 0;
    for (const opp of opponentPlayers) {
        oppProgressSum += Engine.getPlayerProgress(state, opp);
    }
    const avgOppProgress = oppProgressSum / opponentPlayers.length;

    // Raw momentum: difference normalized to [-1, +1]
    // At 100% vs 0% → momentum = +1. At 0% vs 100% → momentum = -1.
    const rawDiff = (aiProgress - avgOppProgress) / 100;
    ctx.momentum = Math.max(-1, Math.min(1, rawDiff));
}

/**
 * Get momentum-adjusted profile overrides.
 * When AI is ahead, slightly reduce sharpness (play more loosely).
 * When AI is behind, slightly increase aggression.
 *
 * @param {Object} ctx — AIContext
 * @returns {Object} Adjusted overrides for decisionWindow and sharpness
 */
function getMomentumAdjustments(ctx) {
    if (!ctx) return { windowMod: 0, sharpnessMod: 0, captureMod: 1.0 };

    const m = ctx.momentum;

    if (m > 0.3) {
        // AI ahead — relax slightly, allow more variance
        const factor = Math.min(m, 0.8);  // Cap effect
        return {
            windowMod: Math.floor(factor * 30),  // Widen decision window
            sharpnessMod: -factor * 0.2,             // Lower sharpness
            captureMod: 1.0 - factor * 0.08        // Slightly less aggressive
        };
    }

    if (m < -0.3) {
        // AI behind — sharpen up, play more aggressively
        const factor = Math.min(Math.abs(m), 0.8);
        return {
            windowMod: -Math.floor(factor * 20),  // Narrow decision window
            sharpnessMod: factor * 0.15,              // Increase sharpness
            captureMod: 1.0 + factor * 0.10         // More aggressive captures
        };
    }

    // Neutral
    return { windowMod: 0, sharpnessMod: 0, captureMod: 1.0 };
}

// ═══════════════════════════════════════════════════════════════
//  6. MOVE SCORING — base weights + phase/mood/momentum modifiers
// ═══════════════════════════════════════════════════════════════

/**
 * Score a move for the AI. Higher = better.
 *
 * Pure base scoring — unchanged foundational weights.
 * Phase, mood, momentum modifiers are layered on top in scoreMoveWithContext().
 */
function scoreMove(state, move, aiPlayer) {
    let score = 0;
    const Engine = getEngine();
    if (!Engine) return Math.random() * 10;

    const BOARD_SIZE = Engine.BOARD_SIZE;
    const players = Object.keys(state.players);
    const opponents = players.filter(p => p !== aiPlayer);

    // ── Priority 1: Finish a piece ──
    if (move.type === 'FINISH') {
        score += 1000;
        const currentFinished = Engine.countFinished(state, aiPlayer);
        if (currentFinished === 3) score += 5000;
    }

    // ── Priority 2: Enter home column ──
    if (move.type === 'HOME_ENTER' || move.type === 'HOME_MOVE') {
        score += 600;
        if (move.to >= BOARD_SIZE) {
            score += (move.to - BOARD_SIZE) * 30;
        }
    }

    // ── Priority 3: Capture an opponent ──
    if (move.captures) {
        score += 500;
        const capturedPlayer = move.captures.player;
        const capturedRelPos = state.players[capturedPlayer].pieces[move.captures.pieceIndex];
        if (capturedRelPos >= BOARD_SIZE - 10) {
            score += 300;
        }
    }

    // ── Priority 4: Get pieces out of base ──
    if (move.type === 'ENTER') {
        score += 150;
        const inBase = Engine.countInBase(state, aiPlayer);
        if (inBase === 4) score += 100;
    }

    // ── Priority 5: Advance & Safety ──
    if (move.to >= 0 && move.to < BOARD_SIZE) {
        score += move.to * 2;

        const absPos = Engine.toAbsolutePos(aiPlayer, move.to);
        if (Engine.isSafeSpot(absPos)) score += 80;

        // Danger check — penalize landing in ANY opponent's capture range
        for (const opp of opponents) {
            const oppPieces = state.players[opp].pieces;
            for (let j = 0; j < 4; j++) {
                const oppRelPos = oppPieces[j];
                if (oppRelPos >= 0 && oppRelPos < BOARD_SIZE) {
                    const oppAbsPos = Engine.toAbsolutePos(opp, oppRelPos);
                    const myAbsPos = Engine.toAbsolutePos(aiPlayer, move.to);
                    let dist = (myAbsPos - oppAbsPos + 52) % 52;
                    if (dist >= 1 && dist <= 6 && !Engine.isSafeSpot(myAbsPos)) {
                        score -= 150;
                        if (move.from >= BOARD_SIZE - 8) {
                            score -= 200;
                        }
                    }
                }
            }
        }

        if (move.to >= BOARD_SIZE - 6) {
            score += 100;
        }
    }

    // ── Tiebreaker ──
    if (move.from >= 0) score += move.from * 0.5;

    return score;
}

/**
 * Score a move with full context: base + phase + mood + momentum.
 *
 * This is the production scoring pipeline:
 *   1. Base score (scoreMove)
 *   2. Phase modifiers (EARLY/MID/LATE)
 *   3. Mood modifiers (Aggressive/Defensive/Runner/Stacker)
 *   4. Profile modifiers (capture/safety/enter/finish bonuses)
 *   5. Momentum adjustments
 *
 * @param {Object} state — game state
 * @param {Object} move — move object
 * @param {string} aiPlayer — any player color
 * @param {Object} ctx — AIContext
 * @param {Object} [turnCtx] — Pre-computed per-turn context {phase, phaseMod, momentumAdj}
 * @returns {number} Final weighted score
 */
function scoreMoveWithContext(state, move, aiPlayer, ctx, turnCtx) {
    let score = scoreMove(state, move, aiPlayer);
    if (!ctx) return score;

    const Engine = getEngine();
    const profile = ctx.profile;
    const mood = ctx.mood;

    // Use pre-computed per-turn context if available (avoids redundant getGamePhase calls)
    const phase = turnCtx ? turnCtx.phase : getGamePhase(state, aiPlayer);
    const phaseMod = turnCtx ? turnCtx.phaseMod : (PHASE_MODIFIERS[phase] || PHASE_MODIFIERS.MID_GAME);
    const momentumAdj = turnCtx ? turnCtx.momentumAdj : getMomentumAdjustments(ctx);

    // ── Apply modifiers by move category ──

    if (move.type === 'FINISH' || move.type === 'HOME_ENTER' || move.type === 'HOME_MOVE') {
        score *= phaseMod.finishMod * mood.finishMod * (profile.finishBonus || 1.0);
    }

    if (move.captures) {
        score *= phaseMod.captureMod * mood.captureMod * (profile.captureBonus || 1.0) * momentumAdj.captureMod;
    }

    if (move.type === 'ENTER') {
        score *= phaseMod.enterMod * mood.enterMod * (profile.enterBonus || 1.0);

        // Spread bonus: incentivize getting multiple tokens on board
        if (Engine && profile.spreadBonus) {
            const onBoard = Engine.countOnBoard(state, aiPlayer);
            if (onBoard <= 1) {
                score += profile.spreadBonus;
            }
        }
    }

    // Safety and advance modifier on track moves
    if (move.type === 'MOVE' && !move.captures) {
        if (Engine) {
            const absPos = Engine.toAbsolutePos(aiPlayer, move.to);
            if (absPos >= 0 && Engine.isSafeSpot(absPos)) {
                score *= phaseMod.safetyMod * mood.safetyMod * (profile.safetyBonus || 1.0);
            }
        }
        // Advance modifier applies to forward movement on the track
        if (move.to > move.from) {
            score *= phaseMod.advanceMod;
        }
    }

    return score;
}

// ═══════════════════════════════════════════════════════════════
//  7. DECISION ENGINE — weighted move selection
// ═══════════════════════════════════════════════════════════════

/**
 * Production weighted move selection.
 *
 * Pipeline:
 *   1. Score all moves with full context (phase + mood + momentum)
 *   2. Apply momentum-adjusted decision window + sharpness
 *   3. Close-score drift (top-2 gap < threshold → coin flip)
 *   4. Controlled imperfection (mistake only when safe)
 *   5. Weighted random pick from eligible pool (score^sharpness)
 *
 * @param {Object} state — game state
 * @param {Array} validMoves — from getValidMoves()
 * @param {string} aiPlayer — any player color
 * @param {Object} [ctx] — AIContext
 * @returns {Object} The selected move
 */
function weightedDecision(state, validMoves, aiPlayer, ctx) {
    if (validMoves.length === 0) return null;
    if (validMoves.length === 1) {
        if (ctx) updateContext(ctx, validMoves[0]);
        return validMoves[0];
    }

    // Fallback context
    if (!ctx) ctx = createAIContext(0);

    // Update momentum before deciding
    updateMomentum(state, ctx);

    const profile = ctx.profile;
    const momentumAdj = getMomentumAdjustments(ctx);

    // Effective profile values (momentum-adjusted)
    const effectiveWindow = Math.max(10, profile.decisionWindow + momentumAdj.windowMod);
    const effectiveSharpness = Math.max(0.5, profile.sharpness + momentumAdj.sharpnessMod);

    // ── Pre-compute per-turn context (once, not per-move) ──
    const phase = getGamePhase(state, aiPlayer);
    const turnCtx = {
        phase,
        phaseMod: PHASE_MODIFIERS[phase] || PHASE_MODIFIERS.MID_GAME,
        momentumAdj
    };

    // Track phase per-turn (not per-move) for accurate stats
    if (ctx.stats) ctx.stats.phaseCounts[phase] = (ctx.stats.phaseCounts[phase] || 0) + 1;

    // ── Step 1: Score all moves with full context ──
    const scored = validMoves.map(move => ({
        move,
        score: scoreMoveWithContext(state, move, aiPlayer, ctx, turnCtx)
    }));

    scored.sort((a, b) => b.score - a.score);
    const topScore = scored[0].score;

    // ── Step 2: Close-score drift ──
    if (scored.length >= 2) {
        const gap = scored[0].score - scored[1].score;
        if (gap < profile.closeScoreDrift && gap >= 0) {
            if (Math.random() < 0.45) {
                if (ctx.stats) ctx.stats.driftDecisions++;
                logAIChoice(ctx, state, aiPlayer, scored[1], scored, 'DRIFT');
                updateContext(ctx, scored[1].move);
                return scored[1].move;
            }
        }
    }

    // ── Step 3: Controlled mistake ──
    if (scored.length >= 2 && Math.random() < profile.mistakeRate) {
        const gapForMistake = topScore - scored[scored.length - 1].score;
        const topMove = scored[0].move;
        const isGameCritical = topMove.type === 'FINISH' ||
            (topMove.type === 'HOME_ENTER' && topMove.from >= 45) ||
            topScore > 2000;

        if (!isGameCritical && gapForMistake < 400) {
            const eligible = scored.filter(s => s.score >= topScore - effectiveWindow);
            if (eligible.length >= 2) {
                const mistakePool = eligible.slice(1);
                const pick = mistakePool[Math.floor(Math.random() * mistakePool.length)];
                if (ctx.stats) ctx.stats.mistakesMade++;
                logAIChoice(ctx, state, aiPlayer, pick, scored, 'MISTAKE');
                updateContext(ctx, pick.move);
                return pick.move;
            }
        }
    }

    // ── Step 4: Build eligible pool ──
    const eligible = scored.filter(s => s.score >= topScore - effectiveWindow);

    if (eligible.length === 1) {
        logAIChoice(ctx, state, aiPlayer, eligible[0], scored, 'ONLY_ELIGIBLE');
        updateContext(ctx, eligible[0].move);
        return eligible[0].move;
    }

    // ── Step 5: Weighted random pick ──
    const minScore = Math.min(...eligible.map(e => e.score));
    const offset = minScore < 1 ? (1 - minScore) : 0;

    const weights = eligible.map(e => Math.pow(e.score + offset, effectiveSharpness));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let roll = Math.random() * totalWeight;
    for (let i = 0; i < eligible.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
            logAIChoice(ctx, state, aiPlayer, eligible[i], scored, 'WEIGHTED');
            updateContext(ctx, eligible[i].move);
            return eligible[i].move;
        }
    }

    // Fallback
    updateContext(ctx, eligible[0].move);
    return eligible[0].move;
}

/**
 * Update AI context after a decision.
 */
function updateContext(ctx, move) {
    if (!ctx) return;
    ctx.turnCount++;
    if (ctx.stats) ctx.stats.totalTurns++;
    ctx.lastMoveTypes.push(move.type);
    if (ctx.lastMoveTypes.length > 10) ctx.lastMoveTypes.shift();
}

// ═══════════════════════════════════════════════════════════════
//  8. HOUSE EDGE TABLE — unchanged
// ═══════════════════════════════════════════════════════════════

const HOUSE_EDGE_TABLE = {
    10: 0.08,
    20: 0.10,
    50: 0.12,
    100: 0.15,
    200: 0.17,
    500: 0.20,
    1000: 0.25,
    2000: 0.28,
    5000: 0.30
};

function getHouseEdge(betAmount) {
    const MIN_EDGE = 0.06;

    if (HOUSE_EDGE_TABLE[betAmount] !== undefined) {
        return HOUSE_EDGE_TABLE[betAmount];
    }

    const tiers = Object.keys(HOUSE_EDGE_TABLE).map(Number).sort((a, b) => a - b);

    if (betAmount <= tiers[0]) return Math.max(HOUSE_EDGE_TABLE[tiers[0]], MIN_EDGE);
    if (betAmount >= tiers[tiers.length - 1]) return HOUSE_EDGE_TABLE[tiers[tiers.length - 1]];

    for (let i = 0; i < tiers.length - 1; i++) {
        if (betAmount >= tiers[i] && betAmount <= tiers[i + 1]) {
            const ratio = (betAmount - tiers[i]) / (tiers[i + 1] - tiers[i]);
            const edge = HOUSE_EDGE_TABLE[tiers[i]] + ratio * (HOUSE_EDGE_TABLE[tiers[i + 1]] - HOUSE_EDGE_TABLE[tiers[i]]);
            return Math.max(edge, MIN_EDGE);
        }
    }

    return MIN_EDGE;
}

// ═══════════════════════════════════════════════════════════════
//  9. DICE ENGINE — weighted partial-bias with anti-streak
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a weighted dice roll for the AI.
 *
 * Process:
 *   1. Roll fair die
 *   2. Check anti-streak chain limit
 *   3. If bias triggers: evaluate all 6 outcomes, pick from top 2–3
 *   4. Track chain count
 *
 * @param {Object} state — game state
 * @param {string} aiPlayer — any player color
 * @param {number} betAmount — coin bet
 * @param {Object} [ctx] — AIContext
 * @returns {number} Dice value 1–6
 */
function weightedDiceRoll(state, aiPlayer, betAmount, ctx) {
    const Engine = getEngine();

    const houseEdge = typeof betAmount === 'number' && betAmount > 0
        ? getHouseEdge(betAmount)
        : 0.12;

    const fairRoll = Math.floor(Math.random() * 6) + 1;

    // ── Anti-streak check ──
    const maxChain = ctx ? ctx.profile.maxBiasChain : 2;
    const chainCount = ctx ? ctx.biasChainCount : 0;

    if (chainCount >= maxChain) {
        if (ctx) ctx.biasChainCount = 0;
        return fairRoll;
    }

    // ── Bias trigger ──
    if (Math.random() > houseEdge || !Engine) {
        if (ctx) ctx.biasChainCount = 0;
        return fairRoll;
    }

    // ── Evaluate all 6 dice outcomes ──
    const diceScores = [];
    for (let d = 1; d <= 6; d++) {
        const moves = Engine.getValidMoves(state, d);
        if (moves.length === 0) {
            diceScores.push({ dice: d, score: -1000 });
            continue;
        }
        const moveScores = moves.map(m => scoreMove(state, m, aiPlayer));
        diceScores.push({ dice: d, score: Math.max(...moveScores) });
    }

    diceScores.sort((a, b) => b.score - a.score);

    // Weighted pick from top 3 viable outcomes
    const candidates = diceScores.filter(d => d.score > -1000).slice(0, 3);

    if (candidates.length === 0) {
        if (ctx) ctx.biasChainCount = 0;
        return fairRoll;
    }

    const BIAS_WEIGHTS = [0.50, 0.30, 0.20];
    let roll = Math.random();
    let selectedDice = candidates[0].dice;

    for (let i = 0; i < candidates.length; i++) {
        roll -= (BIAS_WEIGHTS[i] || 0);
        if (roll <= 0) {
            selectedDice = candidates[i].dice;
            break;
        }
    }

    if (ctx) {
        ctx.biasChainCount++;
        if (ctx.stats) ctx.stats.biasTriggered++;
    }

    return selectedDice;
}

// ═══════════════════════════════════════════════════════════════
//  10. AI TIMING — mood + phase influenced delays
// ═══════════════════════════════════════════════════════════════

/**
 * Think delay — before rolling dice.
 * @param {Object} [ctx] — AIContext
 * @returns {number} milliseconds
 */
function getThinkDelay(ctx) {
    const base = 2000 + Math.floor(Math.random() * 3000);
    if (!ctx || !ctx.moodKey) return base;

    const variance = ctx.profile ? ctx.profile.timingVariance || 1.0 : 1.0;
    let moodMul = 1.0;
    switch (ctx.moodKey) {
        case 'AGGRESSIVE': moodMul = 0.75; break;
        case 'DEFENSIVE': moodMul = 1.15; break;
        case 'RUNNER': moodMul = 0.85; break;
        case 'STACKER': moodMul = 1.05; break;
    }

    return Math.floor(base * moodMul * variance);
}

/**
 * Dice animation duration.
 */
function getDiceDelay(ctx) {
    return 1200 + Math.floor(Math.random() * 1000);
}

/**
 * Move delay — after dice, before piece moves.
 * @param {Object} [ctx] — AIContext
 * @returns {number} milliseconds
 */
function getMoveDelay(ctx) {
    const base = 800 + Math.floor(Math.random() * 1000);
    if (!ctx || !ctx.moodKey) return base;

    const variance = ctx.profile ? ctx.profile.timingVariance || 1.0 : 1.0;
    let moodMul = 1.0;
    switch (ctx.moodKey) {
        case 'AGGRESSIVE': moodMul = 0.80; break;
        case 'DEFENSIVE': moodMul = 1.20; break;
        default: break;
    }

    return Math.floor(base * moodMul * variance);
}

// ═══════════════════════════════════════════════════════════════
//  11. OBSERVABILITY — dev-mode logging + match simulation
// ═══════════════════════════════════════════════════════════════

/** Dev mode flag — set to true to enable debug logging */
let _devMode = false;

function setDevMode(enabled) { _devMode = !!enabled; }
function isDevMode() { return _devMode; }

/**
 * Log an AI choice (dev mode only).
 * @param {Object} ctx — AIContext
 * @param {Object} state — game state
 * @param {string} aiPlayer — color
 * @param {Object} chosen — { move, score }
 * @param {Array} allScored — all scored moves
 * @param {string} reason — DRIFT | MISTAKE | WEIGHTED | ONLY_ELIGIBLE
 */
function logAIChoice(ctx, state, aiPlayer, chosen, allScored, reason) {
    if (!_devMode) return;

    const Engine = getEngine();
    const phase = Engine ? getGamePhase(state, aiPlayer) : 'UNKNOWN';
    const info = {
        turn: ctx ? ctx.turnCount : '?',
        tier: ctx ? ctx.betAmount : '?',
        phase,
        mood: ctx ? ctx.moodKey : '?',
        momentum: ctx ? ctx.momentum.toFixed(2) : '?',
        reason,
        selectedScore: chosen ? chosen.score.toFixed(1) : '?',
        alternativeScores: allScored ? allScored.map(s => s.score.toFixed(1)).join(', ') : '',
        biasChain: ctx ? ctx.biasChainCount : 0,
        moveType: chosen && chosen.move ? chosen.move.type : '?'
    };

    console.log('[LudoAI]', JSON.stringify(info));
}

/**
 * Simulate AI vs AI matches for balance testing.
 *
 * Runs matchCount games at a given entry amount and returns aggregate stats.
 * Both players use the AI decision engine with independent contexts.
 *
 * @param {number} entryAmount — coin tier to simulate
 * @param {number} matchCount — number of matches to run
 * @param {number} [maxTurns=500] — safety cap to prevent infinite loops
 * @returns {Object} Simulation results
 */
function simulateAIMatches(entryAmount, matchCount, maxTurns) {
    const Engine = getEngine();
    if (!Engine) return { error: 'Engine not available' };

    maxTurns = maxTurns || 500;
    const results = {
        entryAmount,
        matchCount,
        wins: {},
        avgTurns: 0,
        avgCaptures: 0,
        biasRate: 0,
        phaseDistribution: { EARLY_GAME: 0, MID_GAME: 0, LATE_GAME: 0 },
        completedMatches: 0,
        stalledMatches: 0
    };

    let totalTurns = 0;
    let totalCaptures = 0;
    let totalBias = 0;
    let totalBiasTurns = 0;

    for (let m = 0; m < matchCount; m++) {
        const state = Engine.createGameState('RED_AI', 'BLUE_AI');
        state.status = 'IN_PROGRESS';

        const ctxRed = createAIContext(entryAmount, 'RED', ['BLUE']);
        const ctxBlue = createAIContext(entryAmount, 'BLUE', ['RED']);
        let turns = 0;

        // Use mutable state reference — rollDice/applyMove return deep-cloned states
        let simState = state;

        while (simState.status !== 'COMPLETED' && turns < maxTurns) {
            turns++;
            const player = simState.currentTurn;
            const ctx = player === 'RED' ? ctxRed : ctxBlue;

            // Roll dice
            const diceVal = weightedDiceRoll(simState, player, entryAmount, ctx);
            const rollResult = Engine.rollDice(simState, diceVal);
            simState = rollResult.state;  // Replace with deep-cloned result

            if (rollResult.autoSkip) continue;

            // Pick move
            const validMoves = Engine.getValidMoves(simState, rollResult.diceValue);
            const move = weightedDecision(simState, validMoves, player, ctx);

            if (!move) continue;

            const moveResult = Engine.applyMove(simState, move.pieceIndex, rollResult.diceValue);

            // Track captures
            const captureEvent = moveResult.events.find(e => e.type === 'PIECE_CAPTURED');
            if (captureEvent) totalCaptures++;

            simState = moveResult.state;  // Replace with deep-cloned result
        }

        if (simState.status === 'COMPLETED' && simState.winner) {
            results.wins[simState.winner] = (results.wins[simState.winner] || 0) + 1;
            results.completedMatches++;
        } else {
            results.stalledMatches++;
        }

        totalTurns += turns;
        totalBias += ctxRed.stats.biasTriggered + ctxBlue.stats.biasTriggered;
        totalBiasTurns += ctxRed.stats.totalTurns + ctxBlue.stats.totalTurns;

        // Aggregate phase counts
        for (const phase in ctxRed.stats.phaseCounts) {
            results.phaseDistribution[phase] += (ctxRed.stats.phaseCounts[phase] || 0) +
                (ctxBlue.stats.phaseCounts[phase] || 0);
        }
    }

    results.avgTurns = matchCount > 0 ? Math.round(totalTurns / matchCount) : 0;
    results.avgCaptures = matchCount > 0 ? (totalCaptures / matchCount).toFixed(1) : 0;
    results.biasRate = totalBiasTurns > 0 ? (totalBias / totalBiasTurns * 100).toFixed(1) + '%' : '0%';

    return results;
}

// ═══════════════════════════════════════════════════════════════
//  12. AI NAMES
// ═══════════════════════════════════════════════════════════════

const AI_NAMES = [
    'Rajesh Kumar', 'Priya Sharma', 'Amit Patel', 'Sneha Reddy',
    'Vikram Singh', 'Pooja Verma', 'Rohit Joshi', 'Neha Gupta',
    'Arjun Mehta', 'Kavita Das', 'Sunil Yadav', 'Riya Chauhan',
    'Deepak Mishra', 'Anita Thakur', 'Manish Tiwari', 'Swati Nair',
    'Rahul Dubey', 'Sonal Pillai', 'Karan Bhatt', 'Divya Iyer',
    'Ashish Pandey', 'Shruti Saxena', 'Gaurav Rathore', 'Meera Jain',
    'Nitin Agarwal', 'Pallavi Sinha', 'Vivek Chandra', 'Anjali Bose',
    'Sanjay Deshmukh', 'Tanvi Kulkarni', 'Sachin Pawar', 'Varsha More',
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun',
    'Reyansh', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva',
    'Ananya', 'Diya', 'Myra', 'Sara', 'Aanya',
    'Aadhya', 'Isha', 'Kiara', 'Riya', 'Pihu',
    'Raj', 'Sunny', 'Lucky', 'Prince', 'Vishal',
    'Mohit', 'Tushar', 'Harsh', 'Akash', 'Rohan',
    'Simran', 'Nisha', 'Komal', 'Kajal', 'Payal',
    'Tanmay', 'Yash', 'Dev', 'Jay', 'Dhruv'
];

function getAIName() {
    return AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
}

// ═══════════════════════════════════════════════════════════════
//  13. BACKWARD-COMPATIBLE ALIASES
// ═══════════════════════════════════════════════════════════════

function selectBestMove(state, validMoves, aiPlayer, difficulty) {
    let fakeAmount = 200;
    if (difficulty === 'EASY') fakeAmount = 20;
    else if (difficulty === 'HARD') fakeAmount = 2000;
    const ctx = createAIContext(fakeAmount);
    return weightedDecision(state, validMoves, aiPlayer, ctx);
}

function biasedDiceRoll(state, aiPlayer, betAmount) {
    return weightedDiceRoll(state, aiPlayer, betAmount, null);
}

/**
 * Legacy applyMoodModifiers — redirects to scoreMoveWithContext.
 */
function applyMoodModifiers(baseScore, move, ctx, state, aiPlayer) {
    if (!ctx) return baseScore;
    return scoreMoveWithContext(state, move, aiPlayer, ctx);
}

// ═══════════════════════════════════════════════════════════════
//  14. EXPORTS
// ═══════════════════════════════════════════════════════════════

const LudoAI = {
    // ── Core API ──
    weightedDecision,
    weightedDiceRoll,
    createAIContext,
    getDifficultyProfile,
    scoreMoveWithContext,

    // ── Game Phase ──
    getGamePhase,
    GAME_PHASES,
    PHASE_MODIFIERS,

    // ── Momentum ──
    updateMomentum,
    getMomentumAdjustments,

    // ── Scoring ──
    scoreMove,
    applyMoodModifiers,

    // ── Mood ──
    scaleMood,
    AI_MOODS,
    MOOD_KEYS,

    // ── House Edge ──
    getHouseEdge,
    HOUSE_EDGE_TABLE,

    // ── Timing ──
    getThinkDelay,
    getDiceDelay,
    getMoveDelay,

    // ── Observability ──
    setDevMode,
    isDevMode,
    logAIChoice,
    simulateAIMatches,

    // ── Names ──
    getAIName,
    AI_NAMES,

    // ── Config ──
    DIFFICULTY_PROFILES,

    // ── Backward-compatible aliases ──
    selectBestMove,
    biasedDiceRoll
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LudoAI;
} else if (typeof window !== 'undefined') {
    window.LudoAI = LudoAI;
}
