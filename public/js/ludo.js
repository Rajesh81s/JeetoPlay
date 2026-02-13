// JeetoPlay — Ludo
// Auto-extracted from app.html

// --- LUDO LOGIC (Full State Machine) ---

// Platform commission percentage (15%) — ₹10 challenge = ₹17 winning
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
        if (btn.textContent === '₹' + amount) {
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
        return showToast('Minimum amount is ₹10', 'error');
    }
    if (amount > 25000) {
        return showToast('Maximum amount is ₹25,000', 'error');
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
        showInsufficientBalanceModal(`Need ₹${amount} to create challenge. Your balance: ₹${totalBalance.toFixed(2)}`);
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
            // Unilateral cancel — allowed for OPEN/PAIRED
            if (!confirm('Cancel this challenge? You will receive a full refund.')) return;
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

    if (!confirm('Request mutual cancellation? Your opponent must also agree for the match to be cancelled and refunded.')) return;

    try {
        // Call Cloud Function
        const cancelLudoMatchFn = functions.httpsCallable('cancelLudoMatch');
        await cancelLudoMatchFn({ matchId: id, cancelType: 'MUTUAL_REQUEST' });

        showToast('🤝 Cancel request sent! Waiting for opponent to accept...', 'info');
    } catch (e) {
        console.error('Request cancel error:', e);
        showToast('Failed: ' + (e.details || e.message), 'error');
    }
}

