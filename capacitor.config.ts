import type { CapacitorConfig } from "@capacitor/cli";

// Nearer's native shell (iOS + Android). Nearer is a Next.js app with API
// routes, so it is not a static export: the shell loads the deployed site.
// `public/` is copied in only so public/offline.html can be the fallback page.
//
// CAP_SERVER_URL MUST be set for every native build (`npm run cap:sync`), e.g.
//   CAP_SERVER_URL=https://nearer.example npm run cap:sync
// Without it, sync/copy/run/build stop with an error, so a build never ships
// pointing at the wrong origin; the default only lets other tooling load this file.
const PLACEHOLDER = "https://nearer.site";
if (!process.env.CAP_SERVER_URL && /\b(sync|copy|run|build|update)\b/.test(process.argv.join(" "))) {
  throw new Error("Set CAP_SERVER_URL to the production origin, e.g. CAP_SERVER_URL=https://<your-domain> npm run cap:sync");
}
const serverUrl = (process.env.CAP_SERVER_URL || PLACEHOLDER).replace(/\/+$/, "");
const host = new URL(serverUrl).host;

const config: CapacitorConfig = {
  appId: "com.sanjeevlabs.nearer",
  appName: "Nearer",
  webDir: "public",
  server: {
    url: serverUrl,
    cleartext: false,
    // The app's own origin plus the sign-in hosts (Google OAuth, Supabase auth).
    allowNavigation: [host, "accounts.google.com", "*.supabase.co"],
    errorPath: "offline.html",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#2f5684",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_INSIDE",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      overlaysWebView: true,
      // LIGHT = dark text for Nearer's light paper background.
      style: "LIGHT",
      backgroundColor: "#00000000",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
