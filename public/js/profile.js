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
    window.open('landing.html#terms', '_blank');
};

window.openPrivacy = function () {
    window.open('landing.html#privacy', '_blank');
};

// Switch between eSports and Ludo on homepage