// --- MUTUAL CANCEL: Accept (opponent agrees) ---
window.acceptMutualCancel = async function (id) {
    if (!confirm('Accept cancellation? Both players will be fully refunded.')) return;

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
    if (!confirm('Reject the cancellation request? The match will continue.')) return;

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
        showInsufficientBalanceModal(`Need ₹${amount} to accept. Your balance: ₹${totalBalance.toFixed(2)}`);
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


// Share Room Code (Creator only, PAIRED state)
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

        await db.ref('ludo_matches/' + id).update({
            roomCode: roomCode,
            status: 'ROOM_SHARED',
            roomSharedAt: firebase.database.ServerValue.TIMESTAMP
        });

        showToast('✅ Room code shared! Both players can now join.', 'success');

        // Refresh the modal with updated state
        viewMyChallenge(id);
    } catch (e) {
        console.error('Share room code error:', e);
        showToast('Failed: ' + e.message, 'error');
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

// Start Game (transition to IN_PROGRESS)
window.startLudoGame = async function (id) {
    try {
        await db.ref('ludo_matches/' + id).update({
            status: 'IN_PROGRESS',
            startedAt: firebase.database.ServerValue.TIMESTAMP
        });
        showToast('🎲 Game started! Submit result when finished.', 'success');
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
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

// Submit LOST - Show custom confirmation modal first
window.submitLost = function (id) {
    // Show custom confirmation modal instead of native confirm()
    document.getElementById('confirm-lost-match-id').value = id;
    document.getElementById('confirm-lost-modal').classList.remove('hidden');
};

// Actual submission after user confirms in custom modal
window.confirmLostSubmit = async function () {
    const id = document.getElementById('confirm-lost-match-id').value;
    closeModal('confirm-lost-modal');

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
        closeModal('ludo-result-modal');

        // Convert to base64
        const reader = new FileReader();
        const base64Promise = new Promise((resolve) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
        const screenshot = await base64Promise;

        // Call Cloud Function FIRST for result processing (all balance ops server-side)
        // NOTE: Screenshot must be saved AFTER cloud function call, not before.
        // Writing to result/{role}/screenshot before the call creates the result object,
        // which causes the cloud function's duplicate check to falsely reject the submission.
        const submitLudoResultFn = functions.httpsCallable('submitLudoResult');
        const result = await submitLudoResultFn({
            matchId: id,
            resultType: type,
            screenshotUrl: screenshot
        });

        // Now store screenshot + remarks on the match (non-financial, client can do this)
        const uid = state.user.uid;
        const matchSnap = await db.ref('ludo_matches/' + id).once('value');
        const match = matchSnap.val();
        if (match) {
            const isCreator = match.creator?.uid === uid;
            const role = isCreator ? 'creator' : 'acceptor';
            await db.ref(`ludo_matches/${id}/result/${role}/screenshot`).set(screenshot);
            if (remarks) {
                await db.ref(`ludo_matches/${id}/result/${role}/remarks`).set(remarks);
            }
        }

        // Handle response
        if (result.data.autoResolved) {
            state.userData.winningBalance = (state.userData.winningBalance || 0) + result.data.winAmount;
            updateUIHeader();
            showToast(`🎉 You WON ₹${result.data.winAmount.toFixed(2)}!`, 'success');
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

function loadChallenges(targetListId) {
    const listId = targetListId || 'home-challenges-list';
    const list = document.getElementById(listId);

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
                if (match.status === 'COMPLETED' || match.status === 'CANCELLED') {
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

        // Render open challenges grid
        renderChallengeGrid(list);

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
            ${match.creator?.ludoKingUsername || 'Player'}
        </div>
        <div style="font-size: 1.4rem; font-weight: 800; color: #00d26a; margin-bottom: 8px;">
            ₹${match.amount}
        </div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 10px;">
            Win: ₹${Math.floor(match.amount * 2 * (1 - LUDO_COMMISSION_PERCENT / 100))}
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
        }

        return `
            <div style="background: var(--bg-hover); border-radius: 12px; padding: 14px; margin-bottom: 10px; cursor: pointer;" 
                 onclick="viewMyChallenge('${match.id}')">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div>
                        <span style="font-weight: 700; color: #00d26a; font-size: 1.1rem;">₹${match.amount}</span>
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
                        <div style="font-size: 0.9rem;">vs <strong>${opponentName}</strong></div>
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

    // Clone content and show in a modal
    const modalHtml = `
        <div id="my-challenge-detail-modal" class="modal-overlay" style="display: flex;">
            <div class="modal" style="max-width: 400px; max-height: 90vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">Match #${match.matchId || match.id.slice(-8)}</h3>
                    <button onclick="document.getElementById('my-challenge-detail-modal').remove()" 
                        style="background: none; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer;">
                        <i class="fa-solid fa-times"></i>
                    </button>
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

// Render Active Ludo Match (handles all states)
function renderActiveLudo(match) {
    const div = document.getElementById('my-active-challenge') || document.getElementById('home-my-challenge');
    if (!div) return;

    const isCreator = match.creator?.uid === state.user?.uid;
    const opponent = isCreator ? match.acceptor : match.creator;
    // Use Ludo King username for privacy
    const opponentName = opponent?.ludoKingUsername || opponent?.username || 'Opponent';

    let statusHtml = '';
    let statusColor = 'var(--primary)';
    let statusIcon = 'fa-spinner fa-spin';

    // State-based UI
    switch (match.status) {
        case 'OPEN':
            statusColor = '#f59e0b';
            statusIcon = 'fa-hourglass-half';
            statusHtml = `
                <div style="text-align: center; padding: 15px;">
                    <div style="color: ${statusColor}; margin-bottom: 10px;">
                        <i class="fa-solid ${statusIcon}"></i> Waiting for opponent...
                    </div>
                    <button class="btn btn-outline" onclick="cancelMyChallenge('${match.id}')" style="margin-top: 10px;">
                        <i class="fa-solid fa-times"></i> Cancel Challenge
                    </button>
                </div>
            `;
            break;

        case 'PAIRED':
            statusColor = '#6366f1';
            statusIcon = 'fa-handshake';
            if (isCreator) {
                // Creator sees match details with rules first, then can update room code
                statusHtml = `
                    <div id="ludo-paired-details-${match.id}" style="padding: 10px;">
                        <!-- Header with Players -->
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; background: linear-gradient(135deg, #dc2626, #b91c1c); padding: 12px; border-radius: 10px;">
                            <div style="text-align: center; flex: 1;">
                                <div style="font-weight: 700; color: white;">${match.creator?.ludoKingUsername || 'You'}</div>
                                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.8);">Challenged</div>
                                <div style="font-weight: 700; color: #fbbf24;">₹${match.amount}</div>
                            </div>
                            <div style="color: white; font-weight: 700; padding: 0 15px;">VS</div>
                            <div style="text-align: center; flex: 1;">
                                <div style="font-weight: 700; color: white;">${opponentName}</div>
                                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.8);">Winning</div>
                                <div style="font-weight: 700; color: #4ade80;">₹${(match.amount * 2 * (1 - LUDO_COMMISSION_PERCENT / 100)).toFixed(0)}</div>
                            </div>
                        </div>
                        
                        <!-- Update Room Code Button -->
                        <button class="btn btn-primary btn-block" onclick="showRoomCodeInputScreen('${match.id}')" 
                            style="background: linear-gradient(135deg, #dc2626, #b91c1c); border: none; margin-bottom: 15px; padding: 12px;">
                            <i class="fa-solid fa-key"></i> Update Room Code To Proceed
                        </button>
                        
                        <!-- Rules Section -->
                        <div style="background: #fff5f5; border: 1px solid #fecaca; border-radius: 10px; padding: 12px; margin-bottom: 10px;">
                            <div style="font-weight: 700; color: #dc2626; margin-bottom: 10px; text-align: center;">📋 RULES & GUIDELINES</div>
                            <ol style="padding-left: 18px; margin: 0; font-size: 0.75rem; color: #374151; line-height: 1.7;">
                                <li>Won the match? Capture a screenshot from Ludo King showing your victory, then tap Won and upload it.</li>
                                <li>Lost the game? Tap the Lost button to confirm. <strong style="color: #dc2626;">Failure to report = ₹25 penalty.</strong></li>
                                <li>Both players must submit results within 2 hours after Room Code is shared.</li>
                                <li>If opponent doesn't respond, your winnings will be credited within 2-4 hours after proof upload.</li>
                                <li>Screen record your games for dispute protection.</li>
                                <li>Need assistance? Contact JeetoPlay support anytime.</li>
                                <li>Ludo King app is required to participate.</li>
                                <li>Room code must be shared within 15 mins. <strong style="color: #dc2626;">Late sharing = ₹25 penalty + match cancellation with full refund to opponent.</strong></li>
                                <li>Quick Mode and 5-6 player modes are not permitted on JeetoPlay.</li>
                                <li>Choose your game mode carefully - both players must play the exact same mode.</li>
                            </ol>
                        </div>
                        
                        <!-- Action Buttons -->
                        <div style="display: flex; gap: 10px; margin-top: 10px;">
                            <button class="btn btn-outline" onclick="cancelMyChallenge('${match.id}')" style="flex: 1; border-color: #6b7280; color: #6b7280;">
                                <i class="fa-solid fa-times"></i> CANCEL
                            </button>
                        </div>
                    </div>
                    
                    <!-- Hidden Room Code Input Screen -->
                    <div id="ludo-roomcode-screen-${match.id}" style="display: none; padding: 15px;">
                        <div style="text-align: center; color: ${statusColor}; margin-bottom: 15px;">
                            <i class="fa-solid ${statusIcon}"></i> Match Paired with <strong>${opponentName}</strong>
                        </div>
                        <div style="margin-bottom: 15px; background: var(--bg-hover); padding: 15px; border-radius: 10px;">
                            <label style="display: block; margin-bottom: 8px; font-size: 0.9rem; color: var(--text-muted);">Enter Ludo King Room Code</label>
                            <input type="text" id="ludo-room-code-input" class="form-input" placeholder="e.g. 12345678" 
                                style="text-align: center; font-size: 1.2rem; letter-spacing: 2px; font-weight: 600; margin-bottom: 10px;">
                            <button class="btn btn-primary btn-block" onclick="shareRoomCode('${match.id}')">
                                <i class="fa-solid fa-share"></i> Share Room Code
                            </button>
                        </div>
                        <button class="btn btn-outline btn-block" onclick="hideRoomCodeInputScreen('${match.id}')" style="margin-top: 10px;">
                            <i class="fa-solid fa-arrow-left"></i> Back to Details
                        </button>
                    </div>
                `;
            } else {
                // Acceptor sees match details with rules - waits for room code
                const creatorName = match.creator?.ludoKingUsername || match.creator?.username || 'creator';
                statusHtml = `
                    <div style="padding: 10px;">
                        <!-- Header with Players -->
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; background: linear-gradient(135deg, #dc2626, #b91c1c); padding: 12px; border-radius: 10px;">
                            <div style="text-align: center; flex: 1;">
                                <div style="font-weight: 700; color: white;">${creatorName}</div>
                                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.8);">Challenged</div>
                                <div style="font-weight: 700; color: #fbbf24;">₹${match.amount}</div>
                            </div>
                            <div style="color: white; font-weight: 700; padding: 0 15px;">VS</div>
                            <div style="text-align: center; flex: 1;">
                                <div style="font-weight: 700; color: white;">${match.acceptor?.ludoKingUsername || 'You'}</div>
                                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.8);">Winning</div>
                                <div style="font-weight: 700; color: #4ade80;">₹${(match.amount * 2 * (1 - LUDO_COMMISSION_PERCENT / 100)).toFixed(0)}</div>
                            </div>
                        </div>
                        
                        <!-- Waiting for Room Code Status -->
                        <div style="background: linear-gradient(135deg, #6366f1, #4f46e5); padding: 15px; border-radius: 10px; margin-bottom: 15px; text-align: center;">
                            <i class="fa-solid fa-spinner fa-spin" style="color: white; font-size: 1.2rem;"></i>
                            <div style="color: white; font-weight: 600; margin-top: 8px;">Waiting for ${creatorName} to share Room Code...</div>
                            <div style="color: rgba(255,255,255,0.7); font-size: 0.8rem; margin-top: 5px;">You will be notified once room code is available</div>
                        </div>
                        
                        <!-- Rules Section -->
                        <div style="background: #fff5f5; border: 1px solid #fecaca; border-radius: 10px; padding: 12px; margin-bottom: 10px;">
                            <div style="font-weight: 700; color: #dc2626; margin-bottom: 10px; text-align: center;">📋 RULES & GUIDELINES</div>
                            <ol style="padding-left: 18px; margin: 0; font-size: 0.75rem; color: #374151; line-height: 1.7;">
                                <li>Victory? Take a screenshot of the win screen in Ludo King, tap Won, and upload your proof.</li>
                                <li>Defeat? Simply tap Lost to confirm. <strong style="color: #dc2626;">Not reporting = ₹25 penalty from wallet.</strong></li>
                                <li>Result submission deadline: 2 hours from when Room Code was shared.</li>
                                <li>Opponent not responding? Your prize will be credited within 2-4 hours after you upload proof.</li>
                                <li>Always record your gameplay for safety and dispute resolution.</li>
                                <li>Questions? JeetoPlay support is here to help.</li>
                                <li>You need the Ludo King app installed to play.</li>
                                <li>Challenger has 15 mins to share room code. <strong style="color: #dc2626;">Delay = ₹25 penalty + auto-cancellation with full refund to you.</strong></li>
                                <li>Quick Mode and 5-6 player modes are prohibited on JeetoPlay.</li>
                                <li>Ensure both players agree on and play the same game mode.</li>
                            </ol>
                        </div>
                        
                        <!-- Cancel Button for Acceptor (PAIRED state - game not started) -->
                        <div style="margin-top: 10px;">
                            <button class="btn btn-outline btn-block" onclick="cancelMyChallenge('${match.id}')" style="border-color: #6b7280; color: #6b7280;">
                                <i class="fa-solid fa-times"></i> Cancel Match
                            </button>
                        </div>
                    </div>
                `;
            }
            break;

        case 'ROOM_SHARED':
        case 'IN_PROGRESS':
            statusColor = '#10b981';
            statusIcon = 'fa-gamepad';
            const myResult = isCreator ? match.result?.creator : match.result?.acceptor;
            const opponentResult = isCreator ? match.result?.acceptor : match.result?.creator;
            const hasSubmitted = !!myResult;
            const opponentDisputed = opponentResult?.type === 'DISPUTE';
            const opponentClaimedWon = opponentResult?.type === 'WON';

            // Get result type for display
            const resultTypeDisplay = hasSubmitted ? (myResult?.type || myResult) : null;

            // Build opponent dispute banner
            let opponentDisputeBanner = '';
            if (!hasSubmitted && opponentDisputed) {
                opponentDisputeBanner = `
                    <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 10px; padding: 12px; margin-bottom: 15px; text-align: center;">
                        <div style="font-size: 1.1rem; margin-bottom: 5px;">⚠️</div>
                        <div style="font-weight: 700; color: #92400e; margin-bottom: 5px;">Opponent Raised a Dispute</div>
                        <div style="font-size: 0.85rem; color: #78350f;">
                            Your opponent has disputed this match. Please submit YOUR result below within 2 hours.
                        </div>
                    </div>
                `;
            } else if (!hasSubmitted && opponentClaimedWon) {
                opponentDisputeBanner = `
                    <div style="background: linear-gradient(135deg, #dbeafe, #bfdbfe); border: 2px solid #3b82f6; border-radius: 10px; padding: 12px; margin-bottom: 15px; text-align: center;">
                        <div style="font-size: 1.1rem; margin-bottom: 5px;">🏆</div>
                        <div style="font-weight: 700; color: #1e40af; margin-bottom: 5px;">Opponent Claims Victory</div>
                        <div style="font-size: 0.85rem; color: #1e3a5f;">
                            Your opponent says they won. Submit YOUR result below within 2 hours.
                        </div>
                    </div>
                `;
            }

            // Check for cancel request state
            const cancelReq = match.cancelRequest;
            const hasCancelRequest = !!cancelReq;
            const iSentCancelRequest = cancelReq?.requestedBy === state.user?.uid;
            const opponentSentCancelRequest = hasCancelRequest && !iSentCancelRequest;

            // Build cancel UI section
            let cancelHtml = '';
            if (opponentSentCancelRequest) {
                // Opponent sent cancel request - show accept/reject
                cancelHtml = `
                    <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 12px; padding: 15px; margin-top: 15px; text-align: center;">
                        <div style="font-size: 1.2rem; margin-bottom: 8px;">🤝</div>
                        <div style="font-weight: 700; color: #92400e; margin-bottom: 5px;">Cancel Request from Opponent</div>
                        <div style="font-size: 0.85rem; color: #78350f; margin-bottom: 12px;">
                            Your opponent wants to mutually cancel this match. Both players will be fully refunded.
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-block" onclick="acceptMutualCancel('${match.id}')" style="padding: 12px; background: #10b981; color: white; flex: 1;">
                                <i class="fa-solid fa-check"></i> Accept & Refund
                            </button>
                            <button class="btn btn-block" onclick="rejectMutualCancel('${match.id}')" style="padding: 12px; background: #ef4444; color: white; flex: 1;">
                                <i class="fa-solid fa-times"></i> Reject
                            </button>
                        </div>
                    </div>
                `;
            } else if (iSentCancelRequest) {
                // We sent cancel request - show waiting status
                cancelHtml = `
                    <div style="background: var(--bg-hover); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-top: 15px; text-align: center;">
                        <i class="fa-solid fa-hourglass-half" style="color: #f59e0b;"></i>
                        <span style="font-size: 0.9rem; color: var(--text-muted); margin-left: 5px;">Cancel request sent. Waiting for opponent...</span>
                    </div>
                `;
            } else if (!hasSubmitted) {
                // No cancel request yet - show request button
                cancelHtml = `
                    <button class="btn btn-outline btn-block" onclick="cancelMyChallenge('${match.id}')" style="padding: 10px; margin-top: 10px; font-size: 0.85rem; color: var(--text-muted);">
                        <i class="fa-solid fa-handshake-slash"></i> Request Mutual Cancel
                    </button>
                `;
            }

            statusHtml = `
                <div style="text-align: center; padding: 15px;">
                    <div style="color: ${statusColor}; margin-bottom: 15px;">
                        <i class="fa-solid ${statusIcon}"></i> Playing vs <strong>${opponentName}</strong>
                    </div>
                    
                    <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px; border-radius: 12px; margin-bottom: 15px;">
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 5px;">Room Code</div>
                        <div style="font-size: 1.8rem; font-weight: 700; letter-spacing: 3px; color: var(--primary); font-family: monospace;">
                            ${match.roomCode || 'N/A'}
                        </div>
                        <button onclick="copyToClipboard('${match.roomCode}')" class="btn btn-sm" style="margin-top: 10px; background: var(--bg-hover);">
                            <i class="fa-solid fa-copy"></i> Copy Code
                        </button>
                    </div>
                    
                    ${opponentDisputeBanner}
                    ${hasSubmitted ? `
                        <div style="color: var(--text-muted); padding: 15px; background: var(--bg-hover); border-radius: 10px;">
                            <i class="fa-solid fa-check-circle" style="color: var(--success);"></i>
                            Result submitted: <strong>${resultTypeDisplay}</strong>
                            <div style="font-size: 0.85rem; margin-top: 5px;">Waiting for opponent (2hr limit)...</div>
                        </div>
                    ` : `
                        <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 15px;">
                            Play the match in Ludo King and submit your result
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button class="btn btn-danger btn-block" onclick="submitLost('${match.id}')" style="padding: 15px;">
                                <i class="fa-solid fa-thumbs-down"></i> I Lost
                            </button>
                            <button class="btn btn-success btn-block" onclick="showResultModal('${match.id}', 'WON')" style="padding: 15px;">
                                <i class="fa-solid fa-trophy"></i> I Won (Upload Proof)
                            </button>
                            <button class="btn btn-warning btn-block" onclick="showResultModal('${match.id}', 'DISPUTE')" style="padding: 15px; background: #f59e0b;">
                                <i class="fa-solid fa-exclamation-triangle"></i> Raise Dispute
                            </button>
                        </div>
                    `}
                    ${cancelHtml}
                </div>
            `;
            break;

        case 'DISPUTED':
            statusColor = '#ef4444';
            statusIcon = 'fa-exclamation-triangle';
            statusHtml = `
                <div style="text-align: center; padding: 20px;">
                    <div style="color: ${statusColor}; margin-bottom: 15px;">
                        <i class="fa-solid ${statusIcon}" style="font-size: 2rem;"></i>
                    </div>
                    <div style="font-weight: 600; margin-bottom: 10px;">Match Disputed</div>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">
                        Results conflict. Admin will review and resolve this dispute.
                    </div>
                    <div style="margin-top: 15px; padding: 10px; background: var(--bg-hover); border-radius: 8px; font-size: 0.85rem;">
                        <i class="fa-solid fa-clock"></i> Please wait for resolution
                    </div>
                </div>
            `;
            break;

        case 'COMPLETED':
            const isWinner = match.winner === state.user?.uid;
            statusColor = isWinner ? '#10b981' : '#6b7280';
            statusIcon = isWinner ? 'fa-trophy' : 'fa-flag-checkered';
            statusHtml = `
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 2rem; margin-bottom: 10px;">
                        ${isWinner ? '🎉' : '😔'}
                    </div>
                    <div style="font-weight: 600; color: ${statusColor};">
                        ${isWinner ? `You Won ₹${(match.winAmount || 0).toFixed(2)}!` : 'Better luck next time!'}
                    </div>
                </div>
            `;
            break;

        case 'CANCELLED':
            statusColor = '#6b7280';
            statusIcon = 'fa-ban';
            statusHtml = `
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 2rem; margin-bottom: 10px;">❌</div>
                    <div style="font-weight: 600; color: ${statusColor};">Match Cancelled</div>
                    <div style="color: var(--text-muted); font-size: 0.9rem; margin-top: 8px;">
                        Your entry fee has been refunded to your wallet.
                    </div>
                </div>
            `;
            break;

        case 'CANCELLING':
            statusColor = '#f59e0b';
            statusIcon = 'fa-spinner fa-spin';
            statusHtml = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: ${statusColor};"></i>
                    <div style="font-weight: 600; color: ${statusColor}; margin-top: 10px;">Cancelling...</div>
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 5px;">Processing refund...</div>
                </div>
            `;
            break;

        default:
            statusHtml = `<div style="padding: 15px; text-align: center;">Unknown status: ${match.status}</div>`;
    }

    div.innerHTML = `
        <div style="background: var(--bg-card); border: 2px solid ${statusColor}; border-radius: 16px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, ${statusColor}22, ${statusColor}11); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; color: ${statusColor};">
                    <i class="fa-solid fa-dice"></i> Match #${match.matchId || match.id.slice(-8)}
                </span>
                <span style="font-weight: 700; font-size: 1.1rem;">₹${match.amount}</span>
            </div>
            ${statusHtml}
        </div>
    `;
}

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
    document.getElementById('profile-balance').innerText = '₹' + totalBal;

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
                    ${txn.type === 'CREDIT' ? '+' : '-'}₹${txn.amount}
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

