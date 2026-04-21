/**
 * ludo-board.js — JeetoPlay Ludo Board Renderer v5
 * 
 * PREMIUM Canvas-based Ludo board with:
 *   - Ultra-vibrant, neon-bright colors on rich dark background
 *   - 3D Pawn-shaped pieces (tall dome + base ring + deep shadow)
 *   - Big, clearly visible tokens
 *   - Vivid glowing player quadrants
 *   - High-contrast track cells
 *   - Smooth step-by-step piece movement animation
 *   - Premium safe-spot markers
 *   - Smooth touch/click interaction
 */

'use strict';

const LudoBoard = (() => {
    let canvas, ctx;
    let cellSize = 0;
    let boardSize = 0;
    let currentState = null;
    let highlightedMoves = [];
    let selectedPiece = null;
    let onPieceSelected = null;

    // Animation state
    let animating = false;
    let animPiece = null;

    const GRID = 15;

    // ─── Color perspective mapping ─────────────────────────
    // Maps engine colors → display colors. Identity by default.
    // For the BLUE player, invert so their tokens render as RED.
    let colorMap = { RED: 'RED', BLUE: 'BLUE' };

    /** Set the color perspective for this client */
    function setColorPerspective(map) { colorMap = map; }

    /** Map engine color → display color (for C[] lookup only) */
    function dc(engineColor) { return colorMap[engineColor] || engineColor; }

    // ─── ULTRA-VIVID color palette ─────────────────────────

    const C = {
        RED: { fill: '#FF1744', mid: '#F50057', dark: '#C51162', light: '#FF616F', glow: 'rgba(255,23,68,0.65)', bg: 'rgba(255,23,68,0.18)', track: 'rgba(255,23,68,0.45)', accent: '#FF8A80' },
        BLUE: { fill: '#2979FF', mid: '#448AFF', dark: '#0D47A1', light: '#82B1FF', glow: 'rgba(41,121,255,0.65)', bg: 'rgba(41,121,255,0.18)', track: 'rgba(41,121,255,0.45)', accent: '#80D8FF' },
        GREEN: { fill: '#00E676', mid: '#00C853', dark: '#00A04A', light: '#69F0AE', glow: 'rgba(0,230,118,0.65)', bg: 'rgba(0,230,118,0.18)', track: 'rgba(0,230,118,0.45)', accent: '#B9F6CA' },
        YELLOW: { fill: '#FFAB00', mid: '#FF8F00', dark: '#E65100', light: '#FFD740', glow: 'rgba(255,171,0,0.65)', bg: 'rgba(255,171,0,0.18)', track: 'rgba(255,171,0,0.45)', accent: '#FFE57F' }
    };

    // ─── Init ───────────────────────────────────────────────

    function init(canvasEl, callback) {
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        onPieceSelected = callback;
        resize();
        window.addEventListener('resize', resize);
        canvas.addEventListener('click', onClick);
        canvas.addEventListener('touchstart', onTouch, { passive: false });
    }

    function resize() {
        const container = canvas.parentElement;
        const size = Math.min(container.clientWidth, container.clientHeight);
        if (size <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        boardSize = size;
        cellSize = size / GRID;
        if (currentState) render(currentState, highlightedMoves);
    }

    // ─── Main Render ────────────────────────────────────────

    function render(state, validMoves = []) {
        currentState = state;
        highlightedMoves = validMoves;
        if (!boardSize) return;
        ctx.clearRect(0, 0, boardSize, boardSize);

        drawBoard();
        drawTrack();
        drawHomeColumns();
        drawCenter();
        drawSafeStars();
        drawPieces(state);
        drawMoveIndicators(validMoves);
    }

    // ─── Board Background ───────────────────────────────────

    function drawBoard() {
        // Rich dark gradient background
        const bg = ctx.createLinearGradient(0, 0, boardSize, boardSize);
        bg.addColorStop(0, '#0a0a1e');
        bg.addColorStop(0.5, '#0f0f28');
        bg.addColorStop(1, '#0a0a1e');
        ctx.fillStyle = bg;
        rr(0, 0, boardSize, boardSize, 16, true);

        // Subtle radial glow in center
        const centerGlow = ctx.createRadialGradient(boardSize / 2, boardSize / 2, 0, boardSize / 2, boardSize / 2, boardSize * 0.45);
        centerGlow.addColorStop(0, 'rgba(100, 80, 200, 0.06)');
        centerGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = centerGlow;
        ctx.fillRect(0, 0, boardSize, boardSize);

        // Grid lines (subtle elegant)
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= GRID; i++) {
            line(i * cellSize, 0, i * cellSize, boardSize);
            line(0, i * cellSize, boardSize, i * cellSize);
        }

        // Quadrant yards with vivid colors
        drawYard(0, 9, 6, 6, C[dc('RED')], 'RED');
        drawYard(0, 0, 6, 6, C.GREEN, null);
        drawYard(9, 0, 6, 6, C[dc('BLUE')], 'BLUE');
        drawYard(9, 9, 6, 6, C.YELLOW, null);
    }

    function drawYard(gx, gy, gw, gh, color, playerKey) {
        const x = gx * cellSize + 2, y = gy * cellSize + 2;
        const w = gw * cellSize - 4, h = gh * cellSize - 4;

        // Outer glow (larger, more vivid)
        ctx.shadowColor = color.glow;
        ctx.shadowBlur = 28;
        ctx.fillStyle = color.bg;
        rr(x, y, w, h, 12, true);
        ctx.shadowBlur = 0;

        // Gradient fill overlay for richness
        const yardGrad = ctx.createLinearGradient(x, y, x + w, y + h);
        yardGrad.addColorStop(0, color.fill + '12');
        yardGrad.addColorStop(0.5, color.fill + '08');
        yardGrad.addColorStop(1, color.fill + '15');
        ctx.fillStyle = yardGrad;
        rr(x, y, w, h, 12, true);

        // Bright border
        ctx.strokeStyle = color.fill + '60';
        ctx.lineWidth = 2;
        rr(x, y, w, h, 12, false, true);

        // Inner base area
        const pad = w * 0.16;
        const innerGrad = ctx.createLinearGradient(x + pad, y + pad, x + w - pad, y + h - pad);
        innerGrad.addColorStop(0, 'rgba(0,0,0,0.35)');
        innerGrad.addColorStop(1, 'rgba(0,0,0,0.20)');
        ctx.fillStyle = innerGrad;
        rr(x + pad, y + pad, w - pad * 2, h - pad * 2, 10, true);
        ctx.strokeStyle = color.fill + '40';
        ctx.lineWidth = 1.5;
        rr(x + pad, y + pad, w - pad * 2, h - pad * 2, 10, false, true);

        // Base piece position circles
        const dotR = cellSize * 0.34;
        const cs = cellSize;

        if (playerKey) {
            const layout = LudoEngine.getBoardLayout();
            const basePos = layout.basePositions[playerKey];
            if (basePos) {
                basePos.forEach(pos => {
                    const cx = pos.x * cs + cs / 2;
                    const cy = pos.y * cs + cs / 2;

                    // Glowing ring for base spots
                    ctx.shadowColor = color.fill + '40';
                    ctx.shadowBlur = 8;
                    ctx.fillStyle = color.fill + '18';
                    ctx.beginPath();
                    ctx.arc(cx, cy, dotR + 3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;

                    ctx.strokeStyle = color.fill + '45';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(cx, cy, dotR + 3, 0, Math.PI * 2);
                    ctx.stroke();
                });
            }
        } else {
            const innerX = x + pad + (w - pad * 2) * 0.25;
            const innerY = y + pad + (h - pad * 2) * 0.25;
            const spacing = (w - pad * 2) * 0.5;
            for (let row = 0; row < 2; row++) {
                for (let col = 0; col < 2; col++) {
                    const cx = innerX + col * spacing;
                    const cy = innerY + row * spacing;
                    ctx.fillStyle = color.fill + '18';
                    ctx.beginPath();
                    ctx.arc(cx, cy, dotR + 3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = color.fill + '45';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(cx, cy, dotR + 3, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
    }

    // ─── Track Cells ────────────────────────────────────────

    function drawTrack() {
        const layout = LudoEngine.getBoardLayout();
        const cs = cellSize, p = 1;

        for (let i = 0; i < layout.mainTrack.length; i++) {
            const { x, y } = layout.mainTrack[i];
            const px = x * cs + p, py = y * cs + p, s = cs - p * 2;

            let fill, border;
            if (i === 0) { fill = C.RED.track; border = C.RED.fill + '80'; }
            else if (i === 13) { fill = C.GREEN.track; border = C.GREEN.fill + '80'; }
            else if (i === 26) { fill = C.BLUE.track; border = C.BLUE.fill + '80'; }
            else if (i === 39) { fill = C.YELLOW.track; border = C.YELLOW.fill + '80'; }
            else {
                // Normal track: much brighter, clearly visible
                fill = 'rgba(255,255,255,0.18)';
                border = 'rgba(255,255,255,0.30)';
            }

            // Cell fill
            ctx.fillStyle = fill;
            ctx.strokeStyle = border;
            ctx.lineWidth = 1;
            rr(px, py, s, s, 3, true, true);

            // Subtle inner highlight for depth
            const innerGlow = ctx.createLinearGradient(px, py, px, py + s);
            innerGlow.addColorStop(0, 'rgba(255,255,255,0.06)');
            innerGlow.addColorStop(1, 'rgba(0,0,0,0.04)');
            ctx.fillStyle = innerGlow;
            rr(px + 1, py + 1, s - 2, s - 2, 2, true);
        }
    }

    // ─── Home Columns ───────────────────────────────────────

    function drawHomeColumns() {
        const layout = LudoEngine.getBoardLayout();
        const cs = cellSize, p = 1;

        const drawCol = (positions, color) => {
            positions.forEach((pos, i) => {
                const px = pos.x * cs + p, py = pos.y * cs + p, s = cs - p * 2;
                // Progressively brighter toward center
                const alpha = 0.25 + (i / 5) * 0.35;
                ctx.fillStyle = color.fill + Math.round(alpha * 255).toString(16).padStart(2, '0');
                ctx.strokeStyle = color.fill + '55';
                ctx.lineWidth = 1;
                rr(px, py, s, s, 3, true, true);

                // Glow effect on home column cells
                ctx.shadowColor = color.glow;
                ctx.shadowBlur = 6 + i * 2;
                ctx.fillStyle = color.fill + '08';
                rr(px, py, s, s, 3, true);
                ctx.shadowBlur = 0;

                // Arrow indicator
                ctx.fillStyle = color.fill + '88';
                ctx.font = `bold ${cs * 0.32}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                if (color === C.RED) ctx.fillText('▲', pos.x * cs + cs / 2, pos.y * cs + cs / 2);
                else if (color === C.BLUE) ctx.fillText('▼', pos.x * cs + cs / 2, pos.y * cs + cs / 2);
                else if (color === C.GREEN) ctx.fillText('▶', pos.x * cs + cs / 2, pos.y * cs + cs / 2);
                else ctx.fillText('◀', pos.x * cs + cs / 2, pos.y * cs + cs / 2);
            });
        };

        drawCol(layout.homeColumns.RED, C[dc('RED')]);
        drawCol(layout.homeColumns.BLUE, C[dc('BLUE')]);
        drawCol(layout.homeColumns.GREEN, C.GREEN);
        drawCol(layout.homeColumns.YELLOW, C.YELLOW);
    }

    // ─── Center Finish ──────────────────────────────────────

    function drawCenter() {
        const cx = 7.5 * cellSize, cy = 7.5 * cellSize;
        const r = cellSize * 1.3;

        // Outer glow (large, colorful)
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
        glow.addColorStop(0, 'rgba(100,200,255,0.12)');
        glow.addColorStop(0.4, 'rgba(0,255,136,0.06)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 2.5, cy - r * 2.5, r * 5, r * 5);

        // Four triangular segments with vivid gradients
        const colors = [C.GREEN, C.BLUE, C.YELLOW, C.RED];
        const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, angles[i] - Math.PI / 4, angles[i] + Math.PI / 4);
            ctx.closePath();
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, colors[i].fill + '55');
            g.addColorStop(0.6, colors[i].fill + '25');
            g.addColorStop(1, colors[i].bg);
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = colors[i].fill + '35';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Center hub with premium gradient
        ctx.beginPath();
        ctx.arc(cx, cy, cellSize * 0.55, 0, Math.PI * 2);
        const cg = ctx.createRadialGradient(cx - 3, cy - 3, 0, cx, cy, cellSize * 0.55);
        cg.addColorStop(0, '#2a2a55');
        cg.addColorStop(0.7, '#151535');
        cg.addColorStop(1, '#0a0a20');
        ctx.fillStyle = cg;
        ctx.fill();

        // Glowing ring around hub
        ctx.shadowColor = 'rgba(0,255,136,0.5)';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(0,255,136,0.55)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Home icon
        ctx.fillStyle = 'rgba(0,255,136,0.80)';
        ctx.font = `${cellSize * 0.55}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🏠', cx, cy + 1);
    }

    // ─── Safe Spot Stars ────────────────────────────────────

    function drawSafeStars() {
        const layout = LudoEngine.getBoardLayout();
        const cs = cellSize;

        LudoEngine.SAFE_SPOTS.forEach(absPos => {
            const pos = layout.mainTrack[absPos];
            if (!pos) return;
            const px = pos.x * cs + cs / 2, py = pos.y * cs + cs / 2;

            // Golden glow
            ctx.shadowColor = 'rgba(255,215,0,0.5)';
            ctx.shadowBlur = 12;
            ctx.fillStyle = 'rgba(255,215,0,0.25)';
            ctx.beginPath();
            ctx.arc(px, py, cs * 0.40, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Bright star
            ctx.fillStyle = 'rgba(255,215,0,0.85)';
            ctx.font = `${cs * 0.45}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', px, py + 1);
        });
    }

    // ─── Draw Single 3D Pawn Token ──────────────────────────

    function drawToken(px, py, color, idx, options = {}) {
        const r = cellSize * 0.42;  // BIGGER radius for premium feel
        const { isMovable, isSelected, isActive, isGhost } = options;

        if (isGhost) {
            ctx.globalAlpha = 0.25;
        }

        // ── Movable glow ring (pulsing) ──
        if (isMovable && isActive) {
            ctx.shadowColor = color.glow;
            ctx.shadowBlur = 22;
            ctx.strokeStyle = color.fill + 'cc';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(px, py, r + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        if (isSelected) {
            ctx.shadowColor = color.glow;
            ctx.shadowBlur = 30;
        }

        // ── Deep shadow underneath ──
        ctx.beginPath();
        ctx.ellipse(px, py + r * 0.35, r * 0.85, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.50)';
        ctx.fill();

        // ── Base ring (3D bottom) ──
        ctx.beginPath();
        ctx.ellipse(px, py + r * 0.15, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
        const baseGrad = ctx.createLinearGradient(px, py - r * 0.3, px, py + r * 0.6);
        baseGrad.addColorStop(0, color.dark);
        baseGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = baseGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Main dome body ──
        const bodyGrad = ctx.createRadialGradient(
            px - r * 0.25, py - r * 0.4, r * 0.05,
            px, py - r * 0.05, r * 0.95
        );
        bodyGrad.addColorStop(0, '#ffffff');
        bodyGrad.addColorStop(0.12, color.accent || color.light);
        bodyGrad.addColorStop(0.35, color.light);
        bodyGrad.addColorStop(0.6, color.fill);
        bodyGrad.addColorStop(0.85, color.mid);
        bodyGrad.addColorStop(1, color.dark);

        ctx.beginPath();
        ctx.arc(px, py - r * 0.05, r * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = bodyGrad;
        ctx.fill();

        // ── Bright rim ──
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── Inner contour ring for 3D depth ──
        ctx.beginPath();
        ctx.arc(px, py - r * 0.05, r * 0.60, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Top dome highlight (spherical glass shine) ──
        const shineGrad = ctx.createRadialGradient(
            px - r * 0.25, py - r * 0.35, 0,
            px - r * 0.15, py - r * 0.25, r * 0.55
        );
        shineGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
        shineGrad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
        shineGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(px - r * 0.1, py - r * 0.22, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = shineGrad;
        ctx.fill();

        // ── Secondary bottom shine (rim reflection) ──
        const bottomShine = ctx.createRadialGradient(
            px + r * 0.15, py + r * 0.25, 0,
            px + r * 0.15, py + r * 0.25, r * 0.3
        );
        bottomShine.addColorStop(0, 'rgba(255,255,255,0.12)');
        bottomShine.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(px + r * 0.1, py + r * 0.18, r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = bottomShine;
        ctx.fill();

        // ── Center jewel dot ──
        ctx.beginPath();
        ctx.arc(px, py - r * 0.05, r * 0.16, 0, Math.PI * 2);
        const jewelGrad = ctx.createRadialGradient(px - 1, py - r * 0.07, 0, px, py - r * 0.05, r * 0.16);
        jewelGrad.addColorStop(0, 'rgba(255,255,255,0.7)');
        jewelGrad.addColorStop(1, 'rgba(255,255,255,0.2)');
        ctx.fillStyle = jewelGrad;
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // ── Piece number (bold, visible) ──
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.font = `bold ${r * 0.55}px 'Inter', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(idx + 1, px + 0.5, py - r * 0.03);
        // White shadow for readability
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(idx + 1, px, py - r * 0.05);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(idx + 1, px + 0.5, py - r * 0.03);

        if (isGhost) {
            ctx.globalAlpha = 1;
        }
    }

    // ─── 3D Token Pieces ────────────────────────────────────

    function drawPieces(state) {
        if (!state) return;

        ['RED', 'BLUE'].forEach(player => {
            const pieces = state.players[player].pieces;
            const color = C[dc(player)];

            pieces.forEach((relPos, idx) => {
                // Skip the piece that's currently animating
                if (animating && animPiece && animPiece.player === player && animPiece.pieceIndex === idx) {
                    return;
                }

                const coords = LudoEngine.getPieceCoords(player, idx, relPos);
                const px = coords.x * cellSize + cellSize / 2;
                const py = coords.y * cellSize + cellSize / 2;
                const isMovable = highlightedMoves.some(m => m.pieceIndex === idx);
                const isSelected = selectedPiece?.player === player && selectedPiece?.pieceIndex === idx;
                const isActive = state.currentTurn === player;

                drawToken(px, py, color, idx, { isMovable, isSelected, isActive });
            });
        });

        // Draw the animated piece on top
        if (animating && animPiece) {
            const color = C[dc(animPiece.player)];
            drawToken(animPiece.currentX, animPiece.currentY, color, animPiece.pieceIndex, {});
        }
    }

    // ─── Piece Movement Animation ───────────────────────────

    /**
     * Animate a piece moving from one position to another, step-by-step.
     * @param {string} player - 'RED' or 'BLUE'
     * @param {number} pieceIndex - 0-3
     * @param {number} fromRelPos - Starting position (player-relative)
     * @param {number} toRelPos - Destination position (player-relative)
     * @param {Object} stateSnapshot - Game state snapshot to render during animation
     * @param {Function} callback - Called when animation completes
     */
    function animateMove(player, pieceIndex, fromRelPos, toRelPos, stateSnapshot, callback) {
        if (!boardSize || !cellSize) {
            if (callback) callback();
            return;
        }

        // Build the path of grid positions for each step
        const path = [];
        const layout = LudoEngine.getBoardLayout();
        const BOARD_SIZE = 52;

        // Entering from base
        if (fromRelPos === -1) {
            // Base -> entry position (usually relPos 0)
            path.push(LudoEngine.getPieceCoords(player, pieceIndex, fromRelPos)); // base
            path.push(LudoEngine.getPieceCoords(player, pieceIndex, 0)); // entry point
            // If toRelPos > 0, continue stepping
            for (let p = 1; p <= toRelPos && p < 99; p++) {
                path.push(LudoEngine.getPieceCoords(player, pieceIndex, p));
            }
        } else if (toRelPos === 99) {
            // Moving to finish
            for (let p = fromRelPos; p < BOARD_SIZE + 6; p++) {
                const coords = LudoEngine.getPieceCoords(player, pieceIndex, p);
                path.push(coords);
                if (p === toRelPos || (coords.x === 7 && coords.y === 7)) break;
            }
            // Add final finish position
            path.push(LudoEngine.getPieceCoords(player, pieceIndex, 99));
        } else {
            // Normal movement or HOME_ENTER: step through each position
            const startP = fromRelPos < 0 ? 0 : fromRelPos;
            const BOARD = LudoEngine.BOARD_SIZE;
            if (toRelPos >= BOARD && fromRelPos < BOARD) {
                // HOME_ENTER: Walk through outer track cells up to pos 50.
                // Skip pos 51 (junction — pass-through, maps to {6,14}).
                // Then step into home column from pos 52 ({7,13}) onwards.
                // This gives a smooth visual path with no reversal.
                const junction = BOARD - 1; // 51
                for (let p = startP; p < junction; p++) {
                    path.push(LudoEngine.getPieceCoords(player, pieceIndex, p));
                }
                // Step through home column cells (52+)
                for (let p = BOARD; p <= toRelPos; p++) {
                    path.push(LudoEngine.getPieceCoords(player, pieceIndex, p));
                }
            } else {
                for (let p = startP; p <= toRelPos; p++) {
                    path.push(LudoEngine.getPieceCoords(player, pieceIndex, p));
                }
            }
        }

        if (path.length < 2) {
            if (callback) callback();
            return;
        }

        // Start animation
        animating = true;
        const startCoords = path[0];
        animPiece = {
            player,
            pieceIndex,
            currentX: startCoords.x * cellSize + cellSize / 2,
            currentY: startCoords.y * cellSize + cellSize / 2,
            path,
            pathIdx: 0,
            stateSnapshot
        };

        const HOP_DURATION = 90; // ms per cell hop
        let lastTime = performance.now();
        let hopProgress = 0;

        function animFrame(now) {
            if (!animating || !animPiece) return;

            const dt = now - lastTime;
            lastTime = now;
            hopProgress += dt;

            const fromCoord = animPiece.path[animPiece.pathIdx];
            const toCoord = animPiece.path[animPiece.pathIdx + 1];

            if (!toCoord) {
                // Animation complete
                animating = false;
                animPiece = null;
                if (callback) callback();
                return;
            }

            // Interpolate with easeOut for snappy feel
            let t = Math.min(hopProgress / HOP_DURATION, 1);
            t = 1 - Math.pow(1 - t, 2); // easeOutQuad

            const fromPx = fromCoord.x * cellSize + cellSize / 2;
            const fromPy = fromCoord.y * cellSize + cellSize / 2;
            const toPx = toCoord.x * cellSize + cellSize / 2;
            const toPy = toCoord.y * cellSize + cellSize / 2;

            // Add a tiny bounce/hop effect on Y axis
            const bounce = Math.sin(t * Math.PI) * cellSize * 0.12;

            animPiece.currentX = fromPx + (toPx - fromPx) * t;
            animPiece.currentY = fromPy + (toPy - fromPy) * t - bounce;

            // Re-render the board with the piece at its current animated position
            render(animPiece.stateSnapshot, []);

            if (t >= 1) {
                // Move to next hop
                animPiece.pathIdx++;
                hopProgress = 0;
                // Small sound tick (if available)
                if (typeof LudoSounds !== 'undefined' && animPiece.pathIdx < animPiece.path.length - 1) {
                    // Soft tick per cell
                }
            }

            requestAnimationFrame(animFrame);
        }

        requestAnimationFrame(animFrame);
    }

    function isAnimating() {
        return animating;
    }

    // ─── Move Indicators ────────────────────────────────────

    function drawMoveIndicators(moves) {
        if (!currentState || !moves.length) return;
        const player = currentState.currentTurn;
        const color = C[dc(player)];
        const cs = cellSize;

        moves.forEach(move => {
            const coords = LudoEngine.getPieceCoords(player, move.pieceIndex, move.to);
            const px = coords.x * cs + cs / 2, py = coords.y * cs + cs / 2;

            // Destination highlight with glow
            ctx.shadowColor = color.glow;
            ctx.shadowBlur = 10;
            ctx.fillStyle = color.fill + '28';
            ctx.beginPath();
            ctx.arc(px, py, cs * 0.42, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = color.fill + '99';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(px, py, cs * 0.38, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            if (move.captures) {
                ctx.fillStyle = 'rgba(255,50,50,0.4)';
                ctx.beginPath();
                ctx.arc(px, py, cs * 0.38, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ff1744';
                ctx.font = `${cs * 0.38}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('⚔', px, py);
            }
        });
    }

    // ─── Input ──────────────────────────────────────────────

    function onClick(e) {
        if (animating) return;
        const rect = canvas.getBoundingClientRect();
        handleInput(e.clientX - rect.left, e.clientY - rect.top);
    }

    function onTouch(e) {
        if (animating) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const t = e.touches[0];
        handleInput(t.clientX - rect.left, t.clientY - rect.top);
    }

    function handleInput(x, y) {
        if (!currentState || !highlightedMoves.length) return;
        const player = currentState.currentTurn;
        const pieces = currentState.players[player].pieces;

        for (const move of highlightedMoves) {
            const coords = LudoEngine.getPieceCoords(player, move.pieceIndex, pieces[move.pieceIndex]);
            const px = coords.x * cellSize + cellSize / 2;
            const py = coords.y * cellSize + cellSize / 2;
            if (Math.hypot(x - px, y - py) < cellSize * 0.60) {
                selectedPiece = { player, pieceIndex: move.pieceIndex };
                if (onPieceSelected) onPieceSelected(move.pieceIndex);
                render(currentState, highlightedMoves);
                return;
            }
        }
    }

    // ─── Dice Rendering ─────────────────────────────────────

    function renderDice(container, value, isRolling = false) {
        if (isRolling) {
            container.classList.add('rolling');
            container.innerHTML = '<div class="dice-value">?</div>';
            return;
        }
        container.classList.remove('rolling');
        if (!value) {
            container.innerHTML = '<div class="dice-value" style="opacity:0.3">🎲</div>';
            return;
        }
        container.classList.add('result');
        setTimeout(() => container.classList.remove('result'), 500);

        const dots = {
            1: [0, 0, 0, 0, 1, 0, 0, 0, 0], 2: [0, 0, 1, 0, 0, 0, 1, 0, 0],
            3: [0, 0, 1, 0, 1, 0, 1, 0, 0], 4: [1, 0, 1, 0, 0, 0, 1, 0, 1],
            5: [1, 0, 1, 0, 1, 0, 1, 0, 1], 6: [1, 0, 1, 1, 0, 1, 1, 0, 1]
        };
        const html = (dots[value] || dots[1]).map(a =>
            `<div class="dice-dot${a ? ' active' : ''}"></div>`
        ).join('');
        container.innerHTML = `<div class="dice-dots">${html}</div>`;
    }

    // ─── Helpers ────────────────────────────────────────────

    function rr(x, y, w, h, r, fill = true, stroke = false) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    function line(x1, y1, x2, y2) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    function clearSelection() { selectedPiece = null; }

    function destroy() {
        window.removeEventListener('resize', resize);
        canvas.removeEventListener('click', onClick);
        canvas.removeEventListener('touchstart', onTouch);
    }

    return { init, render, renderDice, resize, clearSelection, destroy, animateMove, isAnimating, setColorPerspective };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LudoBoard;
else if (typeof window !== 'undefined') window.LudoBoard = LudoBoard;
