// JeetoPlay — Profile
// Auto-extracted from app.html

window.viewProfileDetails = function () {
    const userData = state.userData || {};
    const user = state.user || {};

    // Populate read-only fields
    document.getElementById('pd-fullname').textContent = userData.fullName || userData.name || userData.username || 'Not set';
    document.getElementById('pd-email').textContent = user.email || userData.email || 'Not set';
    document.getElementById('pd-mobile').textContent = userData.phone || userData.mobile || 'Not set';
    document.getElementById('pd-uid').textContent = user.uid || '—';

    // Format join date
    const joinDate = userData.createdAt || userData.joinedAt;
    if (joinDate) {
        document.getElementById('pd-joined').textContent = new Date(joinDate).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
    } else {
        document.getElementById('pd-joined').textContent = '—';
    }

    document.getElementById('profile-details-modal').classList.remove('hidden');
};

window.openNotificationSettings = function () {
    document.getElementById('notifications-modal').classList.remove('hidden');
    loadNotifications();
};

window.loadNotifications = function () {
    const list = document.getElementById('notifications-list');
    const countLabel = document.getElementById('notif-count-label');
    list.innerHTML = '<div class="text-center py-4" style="color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

    db.ref('user_notifications/' + state.user.uid).orderByChild('timestamp').limitToLast(50).once('value', snap => {
        list.innerHTML = '';
        if (!snap.exists()) {
            list.innerHTML = '<div style="text-align:center;padding:40px 20px;"><i class="fa-regular fa-bell-slash" style="font-size:2.5rem;color:rgba(255,255,255,0.15);margin-bottom:12px;display:block;"></i><div style="color:var(--text-muted);font-size:0.9rem;">No notifications yet</div><div style="color:rgba(255,255,255,0.3);font-size:0.8rem;margin-top:4px;">Your notifications will appear here</div></div>';
            if (countLabel) countLabel.textContent = '0 notifications';
            return;
        }

        const notifs = [];
        snap.forEach(child => { notifs.push({ key: child.key, ...child.val() }); });
        notifs.reverse(); // newest first

        if (countLabel) countLabel.textContent = `${notifs.length} notification${notifs.length !== 1 ? 's' : ''}`;

        notifs.forEach(n => {
            const type = n.type || '';
            let icon = 'fa-bell', color = '#00ff88';
            if (type.includes('LUDO')) { icon = 'fa-dice'; color = '#ff9f43'; }
            else if (type.includes('ESPORTS') || type.includes('MATCH')) { icon = 'fa-gamepad'; color = '#4dd0e1'; }
            else if (type.includes('WON') || type.includes('REWARD') || type.includes('REFERRAL')) { icon = 'fa-trophy'; color = '#ffd700'; }
            else if (type.includes('CANCEL') || type.includes('REJECT')) { icon = 'fa-circle-xmark'; color = '#ff6b6b'; }
            else if (type.includes('DISPUTE') || type.includes('ESCALAT')) { icon = 'fa-triangle-exclamation'; color = '#ff9f43'; }
            else if (type.includes('WITHDRAW') || type.includes('PAYMENT')) { icon = 'fa-wallet'; color = '#a78bfa'; }
            else if (type.includes('BROADCAST') || n.sender === 'admin') { icon = 'fa-bullhorn'; color = '#00ff88'; }

            // Relative time
            let timeStr = '';
            if (n.timestamp) {
                const diff = Date.now() - n.timestamp;
                if (diff < 60000) timeStr = 'Just now';
                else if (diff < 3600000) timeStr = Math.floor(diff / 60000) + 'm ago';
                else if (diff < 86400000) timeStr = Math.floor(diff / 3600000) + 'h ago';
                else timeStr = Math.floor(diff / 86400000) + 'd ago';
            } else if (n.sentAt) {
                timeStr = new Date(n.sentAt).toLocaleString();
            }

            const el = document.createElement('div');
            el.style.cssText = 'display:flex;gap:12px;padding:14px;margin-bottom:8px;background:rgba(255,255,255,0.04);border-radius:14px;border:1px solid rgba(255,255,255,0.06);transition:background 0.2s;';
            el.onmouseenter = () => { el.style.background = 'rgba(255,255,255,0.08)'; };
            el.onmouseleave = () => { el.style.background = 'rgba(255,255,255,0.04)'; };
            el.innerHTML = `
                <div style="width:38px;height:38px;border-radius:10px;background:${color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fa-solid ${icon}" style="color:${color};font-size:0.9rem;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="font-weight:600;font-size:0.88rem;color:#fff;line-height:1.3;">${n.title || 'Notification'}</div>
                        <div style="font-size:0.7rem;color:rgba(255,255,255,0.35);white-space:nowrap;flex-shrink:0;">${timeStr}</div>
                    </div>
                    <div style="font-size:0.82rem;color:rgba(255,255,255,0.55);margin-top:3px;line-height:1.35;">${n.body || ''}</div>
                </div>
            `;
            list.appendChild(el);
        });
    });
};

