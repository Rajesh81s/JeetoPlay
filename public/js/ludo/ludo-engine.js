/**
 * ludo-engine.js — JeetoPlay Ludo Rules Engine
 * 
 * Server-authoritative game logic for 2-player Ludo.
 * Pure JavaScript — ZERO dependencies on Firebase, DOM, or platform APIs.
 * Runs identically on server (Cloud Functions) and client (browser).
 *
 * Standard Ludo Rules:
 *   - 2 players (RED vs BLUE), 4 pieces each
 *   - Roll 6 to enter a piece from base onto the board
 *   - Normal clockwise movement around the 52-cell track
 *   - Player-specific home columns (6 cells) leading to finish
 *   - Exact roll required to enter finish
 *   - Capturing opponent sends their piece back to base
 *   - Safe spots (starting squares + star positions) prevent captures
 *   - Extra turn on: rolling a 6, capturing an opponent's piece
 *   - Three consecutive 6s → turn forfeited, no piece moved
 *   - First player to get all 4 pieces to FINISH wins
 */

'use strict';

// ─── Board Constants ────────────────────────────────────────

const BOARD_SIZE = 52;              // Total cells on the main circular track
const HOME_COLUMN_LENGTH = 6;       // 6 cells in home column
const PIECES_PER_PLAYER = 4;
const MAX_CONSECUTIVE_SIXES = 3;    // 3 sixes in a row = turn lost

// Piece position constants
const POS_BASE = -1;                // Piece is in base (not yet on board)
const POS_FINISHED = 99;            // Piece has reached finish

// ── HOME-ENTRY JUNCTION ──
// Position BOARD_SIZE-1 (relPos 51) is the home-entry junction.
// Tokens NEVER stop at this position — when a move reaches or passes
// it, the token transitions directly into the home column (52+).
// This preserves the full 52-cell outer track while ensuring tokens
// enter the home column smoothly without visual reversal.
const HOME_JUNCTION = BOARD_SIZE - 1;  // 51 — junction point (pass-through)

// Starting cell index on the MAIN TRACK for each player
// RED starts at cell 0, BLUE starts at cell 26 (opposite side)
const PLAYER_START = {
    RED: 1,     // First cell after leaving base
    BLUE: 27    // First cell after leaving base (52/2 + 1)
};

// Absolute positions of safe spots (star cells on the board)
// Entry cells where pieces come out of base ARE the safe/star cells
const SAFE_SPOTS = new Set([
    0,          // RED entry (absPos where relPos 0 maps to)
    8,          // Intermediate star
    13,         // GREEN entry
    21,         // Intermediate star
    26,         // BLUE entry (absPos where relPos 0 maps to)
    34,         // Intermediate star
    39,         // YELLOW entry
    47          // Intermediate star
]);

// ─── Deep Clone Utility ─────────────────────────────────────

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// ─── Game State Factory ─────────────────────────────────────

/**
 * Create a fresh game state for a new match
 * @param {string} redPlayerId - UID for RED player
 * @param {string} bluePlayerId - UID for BLUE player (or 'AI' for bot)
 * @returns {Object} Initial game state
 */
function createGameState(redPlayerId, bluePlayerId) {
    return {
        players: {
            RED: {
                id: redPlayerId,
                // Each piece tracks its position relative to this player's path
                // -1 = in base, 0-51 = on main track, 52-57 = home column, 99 = finished
                pieces: [POS_BASE, POS_BASE, POS_BASE, POS_BASE]
            },
            BLUE: {
                id: bluePlayerId,
                pieces: [POS_BASE, POS_BASE, POS_BASE, POS_BASE]
            }
        },
        currentTurn: 'RED',
        diceValue: null,
        mustRollDice: true,         // Player must roll before moving
        consecutiveSixes: 0,
        extraTurn: false,           // When true, same player rolls again
        status: 'WAITING',          // WAITING → IN_PROGRESS → COMPLETED
        winner: null,
        moveCount: 0,
        moves: [],                  // Full move history for replay
        createdAt: Date.now(),
        lastMoveAt: null,
        turnStartedAt: Date.now(),
        turnTimeoutMs: 30000        // 30 seconds per turn
    };
}

// ─── Position Helpers ───────────────────────────────────────

/**
 * Convert a player-relative position to an absolute board position.
 * Each player has their own track: 0-51 main track, 52-57 home column.
 * This converts to absolute (0-51) for collision detection.
 *
 * @param {string} player - 'RED' or 'BLUE'
 * @param {number} relPos - Player-relative position (0-51 on main track)
 * @returns {number} Absolute board position (0-51)
 */
