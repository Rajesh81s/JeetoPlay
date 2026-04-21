// JeetoPlay — App Update Check
// Checks Firebase RTDB for latest version and prompts native app users to update

const APP_CURRENT_VERSION = '1.0.2';

/**
 * Compare two semver strings (e.g. '1.0.2' vs '1.0.3')
 * Returns: -1 if a < b, 0 if equal, 1 if a > b
 */
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va < vb) return -1;
        if (va > vb) return 1;
    }
    return 0;
}

/**
 * Check for app updates on load.
 * Reads app_config/latest_version from Firebase RTDB.
 * Only shows update prompt for native Android app users — browser users
 * get updated automatically via Firebase Hosting.
 */
function checkForAppUpdate() {
    // Only check for native app users (WebView)
    const isNativeApp = typeof AndroidNative !== 'undefined' &&
        AndroidNative.isNativeApp && AndroidNative.isNativeApp();
    if (!isNativeApp) return;

    db.ref('app_config').once('value').then(snap => {
        if (!snap.exists()) return;
        const config = snap.val();
        const latestVersion = config.latest_version;
        const forceUpdate = config.force_update || false;
        const updateMessage = config.update_message || 'A new version of JeetoPlay is available with bug fixes and improvements.';
        const downloadUrl = config.download_url || '/download';

        if (!latestVersion) return;

        // Compare versions
        if (compareVersions(APP_CURRENT_VERSION, latestVersion) < 0) {
            // Current version is older — show update prompt
            showUpdateModal(latestVersion, updateMessage, downloadUrl, forceUpdate);
        }
    }).catch(err => {
        console.warn('[UPDATE] Version check failed (non-critical):', err.message);
    });
}

/**
 * Show the update modal
 */
function showUpdateModal(newVersion, message, downloadUrl, forceUpdate) {
    const modal = document.getElementById('app-update-modal');
    if (!modal) return;

    document.getElementById('update-new-version').textContent = 'v' + newVersion;
    document.getElementById('update-current-version').textContent = 'v' + APP_CURRENT_VERSION;
    document.getElementById('update-message').textContent = message;
    document.getElementById('update-download-btn').onclick = function () {
        if (typeof AndroidNative !== 'undefined' && typeof AndroidNative.openExternal === 'function') {
            AndroidNative.openExternal('https://jeetoplay.in' + downloadUrl);
        } else {
            window.open(downloadUrl, '_blank');
        }
    };

    // If force update, hide the "Later" button — user must update
    const laterBtn = document.getElementById('update-later-btn');
    if (forceUpdate && laterBtn) {
        laterBtn.style.display = 'none';
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function dismissUpdateModal() {
    const modal = document.getElementById('app-update-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

// Run check after a short delay so it doesn't block initial load
setTimeout(checkForAppUpdate, 3000);
