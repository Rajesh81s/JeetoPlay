// JeetoPlay — Ludo
// Auto-extracted from app.html

// XSS sanitization utility
function escapeHtmlLudo(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// --- LUDO LOGIC (Full State Machine) ---

// Platform commission percentage (15%) — 🪙 10 challenge = 🪙 17 winning
const LUDO_COMMISSION_PERCENT = 15;

window.showCreateChallengeModal = function () {
    document.getElementById('create-challenge-modal').classList.remove('hidden');
    // Clear previous values
    document.getElementById('challenge-amount').value = '';
    // Clear slab selection
    document.querySelectorAll('.amount-slab').forEach(btn => btn.classList.remove('selected'));

    // Pre-fill Ludo King username if saved in profile
    const savedUsername = state.userData?.ludoKingUsername || '';
    document.getElementById('challenge-ludo-username').value = savedUsername;
};

// Set amount from quick slab buttons
window.setAmount = function (amount) {
    document.getElementById('challenge-amount').value = amount;
    // Highlight selected slab
    document.querySelectorAll('.amount-slab').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.textContent === '🪙 ' + amount) {
            btn.classList.add('selected');
        }
    });
};

// Create Challenge with split wallet and Ludo King username
window.createChallenge = async function () {
    const ludoUsername = document.getElementById('challenge-ludo-username').value.trim();
    const amount = parseFloat(document.getElementById('challenge-amount').value);

    if (!ludoUsername || ludoUsername.length < 2) {
        return showToast('Please enter your Ludo King username', 'error');
    }
    if (!amount || amount < 10) {
        return showToast('Minimum amount is 🪙 10', 'error');
    }
    if (amount > 25000) {
        return showToast('Maximum amount is 🪙 25,000', 'error');
    }
    if (amount % 10 !== 0) {
        return showToast('Amount must be in multiples of 10', 'error');
    }

    const uid = state.user.uid;
    const depositBal = state.userData.depositBalance || 0;
    const winningBal = state.userData.winningBalance || 0;
    const legacyBal = state.userData.walletBalance || 0;
    const totalBalance = Math.max(depositBal + winningBal, legacyBal);

    // Check balance
    if (totalBalance < amount) {
        showInsufficientBalanceModal(`Need 🪙 ${amount} to create challenge. Your balance: 🪙 ${totalBalance.toFixed(2)}`);
        return;
    }

    try {
        showToast('Creating challenge...', 'info');

        const createLudoChallengeFn = functions.httpsCallable('createLudoChallenge');
        const result = await createLudoChallengeFn({ amount, ludoKingUsername: ludoUsername });
        const r = result.data;

        // Sync local state from server response
        state.userData.depositBalance = r.newDepositBalance;
        state.userData.winningBalance = r.newWinningBalance;
        state.userData.ludoKingUsername = ludoUsername;
        updateUIHeader();

        closeModal('create-challenge-modal');
        document.getElementById('challenge-amount').value = '';

        // Show instructional popup explaining next steps
        showChallengeCreatedModal();

    } catch (e) {
        console.error('Create challenge error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// Cancel Challenge - tiered logic based on match state
// OPEN/PAIRED: unilateral cancel allowed
// ROOM_SHARED/IN_PROGRESS: mutual cancel required (request + accept)
let _pendingCancelData = null; // Stores match data for custom cancel confirmation

window.cancelMyChallenge = async function (id) {
    try {
        // First, fetch the match to determine the correct cancel flow
        const matchSnap = await db.ref('ludo_matches/' + id).once('value');
        const match = matchSnap.val();
        if (!match) {
            return showToast('Match not found', 'error');
        }

        const uid = state.user.uid;
        const isCreator = match.creator?.uid === uid;
        const isAcceptor = match.acceptor?.uid === uid;

        // Route based on match status
        if (match.status === 'OPEN' || match.status === 'PAIRED') {
            // Show custom cancel confirmation modal instead of native confirm()
            _pendingCancelData = { id, match, uid, type: 'UNILATERAL' };
            document.getElementById('confirm-cancel-match-id').value = id;

            // Close the match detail modal first to prevent stacking
            _lastViewedMatchId = id;
            document.getElementById('my-challenge-detail-modal')?.remove();

            document.getElementById('confirm-cancel-modal').classList.remove('hidden');

        } else if (match.status === 'ROOM_SHARED' || match.status === 'IN_PROGRESS') {
            // Mutual cancel required — delegate to requestMutualCancel
            return requestMutualCancel(id, match, uid, isCreator);

        } else {
            showToast('This match cannot be cancelled (status: ' + match.status + ')', 'error');
        }

    } catch (e) {
        console.error('Cancel error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// Confirm unilateral cancel (after user taps in custom modal)
window.confirmUnilateralCancel = async function () {
    closeModal('confirm-cancel-modal');
    _lastViewedMatchId = null; // Action completed, no need to re-open detail modal
    if (!_pendingCancelData) return;

    const { id, uid } = _pendingCancelData;
    _pendingCancelData = null;

    try {
        showToast('Cancelling...', 'info');

        const cancelLudoMatchFn = functions.httpsCallable('cancelLudoMatch');
        await cancelLudoMatchFn({ matchId: id, cancelType: 'UNILATERAL' });

        // Refresh user data to get updated balances
        const userSnap = await db.ref('users/' + uid).once('value');
        const userData = userSnap.val();
        if (userData) {
            state.userData.depositBalance = userData.depositBalance || 0;
            state.userData.winningBalance = userData.winningBalance || 0;
        }
        updateUIHeader();
        showToast('✅ Challenge cancelled & refunded!', 'success');

        // Close detail modal if open
        const detailModal = document.getElementById('my-challenge-detail-modal');
        if (detailModal) detailModal.remove();

    } catch (e) {
        console.error('Cancel error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};


// --- MUTUAL CANCEL: Request (for ROOM_SHARED / IN_PROGRESS) ---
async function requestMutualCancel(id, match, uid, isCreator) {
    // Check if opponent already requested cancel
    if (match.cancelRequest && match.cancelRequest.requestedBy !== uid) {
        // Opponent already requested — treat this as acceptance
        return acceptMutualCancel(id);
    }

    // Check if we already requested
    if (match.cancelRequest && match.cancelRequest.requestedBy === uid) {
        return showToast('You already requested cancellation. Waiting for opponent to accept.', 'info');
    }

    // Show custom mutual cancel modal instead of native confirm()
    _pendingCancelData = { id, match, uid, isCreator, type: 'MUTUAL' };
    document.getElementById('confirm-mutual-cancel-match-id').value = id;

    // Close the match detail modal first to prevent stacking
    _lastViewedMatchId = id;
    document.getElementById('my-challenge-detail-modal')?.remove();

    document.getElementById('confirm-mutual-cancel-modal').classList.remove('hidden');
}

// Confirm mutual cancel request (after user taps in custom modal)
window.confirmMutualCancelRequest = async function () {
    closeModal('confirm-mutual-cancel-modal');
    _lastViewedMatchId = null; // Action completed, no need to re-open detail modal
    if (!_pendingCancelData) return;

    const { id } = _pendingCancelData;
    _pendingCancelData = null;

    try {
        // Call Cloud Function
        const cancelLudoMatchFn = functions.httpsCallable('cancelLudoMatch');
        await cancelLudoMatchFn({ matchId: id, cancelType: 'MUTUAL_REQUEST' });

        showToast('🤝 Cancel request sent! Waiting for opponent to accept...', 'info');
    } catch (e) {
        console.error('Request cancel error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// --- MUTUAL CANCEL: Accept (opponent agrees) ---
window.acceptMutualCancel = async function (id) {
    showToast('Processing mutual cancellation...', 'info');

    try {
        // Call Cloud Function — all refund operations happen server-side
        const cancelLudoMatchFn = functions.httpsCallable('cancelLudoMatch');
        await cancelLudoMatchFn({ matchId: id, cancelType: 'MUTUAL_ACCEPT' });

        // Refresh user data to get updated balances
        const uid = state.user.uid;
        const userSnap = await db.ref('users/' + uid).once('value');
        const userData = userSnap.val();
        if (userData) {
            state.userData.depositBalance = userData.depositBalance || 0;
            state.userData.winningBalance = userData.winningBalance || 0;
        }

        updateUIHeader();
        showToast('✅ Match mutually cancelled & both refunded!', 'success');

        const detailModal = document.getElementById('my-challenge-detail-modal');
        if (detailModal) detailModal.remove();
    } catch (e) {
        console.error('Accept cancel error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// --- MUTUAL CANCEL: Reject ---
window.rejectMutualCancel = async function (id) {
    try {
        // Call Cloud Function
        const cancelLudoMatchFn = functions.httpsCallable('cancelLudoMatch');
        await cancelLudoMatchFn({ matchId: id, cancelType: 'MUTUAL_REJECT' });

        showToast('❌ Cancel request rejected. Match continues.', 'info');
    } catch (e) {
        console.error('Reject cancel error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// Accept Challenge - Shows Ludo username modal first
window.acceptChallenge = function (id, amount) {
    // Check balance first before showing modal
    const depositBal = state.userData.depositBalance || 0;
    const winningBal = state.userData.winningBalance || 0;
    const totalBalance = depositBal + winningBal;

    if (amount > totalBalance) {
        showInsufficientBalanceModal(`Need 🪙 ${amount} to accept. Your balance: 🪙 ${totalBalance.toFixed(2)}`);
        return;
    }

    // Store match info and show username modal
    document.getElementById('join-match-id').value = id;
    document.getElementById('join-match-amount').value = amount;
    // Pre-fill Ludo King username if saved in profile
    document.getElementById('join-ludo-username').value = state.userData?.ludoKingUsername || '';
    document.getElementById('ludo-username-modal').classList.remove('hidden');
};

// Confirm Accept Challenge (after Ludo username entered)
window.confirmAcceptChallenge = async function () {
    const id = document.getElementById('join-match-id').value;
    const amount = parseFloat(document.getElementById('join-match-amount').value);
    const ludoUsername = document.getElementById('join-ludo-username').value.trim();

    if (!ludoUsername || ludoUsername.length < 2) {
        return showToast('Please enter your Ludo King username', 'error');
    }

    const uid = state.user.uid;
    const depositBal = state.userData.depositBalance || 0;
    const winningBal = state.userData.winningBalance || 0;

    try {
        showToast('Joining challenge...', 'info');
        closeModal('ludo-username-modal');

        const acceptLudoChallengeFn = functions.httpsCallable('acceptLudoChallenge');
        const result = await acceptLudoChallengeFn({ matchId: id, ludoKingUsername: ludoUsername });
        const r = result.data;

        // Sync local state from server response
        state.userData.depositBalance = r.newDepositBalance;
        state.userData.winningBalance = r.newWinningBalance;
        state.userData.ludoKingUsername = ludoUsername;
        updateUIHeader();

        // Show instructional popup for the acceptor
        showChallengeJoinedModal();

    } catch (e) {
        console.error('Accept error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};


// Share Room Code (Creator only, PAIRED state — via Cloud Function)
window.shareRoomCode = async function (id) {
    // First try to find input within the modal, then fall back to global search
    const modal = document.getElementById('my-challenge-detail-modal');
    let roomCodeInput = modal?.querySelector('#ludo-room-code-input') ||
        modal?.querySelector('input[type="text"]') ||
        document.getElementById('ludo-room-code-input');

    const roomCode = roomCodeInput?.value?.trim();

    if (!roomCode || roomCode.length < 4 || roomCode.length > 12) {
        return showToast('Enter a valid room code (4-12 characters)', 'error');
    }

    try {
        showToast('Sharing room code...', 'info');

        const shareRoomCodeFn = functions.httpsCallable('shareRoomCode');
        await shareRoomCodeFn({ matchId: id, roomCode: roomCode });

        showToast('✅ Room code shared! Both players can now join.', 'success');

        // Refresh the modal with updated state
        viewMyChallenge(id);
    } catch (e) {
        console.error('Share room code error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// Show/Hide Room Code Input Screen (for two-step flow)
window.showRoomCodeInputScreen = function (matchId) {
    // Search within the modal first
    const modal = document.getElementById('my-challenge-detail-modal');
    const container = modal || document;

    const detailsDiv = container.querySelector(`#ludo-paired-details-${matchId}`) ||
        container.querySelector(`[id="ludo-paired-details-${matchId}"]`);
    const roomCodeDiv = container.querySelector(`#ludo-roomcode-screen-${matchId}`) ||
        container.querySelector(`[id="ludo-roomcode-screen-${matchId}"]`);

    console.log('showRoomCodeInputScreen:', matchId, detailsDiv, roomCodeDiv);

    if (detailsDiv) detailsDiv.style.display = 'none';
    if (roomCodeDiv) roomCodeDiv.style.display = 'block';
};

window.hideRoomCodeInputScreen = function (matchId) {
    // Search within the modal first
    const modal = document.getElementById('my-challenge-detail-modal');
    const container = modal || document;

    const detailsDiv = container.querySelector(`#ludo-paired-details-${matchId}`) ||
        container.querySelector(`[id="ludo-paired-details-${matchId}"]`);
    const roomCodeDiv = container.querySelector(`#ludo-roomcode-screen-${matchId}`) ||
        container.querySelector(`[id="ludo-roomcode-screen-${matchId}"]`);

    if (detailsDiv) detailsDiv.style.display = 'block';
    if (roomCodeDiv) roomCodeDiv.style.display = 'none';
};

// Start Game (transition to IN_PROGRESS — via Cloud Function)
window.startLudoGame = async function (id) {
    try {
        showToast('Starting game...', 'info');
        const startLudoGameFn = functions.httpsCallable('startLudoGame');
        await startLudoGameFn({ matchId: id });
        showToast('🎲 Game started! Submit result when finished.', 'success');
    } catch (e) {
        console.error('Start game error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// ============================================
// NEW RESULT SUBMISSION SYSTEM
// LOST = Instant opponent win (no screenshot)
// WON = Screenshot required, wait for opponent
// DISPUTE = Screenshot + remarks, 2hr timeout
// ============================================

// Screenshot preview handler - hides button when file selected
document.getElementById('ludo-result-screenshot')?.addEventListener('change', function (e) {
    const file = e.target.files[0];
    const preview = document.getElementById('ludo-screenshot-preview');
    const img = document.getElementById('ludo-screenshot-img');
    const uploadBtn = document.getElementById('screenshot-upload-btn');

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            preview.style.display = 'block';
            if (uploadBtn) uploadBtn.style.display = 'none'; // Hide button after selection
        };
        reader.readAsDataURL(file);
    } else {
        preview.style.display = 'none';
        if (uploadBtn) uploadBtn.style.display = 'flex'; // Show button if no file
    }
});

// Clear selected screenshot
window.clearScreenshot = function () {
    const input = document.getElementById('ludo-result-screenshot');
    const preview = document.getElementById('ludo-screenshot-preview');
    const uploadBtn = document.getElementById('screenshot-upload-btn');

    if (input) input.value = '';
    if (preview) preview.style.display = 'none';
    if (uploadBtn) uploadBtn.style.display = 'flex';
};

// Track which match detail modal was open (for re-opening on cancel)
let _lastViewedMatchId = null;

// Submit LOST - Show custom confirmation modal first
window.submitLost = function (id) {
    // Close the detail modal first to prevent stacking
    _lastViewedMatchId = id;
    const detailModal = document.getElementById('my-challenge-detail-modal');
    if (detailModal) detailModal.remove();

    // Show custom confirmation modal
    document.getElementById('confirm-lost-match-id').value = id;
    document.getElementById('confirm-lost-modal').classList.remove('hidden');
};

// Cancel result action and re-open the match detail modal
window.cancelResultAndReopen = function (modalId) {
    closeModal(modalId);
    // Re-open the match detail view the user was looking at
    if (_lastViewedMatchId) {
        viewMyChallenge(_lastViewedMatchId);
        _lastViewedMatchId = null;
    }
};

// Actual submission after user confirms in custom modal
window.confirmLostSubmit = async function () {
    const id = document.getElementById('confirm-lost-match-id').value;
    closeModal('confirm-lost-modal');
    _lastViewedMatchId = null; // Action completed, no need to re-open

    try {
        showToast('Processing...', 'info');

        // Call Cloud Function — all balance ops happen server-side
        const submitLudoResultFn = functions.httpsCallable('submitLudoResult');
        const result = await submitLudoResultFn({ matchId: id, resultType: 'LOST' });

        showToast('😔 Match completed. Better luck next time!', 'info');

        // Refresh the challenge view if modal is open
        const detailModal = document.getElementById('my-challenge-detail-modal');
        if (detailModal) detailModal.remove();

    } catch (e) {
        console.error('Submit loss error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// Show Result Modal (for WIN/DISPUTE - requires screenshot)
window.showResultModal = function (id, type) {
    // Close the detail modal first to prevent stacking
    _lastViewedMatchId = id;
    const detailModal = document.getElementById('my-challenge-detail-modal');
    if (detailModal) detailModal.remove();

    const modal = document.getElementById('ludo-result-modal');
    const title = document.getElementById('ludo-result-modal-title');
    const desc = document.getElementById('ludo-result-modal-desc');
    const remarksLabel = document.getElementById('ludo-remarks-label');

    // Reset form
    document.getElementById('ludo-result-screenshot').value = '';
    document.getElementById('ludo-result-remarks').value = '';
    document.getElementById('ludo-screenshot-preview').style.display = 'none';
    document.getElementById('result-match-id').value = id;
    document.getElementById('result-type').value = type;

    if (type === 'WON') {
        title.textContent = 'Claim Victory 🏆';
        desc.textContent = 'Upload a screenshot showing your win. Wait for opponent to confirm or dispute.';
        remarksLabel.textContent = 'Remarks (Optional)';
    } else if (type === 'DISPUTE') {
        title.textContent = 'Raise Dispute ⚠️';
        desc.textContent = 'Upload proof and explain the issue. If opponent doesn\'t respond in 2 hours, admin will review.';
        remarksLabel.textContent = 'Remarks (Required)';
    }

    modal.classList.remove('hidden');
};

// Confirm Submit Result (after screenshot uploaded)
window.confirmSubmitResult = async function () {
    const id = document.getElementById('result-match-id').value;
    const type = document.getElementById('result-type').value;
    const fileInput = document.getElementById('ludo-result-screenshot');
    const remarks = document.getElementById('ludo-result-remarks').value.trim();

    const file = fileInput.files[0];
    if (!file) {
        return showToast('Please upload a screenshot', 'error');
    }

    if (type === 'DISPUTE' && !remarks) {
        return showToast('Remarks required for dispute', 'error');
    }

    try {
        showToast('Uploading proof...', 'info');
        _lastViewedMatchId = null; // Action completed, no need to re-open
        closeModal('ludo-result-modal');

        const uid = state.user.uid;

        // Upload screenshot to Firebase Storage (instead of base64 in database)
        const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
        const storagePath = `ludo_screenshots/${id}/${uid}.${ext}`;
        const storageRef = window.fbStorage.ref(storagePath);
        await storageRef.put(file, { contentType: file.type });
        const screenshotUrl = await storageRef.getDownloadURL();

        // Call Cloud Function FIRST for result processing (all balance ops server-side)
        // NOTE: Screenshot must be saved AFTER cloud function call, not before.
        // Writing to result/{role}/screenshot before the call creates the result object,
        // which causes the cloud function's duplicate check to falsely reject the submission.
        const submitLudoResultFn = functions.httpsCallable('submitLudoResult');
        const result = await submitLudoResultFn({
            matchId: id,
            resultType: type,
            screenshotUrl: screenshotUrl
        });

        // Now store screenshot URL + remarks on the match (non-financial, client can do this)
        const matchSnap = await db.ref('ludo_matches/' + id).once('value');
        const match = matchSnap.val();
        if (match) {
            const isCreator = match.creator?.uid === uid;
            const role = isCreator ? 'creator' : 'acceptor';
            await db.ref(`ludo_matches/${id}/result/${role}/screenshot`).set(screenshotUrl);
            if (remarks) {
                await db.ref(`ludo_matches/${id}/result/${role}/remarks`).set(remarks);
            }
        }

        // Handle response
        if (result.data.autoResolved) {
            state.userData.winningBalance = (state.userData.winningBalance || 0) + result.data.winAmount;
            updateUIHeader();
            showToast(`🎉 You WON 🪙 ${result.data.winAmount.toFixed(2)}!`, 'success');
        } else if (result.data.dualDispute) {
            // Refresh user data to get updated balances after refund
            const userSnap = await db.ref('users/' + uid).once('value');
            const userData = userSnap.val();
            if (userData) {
                state.userData.depositBalance = userData.depositBalance || 0;
                state.userData.winningBalance = userData.winningBalance || 0;
                updateUIHeader();
            }
            showToast('✅ Match cancelled! Both players refunded.', 'success');
        } else if (result.data.disputed) {
            showToast('⚠️ Conflict! Results differ. Admin will review.', 'warning');
        } else {
            showToast('📸 Proof submitted! Waiting for opponent response (2hr limit)...', 'success');
        }

    } catch (e) {
        console.error('Submit result error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
};

// Dispute timeout checking is now handled server-side by the
// checkDisputeTimeouts scheduled Cloud Function (runs every 5 minutes).
// This ensures all matches are checked reliably, not just when a user opens the app.

// ========== OFFLINE DETECTION ==========
function showOfflineScreen() {
    document.getElementById('offline-screen').style.display = 'flex';
}

function hideOfflineScreen() {
    document.getElementById('offline-screen').style.display = 'none';
}

window.retryConnection = function () {
    if (navigator.onLine) {
        hideOfflineScreen();
        showToast('✅ Connection restored!', 'success');
        // Reload data
        if (typeof loadChallenges === 'function') loadChallenges();
    } else {
        showToast('Still offline. Please check your connection.', 'error');
    }
};

// Listen for offline/online events
window.addEventListener('offline', () => {
    console.log('User went offline');
    showOfflineScreen();
});

window.addEventListener('online', () => {
    console.log('User is back online');
    hideOfflineScreen();
    showToast('✅ Connection restored!', 'success');
});

// Check on page load
if (!navigator.onLine) {
    showOfflineScreen();
}

// Load Challenges for Ludo section - NEW GRID DESIGN
let allLudoMatches = [];
let displayedChallenges = 0;
const CHALLENGES_PER_PAGE = 20;
let myChallengesTab = 'live';
let myChallengesOpen = false;
let _ludoListenerAttached = false; // Guard: prevent duplicate .on() listeners
let _ludoTargetList = null; // Store target list element for the listener callback

function loadChallenges(targetListId) {
    const listId = targetListId || 'home-challenges-list';
    _ludoTargetList = document.getElementById(listId);

    // If listener already attached, just re-render from cached data
    if (_ludoListenerAttached) {
        renderChallengeGrid(_ludoTargetList);
        if (myChallengesOpen) renderMyChallenges();
        return;
    }

    _ludoListenerAttached = true;

    db.ref('ludo_matches').on('value', snap => {
        allLudoMatches = [];
        const myMatches = { live: [], completed: [] };

        snap.forEach(child => {
            const match = child.val();
            match.id = child.key;
            allLudoMatches.push(match);

            // Check if user is involved in this match
            const isCreator = match.creator?.uid === state.user?.uid;
            const isAcceptor = match.acceptor?.uid === state.user?.uid;

            if (isCreator || isAcceptor) {
                if (match.status === 'COMPLETED' || match.status === 'CANCELLED' || match.status === 'EXPIRED' || match.status === 'EXPIRING') {
                    myMatches.completed.push(match);
                } else {
                    myMatches.live.push(match);
                }
            }
        });

        // Update My Challenges count
        const myCount = myMatches.live.length;
        document.getElementById('my-challenges-count').textContent = myCount;

        // Store for dropdown
        window.myLudoMatches = myMatches;

        // Render open challenges grid (use stored ref for latest target)
        renderChallengeGrid(_ludoTargetList);

        // Render My Challenges if open
        if (myChallengesOpen) {
            renderMyChallenges();
        }
    });
}

function renderChallengeGrid(list) {
    if (!list) return;
    list.innerHTML = '';
    displayedChallenges = 0;

    // Filter open challenges from others
    const openChallenges = allLudoMatches.filter(m =>
        m.status === 'OPEN' && m.creator?.uid !== state.user?.uid
    );

    // Update count
    document.getElementById('live-challenges-count').textContent = `(${openChallenges.length})`;

    if (openChallenges.length === 0) {
        list.innerHTML = `
            <div style="grid-column: span 2; text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-ghost" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 15px;"></i>
                <p>No open challenges</p>
                <p style="font-size: 0.85rem;">Create one or wait for others!</p>
            </div>
        `;
        document.getElementById('load-more-container').style.display = 'none';
        return;
    }

    // Sort by newest first
    openChallenges.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Render first batch
    const toShow = openChallenges.slice(0, CHALLENGES_PER_PAGE);
    toShow.forEach(match => {
        list.appendChild(createChallengeCard(match));
    });
    displayedChallenges = toShow.length;

    // Show/hide load more button
    const loadMoreContainer = document.getElementById('load-more-container');
    if (openChallenges.length > displayedChallenges) {
        loadMoreContainer.style.display = 'block';
    } else {
        loadMoreContainer.style.display = 'none';
    }
}

function createChallengeCard(match) {
    const el = document.createElement('div');
    el.className = 'ludo-card';
    el.style.cssText = `
        background: linear-gradient(145deg, #1a1a2e, #16213e);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        transition: transform 0.2s, box-shadow 0.2s;
    `;
    el.innerHTML = `
        <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #ff6b35, #f72585); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; box-shadow: 0 4px 15px rgba(247, 37, 133, 0.3);">
            <i class="fa-solid fa-dice" style="color: white; font-size: 1.3rem;"></i>
        </div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; font-family: monospace;">
            #${match.matchId || match.id.slice(-8)}
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">
            ${escapeHtmlLudo(match.creator?.ludoKingUsername || 'Player')}${match.creator?.isVip && typeof getVipBadgeHtml === 'function' ? getVipBadgeHtml(true) : ''}
        </div>
        <div style="font-size: 1.4rem; font-weight: 800; color: #00d26a; margin-bottom: 8px;">
            🪙 ${match.amount}
        </div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 10px;">
            Win: 🪙 ${Math.floor(match.amount * 2 * (1 - LUDO_COMMISSION_PERCENT / 100))}
        </div>
        <button class="btn btn-primary btn-sm" 
            onclick="acceptChallenge('${match.id}', ${match.amount})" 
            style="width: 100%; padding: 10px; border-radius: 10px; font-weight: 600;">
            <i class="fa-solid fa-play"></i> Play
        </button>
    `;
    return el;
}

function loadMoreChallenges() {
    const list = document.getElementById('home-challenges-list');
    const openChallenges = allLudoMatches.filter(m =>
        m.status === 'OPEN' && m.creator?.uid !== state.user?.uid
    ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const nextBatch = openChallenges.slice(displayedChallenges, displayedChallenges + CHALLENGES_PER_PAGE);
    nextBatch.forEach(match => {
        list.appendChild(createChallengeCard(match));
    });
    displayedChallenges += nextBatch.length;

    // Hide button if no more
    if (displayedChallenges >= openChallenges.length) {
        document.getElementById('load-more-container').style.display = 'none';
    }
}

function refreshLudoChallenges() {
    const btn = document.getElementById('ludo-refresh-btn');
    const icon = btn.querySelector('i');
    icon.classList.add('fa-spin');

    // Reload data
    db.ref('ludo_matches').once('value', snap => {
        allLudoMatches = [];
        snap.forEach(child => {
            const match = child.val();
            match.id = child.key;
            allLudoMatches.push(match);
        });
        renderChallengeGrid(document.getElementById('home-challenges-list'));

        setTimeout(() => icon.classList.remove('fa-spin'), 500);
        showToast('Challenges refreshed!', 'success');
    });
}

// My Challenges Dropdown Functions
function toggleMyChallenges() {
    myChallengesOpen = !myChallengesOpen;
    const dropdown = document.getElementById('my-challenges-dropdown');
    const arrow = document.getElementById('my-challenges-arrow');

    if (myChallengesOpen) {
        dropdown.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
        renderMyChallenges();
    } else {
        dropdown.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

function switchMyChallengesTab(tab) {
    myChallengesTab = tab;
    const tabLive = document.getElementById('my-ch-tab-live');
    const tabCompleted = document.getElementById('my-ch-tab-completed');

    if (tab === 'live') {
        tabLive.style.background = 'var(--primary)';
        tabLive.style.color = 'black';
        tabCompleted.style.background = 'transparent';
        tabCompleted.style.color = 'var(--text-muted)';
    } else {
        tabCompleted.style.background = 'var(--primary)';
        tabCompleted.style.color = 'black';
        tabLive.style.background = 'transparent';
        tabLive.style.color = 'var(--text-muted)';
    }

    renderMyChallenges();
}

function renderMyChallenges() {
    const listEl = document.getElementById('my-challenges-list');
    const matches = window.myLudoMatches?.[myChallengesTab] || [];

    if (matches.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                <i class="fa-solid fa-inbox" style="font-size: 2rem; opacity: 0.3; margin-bottom: 10px;"></i>
                <p>No ${myChallengesTab} challenges</p>
            </div>
        `;
        return;
    }

    // Sort by most recent
    matches.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    listEl.innerHTML = matches.map(match => {
        const isCreator = match.creator?.uid === state.user?.uid;
        const opponent = isCreator ? match.acceptor : match.creator;
        const opponentName = opponent?.ludoKingUsername || opponent?.username || (match.status === 'OPEN' ? 'Waiting...' : 'Opponent');

        // Status badge
        let statusColor = 'var(--primary)';
        let statusText = match.status;
        switch (match.status) {
            case 'OPEN': statusColor = '#f59e0b'; statusText = 'Waiting'; break;
            case 'PAIRED': statusColor = '#6366f1'; statusText = 'Paired'; break;
            case 'ROOM_SHARED': statusColor = '#22c55e'; statusText = 'Room Shared'; break;
            case 'IN_PROGRESS': statusColor = '#ff6b35'; statusText = 'Playing'; break;
            case 'DISPUTED': statusColor = '#ef4444'; statusText = 'Disputed'; break;
            case 'COMPLETED': statusColor = '#22c55e'; statusText = 'Completed'; break;
            case 'CANCELLED': statusColor = '#6b7280'; statusText = 'Cancelled'; break;
            case 'EXPIRED': statusColor = '#6b7280'; statusText = 'Expired'; break;
            case 'EXPIRING': statusColor = '#6b7280'; statusText = 'Expiring...'; break;
            case 'REMATCH_PENDING': statusColor = '#8b5cf6'; statusText = '🔄 Rematch'; break;
        }

        return `
            <div style="background: var(--bg-hover); border-radius: 12px; padding: 14px; margin-bottom: 10px; cursor: pointer;" 
                 onclick="viewMyChallenge('${match.id}')">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div>
                        <span style="font-weight: 700; color: #00d26a; font-size: 1.1rem;">🪙 ${match.amount}</span>
                        <span style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace; margin-left: 6px;">#${match.matchId || match.id.slice(-8)}</span>
                    </div>
                    <span style="background: ${statusColor}20; color: ${statusColor}; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">
                        ${statusText}
                    </span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 35px; height: 35px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <i class="fa-solid fa-user" style="color: white; font-size: 0.85rem;"></i>
                    </div>
                    <div>
                        <div style="font-size: 0.9rem;">vs <strong>${opponentName}</strong>${(opponent?.isVip && typeof getVipBadgeHtml === 'function') ? getVipBadgeHtml(true) : ''}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${formatTimeAgo(match.createdAt)}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function viewMyChallenge(matchId) {
    // Find the match
    const match = allLudoMatches.find(m => m.id === matchId);
    if (!match) return;

    // Render detailed view in the hidden div, then show a modal
    renderActiveLudo(match);

    // Create and show modal with the match details
    const activeDiv = document.getElementById('home-my-challenge');
    if (!activeDiv) return;

    // Status badge config
    let sBadgeColor = '#6366f1', sBadgeText = match.status;
    switch (match.status) {
        case 'OPEN': sBadgeColor = '#f59e0b'; sBadgeText = 'Waiting'; break;
        case 'PAIRED': sBadgeColor = '#6366f1'; sBadgeText = 'Paired'; break;
        case 'ROOM_SHARED': sBadgeColor = '#22c55e'; sBadgeText = 'Room Shared'; break;
        case 'IN_PROGRESS': sBadgeColor = '#ff6b35'; sBadgeText = 'In Progress'; break;
        case 'DISPUTED': sBadgeColor = '#ef4444'; sBadgeText = 'Disputed'; break;
        case 'COMPLETED': sBadgeColor = '#22c55e'; sBadgeText = 'Completed'; break;
        case 'CANCELLED': sBadgeColor = '#6b7280'; sBadgeText = 'Cancelled'; break;
        case 'EXPIRED': sBadgeColor = '#6b7280'; sBadgeText = 'Expired'; break;
        case 'REMATCH_PENDING': sBadgeColor = '#8b5cf6'; sBadgeText = 'Rematch'; break;
    }

    // Clone content and show in a premium modal
    const modalHtml = `
        <div id="my-challenge-detail-modal" class="modal-overlay" style="display: flex;">
            <div class="modal-content" style="max-width: 420px; max-height: 88vh; overflow-y: auto; padding-top: 1.5rem;">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <i class="fa-solid fa-gamepad" style="color: white; font-size: 1rem;"></i>
                        </div>
                        <div>
                            <div style="font-weight: 700; font-size: 1rem; letter-spacing: -0.01em;">Match Details</div>
                            <div style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace;">#${match.matchId || match.id.slice(-8)}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="background: ${sBadgeColor}18; color: ${sBadgeColor}; padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; border: 1px solid ${sBadgeColor}30;">
                            ${sBadgeText}
                        </span>
                        <button onclick="document.getElementById('my-challenge-detail-modal').remove()" 
                            style="background: var(--bg-hover); border: 1px solid var(--border); color: var(--text-muted); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <i class="fa-solid fa-times" style="font-size: 0.85rem;"></i>
                        </button>
                    </div>
                </div>
                ${activeDiv.innerHTML}
            </div>
        </div>
    `;

    // Remove existing modal if any
    document.getElementById('my-challenge-detail-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

// Render Active Ludo Match (handles all states) — Premium Dark Design
function renderActiveLudo(match) {
    const div = document.getElementById('my-active-challenge') || document.getElementById('home-my-challenge');
    if (!div) return;

    const isCreator = match.creator?.uid === state.user?.uid;
    const opponent = isCreator ? match.acceptor : match.creator;
    const opponentName = opponent?.ludoKingUsername || opponent?.username || 'Opponent';
    const myName = isCreator
        ? (match.creator?.ludoKingUsername || 'You')
        : (match.acceptor?.ludoKingUsername || 'You');
    const creatorName = match.creator?.ludoKingUsername || match.creator?.username || 'Creator';
    const prize = Math.floor(match.amount * 2 * (1 - LUDO_COMMISSION_PERCENT / 100));

    // --- Premium VS Card Builder ---
    function buildVSCard(leftName, leftLabel, rightName, rightLabel) {
        return `
            <div style="background: linear-gradient(135deg, #0f172a, #1e293b); border: 1px solid rgba(99,102,241,0.15); border-radius: 14px; padding: 16px; margin-bottom: 14px; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 1;">
                    <div style="text-align: center; flex: 1;">
                        <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1, #818cf8); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 6px;">
                            <i class="fa-solid fa-user" style="color: white; font-size: 0.75rem;"></i>
                        </div>
                        <div style="font-weight: 700; color: #e2e8f0; font-size: 0.85rem;">${escapeHtmlLudo(leftName)}</div>
                        <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">${leftLabel}</div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; padding: 0 8px;">
                        <div style="width: 34px; height: 34px; background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px rgba(245,158,11,0.25);">
                            <span style="font-weight: 900; color: white; font-size: 0.7rem;">VS</span>
                        </div>
                    </div>
                    <div style="text-align: center; flex: 1;">
                        <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #ef4444, #f87171); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 6px;">
                            <i class="fa-solid fa-user" style="color: white; font-size: 0.75rem;"></i>
                        </div>
                        <div style="font-weight: 700; color: #e2e8f0; font-size: 0.85rem;">${escapeHtmlLudo(rightName)}</div>
                        <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">${rightLabel}</div>
                    </div>
                </div>
                <div style="margin-top: 12px; background: linear-gradient(135deg, rgba(34,197,94,0.06), rgba(16,185,129,0.03)); border: 1px solid rgba(34,197,94,0.12); border-radius: 10px; padding: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="text-align: center; flex: 1;">
                        <div style="font-size: 0.62rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Entry</div>
                        <div style="font-weight: 700; color: #fbbf24; font-size: 0.9rem;">🪙 ${match.amount}</div>
                    </div>
                    <div style="width: 1px; height: 22px; background: rgba(255,255,255,0.06);"></div>
                    <div style="text-align: center; flex: 1;">
                        <div style="font-size: 0.62rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Prize</div>
                        <div style="font-weight: 700; color: #22c55e; font-size: 0.9rem;">🪙 ${prize}</div>
                    </div>
                </div>
            </div>
        `;
    }

    // --- Collapsible Rules Section ---
    function buildRulesSection(variant) {
        const rules = variant === 'creator' ? [
            'Won? Screenshot your victory in Ludo King → tap Won → upload.',
            'Lost? Tap Lost to confirm. <strong style="color:#f87171;">Not reporting = 🪙25 penalty.</strong>',
            'Submit results within 2 hours of Room Code shared.',
            'Opponent silent? Prize credited in 2-4 hours after proof.',
            'Screen record your games for dispute protection.',
            'Room code must be shared within 15 mins. <strong style="color:#f87171;">Late = 🪙25 penalty + auto-cancel.</strong>',
            'Quick Mode & 5-6 player modes not allowed.',
            'Both players must agree on and play the same mode.'
        ] : [
            'Victory? Screenshot win screen → tap Won → upload proof.',
            'Defeat? Tap Lost to confirm. <strong style="color:#f87171;">Not reporting = 🪙25 penalty.</strong>',
            'Results due within 2 hours of Room Code shared.',
            'Opponent silent? Prize credited in 2-4 hours after proof.',
            'Always record gameplay for dispute protection.',
            'Challenger has 15 mins to share code. <strong style="color:#f87171;">Delay = 🪙25 penalty + full refund to you.</strong>',
            'Quick Mode & 5-6 player modes not allowed.',
            'Both players must play the exact same mode.'
        ];
        return `
            <div style="background: linear-gradient(135deg, #1e1e2e, #1a1a2a); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; overflow: hidden; margin-bottom: 12px;">
                <div onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'; this.querySelector('.rules-chevron').style.transform = this.nextElementSibling.style.display === 'none' ? 'rotate(0deg)' : 'rotate(180deg)';"
                     style="padding: 12px 14px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-shield-halved" style="color: #818cf8; font-size: 0.8rem;"></i>
                        <span style="font-weight: 600; font-size: 0.8rem; color: #a5b4fc;">Rules & Guidelines</span>
                    </div>
                    <i class="fa-solid fa-chevron-down rules-chevron" style="color: #475569; font-size: 0.65rem; transition: transform 0.2s;"></i>
                </div>
                <div style="display: none; padding: 0 14px 14px;">
                    <ol style="padding-left: 16px; margin: 0; font-size: 0.7rem; color: #94a3b8; line-height: 1.7;">
                        ${rules.map(r => '<li style="margin-bottom: 3px;">' + r + '</li>').join('')}
                    </ol>
                </div>
            </div>
        `;
    }

    let statusHtml = '';
    let statusColor = 'var(--primary)';

    // State-based UI
    switch (match.status) {
        case 'OPEN':
            statusColor = '#f59e0b';
            statusHtml = `
                <div style="text-align: center; padding: 24px 16px;">
                    <div style="width: 52px; height: 52px; background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04)); border: 2px solid rgba(245,158,11,0.25); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; animation: pulse 2s ease-in-out infinite;">
                        <i class="fa-solid fa-hourglass-half" style="color: #fbbf24; font-size: 1.2rem;"></i>
                    </div>
                    <div style="font-weight: 600; color: #fbbf24; margin-bottom: 4px;">Searching for Opponent</div>
                    <div style="font-size: 0.78rem; color: #64748b;">Your challenge is live — waiting for someone to accept</div>
                    <button class="btn btn-outline btn-block" onclick="cancelMyChallenge('${match.id}')" 
                        style="margin-top: 18px; padding: 12px; border-color: rgba(107,114,128,0.2); color: #94a3b8; font-size: 0.82rem; border-radius: 10px;">
                        <i class="fa-solid fa-times"></i> Cancel Challenge
                    </button>
                </div>
            `;
            break;

        case 'PAIRED':
            statusColor = '#6366f1';
            if (isCreator) {
                statusHtml = `
                    <div id="ludo-paired-details-${match.id}" style="padding: 12px;">
                        ${buildVSCard(myName, 'Challenger', opponentName, 'Opponent')}
                        
                        <button class="btn btn-primary btn-block" onclick="showRoomCodeInputScreen('${match.id}')" 
                            style="background: linear-gradient(135deg, #6366f1, #4f46e5); border: none; padding: 14px; border-radius: 12px; font-weight: 600; font-size: 0.88rem; margin-bottom: 14px; box-shadow: 0 4px 15px rgba(99,102,241,0.25);">
                            <i class="fa-solid fa-key"></i> Share Room Code to Start
                        </button>
                        
                        ${buildRulesSection('creator')}
                        
                        <button class="btn btn-outline btn-block" onclick="cancelMyChallenge('${match.id}')" 
                            style="padding: 10px; border-color: rgba(107,114,128,0.15); color: #64748b; font-size: 0.8rem;">
                            <i class="fa-solid fa-times"></i> Cancel Match
                        </button>
                    </div>
                    
                    <div id="ludo-roomcode-screen-${match.id}" style="display: none; padding: 16px;">
                        <div style="text-align: center; margin-bottom: 16px;">
                            <div style="width: 46px; height: 46px; background: linear-gradient(135deg, #6366f1, #818cf8); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px;">
                                <i class="fa-solid fa-key" style="color: white; font-size: 0.95rem;"></i>
                            </div>
                            <div style="font-weight: 600; color: #e2e8f0;">Enter Room Code</div>
                            <div style="font-size: 0.78rem; color: #64748b; margin-top: 4px;">Paired with <strong style="color: #818cf8;">${escapeHtmlLudo(opponentName)}</strong></div>
                        </div>
                        <div style="background: linear-gradient(135deg, #0f172a, #1e293b); border: 1px solid rgba(99,102,241,0.15); padding: 18px; border-radius: 14px; margin-bottom: 14px;">
                            <input type="text" id="ludo-room-code-input" class="form-input" placeholder="e.g. 12345678" 
                                style="text-align: center; font-size: 1.3rem; letter-spacing: 4px; font-weight: 700; margin-bottom: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(99,102,241,0.2); color: #e2e8f0; border-radius: 10px; padding: 14px;">
                            <button class="btn btn-primary btn-block" onclick="shareRoomCode('${match.id}')"
                                style="background: linear-gradient(135deg, #22c55e, #16a34a); border: none; padding: 14px; border-radius: 10px; font-weight: 600;">
                                <i class="fa-solid fa-share"></i> Share Room Code
                            </button>
                        </div>
                        <button class="btn btn-outline btn-block" onclick="hideRoomCodeInputScreen('${match.id}')" style="padding: 10px; color: #64748b; border-color: rgba(107,114,128,0.15);">
                            <i class="fa-solid fa-arrow-left"></i> Back
                        </button>
                    </div>
                `;
            } else {
                // Acceptor view: waiting for room code
                statusHtml = `
                    <div style="padding: 12px;">
                        ${buildVSCard(creatorName, 'Challenger', myName, 'You')}
                        
                        <div style="background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.04)); border: 1px solid rgba(99,102,241,0.15); border-radius: 12px; padding: 16px; margin-bottom: 14px; text-align: center;">
                            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1, #818cf8); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; animation: pulse 2s ease-in-out infinite;">
                                <i class="fa-solid fa-spinner fa-spin" style="color: white; font-size: 0.9rem;"></i>
                            </div>
                            <div style="font-weight: 600; color: #a5b4fc; font-size: 0.88rem;">Waiting for Room Code</div>
                            <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">${escapeHtmlLudo(creatorName)} is creating the room...</div>
                        </div>
                        
                        ${buildRulesSection('acceptor')}
                        
                        <button class="btn btn-outline btn-block" onclick="cancelMyChallenge('${match.id}')" 
                            style="padding: 10px; border-color: rgba(107,114,128,0.15); color: #64748b; font-size: 0.8rem;">
                            <i class="fa-solid fa-times"></i> Cancel Match
                        </button>
                    </div>
                `;
            }
            break;

        case 'ROOM_SHARED':
        case 'IN_PROGRESS':
            statusColor = '#10b981';
            const myResult = isCreator ? match.result?.creator : match.result?.acceptor;
            const opponentResult = isCreator ? match.result?.acceptor : match.result?.creator;
            const hasSubmitted = !!myResult;
            const opponentDisputed = opponentResult?.type === 'DISPUTE';
            const opponentClaimedWon = opponentResult?.type === 'WON';
            const resultTypeDisplay = hasSubmitted ? (myResult?.type || myResult) : null;

            // Opponent alert banners
            let opponentDisputeBanner = '';
            if (!hasSubmitted && opponentDisputed) {
                opponentDisputeBanner = `
                    <div style="background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.04)); border: 1px solid rgba(245,158,11,0.2); border-radius: 12px; padding: 14px; margin-bottom: 14px; text-align: center;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px;">
                            <i class="fa-solid fa-triangle-exclamation" style="color: #fbbf24;"></i>
                            <span style="font-weight: 600; color: #fbbf24; font-size: 0.85rem;">Opponent Raised a Dispute</span>
                        </div>
                        <div style="font-size: 0.78rem; color: #94a3b8;">Please submit YOUR result below within 2 hours.</div>
                    </div>
                `;
            } else if (!hasSubmitted && opponentClaimedWon) {
                opponentDisputeBanner = `
                    <div style="background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.04)); border: 1px solid rgba(59,130,246,0.2); border-radius: 12px; padding: 14px; margin-bottom: 14px; text-align: center;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px;">
                            <i class="fa-solid fa-trophy" style="color: #60a5fa;"></i>
                            <span style="font-weight: 600; color: #60a5fa; font-size: 0.85rem;">Opponent Claims Victory</span>
                        </div>
                        <div style="font-size: 0.78rem; color: #94a3b8;">Submit YOUR result below within 2 hours.</div>
                    </div>
                `;
            }

            // Check for cancel request state
            const cancelReq = match.cancelRequest;
            const hasCancelRequest = !!cancelReq;
            const iSentCancelRequest = cancelReq?.requestedBy === state.user?.uid;
            const opponentSentCancelRequest = hasCancelRequest && !iSentCancelRequest;

            // Cancel request UI
            let cancelHtml = '';
            if (opponentSentCancelRequest) {
                cancelHtml = `
                    <div style="background: linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03)); border: 1px solid rgba(245,158,11,0.18); border-radius: 12px; padding: 14px; margin-top: 14px; text-align: center;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                            <i class="fa-solid fa-handshake" style="color: #fbbf24;"></i>
                            <span style="font-weight: 600; color: #fbbf24; font-size: 0.85rem;">Cancel Request Received</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px;">Opponent wants to mutually cancel. Both get full refund.</div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-block" onclick="acceptMutualCancel('${match.id}')" 
                                style="flex: 1; padding: 12px; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border: none; border-radius: 10px; font-weight: 600; font-size: 0.82rem;">
                                <i class="fa-solid fa-check"></i> Accept
                            </button>
                            <button class="btn btn-block" onclick="rejectMutualCancel('${match.id}')" 
                                style="flex: 1; padding: 12px; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; border-radius: 10px; font-weight: 600; font-size: 0.82rem;">
                                <i class="fa-solid fa-times"></i> Reject
                            </button>
                        </div>
                    </div>
                `;
            } else if (iSentCancelRequest) {
                cancelHtml = `
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 12px; margin-top: 14px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i class="fa-solid fa-hourglass-half" style="color: #fbbf24; font-size: 0.8rem;"></i>
                        <span style="font-size: 0.8rem; color: #94a3b8;">Cancel request sent — waiting for opponent...</span>
                    </div>
                `;
            } else if (!hasSubmitted) {
                cancelHtml = `
                    <button class="btn btn-outline btn-block" onclick="cancelMyChallenge('${match.id}')" 
                        style="padding: 10px; margin-top: 12px; font-size: 0.8rem; color: #64748b; border-color: rgba(107,114,128,0.12);">
                        <i class="fa-solid fa-handshake-slash"></i> Request Mutual Cancel
                    </button>
                `;
            }

            statusHtml = `
                <div style="padding: 12px;">
                    ${buildVSCard(isCreator ? myName : creatorName, isCreator ? 'Challenger' : 'Challenger', isCreator ? opponentName : myName, isCreator ? 'Opponent' : 'You')}
                    
                    <!-- Room Code with glow -->
                    <div style="background: linear-gradient(135deg, #0f172a, #1e293b); border: 1px solid rgba(34,197,94,0.18); border-radius: 14px; padding: 18px; margin-bottom: 14px; text-align: center; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 40%; height: 2px; background: linear-gradient(90deg, transparent, #22c55e, transparent);"></div>
                        <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Room Code</div>
                        <div style="font-size: 1.7rem; font-weight: 800; letter-spacing: 4px; color: #22c55e; font-family: monospace; text-shadow: 0 0 18px rgba(34,197,94,0.25);">
                            ${match.roomCode || 'N/A'}
                        </div>
                        <button onclick="copyToClipboard('${match.roomCode}')" class="btn btn-sm" 
                            style="margin-top: 10px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.18); color: #22c55e; padding: 6px 16px; border-radius: 8px; font-size: 0.75rem;">
                            <i class="fa-solid fa-copy"></i> Copy Code
                        </button>
                    </div>
                    
                    ${opponentDisputeBanner}
                    ${hasSubmitted ? `
                        <div style="background: linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02)); border: 1px solid rgba(34,197,94,0.15); border-radius: 12px; padding: 16px; text-align: center;">
                            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px;">
                                <i class="fa-solid fa-circle-check" style="color: #22c55e;"></i>
                                <span style="font-weight: 600; color: #22c55e; font-size: 0.88rem;">Result Submitted</span>
                            </div>
                            <div style="font-size: 0.82rem; color: #94a3b8;">You reported: <strong style="color: #e2e8f0;">${resultTypeDisplay}</strong></div>
                            <div style="font-size: 0.75rem; color: #64748b; margin-top: 6px;"><i class="fa-solid fa-clock"></i> Waiting for opponent (2hr limit)...</div>
                        </div>
                    ` : `
                        <div style="font-size: 0.8rem; color: #94a3b8; text-align: center; margin-bottom: 14px;">
                            <i class="fa-solid fa-gamepad" style="margin-right: 4px;"></i> Play the match in Ludo King and submit your result
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button class="btn btn-block" onclick="submitLost('${match.id}')" 
                                style="padding: 14px; background: linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.04)); border: 1px solid rgba(239,68,68,0.2); color: #f87171; border-radius: 12px; font-weight: 600; font-size: 0.85rem;">
                                <i class="fa-solid fa-flag"></i> I Lost
                            </button>
                            <button class="btn btn-block" onclick="showResultModal('${match.id}', 'WON')" 
                                style="padding: 14px; background: linear-gradient(135deg, #22c55e, #16a34a); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 0.85rem; box-shadow: 0 4px 12px rgba(34,197,94,0.2);">
                                <i class="fa-solid fa-trophy"></i> I Won — Upload Proof
                            </button>
                            <button class="btn btn-block" onclick="showResultModal('${match.id}', 'DISPUTE')" 
                                style="padding: 14px; background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.04)); border: 1px solid rgba(245,158,11,0.2); color: #fbbf24; border-radius: 12px; font-weight: 600; font-size: 0.85rem;">
                                <i class="fa-solid fa-triangle-exclamation"></i> Raise Dispute
                            </button>
                        </div>
                    `}
                    ${cancelHtml}
                </div>
            `;
            break;

        case 'DISPUTED':
            statusColor = '#ef4444';
            statusHtml = `
                <div style="text-align: center; padding: 24px;">
                    <div style="width: 52px; height: 52px; background: linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04)); border: 2px solid rgba(239,68,68,0.25); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                        <i class="fa-solid fa-gavel" style="color: #f87171; font-size: 1.2rem;"></i>
                    </div>
                    <div style="font-weight: 600; color: #f87171; margin-bottom: 6px;">Match Under Review</div>
                    <div style="color: #94a3b8; font-size: 0.82rem; margin-bottom: 16px;">Results conflict — admin will review and resolve.</div>
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i class="fa-solid fa-clock" style="color: #64748b;"></i>
                        <span style="font-size: 0.8rem; color: #94a3b8;">Please wait for resolution</span>
                    </div>
                </div>
            `;
            break;

        case 'COMPLETED': {
            const isWinner = match.winner === state.user?.uid;
            statusColor = isWinner ? '#22c55e' : '#6b7280';
            const hasRematch = !!match.rematchId;
            const rematchBtn = hasRematch
                ? `<div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 12px; margin-top: 16px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
                       <i class="fa-solid fa-check-circle" style="color: #6366f1;"></i>
                       <span style="font-size: 0.82rem; color: #94a3b8;">Rematch sent</span>
                   </div>`
                : `<button class="btn btn-block" onclick="sendRematch('${match.id}')" 
                       style="margin-top: 16px; padding: 14px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 12px; font-weight: 600; box-shadow: 0 4px 12px rgba(99,102,241,0.25);">
                       <i class="fa-solid fa-rotate"></i> Rematch 🪙 ${match.amount}
                   </button>`;
            statusHtml = `
                <div style="text-align: center; padding: 24px;">
                    ${isWinner ? `
                        <div style="font-size: 2.2rem; margin-bottom: 8px;">🎉</div>
                        <div style="font-weight: 700; font-size: 1.05rem; background: linear-gradient(135deg, #22c55e, #4ade80); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px;">Victory!</div>
                        <div style="font-size: 1.4rem; font-weight: 800; color: #22c55e; text-shadow: 0 0 18px rgba(34,197,94,0.25);">🪙 ${(match.winAmount || 0).toFixed(2)}</div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">credited to your wallet</div>
                    ` : `
                        <div style="font-size: 2.2rem; margin-bottom: 8px;">🎮</div>
                        <div style="font-weight: 600; color: #94a3b8; margin-bottom: 6px;">Match Complete</div>
                        <div style="background: linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02)); border: 1px solid rgba(99,102,241,0.12); border-radius: 10px; padding: 10px; display: inline-block;">
                            <span style="font-size: 0.8rem; color: #a5b4fc;"><i class="fa-solid fa-star" style="margin-right: 4px;"></i> Every game is practice — comeback stronger!</span>
                        </div>
                    `}
                    ${rematchBtn}
                </div>
            `;
            break;
        }

        case 'REMATCH_PENDING': {
            statusColor = '#6366f1';
            const isSender = match.rematchSender === state.user?.uid;
            const rematchOpponent = isSender
                ? (match.acceptor?.uid === match.rematchReceiver ? match.acceptor?.ludoKingUsername : match.creator?.ludoKingUsername)
                : (match.creator?.uid === match.rematchSender ? match.creator?.ludoKingUsername : match.acceptor?.ludoKingUsername);
            statusHtml = isSender ? `
                <div style="text-align: center; padding: 24px;">
                    <div style="width: 52px; height: 52px; background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.04)); border: 2px solid rgba(99,102,241,0.25); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; animation: pulse 2s ease-in-out infinite;">
                        <i class="fa-solid fa-rotate" style="color: #818cf8; font-size: 1.2rem;"></i>
                    </div>
                    <div style="font-weight: 600; color: #a5b4fc; margin-bottom: 6px;">Rematch Sent</div>
                    <div style="color: #94a3b8; font-size: 0.82rem; margin-bottom: 16px;">
                        Waiting for <strong style="color: #818cf8;">${escapeHtmlLudo(rematchOpponent || 'Opponent')}</strong> to accept
                    </div>
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 14px;">
                        <i class="fa-solid fa-clock" style="color: #64748b;"></i>
                        <span style="font-size: 0.78rem; color: #94a3b8;">Expires in 5 minutes</span>
                    </div>
                    <button class="btn btn-outline btn-block" onclick="declineRematch('${match.id}')" 
                        style="padding: 10px; color: #64748b; border-color: rgba(107,114,128,0.15); font-size: 0.82rem;">
                        <i class="fa-solid fa-times"></i> Cancel Rematch
                    </button>
                </div>
            ` : `
                <div style="text-align: center; padding: 24px;">
                    <div style="font-size: 2rem; margin-bottom: 10px;">🔥</div>
                    <div style="font-weight: 600; color: #a5b4fc; margin-bottom: 6px;">Rematch Challenge!</div>
                    <div style="color: #94a3b8; font-size: 0.82rem; margin-bottom: 4px;">
                        <strong style="color: #818cf8;">${escapeHtmlLudo(rematchOpponent || 'Opponent')}</strong> wants a rematch
                    </div>
                    <div style="font-size: 1.4rem; font-weight: 800; color: #22c55e; margin: 12px 0; text-shadow: 0 0 18px rgba(34,197,94,0.25);">🪙 ${match.amount}</div>
                    <div style="display: flex; gap: 10px; margin-top: 16px;">
                        <button class="btn btn-block" onclick="acceptRematch('${match.id}', ${match.amount})" 
                            style="flex: 1; padding: 14px; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border: none; border-radius: 12px; font-weight: 600; box-shadow: 0 4px 12px rgba(34,197,94,0.2);">
                            <i class="fa-solid fa-check"></i> Accept
                        </button>
                        <button class="btn btn-block" onclick="declineRematch('${match.id}')" 
                            style="flex: 1; padding: 14px; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; border-radius: 12px; font-weight: 600;">
                            <i class="fa-solid fa-times"></i> Decline
                        </button>
                    </div>
                </div>
            `;
            break;
        }

        case 'CANCELLED':
        case 'EXPIRED':
        case 'EXPIRING':
            statusColor = '#6b7280';
            statusHtml = `
                <div style="text-align: center; padding: 24px;">
                    <div style="width: 52px; height: 52px; background: rgba(107,114,128,0.08); border: 2px solid rgba(107,114,128,0.18); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                        <i class="fa-solid fa-ban" style="color: #6b7280; font-size: 1.2rem;"></i>
                    </div>
                    <div style="font-weight: 600; color: #94a3b8;">Match Cancelled</div>
                    <div style="color: #64748b; font-size: 0.82rem; margin-top: 6px;">Your entry fee has been refunded to your wallet.</div>
                </div>
            `;
            break;

        case 'CANCELLING':
            statusColor = '#f59e0b';
            statusHtml = `
                <div style="text-align: center; padding: 24px;">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.4rem; color: #fbbf24;"></i>
                    <div style="font-weight: 600; color: #fbbf24; margin-top: 10px;">Cancelling...</div>
                    <div style="color: #94a3b8; font-size: 0.82rem; margin-top: 5px;">Processing your refund</div>
                </div>
            `;
            break;

        default:
            statusHtml = `<div style="padding: 15px; text-align: center; color: #94a3b8;">Unknown status: ${match.status}</div>`;
    }

    div.innerHTML = statusHtml;
}

// ─── Rematch Functions ─────────────────────────────────────

window.sendRematch = async function (matchId) {
    try {
        const btn = event?.target?.closest('button');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; }
        const sendRematchFn = firebase.functions().httpsCallable('sendRematch');
        const result = await sendRematchFn({ matchId });
        if (result.data.success) {
            showToast('🔄 Rematch request sent!', 'success');
        }
    } catch (err) {
        showToast(err.message || 'Failed to send rematch', 'error');
        const btn = event?.target?.closest('button');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Rematch'; }
    }
};

window.acceptRematch = async function (matchId, amount) {
    try {
        const btn = event?.target?.closest('button');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Accepting...'; }
        const acceptRematchFn = firebase.functions().httpsCallable('acceptRematch');
        const result = await acceptRematchFn({ matchId });
        if (result.data.success) {
            showToast('✅ Rematch accepted! Waiting for room code...', 'success');
            // Update local balance display
            if (state.userData) {
                state.userData.depositBalance = result.data.newDepositBalance;
                state.userData.winningBalance = result.data.newWinningBalance;
                if (typeof updateUIHeader === 'function') updateUIHeader();
            }
        }
    } catch (err) {
        showToast(err.message || 'Failed to accept rematch', 'error');
        const btn = event?.target?.closest('button');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Accept'; }
    }
};

window.declineRematch = async function (matchId) {
    try {
        const btn = event?.target?.closest('button');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        const declineRematchFn = firebase.functions().httpsCallable('declineRematch');
        await declineRematchFn({ matchId });
        showToast('Rematch declined', 'info');
    } catch (err) {
        showToast(err.message || 'Failed to decline rematch', 'error');
        const btn = event?.target?.closest('button');
        if (btn) { btn.disabled = false; }
    }
};

// Helper: Copy to clipboard
window.copyToClipboard = function (text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('📋 Copied!', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
};



// --- PROFILE LOGIC ---
function loadProfile() {
    document.getElementById('profile-username').innerText = state.userData.username;
    document.getElementById('profile-email').innerText = state.userData.email;
    document.getElementById('profile-uid').innerText = state.user.uid;
    // Use split wallet balance (consistent with updateUIHeader)
    const totalBal = (state.userData.depositBalance || 0) + (state.userData.winningBalance || 0);
    document.getElementById('profile-balance').innerHTML = formatCoin(totalBal);

    // Load ranking card data
    loadMyRanking();

    // Load Txns
    db.ref('wallet_transactions').orderByChild('userId').equalTo(state.user.uid).limitToLast(10).once('value', snap => {
        const div = document.getElementById('txn-list');
        div.innerHTML = '';
        const arr = [];
        snap.forEach(c => arr.push(c.val()));
        arr.reverse().forEach(txn => {
            const row = document.createElement('div');
            row.style.padding = '10px';
            row.style.borderBottom = '1px solid #333';
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.innerHTML = `
                <div>
                    <div style="font-size:0.9rem">${txn.reason}</div>
                    <div style="font-size:0.75rem; color:#666">${new Date(txn.timestamp).toLocaleDateString()}</div>
                </div>
                <div class="${txn.type === 'CREDIT' ? 'text-success' : 'text-danger'}">
                    ${txn.type === 'CREDIT' ? '+' : '-'}${formatCoinText(txn.amount)}
                </div>
            `;
            div.appendChild(row);
        });
    });
}

// ==========================================
//  DEPOSIT FUNCTIONS
// ==========================================

let depositState = {
    amount: 0,
    transactionId: null,
    upiId: null,
    upiLink: null
};

// Backend URL - Update this when deployed
const BACKEND_URL = '/api'; // Relative path for Vercel

