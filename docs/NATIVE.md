# Nearer native apps (iOS + Android)

Nearer ships to the stores as a **Capacitor 8** shell around the deployed site.
It is a Next.js 14 app with API routes, so it cannot be a static export: the
native WebView loads `server.url` (the production origin) and Capacitor's bridge
gives that page native plugins. `webDir` is `public/` only so that
`public/offline.html` can be shown when the network is down.

| Piece | Where |
|---|---|
| Config | `capacitor.config.ts` |
| Android project | `android/` (Gradle, AGP 8, compile/target SDK 36, min SDK 24) |
| iOS project | `ios/` (Xcode, Swift Package Manager, iOS 15+; no CocoaPods) |
| Web-side helpers | `lib/native.ts` (no-ops on the web) |
| Offline page | `public/offline.html` |
| Icon + splash sources | `native/assets/` (made from `public/icons/icon-1024.png`) |
| App Links / Universal Links files | `native/well-known/` |

Versions (pinned exactly): `@capacitor/core`, `cli`, `android`, `ios` 8.6.0;
`app` 8.1.2, `browser` 8.0.5, `haptics` 8.0.2, `splash-screen` 8.0.2,
`status-bar` 8.0.4, `push-notifications` 8.1.3, `share` 8.0.3.

## The one setting that matters: `CAP_SERVER_URL`

Every native build reads the origin from the environment:

```sh
CAP_SERVER_URL=https://<production-origin> npm run cap:sync
```

It sets `server.url`, `allowNavigation`, and (on Android) the App Links host in
the manifest (`android/app/build.gradle` → `manifestPlaceholders.appLinkHost`, so
also export it when running Gradle). Production is `https://nearer.site`. Without CAP_SERVER_URL, `cap sync`
stops with an error. On iOS the Universal Links host is in
`ios/App/App/App.entitlements` (`applinks:<host>`); edit it to match.

Navigation allowed inside the WebView: the origin, `accounts.google.com`,
`*.supabase.co`. Cleartext HTTP is off.

## Scripts

| Script | Does |
|---|---|
| `npm run cap:sync` | copies `public/` + config into both projects, updates plugins |
| `npm run cap:android` | opens `android/` in Android Studio |
| `npm run cap:ios` | opens `ios/App` in Xcode (Mac only) |
| `npm run android:apk` | `./gradlew assembleDebug` in `android/` → `android/app/build/outputs/apk/debug/app-debug.apk` |

Icons and splash were generated with `npx @capacitor/assets@4.0.0 generate --assetPath native/assets --iconBackgroundColor '#2f5684' --splashBackgroundColor '#2f5684' --android --ios`. Re-run it if the icon changes.

## Build and run

### Android (any OS)

1. Install Android Studio (it brings the SDK, platform 36 and build tools), JDK 21.
2. `npm ci`
3. `CAP_SERVER_URL=https://<origin> npm run cap:sync`
4. `npm run cap:android`, pick a device or emulator, press **Run**.
   Or from the command line: `export CAP_SERVER_URL=https://<origin> ANDROID_HOME=~/Android/Sdk && npm run android:apk`, then `adb install android/app/build/outputs/apk/debug/app-debug.apk`.
5. Push needs `android/app/google-services.json` from a Firebase project with the
   Android app `site.nearer.app` (ignored by git; Gradle applies the plugin only
   when the file exists).

### iOS (Mac with Xcode 16+)

1. `npm ci && CAP_SERVER_URL=https://<origin> npm run cap:sync && npm run cap:ios`
2. In Xcode → target **App** → Signing & Capabilities: choose the team. The
   entitlements already ask for **Push Notifications** and **Associated Domains**;
   make sure both capabilities show up for the App ID in the developer portal.
3. Run on a device (push does not work in the simulator).
4. **TestFlight:** set the version/build, Product → Archive, Distribute App →
   App Store Connect → Upload. In App Store Connect, add internal testers under
   TestFlight; external testers need a short Beta App Review.
5. Push: create an APNs key (.p8) in the developer portal and upload it to
   Firebase (if FCM sends to iOS too) or keep it for direct APNs sends.

A debug APK was built on Linux with only the command-line SDK (`platforms;android-36`,
`platform-tools`; Gradle fetched build-tools itself) and JDK 21. If Maven Central
returns HTTP 429 on the first build, re-run with `./gradlew assembleDebug --max-workers=1`.

