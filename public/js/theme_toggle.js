// JeetoPlay — Dark / Light Theme Toggle
// Saves preference to localStorage and user profile

/**
 * Initialize theme on page load
 */
(function initTheme() {
    const saved = localStorage.getItem('jp-theme') || 'dark';
    applyTheme(saved);
})();

/**
 * Apply theme to document
 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jp-theme', theme);

    // Update toggle icon if present
    const icon = document.getElementById('theme-toggle-icon');
    if (icon) {
        icon.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
    const label = document.getElementById('theme-toggle-label');
    if (label) {
        label.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
    }
}

/**
 * Toggle between dark and light
 */
window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);

    // Save to user profile if logged in
    if (typeof state !== 'undefined' && state.user) {
        db.ref(`users/${state.user.uid}/themePreference`).set(next).catch(() => { });
    }
};

/**
 * Load theme from user profile (call after auth)
 */
window.loadThemePreference = async function () {
    if (!state.user) return;
    try {
        const snap = await db.ref(`users/${state.user.uid}/themePreference`).once('value');
        const pref = snap.val();
        if (pref && (pref === 'dark' || pref === 'light')) {
            applyTheme(pref);
        }
    } catch (e) {
        // Fallback to localStorage value
    }
};
