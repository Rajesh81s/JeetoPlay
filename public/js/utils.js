// JeetoPlay — UI Utilities
// Auto-extracted from app.html

// ─── Coin Economy Formatter (1 Coin = ₹1) ───
// Returns HTML string with inline coin icon + amount
function formatCoin(amount, opts = {}) {
    const val = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
    const display = opts.short ? coinAbbrev(val) : val.toLocaleString('en-IN');
    const sign = opts.sign === '+' ? '+' : opts.sign === '-' ? '-' : '';
    const icon = '<img src="/assets/coin.svg" class="coin-icon" alt="coin">';
    return `${sign}${icon}<span class="coin-amount">${display}</span>`;
}

// Plain text version — for toasts, inputs, and non-HTML contexts
function formatCoinText(amount, opts = {}) {
    const val = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
    const display = opts.short ? coinAbbrev(val) : val.toLocaleString('en-IN');
    const sign = opts.sign === '+' ? '+' : opts.sign === '-' ? '-' : '';
    return `${sign}🪙 ${display}`;
}

// Abbreviate large numbers
function coinAbbrev(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr';
    if (n >= 100000) return (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
}

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
    setLoading('header-balance', '🪙 ...');
    setLoading('profile-fullname', 'Loading...');
    setLoading('profile-balance', '🪙 ...');

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

        // Helper to safely set element HTML (for coin icon support)
        const setElHTML = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = val;
        };
        // Helper for plain text fields
        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        // Header balance (total) — with coin icon
        setElHTML('header-balance', formatCoin(totalBal));

        // Update profile fields (with null checks)
        setEl('profile-fullname', state.userData.fullName || 'User');
        setEl('profile-email', state.userData.email || '');
        setEl('profile-mobile', state.userData.mobile || '-');
        setEl('profile-avatar', (state.userData.fullName || 'U').charAt(0).toUpperCase());
        setElHTML('profile-balance', formatCoin(totalBal));

        // Update VIP badge in profile
        const vipBadgeEl = document.getElementById('profile-vip-badge');
        if (vipBadgeEl) {
            vipBadgeEl.innerHTML = (typeof isCurrentUserVip === 'function' && isCurrentUserVip()) ? getVipBadgeHtml() : '';
        }

        // Update wallet view — with coin icon
        setElHTML('wallet-deposit-bal', formatCoin(depositBal));
        setElHTML('wallet-winning-bal', formatCoin(winningBal));
        setElHTML('wallet-total-bal', formatCoin(totalBal));
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

// ─── External URL Handler ───
// Opens URLs in external apps/browsers instead of inside the WebView.
// IMPORTANT: Do NOT use this for payment gateway URLs — those must stay in-app.
// This is specifically for slider links, contact links (WhatsApp, Insta, YT, Telegram), etc.
window.openExternalUrl = function (url) {
    if (!url) return;

    // Ensure URL has a protocol
    let fullUrl = url;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://') && !fullUrl.startsWith('mailto:')) {
        fullUrl = 'https://' + fullUrl;
    }

    // Detect if running inside Android WebView — use native bridge to open externally
    const isAndroidWebView = typeof AndroidNative !== 'undefined' && AndroidNative.isNativeApp && AndroidNative.isNativeApp();

    if (isAndroidWebView && typeof AndroidNative.openExternal === 'function') {
        // Native bridge opens URL in external app (WhatsApp, Instagram, YouTube, Chrome, etc.)
        AndroidNative.openExternal(fullUrl);
    } else {
        // Regular browser — open in new tab as normal
        window.open(fullUrl, '_blank');
    }
};

