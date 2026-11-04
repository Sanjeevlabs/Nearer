// First-paint light/dark, as a plain string for the inline script in app/layout.tsx.
// Light or dark follows the phone, or a saved "theme" of light / dark.
// Why not next-themes: it builds its inline script with Function.prototype.toString. When the Cloudflare
// worker bundle is made with keepNames, that stringified function gained a call to a helper (__name) that
// only exists in the bundle, so every server-rendered route (/kitchen/<id>, /join/<code>) threw
// "__name is not defined" in the browser. A string literal cannot pick that up.
export const THEME_HINT = `try{var d=document.documentElement,t=localStorage.getItem("theme")||"system",m=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;if(m==="light"||m==="dark"){d.classList.remove("light","dark");d.classList.add(m);d.style.colorScheme=m}}catch(x){}`;