function toAbsolutePos(player, relPos) {
    if (relPos < 0 || relPos >= BOARD_SIZE + HOME_COLUMN_LENGTH + 1) return -1;
    if (relPos >= BOARD_SIZE) return -1; // Home column — no absolute pos (can't be captured)

    const offset = PLAYER_START[player] - 1; // RED: 0, BLUE: 26
    return (relPos + offset) % BOARD_SIZE;
}

/**
 * Check if a player-relative position is in the home column
 */
function isInHomeColumn(relPos) {
    return relPos >= BOARD_SIZE && relPos < BOARD_SIZE + HOME_COLUMN_LENGTH;
}

/**
 * Check if a piece is finished (reached the end of home column)
 */
function isFinished(relPos) {
    return relPos === POS_FINISHED;
}

/**
 * Check if a piece is still in base
 */
function isInBase(relPos) {
    return relPos === POS_BASE;
}

/**
 * Check if an absolute position is a safe spot
 */
function isSafeSpot(absPos) {
    return SAFE_SPOTS.has(absPos);
}

/**
 * Get the position a piece would move to given a dice roll
 * Returns null if the move is invalid
 *
 * @param {string} player - 'RED' or 'BLUE'
 * @param {number} currentRelPos - Current player-relative position
 * @param {number} diceValue - Dice roll (1-6)
 * @returns {number|null} New position, or null if invalid
 */
function calculateNewPosition(player, currentRelPos, diceValue) {
    // From BASE: only a 6 can bring a piece out
    if (currentRelPos === POS_BASE) {
        if (diceValue === 6) return 0; // Enter at relative position 0
        return null;
    }

    // Already finished — can't move
    if (currentRelPos === POS_FINISHED) return null;

    const newPos = currentRelPos + diceValue;

    // Moving on the main track (0-51)
    if (currentRelPos < BOARD_SIZE) {
        // ── HOME-ENTRY JUNCTION (pos 51) ──
        // Position 51 is a pass-through junction. When a move reaches
        // or passes this point, the token transitions into the home
        // column. Steps beyond the junction count inside the column.
        //   newPos 51 → homeCol 52 (first cell)
        //   newPos 52 → homeCol 53 (second cell)
        //   etc.
        if (newPos >= HOME_JUNCTION) {
            const homeColPos = BOARD_SIZE + (newPos - HOME_JUNCTION);
            if (homeColPos === BOARD_SIZE + HOME_COLUMN_LENGTH) {
                return POS_FINISHED; // Exact roll into finish!
            }
            if (homeColPos < BOARD_SIZE + HOME_COLUMN_LENGTH) {
                return homeColPos; // Entering home column
            }
            return null; // Overshot the finish
        }
        return newPos; // Normal track movement (0-50)
    }

    // Already in home column (52-57)
    if (isInHomeColumn(currentRelPos)) {
        if (newPos === BOARD_SIZE + HOME_COLUMN_LENGTH) {
            return POS_FINISHED; // Exact roll to finish
        }
        if (newPos < BOARD_SIZE + HOME_COLUMN_LENGTH) {
            return newPos; // Moving forward in home column
        }
        // Overshot — invalid
        return null;
    }

    return null;
}

// ─── Move Validation ────────────────────────────────────────

/**
 * Get all valid moves for the current player given a dice roll.
 *
 * @param {Object} state - Current game state
 * @param {number} diceValue - The dice value rolled
 * @returns {Array} Array of valid move objects
 *   Each: { pieceIndex, from, to, type, captures }
 *   type: 'ENTER' | 'MOVE' | 'HOME_ENTER' | 'HOME_MOVE' | 'FINISH'
 */
