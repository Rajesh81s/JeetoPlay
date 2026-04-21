# JeetoPlay APK Placeholder

This folder is for the downloadable APK file.

## Setup Instructions

1. Build your APK using Android Studio or a WebView wrapper tool
2. Name the APK file: `JeetoPlay.apk`
3. Place it in this folder

### Recommended WebView Wrapper Tools

For converting the web app to APK:

1. **Capacitor** (Recommended)
   ```bash
   npm install @capacitor/core @capacitor/cli
   npx cap init JeetoPlay com.jeetoplay.app
   npx cap add android
   npx cap sync
   ```

2. **WebView-based APK generators**
   - [Website 2 APK Builder](https://nicegrapheme.com/website2apk.html)
   - [Gonative.io](https://gonative.io/)

### APK Configuration

When building your APK:
- Package name: `com.jeetoplay.app`
- Target URL: `https://jeetoplay.in/app.html`
- Min SDK: Android 6.0 (API 23)
- Enable camera/microphone if needed for future features

### After Building

Place the generated APK here as:
```
assets/downloads/JeetoPlay.apk
```

The download button on the landing page will automatically link to this file.
