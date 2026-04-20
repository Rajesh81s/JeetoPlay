# JeetoPlay Deployment Guide

## Architecture: Firebase-Only

Everything is hosted on Firebase (Blaze plan, pay-as-you-go with free tier).

```
JeetoPlay/
├── public/                     # Firebase Hosting root
│   ├── index.html              # Landing page (jeetoplay.in)
│   ├── app.html                # User app (WebView target)
│   ├── admin_panel.html        # Admin dashboard
│   ├── payment-callback.html   # Payment gateway callback
│   ├── firebase-messaging-sw.js # FCM service worker
│   └── assets/
│       ├── images/
│       └── downloads/
│           └── JeetoPlay.apk
│
├── functions/                  # Cloud Functions (Node.js 18)
│   ├── index.js                # All cloud functions
│   └── package.json
│
├── database.rules.json         # Realtime Database security rules
└── firebase.json               # Firebase project config
```

## URLs

| URL | Purpose |
|-----|---------|
| `https://jeetoplay.in/` | Landing page |
| `https://jeetoplay.in/app.html` | User app (WebView target) |
| `https://jeetoplay.in/admin_panel.html` | Admin panel |
| `https://jeetoplay.in/assets/downloads/JeetoPlay.apk` | APK download |

## Deployment Commands

```bash
# First time setup
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..

# Deploy everything
firebase deploy

# Deploy only specific parts
firebase deploy --only hosting          # HTML, CSS, JS, assets
firebase deploy --only functions        # Cloud Functions
firebase deploy --only database         # Security rules
firebase deploy --only hosting,database # Hosting + rules
```

## Initial Setup Checklist

- [ ] Enable Blaze plan on Firebase Console (pay-as-you-go, still has free tier)
- [ ] Set billing alert at ₹100/month in Google Cloud Console → Budgets & Alerts
- [ ] Deploy Cloud Functions: `firebase deploy --only functions`
- [ ] Buy domain `jeetoplay.in` from any registrar
- [ ] Connect domain: Firebase Console → Hosting → Add custom domain
- [ ] Add DNS records (TXT + A) as instructed by Firebase
- [ ] Wait for SSL provisioning (automatic, may take 24h)
- [ ] Update Android WebView URL to `https://jeetoplay.in/app.html`
- [ ] Build signed APK and place in `public/assets/downloads/`
- [ ] Deploy: `firebase deploy`

## Environment Config

```bash
# Payment gateway webhook secret
firebase functions:config:set upi.webhook_secret="YOUR_SECRET"
```

## Cost Estimate

| Service | Free Tier | Expected Cost |
|---------|-----------|---------------|
| Hosting | 10 GB storage, 10 GB/mo transfer | ₹0 |
| Cloud Functions | 2M calls, 400K GB-sec | ₹0-50/mo |
| Realtime Database | 1 GB stored, 10 GB/mo transfer | ₹0 |
| Auth | 10K users/month | ₹0 |
| Domain | — | ~₹60/mo (₹700/yr) |
| **Total** | | **~₹60-110/mo** |

## Security Notes

- `X-Frame-Options: SAMEORIGIN` prevents clickjacking
- `X-Content-Type-Options: nosniff` prevents MIME sniffing
- Images cached for 7 days, assets for 1 day
- Admin panel protected by Firebase Auth + custom tokens
- Database rules enforce role-based access