function getValidMoves(state, diceValue) {
    const player = state.currentTurn;
    const opponent = player === 'RED' ? 'BLUE' : 'RED';
    const pieces = state.players[player].pieces;
    const opponentPieces = state.players[opponent].pieces;
    const moves = [];

    for (let i = 0; i < PIECES_PER_PLAYER; i++) {
        const currentPos = pieces[i];
        const newPos = calculateNewPosition(player, currentPos, diceValue);

        if (newPos === null) continue; // Invalid move for this piece

        // Determine move type
        let type;
        if (currentPos === POS_BASE && newPos === 0) {
            type = 'ENTER';
        } else if (newPos === POS_FINISHED) {
            type = 'FINISH';
        } else if (newPos >= BOARD_SIZE) {
            type = currentPos < BOARD_SIZE ? 'HOME_ENTER' : 'HOME_MOVE';
        } else {
            type = 'MOVE';
        }

        // Check for captures and blocking
        let captures = null;

        // Helper: check if a position has a multi-token stack (2+ pieces total
        // from ANY color). A box with 2+ tokens = SAFE, no captures allowed.
        // Safety is based on the BOX, not the COLOR that created the stack.
        // We exclude the moving piece itself (pieceIndex i) from the count.
        function isStackSafe(absPos) {
            let count = 0;

            // Count current player's pieces at this position (excluding the moving piece)
            for (let k = 0; k < PIECES_PER_PLAYER; k++) {
                if (k === i) continue; // Don't count the piece that's moving
                const myRelPos = pieces[k];
                if (myRelPos >= 0 && myRelPos < BOARD_SIZE) {
                    if (toAbsolutePos(player, myRelPos) === absPos) {
                        count++;
                    }
                }
            }

            // Count opponent's pieces at this position
            for (let k = 0; k < PIECES_PER_PLAYER; k++) {
                const oRelPos = opponentPieces[k];
                if (oRelPos >= 0 && oRelPos < BOARD_SIZE) {
                    if (toAbsolutePos(opponent, oRelPos) === absPos) {
                        count++;
                    }
                }
            }

            return count >= 2; // 2+ tokens at this box = SAFE
        }

        if (newPos >= 0 && newPos < BOARD_SIZE) {
            const absNewPos = toAbsolutePos(player, newPos);

            // No captures on safe spots (stars + entry cells) or
            // on tiles with 2+ tokens (any color mix = stack-safe box)
            if (!isSafeSpot(absNewPos) && !isStackSafe(absNewPos)) {
                for (let j = 0; j < PIECES_PER_PLAYER; j++) {
                    const oppRelPos = opponentPieces[j];
                    if (oppRelPos >= 0 && oppRelPos < BOARD_SIZE) {
                        const oppAbsPos = toAbsolutePos(opponent, oppRelPos);
                        if (oppAbsPos === absNewPos) {
                            captures = { player: opponent, pieceIndex: j };
                            break;
                        }
                    }
                }
            }
        }
        // When entering the home/winning column (newPos >= BOARD_SIZE),
        // the token goes DIRECTLY into the column — no captures on the
        // outer main track. Enemies outside the winning path are ignored.

        // Can't land on own piece
        let selfBlocked = false;
        for (let j = 0; j < PIECES_PER_PLAYER; j++) {
            if (j === i) continue;
            if (pieces[j] === newPos && newPos !== POS_FINISHED) {
                // Two of your own pieces at the same relative position
                // In standard Ludo, this is allowed (stacking). 
                // But some variants don't allow it. We'll allow it.
                // selfBlocked = true; break;
            }
        }
        if (selfBlocked) continue;

        moves.push({
            pieceIndex: i,
            from: currentPos,
            to: newPos,
            type,
            captures
        });
    }

    return moves;
}

// ─── Apply Move ─────────────────────────────────────────────

/**
 * Apply a validated move to the game state.
 * Returns a NEW state object (immutable — original is not modified).
 *
 * @param {Object} state - Current game state
 * @param {number} pieceIndex - Which piece to move (0-3)
 * @param {number} diceValue - The dice roll
 * @returns {{ state: Object, events: Array }} New state + events that occurred
 */