Generated on Linux: the iOS project was created with `npx cap add ios` and has not
been built here. Capacitor 8 uses Swift Package Manager, so there is no
`pod install` step; Xcode resolves `ios/App/CapApp-SPM` on first open.

## Sign-in deep links

Google blocks OAuth inside embedded WebViews, so in the app sign-in must open in
the system browser and come back:

- **Custom scheme** `site.nearer.app://auth/callback` (Android intent filter,
  iOS `CFBundleURLTypes`). Used for Google OAuth.
- **App Links / Universal Links** for `https://<origin>/auth/callback`. Used for
  email magic links. Verification needs, on the origin:
  - `/.well-known/assetlinks.json` (template in `native/well-known/`; put in the
    SHA-256 of the signing certificate: `keytool -list -v -keystore <ks>`; Play
    App Signing shows the release one).
  - `/.well-known/apple-app-site-association` (template; put in the Team ID; served
    as `application/json`, no redirect, no extension).
- Add `site.nearer.app://auth/callback` to Supabase → Auth → URL configuration →
  Redirect URLs.

Flow: the web code calls `signInWithOAuth({ options: { redirectTo: authRedirectUrl("oauth"), skipBrowserRedirect: true } })`,
then `openExternal(data.url)`. The browser returns to the custom scheme, the App
plugin fires `appUrlOpen`, `onAppUrlOpen` closes the in-app browser and routes to
`/auth/callback?code=...`, which exchanges the code in the WebView (where the PKCE
verifier lives).

## What's native now

- **Splash**: `#2f5684` with the window icon; hides after ~1.2 s.
- **Status bar**: overlays the WebView, dark text on the paper background
  (`setStatusBar()`; pass `{ dark: true }` on dark screens).
- **Haptics**: `haptic("light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error")`.
- **Deep links**: sign-in callbacks (above), routed by `onAppUrlOpen`.
- **Share**: `share({ title, text, url })` opens the native sheet; `navigator.share` on the web.
- **Push permission**: `registerPush()` asks, registers with FCM/APNs and returns the
  token. Sending it to the server is a TODO.
- **External links**: `openExternal(url)` uses the in-app browser.
- **Offline**: when the origin can't load, `public/offline.html` shows; it returns to
  the app as soon as the connection does.
- **Android back button** goes back in WebView history, then exits (Capacitor default).

## What's next

1. **Push sending**: `POST /api/push/register` stores `{ memberId, platform, token }`;
   the server sends via FCM HTTP v1 (Android, and iOS through FCM's APNs
   bridge) for the morning letter, a knock to sit together, a quiet-person nudge.
   Store the service-account key in the environment only.
2. **Home-screen widget** (iOS WidgetKit, Android Jetpack Glance): the far home's
   window, the lamp state and each person's safe & sound dot. Reads a small
   `GET /api/widget` (`{ home, city, localTime, lamp: { glow, litAt }, people: [{ name, dot }] }`,
   a few hundred bytes, cached 15 min) with a long-lived, widget-only, read-only
   token stored in the shared app group / DataStore. Tap opens the app on the window.
3. **Android TV build**: a leanback launcher entry and a D-pad friendly window view,
   so parents see the window on the living-room TV.
4. Phone-wide activity for safe & sound (Android Usage Access only, opt-in);
   iOS does not allow it.

## Store review notes

- **Apple 4.2 (minimum functionality)**: an app that only loads a website is
  rejected. Nearer must show native value in the review build: push notifications
  (the knock, the morning letter), the home-screen widget, haptics on the lamp,
  the native share sheet, and deep-link sign-in. Ship the widget before first
  submission if possible; say so in the review notes.
- Give reviewers a working demo login (invite code + member) in App Review
  Information, since the app needs a family to show anything.
- **Sign in with Apple** is required on iOS when Google sign-in is offered
  (guideline 4.8) unless sign-in is email-only; add it before submission.
- Account deletion must be possible in the app (5.1.1(v)).
- Privacy labels / Play Data safety: photos, voice notes, names, coarse city; no
  tracking, no ads. Notification permission is asked in context, not at launch.
- Play: target SDK 36 is current; `POST_NOTIFICATIONS` is declared for Android 13+.
- Both stores: in-app ordering (Swiggy/Zomato) is for physical goods, so it does not
  use in-app purchase.
