// On a wide screen, "/" is the public home page until the person steps into
// the app once this session (Open Aangan, the demo, or any app route). After
// that, "/" is the app again, so in-app links back to "/" keep working.
const KEY = "aangan:entered";

export function hasEntered(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return true; // no sessionStorage: never trap someone on the site
  }
}

export function markEntered(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
}