function applyMove(state, pieceIndex, diceValue) {
    const newState = deepClone(state);
    const player = newState.currentTurn;
    const opponent = player === 'RED' ? 'BLUE' : 'RED';
    const events = [];

    // Validate the move exists
    const validMoves = getValidMoves(state, diceValue);
    const move = validMoves.find(m => m.pieceIndex === pieceIndex);

    if (!move) {
        return { state: newState, events: [{ type: 'INVALID_MOVE' }] };
    }

    // Execute the move
    const oldPos = newState.players[player].pieces[pieceIndex];
    newState.players[player].pieces[pieceIndex] = move.to;

    events.push({
        type: 'PIECE_MOVED',
        player,
        pieceIndex,
        from: oldPos,
        to: move.to,
        moveType: move.type
    });

    // Handle capture
    let didCapture = false;
    if (move.captures) {
        const { player: capturedPlayer, pieceIndex: capturedPiece } = move.captures;
        newState.players[capturedPlayer].pieces[capturedPiece] = POS_BASE;
        didCapture = true;

        events.push({
            type: 'PIECE_CAPTURED',
            capturedPlayer,
            capturedPiece,
            capturedAt: move.to,
            capturedBy: player
        });
    }

    // Handle finish
    if (move.to === POS_FINISHED) {
        events.push({
            type: 'PIECE_FINISHED',
            player,
            pieceIndex
        });
    }

    // Record the move
    newState.moveCount++;
    newState.lastMoveAt = Date.now();
    newState.moves.push({
        player,
        pieceIndex,
        dice: diceValue,
        from: oldPos,
        to: move.to,
        captured: move.captures ? { ...move.captures } : null,
        timestamp: Date.now()
    });

    // Check for win
    const allFinished = newState.players[player].pieces.every(p => p === POS_FINISHED);
    if (allFinished) {
        newState.status = 'COMPLETED';
        newState.winner = player;
        events.push({ type: 'GAME_OVER', winner: player });
        return { state: newState, events };
    }

    // Determine next turn
    const rolledSix = diceValue === 6;
    const didFinish = move.to === POS_FINISHED;

    if (rolledSix) {
        newState.consecutiveSixes++;

        if (newState.consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
            // Three sixes in a row — forfeit turn
            events.push({ type: 'THREE_SIXES', player });
            newState.currentTurn = opponent;
            newState.consecutiveSixes = 0;
            newState.extraTurn = false;
        } else {
            // Extra turn for rolling a 6
            newState.extraTurn = true;
            events.push({ type: 'EXTRA_TURN', reason: 'ROLLED_SIX', player });
        }
    } else if (didCapture) {
        // Extra turn for capturing
        newState.consecutiveSixes = 0;
        newState.extraTurn = true;
        events.push({ type: 'EXTRA_TURN', reason: 'CAPTURE', player });
    } else if (didFinish) {
        // Extra turn for finishing a piece (standard Ludo rule)
        newState.consecutiveSixes = 0;
        newState.extraTurn = true;
        events.push({ type: 'EXTRA_TURN', reason: 'PIECE_FINISHED', player });
    } else {
        // Normal turn — switch to opponent
        newState.currentTurn = opponent;
        newState.consecutiveSixes = 0;
        newState.extraTurn = false;
    }

    // Reset dice for next roll
    newState.diceValue = null;
    newState.mustRollDice = true;
    newState.turnStartedAt = Date.now();

    return { state: newState, events };
}

// ─── Dice Roll Handler ──────────────────────────────────────

/**
 * Roll the dice for the current player.
 * Returns new state with the dice value set.
 *
 * @param {Object} state - Current game state
 * @param {number} [forcedValue] - Force a specific dice value (for testing/AI)
 * @returns {{ state: Object, diceValue: number, validMoves: Array, autoSkip: boolean }}
 */
function rollDice(state, forcedValue) {
    const newState = deepClone(state);
    const diceValue = forcedValue || (Math.floor(Math.random() * 6) + 1);

    newState.diceValue = diceValue;
    newState.mustRollDice = false;

    const validMoves = getValidMoves(newState, diceValue);
    const autoSkip = validMoves.length === 0;

    if (autoSkip) {
        // No valid moves — always pass the turn, even on a 6.
        // Extra turns are only granted when a move is actually EXECUTED
        // (handled in applyMove). Rolling 6 with no valid moves = skip.
        const opponent = newState.currentTurn === 'RED' ? 'BLUE' : 'RED';

        newState.currentTurn = opponent;
        newState.consecutiveSixes = 0;
        newState.extraTurn = false;
        newState.diceValue = null;
        newState.mustRollDice = true;
        newState.turnStartedAt = Date.now();
    }

    return {
        state: newState,
        diceValue,
        validMoves,
        autoSkip
    };
}

// ─── Turn Timeout (Skip) ────────────────────────────────────

/**
 * Force-skip a player's turn (due to timeout or disconnect).
 *
 * @param {Object} state - Current game state
 * @returns {Object} New game state with turn switched
 */
function forceSkipTurn(state) {
    const newState = deepClone(state);
    const opponent = newState.currentTurn === 'RED' ? 'BLUE' : 'RED';

    newState.currentTurn = opponent;
    newState.consecutiveSixes = 0;
    newState.extraTurn = false;
    newState.diceValue = null;
    newState.mustRollDice = true;
    newState.turnStartedAt = Date.now();

    return newState;
}

