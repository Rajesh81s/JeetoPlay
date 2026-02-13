// JeetoPlay — UI Utilities
// Auto-extracted from app.html

function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.style.background = type === 'error' ? 'var(--danger)' : 'var(--primary)';
    el.style.color = type === 'error' ? 'white' : 'black';
    el.style.padding = '10px';
    el.style.borderRadius = '8px';
    el.style.marginBottom = '10px';
    el.style.fontWeight = '600';
    el.innerText = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

window.closeModal = function (id) {
    document.getElementById(id).classList.add('hidden');
}



function showAppShell() {
    console.log('[PERF] showAppShell() - Showing app immediately');

    // Hide splash screen with fast fade
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.style.display = 'none', 300);
    }

    // Show app layout immediately
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');

    // Set loading placeholders in header
    const setLoading = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    setLoading('header-balance', '₹...');
    setLoading('profile-fullname', 'Loading...');
    setLoading('profile-balance', '₹...');

    // Start loading content in parallel (non-blocking)
    console.log('[PERF] Starting parallel content load');
    loadHome();
    loadEsportsGames();
    loadChallenges();
}

function showAuth() {
    // Hide splash screen with fade animation
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.style.display = 'none', 500);
    }

    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('app-layout').classList.add('hidden');
}

function showApp() {
    console.log('[AUTH] showApp() called - transitioning to app');

    // Hide splash screen with fade animation
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.style.display = 'none', 500);
    }

    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');
    console.log('[AUTH] auth-view hidden, app-layout visible');
    // Initial loads
    loadHome();
    loadEsportsGames(); // Load eSports games grid
    loadChallenges(); // Ludo
    console.log('[AUTH] Initial loads complete');
}

function updateUIHeader() {
    if (state.userData) {
        // Compute total balance from dual balances
        const depositBal = state.userData.depositBalance || 0;
        const winningBal = state.userData.winningBalance || 0;
        const totalBal = depositBal + winningBal;

        // Helper to safely set element text
        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        // Header balance (total)
        setEl('header-balance', '₹' + totalBal);

        // Update profile fields (with null checks)
        setEl('profile-fullname', state.userData.fullName || 'User');
        setEl('profile-email', state.userData.email || '');
        setEl('profile-mobile', state.userData.mobile || '-');
        setEl('profile-avatar', (state.userData.fullName || 'U').charAt(0).toUpperCase());
        setEl('profile-balance', '₹' + totalBal);

        // Update wallet view
        setEl('wallet-deposit-bal', '₹' + depositBal);
        setEl('wallet-winning-bal', '₹' + winningBal);
        setEl('wallet-total-bal', '₹' + totalBal);
    }
}

// Helper function to switch between tabs from profile menu
function switchTab(tabName) {
    // Handle wallet tab separately as it needs to open the wallet view
    if (tabName === 'wallet') {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.getElementById('view-wallet').classList.remove('hidden');
        loadWalletTransactions(); // Load transactions when wallet opens
        return;
    }

    // For other tabs, simulate nav item click
    const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (navItem) {
        navItem.click();
    }
}