window.clearAllNotifications = async function () {
    if (!state.user) return;
    if (!confirm('Clear all notifications?')) return;
    try {
        await db.ref('user_notifications/' + state.user.uid).remove();
        loadNotifications();
        showToast('Notifications cleared', 'success');
    } catch (e) {
        showToast('Failed to clear', 'error');
    }
};

window.shareApp = function () {
    const shareText = 'Join JeetoPlay - Play games and earn money! Download now: ' + window.location.origin;
    if (navigator.share) {
        navigator.share({
            title: 'JeetoPlay - Play & Earn',
            text: shareText,
            url: window.location.origin
        }).catch(() => { });
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            showToast('Link copied to clipboard!', 'success');
        }).catch(() => {
            showToast('Could not copy link', 'error');
        });
    }
};

window.openTerms = function () {
    window.open('https://jeetoplay.in/terms.html', '_blank');
};

window.openPrivacy = function () {
    window.open('https://jeetoplay.in/privacy.html', '_blank');
};

// Switch between eSports and Ludo on homepage

// ==================== AVATAR UPLOAD ====================

/**
 * Compress image client-side using Canvas
 * Returns a Blob (JPEG, max 200×200, 70% quality)
 */
function compressAvatar(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 200;
                let w = img.width, h = img.height;
                if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                else { w = Math.round(w * MAX / h); h = MAX; }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('Compression failed'));
                }, 'image/jpeg', 0.7);
            };
            img.onerror = () => reject(new Error('Invalid image'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Upload avatar: compress → Firebase Storage → save URL to user profile
 */
window.uploadAvatar = async function(input) {
    const file = input.files?.[0];
    if (!file) return;

    if (!state.user?.uid) {
        showToast('Please log in first', 'error');
        return;
    }

    if (!file.type.startsWith('image/')) {
        showToast('Please select an image', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showToast('Image too large (max 10MB)', 'error');
        return;
    }

    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarSpan = document.getElementById('profile-avatar');

    // Show loading state
    if (avatarSpan) avatarSpan.textContent = '⏳';

    try {
        // Compress
        const compressed = await compressAvatar(file);

        // Check storage SDK is loaded
        if (!fbStorage) {
            throw new Error('Storage not ready. Please try again in a moment.');
        }

        // Upload to Firebase Storage
        const storageRef = fbStorage.ref(`avatars/${state.user.uid}.jpg`);
        const snapshot = await storageRef.put(compressed, {
            contentType: 'image/jpeg',
            cacheControl: 'public, max-age=86400'
        });

        // Get download URL
        const downloadURL = await snapshot.ref.getDownloadURL();

        // Save to database
        await db.ref(`users/${state.user.uid}/photoURL`).set(downloadURL);

        // Update UI immediately
        if (avatarImg) {
            avatarImg.src = downloadURL;
            avatarImg.style.display = 'block';
        }
        if (avatarSpan) avatarSpan.style.display = 'none';

        // Cache in state
        if (state.userData) state.userData.photoURL = downloadURL;

        showToast('Profile photo updated! 📸', 'success');
    } catch (err) {
        console.error('Avatar upload failed:', err);
        // Restore initial
        if (avatarSpan) {
            avatarSpan.textContent = (state.userData?.fullName || 'U').charAt(0).toUpperCase();
            avatarSpan.style.display = '';
        }
        showToast('Upload failed: ' + (err.message || 'Try again'), 'error');
    }

    // Reset input so same file can be re-selected
    input.value = '';
};

/**
 * Load and display avatar from user data
 * Called from updateUIHeader and on auth state change
 */
window.loadProfileAvatar = function(photoURL) {
    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarSpan = document.getElementById('profile-avatar');
    if (!avatarImg || !avatarSpan) return;

    if (photoURL) {
        avatarImg.src = photoURL;
        avatarImg.style.display = 'block';
        avatarSpan.style.display = 'none';
        avatarImg.onerror = () => {
            // Fallback to initial on broken URL
            avatarImg.style.display = 'none';
            avatarSpan.style.display = '';
        };
    } else {
        avatarImg.style.display = 'none';
        avatarSpan.style.display = '';
    }
};

/**
 * Helper: generate avatar HTML for leaderboard/lists
 * Returns <img> if photoURL exists, fallback initial div otherwise
 */
window.getAvatarHtml = function(name, photoURL, size, extraStyle) {
    const initial = (name || 'P').charAt(0).toUpperCase();
    const sz = size || 36;
    const style = extraStyle || '';

    if (photoURL) {
        return `<img src="${photoURL}" alt="${initial}" 
            style="width:${sz}px; height:${sz}px; border-radius:50%; object-fit:cover; ${style}" 
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div style="width:${sz}px; height:${sz}px; border-radius:50%; display:none; align-items:center; justify-content:center; font-weight:700; font-size:${sz * 0.4}px; color:#fff; background:linear-gradient(135deg,#1e293b,#334155); ${style}">${initial}</div>`;
    }
    return `<div style="width:${sz}px; height:${sz}px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:${sz * 0.4}px; color:#fff; background:linear-gradient(135deg,#1e293b,#334155); ${style}">${initial}</div>`;
};