// ─── Auto-move (Single Valid Move) ──────────────────────────

/**
 * If there's exactly 1 valid move, auto-play it (for speed).
 *
 * @param {Object} state - Current game state after dice roll
 * @param {number} diceValue
 * @returns {{ state: Object, events: Array, autoMoved: boolean }}
 */
function autoMoveIfSingle(state, diceValue) {
    const validMoves = getValidMoves(state, diceValue);
    if (validMoves.length === 1) {
        const result = applyMove(state, validMoves[0].pieceIndex, diceValue);
        return { ...result, autoMoved: true };
    }
    return { state, events: [], autoMoved: false };
}

// ─── Game State Queries ─────────────────────────────────────

/**
 * Count how many pieces a player has finished
 */
function countFinished(state, player) {
    return state.players[player].pieces.filter(p => p === POS_FINISHED).length;
}

/**
 * Count how many pieces a player has on the board (not base, not finished)
 */
function countOnBoard(state, player) {
    return state.players[player].pieces.filter(p => p !== POS_BASE && p !== POS_FINISHED).length;
}

/**
 * Count how many pieces a player still has in base
 */
function countInBase(state, player) {
    return state.players[player].pieces.filter(p => p === POS_BASE).length;
}

/**
 * Get a compact summary of the game state (for logging/display)
 */
function getGameSummary(state) {
    return {
        turn: state.currentTurn,
        dice: state.diceValue,
        move: state.moveCount,
        status: state.status,
        winner: state.winner,
        red: {
            base: countInBase(state, 'RED'),
            board: countOnBoard(state, 'RED'),
            finished: countFinished(state, 'RED'),
            positions: [...state.players.RED.pieces]
        },
        blue: {
            base: countInBase(state, 'BLUE'),
            board: countOnBoard(state, 'BLUE'),
            finished: countFinished(state, 'BLUE'),
            positions: [...state.players.BLUE.pieces]
        }
    };
}

/**
 * Get progress percentage for a player (0-100)
 */
function getPlayerProgress(state, player) {
    const pieces = state.players[player].pieces;
    let totalProgress = 0;
    const maxPerPiece = BOARD_SIZE + HOME_COLUMN_LENGTH; // 58 steps to finish

    for (const pos of pieces) {
        if (pos === POS_FINISHED) {
            totalProgress += maxPerPiece;
        } else if (pos === POS_BASE) {
            totalProgress += 0;
        } else {
            totalProgress += pos;
        }
    }

    return Math.round((totalProgress / (maxPerPiece * PIECES_PER_PLAYER)) * 100);
}

// ─── Board Coordinate Mapping (for UI rendering) ────────────

/**
 * Map absolute board positions (0-51) and home columns to
 * x,y grid coordinates on a 15x15 Ludo board.
 * 
 * Returns data structures the UI needs to render pieces.
 */
