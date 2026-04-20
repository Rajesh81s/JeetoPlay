// Firebase Messaging Service Worker
// This handles background push notifications

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
    apiKey: "AIzaSyDnfA0q0BpkppZDGXHuRBSx8UNEJxddu6s",
    authDomain: "jeetoplay-325f1.firebaseapp.com",
    databaseURL: "https://jeetoplay-325f1-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "jeetoplay-325f1",
    storageBucket: "jeetoplay-325f1.firebasestorage.app",
    messagingSenderId: "450077839860",
    appId: "1:450077839860:web:57b342941db036bf7da9a1"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message received:', payload);

    const notificationTitle = payload.notification?.title || 'JeetoPlay';
    const notificationOptions = {
        body: payload.notification?.body || 'You have a new notification',
        icon: '/assets/images/icon-192.png',
        badge: '/assets/images/badge-72.png',
        tag: payload.data?.type || 'general',
        data: payload.data,
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open', title: 'Open App' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    // Add image if present
    if (payload.notification?.image) {
        notificationOptions.image = payload.notification.image;
    }

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event);

    event.notification.close();

    if (event.action === 'dismiss') {
        return;
    }

    // Open or focus the app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // If app is already open, focus it
                for (const client of clientList) {
                    if (client.url.includes('jeetoplay') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Otherwise open new window
                if (clients.openWindow) {
                    return clients.openWindow('/app.html');
                }
            })
    );
});

// Service worker install event
self.addEventListener('install', (event) => {
    console.log('[SW] Service Worker installed');
    self.skipWaiting();
});

// Service worker activate event
self.addEventListener('activate', (event) => {
    console.log('[SW] Service Worker activated');
    event.waitUntil(clients.claim());
});
