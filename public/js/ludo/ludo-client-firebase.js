/**
 * ludo-client-firebase.js — Firebase-Integrated Ludo Client
 * 
 * Extends the standalone client with:
 *   - Firebase Auth (require login to play)
 *   - Wallet integration (deduct on start, credit on win)
 *   - Real balance display
 *   - Cloud Function calls for match start/complete
 *   - Real-player matchmaking queue (25s) → AI fallback
 *   - Natural AI play timing & clear dice UX
 */

'use strict';

const LudoClient = (() => {
    // ─── State ──────────────────────────────────────────────
    let gameState = null;
    let playerColor = 'RED';
    let opponentColor = 'BLUE';
    let isAIOpponent = true;
    let opponentDisplayName = 'Opponent';  // persisted for game-over modal
    let selectedAmount = 50;
    let turnTimer = null;
    let turnTimeLeft = 30;
    let isProcessingMove = false;
    let matchmakingTimer = null;
    let matchmakingElapsed = 0;
    let currentMatchId = null;        // Firebase match ID
    let queueRef = null;              // Firebase queue entry reference
    let queueListener = null;         // Firebase queue listener
    let pvpRoomRef = null;            // Firebase PvP room reference
    let pvpRoomListener = null;       // Firebase PvP room listener
    let playerStrikes = 0;            // Timeout strikes for player
    let opponentStrikes = 0;          // Timeout strikes for opponent
    let aiContext = null;             // Per-match AI context (mood, profile, chain tracking)
    const MAX_STRIKES = 5;            // 5 timeouts = auto-loss
    const MATCHMAKING_TIMEOUT = 25;   // Search for real players for 25 seconds


    const $ = id => document.getElementById(id);

    // ─── Firebase Helpers ───────────────────────────────────

    function getCurrentUser() {
        return firebase.auth().currentUser;
    }

    async function callFunction(name, data) {
        const fn = firebase.functions().httpsCallable(name);
        const result = await fn(data);
        return result.data;
    }

    async function getUserBalance() {
        const user = getCurrentUser();
        if (!user) return { deposit: 0, winning: 0, total: 0 };
        const snap = await firebase.database().ref(`users/${user.uid}`).once('value');
        const data = snap.val() || {};
        return {
            deposit: data.depositBalance || 0,
            winning: data.winningBalance || 0,
            total: data.walletBalance || (data.depositBalance || 0) + (data.winningBalance || 0)
        };
    }

    function listenToBalance() {
        const user = getCurrentUser();
        if (!user) return;
        firebase.database().ref(`users/${user.uid}/walletBalance`).on('value', snap => {
            const bal = snap.val() || 0;
            const balEl = $('lobby-balance');
            if (balEl) balEl.textContent = `Balance: 🪙 ${bal}`;
        });
    }

    // ─── Initialize ─────────────────────────────────────────

    function init() {
        const canvas = $('game-board');
        if (canvas) LudoBoard.init(canvas, onPieceSelected);

        // Bind amount cards
        document.querySelectorAll('.amount-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.amount-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedAmount = parseInt(card.dataset.amount);
                updateWinDisplay();
            });
        });

        const defaultCard = document.querySelector('.amount-card[data-amount="50"]');
        if (defaultCard) defaultCard.classList.add('selected');
        updateWinDisplay();

        // Firebase Auth state
        firebase.auth().onAuthStateChanged(async user => {
            if (user) {
                showScreen('lobby');
                listenToBalance();
                // Fetch display name from DB (more reliable than Auth displayName)
                const snap = await firebase.database().ref(`users/${user.uid}`).once('value');
                const userData = snap.val() || {};
                const resolvedName = user.displayName || userData.fullName || userData.name || userData.username || 'Player';
                const nameEl = $('lobby-user-name');
                if (nameEl) nameEl.textContent = resolvedName;
            } else {
                window.location.href = '/app';
            }
        });
    }

    // ─── Screen Management ──────────────────────────────────

    function showScreen(screen) {
        $('lobby-screen')?.classList.toggle('hidden', screen !== 'lobby');
        $('game-screen')?.classList.toggle('hidden', screen !== 'game');
        $('matchmaking-overlay')?.classList.toggle('hidden', screen !== 'matchmaking');
        $('gameover-overlay')?.classList.toggle('hidden', screen !== 'gameover');
    }

    // ─── Lobby ──────────────────────────────────────────────

    function updateWinDisplay() {
        const commission = 0.15;
        document.querySelectorAll('.win-amount').forEach(el => {
            const cardAmount = parseInt(el.closest('.amount-card')?.dataset.amount || selectedAmount);
            const cardPool = cardAmount * 2;
            const cardWin = Math.floor(cardPool * (1 - commission));
            el.textContent = `Win 🪙 ${cardWin}`;
        });
    }

    // ─── Production-Grade Real Player Matchmaking ─────────

    let matchFound = false;          // single-fire flag: prevents any double-start
    const STALE_TTL = 35000;         // entries older than 35s are stale (cleanup)

    async function startMatchmaking() {
        if (typeof LudoSounds !== 'undefined') LudoSounds.buttonTap();

        const balance = await getUserBalance();
        if (balance.total < selectedAmount) {
            alert(`Insufficient balance (🪙 ${balance.total}). You need 🪙 ${selectedAmount}. Please add funds.`);
            return;
        }

        showScreen('matchmaking');
        matchmakingElapsed = 0;
        matchFound = false;
        updateMatchmakingTimer();

        const user = getCurrentUser();
        if (!user) { startGameWithAI(); return; }

        const myUid = user.uid;
        // Fetch display name from DB
        const userSnap = await firebase.database().ref(`users/${myUid}`).once('value');
        const userData = userSnap.val() || {};
        const myName = user.displayName || userData.fullName || userData.name || userData.username || 'Player';
        const queuePath = `ludo_queue/${selectedAmount}`;

        // ────────────────────────────────────────────────────
        // HELPER: Centralized match-found handler
        // Only the FIRST call succeeds; all subsequent calls are no-ops.
        // ────────────────────────────────────────────────────

        // Called by JOINER — successfully claimed another player's entry
        async function onMatchFoundAsJoiner(opponentUid, opponentName, hostEntryRef) {
            if (matchFound) return;
            matchFound = true;
            clearInterval(matchmakingTimer);

            // Remove own queue entry immediately to prevent others from claiming it
            if (queueRef) {
                queueRef.remove().catch(() => { });
            }

            try {
                // Create PvP match room via cloud function
                const result = await callFunction('startLudoPvPMatch', {
                    opponentUid,
                    amount: selectedAmount,
                    joinerName: myName,
                    opponentName: opponentName
                });

                if (result.success && result.matchId) {
                    // Write matchId to the host's queue entry so they can join the room
                    await hostEntryRef.update({ matchId: result.matchId });
                    cleanupQueue();
                    startPvPGame(result.matchId, 'BLUE', myName, opponentName);
                } else {
                    throw new Error('Failed to create PvP match');
                }
            } catch (err) {
                console.warn('PvP match creation failed, falling back to AI:', err);
                cleanupQueue();
                startGameWithAI(opponentName);
            }
        }

        // NOTE: onMatchFoundAsHost logic is now inline in the self-listener (Stage 1 + Stage 2)

        // ────────────────────────────────────────────────────
        // HELPER: Atomically claim a waiting entry via transaction.
        // Returns true if successfully claimed, false otherwise.
        // ────────────────────────────────────────────────────
        async function tryClaimEntry(entryKey) {
            if (matchFound) return false;
            const entryRef = firebase.database().ref(`${queuePath}/${entryKey}`);
            try {
                const result = await entryRef.transaction(current => {
                    if (!current) return;                           // entry removed
                    if (current.uid === myUid) return;              // it's me
                    if (current.status !== 'waiting') return;       // already claimed

                    // Stale check — skip entries older than STALE_TTL
                    if (current.timestamp && Date.now() - current.timestamp > STALE_TTL) {
                        return;  // abort — stale entry
                    }

                    // Claim it
                    current.status = 'matched';
                    current.matchedWith = myUid;
                    current.matchedName = myName;
                    return current;
                });

                if (result.committed && result.snapshot.exists()) {
                    const data = result.snapshot.val();
                    if (data.status === 'matched' && data.matchedWith === myUid) {
                        // Successfully claimed — I am the joiner
                        const oppUid = data.uid;
                        const oppName = data.displayName || 'Opponent';
                        // Create PvP room, then write matchId back to queue entry
                        await onMatchFoundAsJoiner(oppUid, oppName, entryRef);
                        return true;
                    }
                }
            } catch (e) {
                // Transaction rejected by rules or network error — move on
            }
            return false;
        }

        // ────────────────────────────────────────────────────
        // STEP 1: Register myself in the queue
        // ────────────────────────────────────────────────────
        try {
            queueRef = firebase.database().ref(queuePath).push();
            const myEntryKey = queueRef.key;
            await queueRef.set({
                uid: myUid,
                displayName: myName,
                status: 'waiting',
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });

            // ──────────────────────────────────────────────
            // STEP 2: Self-listener — detect when someone claims ME
            // Two stages:
            //   a) status='matched' → lock matchFound immediately (prevent cross-claims)
            //   b) matchId arrives  → start PvP game
            // ──────────────────────────────────────────────
            let hostWaitingForMatchId = false;
            let hostOpponentName = '';
            let matchIdTimeout = null;

            const selfListener = queueRef.on('value', snap => {
                if (!snap.exists()) return;
                const data = snap.val();

                if (data.status === 'matched' && data.matchedWith) {
                    // STAGE 1: Lock immediately — prevent cross-claims
                    if (!matchFound && !hostWaitingForMatchId) {
                        matchFound = true;
                        hostWaitingForMatchId = true;
                        hostOpponentName = data.matchedName || 'Opponent';
                        clearInterval(matchmakingTimer);

                        // Safety: if matchId doesn't arrive in 15s, fall back to AI
                        matchIdTimeout = setTimeout(() => {
                            if (hostWaitingForMatchId) {
                                hostWaitingForMatchId = false;
                                cleanupQueue();
                                startGameWithAI(hostOpponentName);
                            }
                        }, 15000);
                    }

                    // STAGE 2: matchId arrived — start PvP
                    if (hostWaitingForMatchId && data.matchId) {
                        hostWaitingForMatchId = false;
                        if (matchIdTimeout) clearTimeout(matchIdTimeout);
                        cleanupQueue();
                        startPvPGame(data.matchId, 'RED', myName, hostOpponentName);
                    }
                }
            });

            // ──────────────────────────────────────────────
            // STEP 3: Queue-watcher — detect ANY other waiting player
            // CRITICAL: Only claim entries with keys OLDER than mine
            // (smaller push key = added before me). This ensures
            // only ONE player (the newer one) claims the other,
            // preventing cross-claim races.
            // ──────────────────────────────────────────────
            const queueWatchRef = firebase.database().ref(queuePath)
                .orderByChild('timestamp');

            const childListener = queueWatchRef.on('child_added', snap => {
                if (matchFound) return;
                const data = snap.val();
                if (!data || data.uid === myUid) return;           // skip self
                if (data.status !== 'waiting') return;             // skip non-waiting

                // ANTI-CROSS-CLAIM: Only claim entries that existed BEFORE mine
                // Newer entries (larger push key) must claim ME, not the other way
                if (snap.key >= myEntryKey) return;

                // Skip stale entries (player likely crashed/abandoned)
                if (data.timestamp && Date.now() - data.timestamp > STALE_TTL) {
                    return;
                }

                // Try to claim this player
                tryClaimEntry(snap.key);
            });

            // Store references for cleanup
            queueListener = { selfListener, childListener, queueWatchRef };

        } catch (err) {
            console.warn('Queue error, falling back to AI:', err);
            if (!matchFound) { matchFound = true; startGameWithAI(); }
            return;
        }

        // ────────────────────────────────────────────────────
        // STEP 4: Countdown → AI fallback after MATCHMAKING_TIMEOUT
        // ────────────────────────────────────────────────────
        matchmakingTimer = setInterval(() => {
            matchmakingElapsed++;
            updateMatchmakingTimer();

            if (matchmakingElapsed >= MATCHMAKING_TIMEOUT) {
                clearInterval(matchmakingTimer);
                cleanupQueue();
                if (!matchFound) {
                    matchFound = true;
                    startGameWithAI();
                }
            }
        }, 1000);
    }

    function cancelMatchmaking() {
        matchFound = true;   // block any pending async transactions
        clearInterval(matchmakingTimer);
        cleanupQueue();
        showScreen('lobby');
    }

    /** Detach all listeners and remove our queue entry */
    function cleanupQueue() {
        if (queueListener) {
            if (queueRef && queueListener.selfListener) {
                queueRef.off('value', queueListener.selfListener);
            }
            if (queueListener.queueWatchRef && queueListener.childListener) {
                queueListener.queueWatchRef.off('child_added', queueListener.childListener);
            }
            queueListener = null;
        }
        if (queueRef) {
            queueRef.remove().catch(() => { });
            queueRef = null;
        }
    }

    function updateMatchmakingTimer() {
        const timerEl = $('mm-timer');
        if (timerEl) {
            timerEl.textContent = `Searching for 🪙 ${selectedAmount} match... ${matchmakingElapsed}s`;
        }
    }

    // ─── Start Game ─────────────────────────────────────────

    async function startGameWithAI(realOpponentName) {
        isAIOpponent = true;
        const aiName = realOpponentName || LudoAI.getAIName();
        opponentDisplayName = aiName;

        // Call Cloud Function to deduct balance
        try {
            const result = await callFunction('startLudoAIMatch', { amount: selectedAmount });
            if (!result.success) {
                alert('Failed to start match. Please try again.');
                showScreen('lobby');
                return;
            }
            currentMatchId = result.matchId;
        } catch (err) {
            const msg = err.message || 'Failed to start match';
            alert(msg);
            showScreen('lobby');
            return;
        }

        // Player is always RED (bottom-left quadrant) for correct perspective.
        playerColor = 'RED'; opponentColor = 'BLUE';
        LudoBoard.setColorPerspective({ RED: 'RED', BLUE: 'BLUE' });

        gameState = LudoEngine.createGameState(
            playerColor === 'RED' ? 'PLAYER' : 'AI',
            playerColor === 'BLUE' ? 'PLAYER' : 'AI'
        );
        gameState.status = 'IN_PROGRESS';

        // ── Initialize AI context (mood, difficulty profile, chain tracking) ──
        aiContext = LudoAI.createAIContext(selectedAmount, opponentColor, [playerColor]);

        // ── Dynamic Panel Assignment ──
        const topPanel = $('top-panel');
        const bottomPanel = $('bottom-panel');
        const topNameEl = $('top-player-name');
        const bottomNameEl = $('bottom-player-name');
        const topAvatar = topPanel?.querySelector('.player-avatar');
        const bottomAvatar = bottomPanel?.querySelector('.player-avatar');

        if (bottomNameEl) bottomNameEl.textContent = 'You';
        if (topNameEl) topNameEl.textContent = aiName;
        if (bottomAvatar) bottomAvatar.textContent = 'Y';
        if (topAvatar) topAvatar.textContent = aiName.charAt(0).toUpperCase();

        if (topPanel) topPanel.className = 'player-panel blue';
        if (bottomPanel) bottomPanel.className = 'player-panel red active';

        // ── Reset strike dots ──
        playerStrikes = 0;
        opponentStrikes = 0;
        resetStrikeDots('top-strikes');
        resetStrikeDots('bottom-strikes');

        // ── Top Bar: entry fee + winning prize ──
        const amountEl = $('game-amount');
        if (amountEl) amountEl.textContent = `🪙 ${selectedAmount}`;
        const winAmountEl = $('game-win-amount');
        if (winAmountEl) {
            const pool = selectedAmount * 2;
            const win = Math.floor(pool * 0.85);
            winAmountEl.textContent = `🪙 ${win}`;
        }

        showScreen('game');

        requestAnimationFrame(() => {
            LudoBoard.resize();
            renderBoard();
            startTurnTimer();

            if (gameState.currentTurn === opponentColor && isAIOpponent) {
                setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
            }
        });
    }

    // ─── Start Real-Time PvP Game ────────────────────────────

    function startPvPGame(matchId, myColor, myName, oppName) {
        isAIOpponent = false;
        playerColor = myColor;
        opponentColor = myColor === 'RED' ? 'BLUE' : 'RED';
        opponentDisplayName = oppName;
        currentMatchId = matchId;

        // Initialize local game state from engine defaults
        gameState = LudoEngine.createGameState('PLAYER', 'PLAYER');
        gameState.status = 'IN_PROGRESS';
        gameState.currentTurn = 'RED'; // RED always goes first

        // Color perspective: every player sees their tokens as RED
        if (myColor === 'BLUE') {
            LudoBoard.setColorPerspective({ RED: 'BLUE', BLUE: 'RED' });
        } else {
            LudoBoard.setColorPerspective({ RED: 'RED', BLUE: 'BLUE' });
        }

        // ── Dynamic Panel Assignment ──
        const topPanel = $('top-panel');
        const bottomPanel = $('bottom-panel');
        const topNameEl = $('top-player-name');
        const bottomNameEl = $('bottom-player-name');
        const topAvatar = topPanel?.querySelector('.player-avatar');
        const bottomAvatar = bottomPanel?.querySelector('.player-avatar');

        if (bottomNameEl) bottomNameEl.textContent = 'You';
        if (topNameEl) topNameEl.textContent = oppName;
        if (bottomAvatar) bottomAvatar.textContent = myName.charAt(0).toUpperCase();
        if (topAvatar) topAvatar.textContent = oppName.charAt(0).toUpperCase();

        // Always show bottom panel (you) as red, top (opponent) as blue
        if (topPanel) topPanel.className = 'player-panel blue';
        if (bottomPanel) bottomPanel.className = 'player-panel red active';

        // ── Reset strike dots ──
        playerStrikes = 0;
        opponentStrikes = 0;
        resetStrikeDots('top-strikes');
        resetStrikeDots('bottom-strikes');

        // ── Top Bar ──
        const amountEl = $('game-amount');
        if (amountEl) amountEl.textContent = `🪙 ${selectedAmount}`;
        const winAmountEl = $('game-win-amount');
        if (winAmountEl) {
            const pool = selectedAmount * 2;
            const win = Math.floor(pool * 0.85);
            winAmountEl.textContent = `🪙 ${win}`;
        }

        showScreen('game');

        // ── Attach Firebase room listener for real-time sync ──
        let pvpGameEnded = false;  // prevents double endGame calls
        pvpRoomRef = firebase.database().ref(`ludo_rooms/${matchId}`);
        pvpRoomListener = pvpRoomRef.on('value', snap => {
            if (!snap.exists() || pvpGameEnded) return;
            const room = snap.val();

            // Skip updates from our own writes (lastMove.by === my color)
            if (room.lastMove && room.lastMove.by === myColor && room.status !== 'COMPLETED') {
                return;
            }

            // Sync game state from room data
            gameState.currentTurn = room.currentTurn;
            gameState.diceValue = room.diceValue;
            gameState.mustRollDice = room.mustRollDice;
            gameState.consecutiveSixes = room.consecutiveSixes || 0;
            gameState.players.RED.pieces = room.players?.RED?.pieces || [-1, -1, -1, -1];
            gameState.players.BLUE.pieces = room.players?.BLUE?.pieces || [-1, -1, -1, -1];

            // Re-render the board with synced state
            requestAnimationFrame(() => {
                LudoBoard.resize();
                renderBoard();

                // Update dice display with sound
                const diceEl = $('dice');
                if (diceEl && room.diceValue) {
                    LudoBoard.renderDice(diceEl, room.diceValue);
                    if (typeof LudoSounds !== 'undefined') LudoSounds.diceLand(room.diceValue);
                }
            });

            // Reset timer when turn changes
            resetTurnTimer();

            // Check for game over from opponent's write
            if (room.status === 'COMPLETED' && room.winner && !pvpGameEnded) {
                pvpGameEnded = true;
                gameState.status = 'COMPLETED';
                gameState.winner = room.winner;
                endGame();
            }
        });

        requestAnimationFrame(() => {
            LudoBoard.resize();
            renderBoard();
            startTurnTimer();
        });
    }

    /** Write updated game state to Firebase room */
    function pvpSyncState() {
        if (!pvpRoomRef || isAIOpponent) return;
        pvpRoomRef.update({
            currentTurn: gameState.currentTurn,
            diceValue: gameState.diceValue,
            mustRollDice: gameState.mustRollDice,
            consecutiveSixes: gameState.consecutiveSixes || 0,
            players: {
                RED: { pieces: gameState.players.RED.pieces },
                BLUE: { pieces: gameState.players.BLUE.pieces }
            },
            lastMove: {
                by: playerColor,
                at: firebase.database.ServerValue.TIMESTAMP
            }
        }).catch(err => console.warn('PvP sync failed:', err));
    }

    /** Write a completed game state to Firebase room */
    function pvpSyncGameOver(winnerColor) {
        if (!pvpRoomRef || isAIOpponent) return;
        pvpRoomRef.update({
            status: 'COMPLETED',
            winner: winnerColor,
            currentTurn: gameState.currentTurn,
            diceValue: gameState.diceValue,
            mustRollDice: gameState.mustRollDice,
            players: {
                RED: { pieces: gameState.players.RED.pieces },
                BLUE: { pieces: gameState.players.BLUE.pieces }
            }
        }).catch(err => console.warn('PvP game over sync failed:', err));
    }

    /** Cleanup PvP room listener */
    function cleanupPvPRoom() {
        if (pvpRoomListener && pvpRoomRef) {
            pvpRoomRef.off('value', pvpRoomListener);
            pvpRoomListener = null;
        }
        pvpRoomRef = null;
    }

    // ─── Rendering ──────────────────────────────────────────

    function renderBoard() {
        if (!gameState) return;
        const diceValue = gameState.diceValue;
        const validMoves = diceValue ? LudoEngine.getValidMoves(gameState, diceValue) : [];
        const myMoves = gameState.currentTurn === playerColor ? validMoves : [];
        LudoBoard.render(gameState, myMoves);
        updatePlayerPanels();
        updateDiceState();
    }

    function updatePlayerPanels() {
        if (!gameState) return;
        const isPlayerTurn = gameState.currentTurn === playerColor;

        $('top-panel')?.classList.toggle('active', !isPlayerTurn);
        $('bottom-panel')?.classList.toggle('active', isPlayerTurn);

        const bottomStatus = $('bottom-status');
        const topStatus = $('top-status');
        if (bottomStatus) {
            bottomStatus.textContent = isPlayerTurn ? 'Your turn' : 'Waiting';
            bottomStatus.className = 'player-status' + (isPlayerTurn ? ' your-turn' : '');
        }
        if (topStatus) {
            topStatus.textContent = !isPlayerTurn ? 'Thinking…' : 'Waiting';
            topStatus.className = 'player-status' + (!isPlayerTurn ? ' your-turn' : '');
        }
    }

    /** Reset all strike dots to empty */
    function resetStrikeDots(containerId) {
        const container = $(containerId);
        if (!container) return;
        container.querySelectorAll('.strike-dot').forEach(dot => {
            dot.classList.remove('filled');
        });
    }

    /** Fill the next strike dot for a player */
    function fillStrikeDot(containerId, strikeCount) {
        const container = $(containerId);
        if (!container) return;
        const dots = container.querySelectorAll('.strike-dot');
        if (strikeCount > 0 && strikeCount <= dots.length) {
            dots[strikeCount - 1].classList.add('filled');
        }
    }

    /** Update dice visual state based on whose turn it is */
    function updateDiceState() {
        const diceEl = $('dice');
        const hintEl = diceEl?.parentElement?.querySelector('.dice-hint');
        if (!diceEl || !gameState) return;

        const isPlayerTurn = gameState.currentTurn === playerColor;

        if (isPlayerTurn) {
            // Player's turn — enable dice
            diceEl.classList.remove('disabled');
            if (hintEl) hintEl.textContent = gameState.mustRollDice ? 'Tap to roll' : 'Select a piece';
        } else {
            // Opponent's turn — disable dice, show opponent status
            diceEl.classList.add('disabled');
            if (hintEl) hintEl.textContent = 'Opponent\'s turn';
        }
    }

    /** Show a temporary status on opponent panel during AI turn */
    function setOpponentStatus(text) {
        const topStatus = $('top-status');
        if (topStatus) {
            topStatus.textContent = text;
            topStatus.className = 'player-status your-turn';
        }
    }

    // ─── Turn Timer ─────────────────────────────────────────

    function startTurnTimer() {
        clearInterval(turnTimer);
        turnTimeLeft = 30;
        updateTimerBar();
        turnTimer = setInterval(() => {
            turnTimeLeft--;
            updateTimerBar();
            if (turnTimeLeft <= 0) {
                clearInterval(turnTimer);
                if (gameState.currentTurn === playerColor) {
                    // Player timed out — always handle locally
                    handleNoMove();
                } else if (!isAIOpponent) {
                    // PvP mode: opponent timed out (likely disconnected)
                    // Force-skip on their behalf and sync to Firebase
                    handleNoMove();
                }
                // AI mode: opponent timeout handled by aiTurn flow
            }
        }, 1000);
    }

    function resetTurnTimer() { startTurnTimer(); }

    function updateTimerBar() {
        const topFill = $('top-timer-fill');
        const bottomFill = $('bottom-timer-fill');

        const pct = (turnTimeLeft / 30) * 100;
        const isPlayerTurn = gameState && gameState.currentTurn === playerColor;

        // Bottom = player, top = opponent
        if (bottomFill) {
            bottomFill.style.width = isPlayerTurn ? pct + '%' : '100%';
            bottomFill.classList.remove('warning', 'critical');
            if (isPlayerTurn) {
                if (pct <= 20) bottomFill.classList.add('critical');
                else if (pct <= 40) bottomFill.classList.add('warning');
            }
        }
        if (topFill) {
            topFill.style.width = !isPlayerTurn ? pct + '%' : '100%';
            topFill.classList.remove('warning', 'critical');
            if (!isPlayerTurn) {
                if (pct <= 20) topFill.classList.add('critical');
                else if (pct <= 40) topFill.classList.add('warning');
            }
        }
    }

    function handleNoMove() {
        if (gameState.status !== 'IN_PROGRESS') return;

        // Add a timeout strike to the current player
        if (gameState.currentTurn === playerColor) {
            playerStrikes++;
            fillStrikeDot('bottom-strikes', playerStrikes);
            if (typeof LudoSounds !== 'undefined') LudoSounds.threeSixes();
            showEventToast('⏰', `Strike ${playerStrikes}/${MAX_STRIKES}`,
                playerStrikes >= MAX_STRIKES ? 'Too many timeouts — you lose!' : 'Move before time runs out!');

            if (playerStrikes >= MAX_STRIKES) {
                gameState.status = 'COMPLETED';
                gameState.winner = opponentColor;
                pvpSyncGameOver(opponentColor);
                setTimeout(() => endGame(), 800);
                return;
            }
        } else {
            opponentStrikes++;
            fillStrikeDot('top-strikes', opponentStrikes);
            showEventToast('⏰', `Opponent Strike ${opponentStrikes}/${MAX_STRIKES}`,
                opponentStrikes >= MAX_STRIKES ? 'Opponent timed out — you win!' : 'Opponent took too long');

            if (opponentStrikes >= MAX_STRIKES) {
                gameState.status = 'COMPLETED';
                gameState.winner = playerColor;
                pvpSyncGameOver(playerColor);
                setTimeout(() => endGame(), 800);
                return;
            }
        }

        gameState = LudoEngine.forceSkipTurn(gameState);
        pvpSyncState(); // Sync forced skip to opponent
        renderBoard();
        resetTurnTimer();
        if (gameState.currentTurn === opponentColor && isAIOpponent) {
            setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
        }
    }

    // ─── Dice Roll ──────────────────────────────────────────

    function onDiceClick() {
        if (!gameState || gameState.status !== 'IN_PROGRESS') return;
        if (gameState.currentTurn !== playerColor) return;
        if (!gameState.mustRollDice) return;
        if (isProcessingMove) return;

        isProcessingMove = true;
        const diceEl = $('dice');
        if (diceEl) {
            diceEl.classList.add('rolling');
            LudoBoard.renderDice(diceEl, null, true);
        }
        if (typeof LudoSounds !== 'undefined') LudoSounds.diceRoll();

        setTimeout(() => {
            const result = LudoEngine.rollDice(gameState);
            gameState = result.state;

            if (diceEl) {
                diceEl.classList.remove('rolling');
                LudoBoard.renderDice(diceEl, result.diceValue);
            }
            if (typeof LudoSounds !== 'undefined') LudoSounds.diceLand(result.diceValue);

            if (result.autoSkip) {
                if (typeof LudoSounds !== 'undefined') LudoSounds.noMoves();
                showEventToast('😔', 'No moves!', `Rolled ${result.diceValue} — no valid moves`);
                pvpSyncState(); // Sync auto-skip to opponent
                isProcessingMove = false;
                resetTurnTimer();
                if (gameState.currentTurn === opponentColor && isAIOpponent) {
                    setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
                }
                return;
            }

            pvpSyncState(); // Sync dice roll to opponent
            renderBoard();
            isProcessingMove = false;

            if (result.validMoves.length === 1) {
                setTimeout(() => onPieceSelected(result.validMoves[0].pieceIndex), 300);
            }
        }, 600);
    }

    // ─── Piece Selection ────────────────────────────────────

    function onPieceSelected(pieceIndex) {
        if (!gameState || gameState.status !== 'IN_PROGRESS') return;
        if (gameState.currentTurn !== playerColor || gameState.mustRollDice) return;
        if (isProcessingMove) return;
        if (LudoBoard.isAnimating && LudoBoard.isAnimating()) return;

        const diceValue = gameState.diceValue;
        const validMoves = LudoEngine.getValidMoves(gameState, diceValue);
        const move = validMoves.find(m => m.pieceIndex === pieceIndex);
        if (!move) return;

        isProcessingMove = true;
        if (typeof LudoSounds !== 'undefined') {
            if (move.type === 'ENTER') LudoSounds.pieceEnter();
            else LudoSounds.pieceMove();
        }

        const fromPos = gameState.players[playerColor].pieces[pieceIndex];
        const preAnimState = JSON.parse(JSON.stringify(gameState));

        const result = LudoEngine.applyMove(gameState, pieceIndex, diceValue);
        gameState = result.state;
        LudoBoard.clearSelection();

        if (LudoBoard.animateMove) {
            LudoBoard.animateMove(playerColor, pieceIndex, fromPos, move.to, preAnimState, () => {
                handleEvents(result.events);
                renderBoard();

                isProcessingMove = false;
                resetTurnTimer();

                if (gameState.status === 'COMPLETED') {
                    pvpSyncGameOver(gameState.winner);
                    endGame();
                    return;
                }

                pvpSyncState(); // Sync move to opponent

                if (gameState.currentTurn === opponentColor && isAIOpponent) {
                    setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
                }
            });
        } else {
            renderBoard();
            handleEvents(result.events);

            isProcessingMove = false;
            resetTurnTimer();

            if (gameState.status === 'COMPLETED') {
                pvpSyncGameOver(gameState.winner);
                endGame();
                return;
            }

            pvpSyncState(); // Sync move to opponent

            if (gameState.currentTurn === opponentColor && isAIOpponent) {
                setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
            }
        }
    }

    // ─── AI Turn (Natural, Human-Like Flow) ─────────────────

    function aiTurn() {
        if (!gameState || gameState.status !== 'IN_PROGRESS') return;
        if (gameState.currentTurn !== opponentColor) return;

        // ── Phase 1: "Thinking…" — AI is deciding to roll ──
        const diceEl = $('dice');
        if (diceEl) diceEl.classList.add('disabled');
        setOpponentStatus('Thinking…');

        // Pre-compute the dice value (but don't show it yet)
        const diceValue = LudoAI.weightedDiceRoll(gameState, opponentColor, selectedAmount, aiContext);

        // ── Phase 2: "Rolling…" — Show dice animation ──
        const diceAnimDelay = 800 + Math.floor(Math.random() * 600);
        setTimeout(() => {
            setOpponentStatus('Rolling…');
            if (typeof LudoSounds !== 'undefined') LudoSounds.diceRoll();

            if (diceEl) {
                diceEl.classList.add('rolling');
                LudoBoard.renderDice(diceEl, null, true);
            }

            // ── Phase 3: Show dice result — "Rolled X" ──
            const rollDuration = LudoAI.getDiceDelay();
            setTimeout(() => {
                const result = LudoEngine.rollDice(gameState, diceValue);
                gameState = result.state;

                if (diceEl) {
                    diceEl.classList.remove('rolling');
                    LudoBoard.renderDice(diceEl, result.diceValue);
                }
                if (typeof LudoSounds !== 'undefined') LudoSounds.diceLand(result.diceValue);

                setOpponentStatus(`Rolled ${result.diceValue}`);

                if (result.autoSkip) {
                    // No valid moves — show briefly then pass turn
                    if (typeof LudoSounds !== 'undefined') LudoSounds.noMoves();
                    setTimeout(() => {
                        setOpponentStatus('No moves');
                        setTimeout(() => {
                            renderBoard();

                            // Safety: after autoSkip, engine should have passed turn.
                            // If still AI's turn (shouldn't happen), force-skip to prevent freeze.
                            if (gameState.currentTurn === opponentColor && isAIOpponent) {
                                gameState = LudoEngine.forceSkipTurn(gameState);
                                renderBoard();
                            }

                            resetTurnTimer();
                        }, 800);
                    }, 1000);
                    return;
                }

                renderBoard();

                // ── Phase 4: "Moving…" — AI picks and moves a piece ──
                const moveDelay = LudoAI.getMoveDelay(aiContext);
                setTimeout(() => {
                    setOpponentStatus('Moving…');
                    const validMoves = LudoEngine.getValidMoves(gameState, result.diceValue);
                    const move = LudoAI.weightedDecision(gameState, validMoves, opponentColor, aiContext);

                    if (move) {
                        if (typeof LudoSounds !== 'undefined') {
                            if (move.type === 'ENTER') LudoSounds.pieceEnter();
                            else LudoSounds.pieceMove();
                        }

                        const fromPos = gameState.players[opponentColor].pieces[move.pieceIndex];
                        const preAnimState = JSON.parse(JSON.stringify(gameState));

                        const moveResult = LudoEngine.applyMove(gameState, move.pieceIndex, result.diceValue);
                        gameState = moveResult.state;

                        if (LudoBoard.animateMove) {
                            LudoBoard.animateMove(opponentColor, move.pieceIndex, fromPos, move.to, preAnimState, () => {
                                handleEvents(moveResult.events);
                                renderBoard();

                                if (gameState.status === 'COMPLETED') {
                                    endGame();
                                    return;
                                }

                                if (gameState.currentTurn === opponentColor && isAIOpponent) {
                                    // Extra turn (rolled 6 or captured) — think again
                                    setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
                                } else {
                                    resetTurnTimer();
                                }
                            });
                            return;
                        }

                        renderBoard();
                        handleEvents(moveResult.events);

                        if (gameState.status === 'COMPLETED') {
                            endGame();
                            return;
                        }

                        if (gameState.currentTurn === opponentColor && isAIOpponent) {
                            setTimeout(() => aiTurn(), LudoAI.getThinkDelay(aiContext));
                        } else {
                            resetTurnTimer();
                        }
                    }
                }, moveDelay);
            }, rollDuration);
        }, diceAnimDelay);
    }

    // ─── Event Handling ─────────────────────────────────────

    function handleEvents(events) {
        for (const ev of events) {
            switch (ev.type) {
                case 'PIECE_CAPTURED':
                    if (typeof LudoSounds !== 'undefined') LudoSounds.pieceCapture();
                    showEventToast('⚔️',
                        ev.capturedBy === playerColor ? 'Captured!' : 'Piece Captured!',
                        ev.capturedBy === playerColor ? 'Opponent sent back to base!' : 'Your piece was captured!'
                    );
                    break;

                case 'EXTRA_TURN': {
                    if (typeof LudoSounds !== 'undefined') LudoSounds.extraTurn();
                    let reason;
                    if (ev.reason === 'ROLLED_SIX') reason = 'Rolled a 6!';
                    else if (ev.reason === 'CAPTURE') reason = 'Bonus for capture!';
                    else if (ev.reason === 'PIECE_FINISHED') reason = 'Piece reached home!';
                    else reason = 'Extra turn!';

                    if (ev.player === playerColor) {
                        showEventToast('🎯', 'Extra Turn!', reason);
                    } else {
                        showEventToast('🔄', 'Opponent Extra Turn', reason);
                    }
                    break;
                }

                case 'THREE_SIXES':
                    if (typeof LudoSounds !== 'undefined') LudoSounds.threeSixes();
                    if (ev.player === playerColor) {
                        showEventToast('😵', 'Three Sixes!', 'Turn forfeited — 3 sixes in a row');
                    } else {
                        showEventToast('😵', 'Opponent Three Sixes!', 'Their turn forfeited');
                    }
                    break;

                case 'PIECE_FINISHED':
                    if (typeof LudoSounds !== 'undefined') LudoSounds.pieceFinish();
                    if (ev.player === playerColor) {
                        showEventToast('🏠', 'Home!', 'One piece finished! Extra turn!');
                    } else {
                        showEventToast('🏠', 'Opponent Home!', 'Opponent finished a piece');
                    }
                    break;
            }
        }
    }

    // ─── Game End ───────────────────────────────────────────

    async function endGame() {
        clearInterval(turnTimer);
        cleanupPvPRoom();  // Stop listening to room updates
        const won = gameState.winner === playerColor;

        // Call appropriate Cloud Function based on game mode
        try {
            if (currentMatchId) {
                if (isAIOpponent) {
                    await callFunction('completeLudoAIMatch', {
                        matchId: currentMatchId,
                        winner: won ? 'PLAYER' : 'AI'
                    });
                } else {
                    await callFunction('completeLudoPvPMatch', {
                        matchId: currentMatchId,
                        winner: gameState.winner  // 'RED' or 'BLUE'
                    });
                }
            }
        } catch (err) {
            console.error('Failed to complete match on server:', err);
        }

        // Calculate amounts
        const pool = selectedAmount * 2;
        const commission = Math.floor(pool * 0.15);
        const winAmount = pool - commission;

        // Compute match stats from move history
        const totalMoves = gameState.moves ? gameState.moves.filter(m => m.player === playerColor).length : 0;
        const totalCaptures = gameState.moves ? gameState.moves.filter(m => m.player === playerColor && m.captured).length : 0;
        const piecesHome = gameState.players[playerColor].pieces.filter(p => p === LudoEngine.POS_FINISHED).length;

        // Get user's display name
        const user = getCurrentUser();
        const myName = user?.displayName || 'You';

        setTimeout(() => {
            const card = $('gameover-card');

            // Card variant
            if (card) {
                card.classList.remove('win', 'lose');
                card.classList.add(won ? 'win' : 'lose');
            }

            // Title & subtitle — encouraging for both outcomes
            const emoji = $('go-emoji');
            const title = $('go-title');
            const subtitle = $('go-subtitle');
            if (emoji) emoji.textContent = won ? '🏆' : '⭐';
            if (title) title.textContent = won ? 'Victory!' : 'Great Game!';
            if (subtitle) subtitle.textContent = won
                ? 'Winnings credited to wallet'
                : 'You played well, try again!';

            // Player matchup — populate names, avatars, and swap badges
            const nameYou = $('go-name-you');
            const nameOpp = $('go-name-opp');
            const avatarYou = $('go-avatar-you');
            const avatarOpp = $('go-avatar-opp');
            const badgeYou = $('go-badge-you');
            const badgeOpp = $('go-badge-opp');

            if (nameYou) nameYou.textContent = myName;
            if (nameOpp) nameOpp.textContent = opponentDisplayName;
            if (avatarYou) avatarYou.textContent = myName.charAt(0).toUpperCase();
            if (avatarOpp) avatarOpp.textContent = opponentDisplayName.charAt(0).toUpperCase();

            if (badgeYou) {
                badgeYou.className = `go-player-badge ${won ? 'go-badge-winner' : 'go-badge-loser'}`;
                badgeYou.innerHTML = won ? '<i class="fa-solid fa-crown"></i> Winner' : 'Defeated';
            }
            if (badgeOpp) {
                badgeOpp.className = `go-player-badge ${!won ? 'go-badge-winner' : 'go-badge-loser'}`;
                badgeOpp.innerHTML = !won ? '<i class="fa-solid fa-crown"></i> Winner' : 'Defeated';
            }

            // Amount (only visible on win via CSS)
            const amountValue = $('go-amount');
            if (amountValue) amountValue.textContent = `🪙 ${winAmount}`;

            // Stats
            const movesEl = $('go-moves');
            const capturesEl = $('go-captures');
            const finishedEl = $('go-finished');
            if (movesEl) movesEl.textContent = totalMoves;
            if (capturesEl) capturesEl.textContent = totalCaptures;
            if (finishedEl) finishedEl.textContent = piecesHome;

            showScreen('gameover');

            if (won) {
                if (typeof LudoSounds !== 'undefined') LudoSounds.gameWin();
                spawnConfetti();
            } else {
                if (typeof LudoSounds !== 'undefined') LudoSounds.gameLose();
            }
        }, 500);
    }

    // ─── Event Toast ────────────────────────────────────────

    function showEventToast(icon, title, desc) {
        const container = $('event-toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'game-event-toast';
        toast.innerHTML = `
            <div class="event-icon">${icon}</div>
            <div class="event-title">${title}</div>
            <div class="event-desc">${desc}</div>
        `;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        }, 2000);
        setTimeout(() => { container.innerHTML = ''; }, 4000);
    }

    // ─── Confetti ───────────────────────────────────────────

    function spawnConfetti() {
        const colors = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#ff6b81', '#7bed9f'];
        for (let i = 0; i < 50; i++) {
            const c = document.createElement('div');
            c.style.cssText = `
                position:fixed;width:8px;height:8px;background:${colors[i % colors.length]};
                border-radius:50%;top:-10px;left:${Math.random() * 100}%;z-index:999;
                animation:confettiFall ${1.5 + Math.random() * 2}s ease-out forwards;
                animation-delay:${Math.random() * 0.5}s;pointer-events:none;
            `;
            document.body.appendChild(c);
            setTimeout(() => c.remove(), 4000);
        }
    }

    // ─── Sound Toggle ──────────────────────────────────────

    function toggleSound() {
        if (typeof LudoSounds === 'undefined') return;
        const isOn = LudoSounds.isEnabled();
        LudoSounds.toggle(!isOn);
        LudoSounds.toggleHaptics(!isOn);
        const btn = document.getElementById('btn-sound');
        if (btn) {
            btn.innerHTML = !isOn
                ? '<i class="fa-solid fa-volume-high"></i>'
                : '<i class="fa-solid fa-volume-xmark"></i>';
        }
    }


    // ─── Public API ─────────────────────────────────────────

    return {
        init,
        startMatchmaking,
        cancelMatchmaking,
        onDiceClick,
        startGameWithAI,
        showScreen,
        toggleSound
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    LudoClient.init();
});
