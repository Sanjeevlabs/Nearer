// First paint: Nearer is light only (app/tokens.css sets `color-scheme: light only`), so the page is
// always light, whatever the phone's setting. A plain string for the inline script in app/layout.tsx.
// Why not next-themes: it builds its inline script with Function.prototype.toString. When the Cloudflare
// worker bundle is made with keepNames, that stringified function gained a call to a helper (__name) that
// only exists in the bundle, so every server-rendered route (/kitchen/<id>, /join/<code>) threw
// "__name is not defined" in the browser. A string literal cannot pick that up.
export const THEME_HINT = `try{var d=document.documentElement;d.classList.remove("dark");d.classList.add("light");d.style.colorScheme="light"}catch(x){}`;
