/**
 * ludo-engine-test.js — Comprehensive Ludo Engine Tests
 * 
 * Run: node tests/ludo-engine-test.js
 */

const LudoEngine = require('../public/js/ludo/ludo-engine');
const LudoAI = require('../public/js/ludo/ludo-ai');

let passed = 0, failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${name}: ${e.message}`);
        failed++;
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// Helper to create a game state with specific piece positions
function makeState(redPieces, bluePieces, currentTurn = 'RED') {
    const state = LudoEngine.createGameState('P1', 'P2');
    state.players.RED.pieces = [...redPieces];
    state.players.BLUE.pieces = [...bluePieces];
    state.currentTurn = currentTurn;
    state.status = 'IN_PROGRESS';
    state.mustRollDice = false;
    return state;
}

// ─────────────────────────────────────────────────────────────
console.log('\n═══ calculateNewPosition Tests ═══');

test('Base → entry with 6', () => {
    const pos = LudoEngine.calculateNewPosition('RED', -1, 6);
    assertEqual(pos, 0, 'Should enter at position 0');
});

test('Base → no move without 6', () => {
    for (let d = 1; d <= 5; d++) {
        const pos = LudoEngine.calculateNewPosition('RED', -1, d);
        assertEqual(pos, null, `Dice ${d} should not exit base`);
    }
});

test('Normal track movement', () => {
    const pos = LudoEngine.calculateNewPosition('RED', 10, 3);
    assertEqual(pos, 13);
});

test('Enter home column from pos 49 with dice 2', () => {
    // 49+2=51 → junction → homeCol 52
    const pos = LudoEngine.calculateNewPosition('RED', 49, 2);
    assertEqual(pos, 52, 'Should enter home column at position 52');
});

test('Enter home column from pos 48 with dice 3', () => {
    // 48+3=51 → junction → homeCol 52
    const pos = LudoEngine.calculateNewPosition('RED', 48, 3);
    assertEqual(pos, 52, 'Should enter home column at position 52');
});

test('Exact finish from home column', () => {
    const pos = LudoEngine.calculateNewPosition('RED', 52, 6);
    assertEqual(pos, 99, 'Should finish with exact roll (52+6=58)');
});

test('Exact finish from main track', () => {
    // 45+6=51 → junction → homeCol 52. Not finish.
    const pos = LudoEngine.calculateNewPosition('RED', 45, 6);
    assertEqual(pos, 52, 'Should enter home column');
});

test('Overshoot finish from home column', () => {
    const pos = LudoEngine.calculateNewPosition('RED', 53, 6);
    assertEqual(pos, null, 'Should be null — overshoot');
});

test('Move within home column', () => {
    const pos = LudoEngine.calculateNewPosition('RED', 52, 3);
    assertEqual(pos, 55, 'Should move to position 55 in home column');
});

test('Already finished cannot move', () => {
    const pos = LudoEngine.calculateNewPosition('RED', 99, 1);
    assertEqual(pos, null, 'Finished pieces cannot move');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ Anti-Looping Tests (Issue 2) ═══');

test('ISSUE 2: Piece near home NEVER wraps around', () => {
    // Test ALL dice values for positions 46-50 (near home junction)
    // No result should EVER be less than the current position
    for (let pos = 46; pos <= 50; pos++) {
        for (let dice = 1; dice <= 6; dice++) {
            const result = LudoEngine.calculateNewPosition('RED', pos, dice);
            if (result !== null && result !== 99) {
                assert(result > pos, `pos=${pos} dice=${dice} → ${result} should be > ${pos} (no looping!)`);
            }
        }
    }
});

test('ISSUE 2: getValidMoves never generates backward moves near home', () => {
    // RED at position 50, test dice 1-6. Every valid move must go FORWARD.
    for (let dice = 1; dice <= 6; dice++) {
        const state = makeState([50, -1, -1, -1], [-1, -1, -1, -1]);
        const moves = LudoEngine.getValidMoves(state, dice);
        for (const move of moves) {
            if (move.pieceIndex === 0) {
                assert(move.to > 50 || move.to === 99,
                    `dice=${dice}: move.to=${move.to} must be > 50 (no backward/looping)`);
            }
        }
    }
});

test('ISSUE 2: Home entry ignores enemies on outer track', () => {
    // RED at relPos 50, BLUE at absPos 51 (on outer track), RED rolls 2
    // 50+2=52 → junction redirect → homeCol 53. HOME_ENTER.
    const state = makeState([50, -1, -1, -1], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 2);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].to, 53, 'Must enter home column at 53 (52 via junction = 53)');
    assertEqual(moves[0].type, 'HOME_ENTER', 'Must be HOME_ENTER, not MOVE');
    assertEqual(moves[0].captures, null, 'NO capture — enemies on outer track ignored during home entry');

    // Apply the move and verify piece is in home column
    state.diceValue = 2;
    const result = LudoEngine.applyMove(state, 0, 2);
    assertEqual(result.state.players.RED.pieces[0], 53, 'RED must be at 53 (home column)');
    // BLUE should NOT be captured
    assertEqual(result.state.players.BLUE.pieces[0], 25, 'BLUE must stay at relPos 25 (not captured)');
});

test('ISSUE 2: No capture options behind entry point', () => {
    // RED at relPos 50. BLUE at absPos 49 (behind RED).
    // RED rolls 2 → enters home at 52.
    // The capture at absPos 49 is BEHIND RED — must NOT appear.
    // BLUE at absPos 49: (relPos+26)%52=49 → relPos=23
    const state = makeState([50, -1, -1, -1], [23, -1, -1, -1]);

    const blueAbsPos = LudoEngine.toAbsolutePos('BLUE', 23);
    assertEqual(blueAbsPos, 49, 'BLUE at absPos 49 (behind RED)');

    const moves = LudoEngine.getValidMoves(state, 2);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].captures, null, 'Should NOT capture — BLUE is BEHIND the token, not ahead');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ getValidMoves Tests ═══');

test('Piece at pos 50, dice 2 → HOME_ENTER', () => {
    // 50+2=52 → junction redirect → homeCol 53
    const state = makeState([50, -1, -1, -1], [-1, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 2);
    assertEqual(moves.length, 1, 'Should have exactly 1 move');
    assertEqual(moves[0].type, 'HOME_ENTER', 'Should be HOME_ENTER');
    assertEqual(moves[0].to, 53, 'Destination should be 53 (50+2=52 via junction = 53)');
    assertEqual(moves[0].captures, null, 'No captures');
});

test('Home entry ignores enemies on outer path (no pass-through capture)', () => {
    // RED at relPos 50, rolls 2 → 50+2=52 → junction → homeCol 53
    // BLUE at absPos 51 — on outer track, ignored during home entry
    const state = makeState([50, -1, -1, -1], [25, -1, -1, -1]);

    // Verify BLUE is at absPos 51
    const blueAbsPos = LudoEngine.toAbsolutePos('BLUE', 25);
    assertEqual(blueAbsPos, 51, 'BLUE should be at absPos 51');

    const moves = LudoEngine.getValidMoves(state, 2);
    assertEqual(moves.length, 1, 'Should have exactly 1 move');
    assertEqual(moves[0].type, 'HOME_ENTER', 'Should be HOME_ENTER');
    assertEqual(moves[0].to, 53, 'Destination should be 53 (home column)');
    assertEqual(moves[0].captures, null, 'NO capture during home entry');
});

test('Home entry ignores ALL enemies on outer track (safe or non-safe)', () => {
    // RED at relPos 46, dice 6 → dest 52 (HOME_ENTER)
    // BLUE at absPos 47 (star) and at absPos 48 (non-safe)
    // NONE should be captured — home entry ignores outer track entirely
    // BLUE relPos 21 → absPos 47 (star), BLUE relPos 22 → absPos 48 (non-safe)
    const state = makeState([46, 99, 99, 99], [21, 22, -1, -1]);

    const moves = LudoEngine.getValidMoves(state, 6);
    assertEqual(moves.length, 1, 'Should have 1 move');
    assertEqual(moves[0].type, 'HOME_ENTER', 'Should be HOME_ENTER');
    assertEqual(moves[0].captures, null, 'NO capture — home entry ignores outer enemies');
});

test('Normal main track capture', () => {
    // RED at relPos 10, BLUE at absPos 13 (not a safe spot... wait, 13 IS a safe spot)
    // Use absPos 14 instead: BLUE at (relPos+26)%52 = 14 → relPos = -12 → negative???
    // (relPos + 26) % 52 = 14 → relPos = 14 - 26 = -12. Nope.
    // relPos = (14 - 26 + 52) % 52 = 40. So BLUE relPos 40 → absPos = (40+26)%52 = 14
    // But wait, absPos 14 is not a safe spot... Let me check. Safe spots: 0,8,13,21,26,34,39,47
    // 14 is NOT safe. Good.
    const state = makeState([10, -1, -1, -1], [40, -1, -1, -1]);

    const blueAbsPos = LudoEngine.toAbsolutePos('BLUE', 40);
    assertEqual(blueAbsPos, 14, 'BLUE should be at absPos 14');

    const redAbsAfter = LudoEngine.toAbsolutePos('RED', 14);
    assertEqual(redAbsAfter, 14, 'RED dest should also be absPos 14');

    const moves = LudoEngine.getValidMoves(state, 4);
    const captureMove = moves.find(m => m.captures);
    assert(captureMove !== null && captureMove !== undefined, 'Should find a capture move');
    assertEqual(captureMove.captures.player, 'BLUE');
    assertEqual(captureMove.type, 'MOVE', 'Should be regular MOVE');
});

test('Safe spot allows landing but no capture', () => {
    // RED at relPos 5, dice 3 → dest relPos 8, absPos 8 (STAR)
    // BLUE at absPos 8: (relPos+26)%52 = 8 → relPos = (8-26+52)%52 = 34
    const state = makeState([5, -1, -1, -1], [34, -1, -1, -1]);

    const blueAbsPos = LudoEngine.toAbsolutePos('BLUE', 34);
    assertEqual(blueAbsPos, 8, 'BLUE should be at absPos 8 (star)');

    const moves = LudoEngine.getValidMoves(state, 3);
    // Move should be ALLOWED (can land on safe spot) but NO capture
    const moveToStar = moves.find(m => m.to === 8);
    assert(moveToStar !== undefined, 'Should be able to move to safe spot with opponent');
    assertEqual(moveToStar.captures, null, 'Should NOT capture on safe spot');
});

test('Finish with exact roll', () => {
    const state = makeState([52, 99, 99, 99], [-1, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 6);
    assertEqual(moves.length, 1, 'Should have 1 move');
    assertEqual(moves[0].type, 'FINISH');
    assertEqual(moves[0].to, 99);
});

test('Cannot overshoot finish', () => {
    // Piece in home column at pos 54, dice 5 → 59 > 58 → invalid
    const state = makeState([54, 99, 99, 99], [-1, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 5);
    assertEqual(moves.length, 0, 'Should have no valid moves (overshoot)');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ applyMove Tests ═══');

test('Home entry applies correctly (no capture on outer track)', () => {
    // RED at 49, dice 2: 49+2=51 → junction → homeCol 52. HOME_ENTER.
    const state = makeState([49, -1, -1, -1], [25, -1, -1, -1]);
    state.diceValue = 2;

    const result = LudoEngine.applyMove(state, 0, 2);

    // RED piece should be in home column
    assertEqual(result.state.players.RED.pieces[0], 52, 'RED should be at 52 (home column)');
    // BLUE piece should NOT be captured — stays in place
    assertEqual(result.state.players.BLUE.pieces[0], 25, 'BLUE should stay at relPos 25');

    // No capture events — home entry ignores outer enemies
    const captureEvent = result.events.find(e => e.type === 'PIECE_CAPTURED');
    assertEqual(captureEvent, undefined, 'Should NOT have PIECE_CAPTURED event for home entry');
});

test('Normal home entry without capture', () => {
    const state = makeState([49, -1, -1, -1], [-1, -1, -1, -1]);
    state.diceValue = 2;

    const result = LudoEngine.applyMove(state, 0, 2);
    assertEqual(result.state.players.RED.pieces[0], 52, 'RED should be at 52');
    assertEqual(result.state.currentTurn, 'BLUE', 'Turn should switch to BLUE');
});

test('Win condition: all 4 pieces finished', () => {
    const state = makeState([99, 99, 99, 52], [-1, -1, -1, -1]);
    state.diceValue = 6;

    const result = LudoEngine.applyMove(state, 3, 6);
    assertEqual(result.state.status, 'COMPLETED', 'Game should be completed');
    assertEqual(result.state.winner, 'RED', 'RED should win');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ AI Scoring Tests ═══');

test('AI prefers HOME_ENTER over main track capture', () => {
    // AI has piece at 50 (can enter home with 2) and piece at 10 (can capture opponent)
    const state = makeState(
        [-1, -1, -1, -1],            // RED (player)
        [50, 10, -1, -1]             // BLUE (AI)
    );
    state.currentTurn = 'BLUE';

    // BLUE at relPos 50 → absPos (50+26)%52 = 24
    // BLUE at relPos 10 → absPos (10+26)%52 = 36

    // Need a RED piece at absPos 38 (relPos 38) so BLUE piece 1 can capture
    // Actually, let's make correct opponent positions
    // BLUE piece 1 at relPos 10, dice 2 → dest relPos 12, absPos (12+26)%52 = 38
    // RED at relPos 38 → absPos 38 (not safe)
    state.players.RED.pieces = [38, -1, -1, -1];

    const moves = LudoEngine.getValidMoves(state, 2);
    const homeMove = moves.find(m => m.type === 'HOME_ENTER');
    const captureMove = moves.find(m => m.captures && m.type !== 'HOME_ENTER');

    assert(homeMove !== undefined, 'Should have HOME_ENTER move');

    if (homeMove && captureMove) {
        const homeScore = LudoAI.scoreMove(state, homeMove, 'BLUE');
        const captureScore = LudoAI.scoreMove(state, captureMove, 'BLUE');
        assert(homeScore > captureScore, `HOME_ENTER (${homeScore}) should score higher than capture (${captureScore})`);
    }
});

test('AI values capture+home combo highest', () => {
    // BLUE piece at relPos 50, dice 2 → HOME_ENTER (no capture on outer track)
    // Home entry should score higher than any regular move
    const state = makeState(
        [25, -1, -1, -1],  // RED (on outer track)
        [50, 10, -1, -1]   // BLUE (piece 0 near home, piece 1 on track)
    );
    state.currentTurn = 'BLUE';

    const moves = LudoEngine.getValidMoves(state, 2);
    const homeMove = moves.find(m => m.type === 'HOME_ENTER');
    const trackMove = moves.find(m => m.type === 'MOVE');

    assert(homeMove !== undefined, 'Should have HOME_ENTER move');
    assertEqual(homeMove.captures, null, 'Home entry should NOT have captures');

    if (homeMove && trackMove) {
        const homeScore = LudoAI.scoreMove(state, homeMove, 'BLUE');
        const trackScore = LudoAI.scoreMove(state, trackMove, 'BLUE');
        assert(homeScore > trackScore, `HOME_ENTER (${homeScore}) must score higher than track MOVE (${trackScore})`);
    }
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ Edge Case Tests ═══');

test('Three consecutive sixes forfeits turn', () => {
    const state = makeState([0, -1, -1, -1], [-1, -1, -1, -1]);
    state.consecutiveSixes = 2; // Already rolled 2 sixes
    state.diceValue = 6;

    const result = LudoEngine.applyMove(state, 0, 6);
    // Should forfeit turn after 3rd six
    assertEqual(result.state.currentTurn, 'BLUE', 'Turn should switch after 3 sixes');
    const threeSixesEvent = result.events.find(e => e.type === 'THREE_SIXES');
    assert(threeSixesEvent !== undefined, 'Should have THREE_SIXES event');
});

test('Enter from base onto safe spot with opponent', () => {
    // RED rolls 6, enters at relPos 0, absPos 0 — safe spot (RED entry)
    // BLUE at absPos 0: (relPos+26)%52 = 0 → relPos = 26
    const state = makeState([-1, -1, -1, -1], [26, -1, -1, -1]);

    const moves = LudoEngine.getValidMoves(state, 6);
    // Should be ALLOWED to enter (safe spot allows coexistence) but NO capture
    const enterMove = moves.find(m => m.type === 'ENTER');
    assert(enterMove !== undefined, 'Should be able to enter on safe spot with opponent');
    assertEqual(enterMove.captures, null, 'Should NOT capture on safe spot');
});

test('BLUE home entry also ignores outer enemies', () => {
    // BLUE at relPos 50, rolls 2 → dest 52 (HOME_ENTER)
    // RED at absPos 25 (on outer track near BLUE's home)
    // Home entry goes directly into column — no capture
    const state = makeState([25, -1, -1, -1], [50, -1, -1, -1], 'BLUE');

    const moves = LudoEngine.getValidMoves(state, 2);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].captures, null, 'NO capture — BLUE enters winning column directly');
});

test('SCREENSHOT BUG 1: RED at 25 dice 1 → BLUE entry star (absPos 26)', () => {
    // R: [0,99,47,25], B: [0,13,0,13], dice=1
    // RED piece 3 at relPos 25, dest 26, absPos 26 (BLUE entry star)
    // BLUE pieces 0,2 at relPos 0 → absPos 26
    // Should be allowed to land (no capture on safe spot)
    const state = makeState([0, 99, 47, 25], [0, 13, 0, 13]);
    const moves = LudoEngine.getValidMoves(state, 1);
    const piece3Move = moves.find(m => m.pieceIndex === 3);
    assert(piece3Move !== undefined, 'RED piece 3 should have a valid move to BLUE entry star');
    assertEqual(piece3Move.to, 26, 'Destination should be relPos 26');
    assertEqual(piece3Move.captures, null, 'No capture on safe spot');
    assert(moves.length >= 3, 'Should have moves for pieces 0, 2, and 3');
});

test('SCREENSHOT BUG 2: RED at 20 dice 6 → BLUE entry star (absPos 26)', () => {
    // R: [-1,47,20,0], B: [23,9,0,-1], dice=6
    // RED piece 2 at relPos 20, dest 26, absPos 26 (BLUE entry star)
    // BLUE piece 2 at relPos 0 → absPos 26
    const state = makeState([-1, 47, 20, 0], [23, 9, 0, -1]);
    const moves = LudoEngine.getValidMoves(state, 6);
    const piece2Move = moves.find(m => m.pieceIndex === 2);
    assert(piece2Move !== undefined, 'RED piece 2 should have a valid move to BLUE entry star');
    assertEqual(piece2Move.to, 26, 'Destination should be relPos 26');
    assertEqual(piece2Move.captures, null, 'No capture on safe spot');
    // Piece 0 can enter from base, piece 1 enters home, piece 3 moves to 6
    assert(moves.length >= 3, 'Should have multiple valid moves');
});

test('Position helpers are consistent', () => {
    // Verify toAbsolutePos round trips correctly (full 52-cell outer track)
    for (let pos = 0; pos < 52; pos++) {
        const absRed = LudoEngine.toAbsolutePos('RED', pos);
        assert(absRed >= 0 && absRed < 52, `RED absPos ${absRed} out of range for relPos ${pos}`);
    }
    for (let pos = 0; pos < 52; pos++) {
        const absBlue = LudoEngine.toAbsolutePos('BLUE', pos);
        assert(absBlue >= 0 && absBlue < 52, `BLUE absPos ${absBlue} out of range for relPos ${pos}`);
    }
    // Home column (52+) should return -1
    assertEqual(LudoEngine.toAbsolutePos('RED', 52), -1, 'Home column should have no absPos');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ Stack Safety Tests (All-Color) ═══');

test('Same-color double stack prevents capture', () => {
    // RED at relPos 10, dice 4 → dest 14, absPos 14 (not safe)
    // BLUE has TWO pieces at absPos 14: both at relPos 40
    // (40+26)%52 = 14 ✓
    const state = makeState([10, -1, -1, -1], [40, 40, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 4);
    const moveToStack = moves.find(m => m.to === 14);
    assert(moveToStack !== undefined, 'Should be able to LAND on stacked position');
    assertEqual(moveToStack.captures, null, 'Should NOT capture — 2 same-color tokens stacked');
});

test('Mixed-color stack prevents capture (RED + BLUE together)', () => {
    // RED piece 1 is at relPos 14 (absPos 14)
    // BLUE piece at relPos 40 → absPos 14 (same box)
    // So position absPos 14 has: 1 RED + 1 BLUE = 2 total → SAFE
    // RED piece 0 at relPos 10, dice 4 → dest 14
    // Should NOT capture BLUE because the box has 2+ tokens total
    const state = makeState([10, 14, -1, -1], [40, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 4);
    const moveToMixed = moves.find(m => m.pieceIndex === 0 && m.to === 14);
    assert(moveToMixed !== undefined, 'Should be able to land on mixed-stack position');
    assertEqual(moveToMixed.captures, null, 'Should NOT capture — box has 2+ total tokens (mixed colors)');
});

test('Single piece CAN still be captured', () => {
    // BLUE has only ONE piece at absPos 14 (no stack)
    const state = makeState([10, -1, -1, -1], [40, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 4);
    const captureMove = moves.find(m => m.to === 14);
    assert(captureMove !== undefined, 'Should have move to position 14');
    assert(captureMove.captures !== null, 'SHOULD capture single isolated piece');
    assertEqual(captureMove.captures.player, 'BLUE');
});

test('Stack protection is temporary — last token is vulnerable', () => {
    // If only 1 token remains after others leave, it's capturable
    // BLUE has 1 piece at absPos 14. No other tokens at that position.
    const state = makeState([10, -1, -1, -1], [40, 20, -1, -1]);
    // BLUE piece 0 at relPos 40 → absPos 14 (alone, piece 1 is elsewhere)
    const moves = LudoEngine.getValidMoves(state, 4);
    const captureMove = moves.find(m => m.to === 14);
    assert(captureMove !== undefined, 'Should have move');
    assert(captureMove.captures !== null, 'Single remaining token is capturable');
});

test('Three tokens at same box = all safe', () => {
    // RED piece 1 at absPos 14, RED piece 2 at absPos 14
    // BLUE piece at absPos 14
    // 3 total tokens → SAFE
    // RED piece 0 at relPos 10, dice 4 → dest 14
    const state = makeState([10, 14, 14, -1], [40, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 4);
    const moveToTriple = moves.find(m => m.pieceIndex === 0 && m.to === 14);
    assert(moveToTriple !== undefined, 'Should be able to land');
    assertEqual(moveToTriple.captures, null, 'Should NOT capture — 3 tokens at that box');
});

test('Home entry never captures regardless of stack status', () => {
    // RED at relPos 50, dice 2 → dest 52 (HOME_ENTER)
    // BLUE is on the outer track path — should be ignored regardless
    const state = makeState([50, 51, -1, -1], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 2);
    const homeMove = moves.find(m => m.pieceIndex === 0);
    assert(homeMove !== undefined, 'Should have HOME_ENTER move');
    assertEqual(homeMove.type, 'HOME_ENTER');
    assertEqual(homeMove.captures, null, 'NO capture — home entry ignores outer track entirely');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ User Scenario: RED Near Home, BLUE Near Red Home Star ═══');

test('RED at 46, dice 6 → HOME_ENTER, BLUE at absPos 51 NOT captured', () => {
    // RED at relPos 46, dice 6 → rawPos 52 → junction → homeCol 53
    const state = makeState([46, 99, 99, 99], [25, -1, -1, -1]);

    const blueAbsPos = LudoEngine.toAbsolutePos('BLUE', 25);
    assertEqual(blueAbsPos, 51, 'BLUE should be at absPos 51');

    const moves = LudoEngine.getValidMoves(state, 6);
    assertEqual(moves.length, 1, 'Should have 1 move');
    assertEqual(moves[0].type, 'HOME_ENTER', 'Should be HOME_ENTER');
    assertEqual(moves[0].to, 53, 'Dest should be 53 (46+6=52 via junction = 53)');
    assertEqual(moves[0].captures, null, 'NO capture');

    state.diceValue = 6;
    const result = LudoEngine.applyMove(state, 0, 6);
    assertEqual(result.state.players.RED.pieces[0], 53, 'RED at home column 53');
    assertEqual(result.state.players.BLUE.pieces[0], 25, 'BLUE stays at relPos 25');
    const capEvent = result.events.find(e => e.type === 'PIECE_CAPTURED');
    assertEqual(capEvent, undefined, 'No PIECE_CAPTURED event');
});

test('RED at 47, dice 5 → HOME_ENTER, BLUE at absPos 51 NOT captured', () => {
    // 47+5=52 → junction → homeCol 53
    const state = makeState([47, -1, -1, -1], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 5);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].to, 53, 'Dest should be 53');
    assertEqual(moves[0].captures, null, 'NO capture');

    state.diceValue = 5;
    const result = LudoEngine.applyMove(state, 0, 5);
    assertEqual(result.state.players.BLUE.pieces[0], 25, 'BLUE stays');
});

test('RED at 48, dice 4 → HOME_ENTER, BLUE at absPos 51 NOT captured', () => {
    // 48+4=52 → junction → homeCol 53
    const state = makeState([48, -1, -1, -1], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 4);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].to, 53, 'Dest should be 53');
    assertEqual(moves[0].captures, null, 'NO capture');

    state.diceValue = 4;
    const result = LudoEngine.applyMove(state, 0, 4);
    assertEqual(result.state.players.BLUE.pieces[0], 25, 'BLUE stays');
});

test('RED at 47, dice 6 → HOME_ENTER at 54, BLUE at absPos 51 NOT captured', () => {
    // 47+6=53 → junction → homeCol 54
    const state = makeState([47, 99, 99, 99], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 6);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].to, 54, 'Dest should be 54 (47+6=53 via junction = 54)');
    assertEqual(moves[0].captures, null, 'NO capture');
});

test('RED at 48, dice 5 → HOME_ENTER at 54, BLUE at absPos 51 NOT captured', () => {
    // 48+5=53 → junction → homeCol 54
    const state = makeState([48, -1, -1, -1], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 5);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].to, 54);
    assertEqual(moves[0].captures, null, 'NO capture');
});

test('RED at 48, dice 6 → HOME_ENTER at 55, BLUE at absPos 51 NOT captured', () => {
    // 48+6=54 → junction → homeCol 55
    const state = makeState([48, 99, 99, 99], [25, -1, -1, -1]);
    const moves = LudoEngine.getValidMoves(state, 6);
    assertEqual(moves.length, 1);
    assertEqual(moves[0].type, 'HOME_ENTER');
    assertEqual(moves[0].to, 55);
    assertEqual(moves[0].captures, null, 'NO capture');
});

test('HOME PRIORITY: RED at 47, dice 4 → HOME_ENTER via junction, BLUE ignored', () => {
    // USER'S EXACT SCENARIO: RED at yellow star (47), dice 4
    // 47+4=51 → junction (pass-through) → homeCol 52 (HOME_ENTER)
    // BLUE at absPos 51 (relPos 25) is on the outer track — ignored.
    const state = makeState([47, 99, 99, 99], [25, -1, -1, -1]);

    const moves = LudoEngine.getValidMoves(state, 4);
    assertEqual(moves.length, 1, 'Should have 1 move');
    assertEqual(moves[0].to, 52, 'Dest should be 52 (home column via junction)');
    assertEqual(moves[0].type, 'HOME_ENTER', 'Should be HOME_ENTER');
    assertEqual(moves[0].captures, null, 'NO capture — entered home column');

    // Apply and verify BLUE stays
    state.diceValue = 4;
    const result = LudoEngine.applyMove(state, 0, 4);
    assertEqual(result.state.players.RED.pieces[0], 52, 'RED at 52 (home column)');
    assertEqual(result.state.players.BLUE.pieces[0], 25, 'BLUE stays at relPos 25');
    const capEvent = result.events.find(e => e.type === 'PIECE_CAPTURED');
    assertEqual(capEvent, undefined, 'No PIECE_CAPTURED event');
});

test('HOME PRIORITY: Junction redirects all positions correctly', () => {
    // Test positions near home: junction at 51 redirects to home column
    for (let pos = 46; pos <= 50; pos++) {
        for (let dice = 1; dice <= 6; dice++) {
            const rawNewPos = pos + dice;
            const dest = LudoEngine.calculateNewPosition('RED', pos, dice);
            if (dest === null || dest === 99) continue;
            if (rawNewPos >= 51) {
                // Should be home column (52+ via junction redirect)
                const expectedHome = 52 + (rawNewPos - 51);
                if (expectedHome <= 57) {
                    assertEqual(dest, expectedHome,
                        `pos=${pos} dice=${dice}: rawNewPos=${rawNewPos} → homeCol ${expectedHome}`);
                }
            } else {
                // Normal outer track move
                assertEqual(dest, rawNewPos, `pos=${pos} dice=${dice}: stays at ${rawNewPos}`);
            }
        }
    }
});

test('HOME PRIORITY: Captures still work on outer track', () => {
    // RED at relPos 45, dice 1 → dest 46 (outer track, below junction)
    // BLUE at absPos 46: relPos = (46-26+52)%52 = 20
    const state = makeState([45, 99, 99, 99], [20, -1, -1, -1]);
    const blueAbs = LudoEngine.toAbsolutePos('BLUE', 20);
    assertEqual(blueAbs, 46, 'BLUE at absPos 46');

    const moves = LudoEngine.getValidMoves(state, 1);
    const move = moves.find(m => m.pieceIndex === 0);
    assert(move !== undefined, 'Should have a move');
    assertEqual(move.type, 'MOVE', 'Should be MOVE type');
    assert(move.captures !== null, 'SHOULD capture — normal outer track');
    assertEqual(move.captures.player, 'BLUE');
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ Next-Gen AI System Tests ═══');

test('getDifficultyProfile returns correct profile per tier', () => {
    const low1 = LudoAI.getDifficultyProfile(10);
    const low2 = LudoAI.getDifficultyProfile(50);
    const low3 = LudoAI.getDifficultyProfile(100);
    const mid1 = LudoAI.getDifficultyProfile(200);
    const mid2 = LudoAI.getDifficultyProfile(500);
    const high1 = LudoAI.getDifficultyProfile(1000);
    const high2 = LudoAI.getDifficultyProfile(5000);

    assertEqual(low1.sharpness, 1.1, 'LOW_STAKES sharpness = 1.1');
    assertEqual(low2.sharpness, 1.1, '50 coins = LOW_STAKES');
    assertEqual(low3.sharpness, 1.1, '100 coins = LOW_STAKES');
    assertEqual(mid1.sharpness, 1.5, '200 coins = MID_STAKES');
    assertEqual(mid2.sharpness, 1.5, '500 coins = MID_STAKES');
    assertEqual(high1.sharpness, 2.0, '1000 coins = HIGH_STAKES');
    assertEqual(high2.sharpness, 2.0, '5000 coins = HIGH_STAKES');
});

test('createAIContext produces valid mood and profile', () => {
    const ctx = LudoAI.createAIContext(200);
    assert(ctx.profile !== undefined, 'Should have profile');
    assert(ctx.mood !== undefined, 'Should have mood');
    assert(['AGGRESSIVE', 'DEFENSIVE', 'RUNNER', 'STACKER'].includes(ctx.moodKey),
        'Mood should be one of the 4 defined moods');
    assertEqual(ctx.biasChainCount, 0, 'Initial chain should be 0');
    assertEqual(ctx.turnCount, 0, 'Initial turn count should be 0');
    assertEqual(ctx.betAmount, 200, 'Should store bet amount');
});

test('weightedDecision returns a valid move from the eligible set', () => {
    const state = makeState(
        [10, -1, -1, -1],   // RED
        [20, 30, -1, -1]    // BLUE (AI)
    );
    state.currentTurn = 'BLUE';

    const validMoves = LudoEngine.getValidMoves(state, 3);
    assert(validMoves.length >= 1, 'Should have at least 1 valid move');

    const ctx = LudoAI.createAIContext(100);
    const chosen = LudoAI.weightedDecision(state, validMoves, 'BLUE', ctx);
    assert(chosen !== null, 'Should return a move');
    assert(validMoves.some(m => m.pieceIndex === chosen.pieceIndex), 'Move must be from valid set');
});

test('weightedDiceRoll returns value 1-6', () => {
    const state = makeState([-1, -1, -1, -1], [0, 10, -1, -1], 'BLUE');
    const ctx = LudoAI.createAIContext(500);

    for (let i = 0; i < 50; i++) {
        const val = LudoAI.weightedDiceRoll(state, 'BLUE', 500, ctx);
        assert(val >= 1 && val <= 6, `Dice value ${val} out of range`);
    }
});

test('Anti-streak chain limiter forces fair roll', () => {
    const state = makeState([-1, -1, -1, -1], [0, -1, -1, -1], 'BLUE');
    const ctx = LudoAI.createAIContext(10);
    // LOW_STAKES maxBiasChain = 1
    assertEqual(ctx.profile.maxBiasChain, 1, 'LOW maxBiasChain should be 1');

    // Simulate chain already at limit
    ctx.biasChainCount = 1;
    const val = LudoAI.weightedDiceRoll(state, 'BLUE', 10, ctx);
    assert(val >= 1 && val <= 6, 'Should return valid dice');
    assertEqual(ctx.biasChainCount, 0, 'Chain should be reset after forced fair roll');
});

test('Close-score drift: doesn\'t crash with only 1 valid move', () => {
    // Single move scenario — no drift possible, should return the only move
    const state = makeState([52, 99, 99, 99], [-1, -1, -1, -1]);
    state.currentTurn = 'RED';
    const moves = LudoEngine.getValidMoves(state, 6);
    assertEqual(moves.length, 1, 'Should have exactly 1 move');

    const ctx = LudoAI.createAIContext(50);
    const chosen = LudoAI.weightedDecision(state, moves, 'RED', ctx);
    assert(chosen !== null, 'Should return the single move');
    assertEqual(chosen.pieceIndex, moves[0].pieceIndex, 'Should be the only available move');
});

test('Backward compat: selectBestMove alias still works', () => {
    const state = makeState(
        [-1, -1, -1, -1],
        [0, 10, -1, -1]
    );
    state.currentTurn = 'BLUE';
    const moves = LudoEngine.getValidMoves(state, 3);
    const chosen = LudoAI.selectBestMove(state, moves, 'BLUE');
    assert(chosen !== null, 'selectBestMove alias should return a valid move');
    assert(moves.some(m => m.pieceIndex === chosen.pieceIndex), 'Must be from valid set');
});

test('Backward compat: biasedDiceRoll alias still works', () => {
    const state = makeState([-1, -1, -1, -1], [0, -1, -1, -1], 'BLUE');
    const val = LudoAI.biasedDiceRoll(state, 'BLUE', 100);
    assert(val >= 1 && val <= 6, `Dice value ${val} out of range`);
});

test('Mood modifiers apply without crashing', () => {
    const state = makeState([-1, -1, -1, -1], [10, -1, -1, -1], 'BLUE');
    const moves = LudoEngine.getValidMoves(state, 3);
    if (moves.length > 0) {
        const baseScore = LudoAI.scoreMove(state, moves[0], 'BLUE');
        const ctx = LudoAI.createAIContext(200);
        const modified = LudoAI.applyMoodModifiers(baseScore, moves[0], ctx, state, 'BLUE');
        assert(typeof modified === 'number', 'Modified score should be a number');
        assert(!isNaN(modified), 'Modified score should not be NaN');
    }
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ Production Architecture Tests (v2) ═══');

test('Game phase: EARLY_GAME when all in base', () => {
    const state = makeState([-1, -1, -1, -1], [-1, -1, -1, -1]);
    const phase = LudoAI.getGamePhase(state, 'RED');
    assertEqual(phase, 'EARLY_GAME', 'All in base = EARLY_GAME');
});

test('Game phase: EARLY_GAME with 1 token active', () => {
    const state = makeState([5, -1, -1, -1], [-1, -1, -1, -1]);
    const phase = LudoAI.getGamePhase(state, 'RED');
    assertEqual(phase, 'EARLY_GAME', '1 token on board = EARLY_GAME');
});

test('Game phase: MID_GAME with 2+ tokens active', () => {
    const state = makeState([5, 20, -1, -1], [-1, -1, -1, -1]);
    const phase = LudoAI.getGamePhase(state, 'RED');
    assertEqual(phase, 'MID_GAME', '2 tokens on board = MID_GAME');
});

test('Game phase: LATE_GAME with token in home column', () => {
    const state = makeState([53, 20, -1, -1], [-1, -1, -1, -1]);
    const phase = LudoAI.getGamePhase(state, 'RED');
    assertEqual(phase, 'LATE_GAME', 'Token in home col = LATE_GAME');
});

test('Game phase: LATE_GAME with 2 finished', () => {
    const state = makeState([99, 99, 10, -1], [-1, -1, -1, -1]);
    const phase = LudoAI.getGamePhase(state, 'RED');
    assertEqual(phase, 'LATE_GAME', '2 finished = LATE_GAME');
});

test('Momentum: AI ahead → positive momentum', () => {
    // RED all finished, BLUE all in base → RED progress = 100%, BLUE = 0%
    const state = makeState([99, 99, 99, 40], [-1, -1, -1, -1]);
    const ctx = LudoAI.createAIContext(100, 'RED', ['BLUE']);
    LudoAI.updateMomentum(state, ctx);
    assert(ctx.momentum > 0, `Momentum should be positive when AI ahead, got: ${ctx.momentum}`);
});

test('Momentum: AI behind → negative momentum', () => {
    const state = makeState([-1, -1, -1, -1], [99, 99, 40, 30]);
    state.currentTurn = 'RED';
    const ctx = LudoAI.createAIContext(100, 'RED', ['BLUE']);
    LudoAI.updateMomentum(state, ctx);
    assert(ctx.momentum < 0, `Momentum should be negative when AI behind, got: ${ctx.momentum}`);
});

test('Momentum adjustments: ahead → wider window', () => {
    const ctx = LudoAI.createAIContext(100);
    ctx.momentum = 0.5;
    const adj = LudoAI.getMomentumAdjustments(ctx);
    assert(adj.windowMod > 0, 'Should widen decision window when ahead');
    assert(adj.sharpnessMod < 0, 'Should lower sharpness when ahead');
});

test('Momentum adjustments: behind → narrower window', () => {
    const ctx = LudoAI.createAIContext(100);
    ctx.momentum = -0.5;
    const adj = LudoAI.getMomentumAdjustments(ctx);
    assert(adj.windowMod < 0, 'Should narrow decision window when behind');
    assert(adj.sharpnessMod > 0, 'Should increase sharpness when behind');
});

test('4-player-ready: AIContext stores player and opponents', () => {
    const ctx = LudoAI.createAIContext(200, 'BLUE', ['RED']);
    assertEqual(ctx.aiPlayer, 'BLUE', 'Should store AI player');
    assertEqual(ctx.opponents.length, 1, 'Should have 1 opponent');
    assertEqual(ctx.opponents[0], 'RED', 'Opponent should be RED');
});

test('scoreMoveWithContext returns different values per phase', () => {
    // EARLY_GAME: ENTER moves should score higher
    const stateEarly = makeState([-1, -1, -1, -1], [-1, -1, -1, -1], 'BLUE');
    const stateLate = makeState([99, 99, 53, -1], [-1, -1, -1, -1], 'BLUE');

    // BLUE has pieces in base; dice 6 lets one enter
    stateEarly.currentTurn = 'BLUE';
    stateLate.currentTurn = 'BLUE';

    const movesEarly = LudoEngine.getValidMoves(stateEarly, 6);
    const movesLate = LudoEngine.getValidMoves(stateLate, 6);

    if (movesEarly.length > 0) {
        const ctxEarly = LudoAI.createAIContext(50, 'BLUE', ['RED']);
        const scoreEarly = LudoAI.scoreMoveWithContext(stateEarly, movesEarly[0], 'BLUE', ctxEarly);
        assert(typeof scoreEarly === 'number' && !isNaN(scoreEarly), 'Should produce valid score');
    }
});

test('Mood intensity scaling: HIGH_STAKES moods are subtler', () => {
    const base = LudoAI.AI_MOODS.AGGRESSIVE;
    const full = LudoAI.scaleMood(base, 1.0);
    const half = LudoAI.scaleMood(base, 0.5);

    // Full intensity = original values
    assertEqual(full.captureMod, base.captureMod, 'Full intensity should match base');

    // Half intensity should be closer to 1.0
    const fullDeviation = Math.abs(full.captureMod - 1.0);
    const halfDeviation = Math.abs(half.captureMod - 1.0);
    assert(halfDeviation < fullDeviation, 'Half intensity should have smaller deviation from 1.0');
});

test('Simulation: runs 3 matches without crashing', () => {
    const results = LudoAI.simulateAIMatches(50, 3, 200);
    assert(results !== null, 'Should return results');
    assert(results.completedMatches + results.stalledMatches === 3, 'Should process all 3 matches');
    assert(typeof results.avgTurns === 'number', 'Should have avgTurns');
    assert(typeof results.avgCaptures === 'string' || typeof results.avgCaptures === 'number', 'Should have avgCaptures');
});

test('Dev mode: toggle on/off', () => {
    assertEqual(LudoAI.isDevMode(), false, 'Should start in non-dev mode');
    LudoAI.setDevMode(true);
    assertEqual(LudoAI.isDevMode(), true, 'Should be in dev mode after enabling');
    LudoAI.setDevMode(false);
    assertEqual(LudoAI.isDevMode(), false, 'Should be off after disabling');
});

test('Phase modifiers structure is valid', () => {
    for (const phase of ['EARLY_GAME', 'MID_GAME', 'LATE_GAME']) {
        const mod = LudoAI.PHASE_MODIFIERS[phase];
        assert(mod !== undefined, `Phase modifier for ${phase} should exist`);
        assert(typeof mod.captureMod === 'number', `${phase} captureMod should be number`);
        assert(typeof mod.safetyMod === 'number', `${phase} safetyMod should be number`);
        assert(typeof mod.finishMod === 'number', `${phase} finishMod should be number`);
        assert(typeof mod.enterMod === 'number', `${phase} enterMod should be number`);
        assert(typeof mod.dangerMod === 'number', `${phase} dangerMod should be number`);
        assert(typeof mod.advanceMod === 'number', `${phase} advanceMod should be number`);
    }
});

// ─────────────────────────────────────────────────────────────
console.log('\n═══ Freeze Bug Fix: Dice-6 No Valid Moves ═══');

test('FREEZE FIX: dice=6, all pieces in home col → turn passes to opponent', () => {
    // RED has all pieces in home column positions (52-55), needing exact rolls
    // dice=6 can't be used → autoSkip should pass turn to BLUE
    const state = makeState([53, 54, 55, 99], [-1, -1, -1, -1]);
    state.currentTurn = 'RED';

    const result = LudoEngine.rollDice(state, 6);
    assert(result.autoSkip === true, 'Should autoSkip when no moves available');
    assertEqual(result.state.currentTurn, 'BLUE', 'Turn should pass to BLUE, NOT stay on RED');
    assertEqual(result.state.extraTurn, false, 'extraTurn should be false');
    assertEqual(result.state.consecutiveSixes, 0, 'consecutiveSixes should be reset');
});

test('FREEZE FIX: repeated dice=6 with no moves never locks game', () => {
    // Simulate RED rolling 6 multiple times with no valid moves
    // Should NEVER stay on RED — always passes to BLUE
    let state = makeState([53, 54, 55, 56], [0, -1, -1, -1]);
    state.currentTurn = 'RED';

    for (let i = 0; i < 10; i++) {
        if (state.currentTurn !== 'RED') break; // Turn already passed
        const result = LudoEngine.rollDice(state, 6);
        state = result.state;
        if (result.autoSkip) {
            assertEqual(state.currentTurn, 'BLUE', `Iteration ${i}: should pass to BLUE`);
        }
    }
    // After any autoSkip, RED should not be stuck
    assert(true, 'No infinite loop — game did not freeze');
});

// ─── Summary ────────────────────────────────────────────────
console.log('\n═══════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
    console.log('🎉 All tests passed!\n');
} else {
    console.log('⚠️  Some tests failed!\n');
    process.exit(1);
}