function getBoardLayout() {
    // The classic Ludo board is a 15x15 grid
    // Each quadrant has a 6x6 home area and track cells

    // Main track: 52 cells going clockwise
    // We define x,y for each absolute position
    const mainTrack = [
        // RED's side (bottom) — cells 0-12
        { x: 6, y: 13 }, // 0  (RED safe - start zone)
        { x: 6, y: 12 }, // 1  (RED entry)
        { x: 6, y: 11 }, // 2
        { x: 6, y: 10 }, // 3
        { x: 6, y: 9 },  // 4
        { x: 5, y: 8 },  // 5
        { x: 4, y: 8 },  // 6
        { x: 3, y: 8 },  // 7
        { x: 2, y: 8 },  // 8  (star)
        { x: 1, y: 8 },  // 9
        { x: 0, y: 8 },  // 10
        { x: 0, y: 7 },  // 11
        { x: 0, y: 6 },  // 12

        // GREEN's side (left) — cells 13-25
        { x: 1, y: 6 },  // 13 (star)
        { x: 2, y: 6 },  // 14
        { x: 3, y: 6 },  // 15
        { x: 4, y: 6 },  // 16
        { x: 5, y: 6 },  // 17
        { x: 6, y: 5 },  // 18
        { x: 6, y: 4 },  // 19
        { x: 6, y: 3 },  // 20
        { x: 6, y: 2 },  // 21 (star)
        { x: 6, y: 1 },  // 22
        { x: 6, y: 0 },  // 23
        { x: 7, y: 0 },  // 24
        { x: 8, y: 0 },  // 25

        // BLUE's side (top) — cells 26-38
        { x: 8, y: 1 },  // 26 (BLUE safe - start zone)
        { x: 8, y: 2 },  // 27 (BLUE entry)
        { x: 8, y: 3 },  // 28
        { x: 8, y: 4 },  // 29
        { x: 8, y: 5 },  // 30
        { x: 9, y: 6 },  // 31
        { x: 10, y: 6 }, // 32
        { x: 11, y: 6 }, // 33
        { x: 12, y: 6 }, // 34 (star)
        { x: 13, y: 6 }, // 35
        { x: 14, y: 6 }, // 36
        { x: 14, y: 7 }, // 37
        { x: 14, y: 8 }, // 38

        // YELLOW's side (right) — cells 39-51
        { x: 13, y: 8 }, // 39 (star)
        { x: 12, y: 8 }, // 40
        { x: 11, y: 8 }, // 41
        { x: 10, y: 8 }, // 42
        { x: 9, y: 8 },  // 43
        { x: 8, y: 9 },  // 44
        { x: 8, y: 10 }, // 45
        { x: 8, y: 11 }, // 46
        { x: 8, y: 12 }, // 47 (star)
        { x: 8, y: 13 }, // 48
        { x: 8, y: 14 }, // 49
        { x: 7, y: 14 }, // 50
        { x: 6, y: 14 }  // 51
    ];

    // Home columns (6 cells each, leading to center)
    const homeColumns = {
        RED: [
            { x: 7, y: 13 }, { x: 7, y: 12 }, { x: 7, y: 11 },
            { x: 7, y: 10 }, { x: 7, y: 9 }, { x: 7, y: 8 }
        ],
        BLUE: [
            { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 },
            { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }
        ],
        GREEN: [
            { x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 },
            { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }
        ],
        YELLOW: [
            { x: 13, y: 7 }, { x: 12, y: 7 }, { x: 11, y: 7 },
            { x: 10, y: 7 }, { x: 9, y: 7 }, { x: 8, y: 7 }
        ]
    };

    // Base/yard areas (where pieces start)
    const basePositions = {
        RED: [
            { x: 2, y: 11 }, { x: 4, y: 11 },
            { x: 2, y: 13 }, { x: 4, y: 13 }
        ],
        BLUE: [
            { x: 10, y: 1 }, { x: 12, y: 1 },
            { x: 10, y: 3 }, { x: 12, y: 3 }
        ]
    };

    // Finish/center position
    const finishPos = { x: 7, y: 7 };

    return { mainTrack, homeColumns, basePositions, finishPos, gridSize: 15 };
}

/**
 * Get the x,y coordinates for a specific piece
 * @param {string} player - 'RED' or 'BLUE'
 * @param {number} pieceIndex - 0-3
 * @param {number} relPos - Player-relative position
 * @returns {{ x: number, y: number }}
 */
function getPieceCoords(player, pieceIndex, relPos) {
    const layout = getBoardLayout();

    if (relPos === POS_BASE) {
        return layout.basePositions[player][pieceIndex];
    }

    if (relPos === POS_FINISHED) {
        return layout.finishPos;
    }

    if (relPos >= BOARD_SIZE) {
        // Home column
        const homeIdx = relPos - BOARD_SIZE;
        return layout.homeColumns[player][homeIdx];
    }

    // Main track — convert relative to absolute
    const absPos = toAbsolutePos(player, relPos);
    return layout.mainTrack[absPos];
}

// ─── Exports ────────────────────────────────────────────────

const LudoEngine = {
    // Constants
    BOARD_SIZE,
    HOME_JUNCTION,
    HOME_COLUMN_LENGTH,
    PIECES_PER_PLAYER,
    MAX_CONSECUTIVE_SIXES,
    POS_BASE,
    POS_FINISHED,
    PLAYER_START,
    SAFE_SPOTS,

    // State management
    createGameState,
    deepClone,

    // Core game actions
    rollDice,
    getValidMoves,
    applyMove,
    forceSkipTurn,
    autoMoveIfSingle,

    // Position helpers
    toAbsolutePos,
    calculateNewPosition,
    isInHomeColumn,
    isFinished,
    isInBase,
    isSafeSpot,

    // Queries
    countFinished,
    countOnBoard,
    countInBase,
    getGameSummary,
    getPlayerProgress,

    // Board layout for UI
    getBoardLayout,
    getPieceCoords
};

// Universal export — works in Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LudoEngine;
} else if (typeof window !== 'undefined') {
    window.LudoEngine = LudoEngine;
}
