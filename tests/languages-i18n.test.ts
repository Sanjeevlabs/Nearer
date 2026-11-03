import { describe, expect, it } from "vitest";
import { LANGUAGES, LANG_CODES, isRtl, language, toLangCode } from "@/lib/languages";
import { DisplayLangSchema } from "@/lib/schemas";
import { CATALOGUES, en, hasUiCatalogue, htmlDir, htmlLang, translate, type UiKey } from "@/lib/ui-strings";

describe("content languages", () => {
  it("has about 55 unique languages, each with a native name and script", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(53);
    expect(new Set(LANG_CODES).size).toBe(LANGUAGES.length);
    for (const l of LANGUAGES) {
      expect(l.native.trim().length).toBeGreaterThan(0);
      expect(l.script.trim().length).toBeGreaterThan(0);
      expect(DisplayLangSchema.parse(l.code)).toBe(l.code);
    }
  });

  it("keeps stored codes unchanged", () => {
    for (const c of ["en", "hi-deva", "hi-latn", "ta", "ur", "ar", "zh", "tl", "sw"]) expect(LANG_CODES).toContain(c);
  });

  it("marks right-to-left scripts", () => {
    for (const c of ["ur", "ar", "fa", "he", "ps"]) expect(isRtl(c)).toBe(true);
    for (const c of ["en", "hi-deva", "ta", "el", "am"]) expect(isRtl(c)).toBe(false);
  });

  it("maps browser tags and legacy aliases", () => {
    expect(toLangCode("nl-NL")).toBe("nl");
    expect(toLangCode("iw")).toBe("he");
    expect(toLangCode("nb-NO")).toBe("no");
    expect(toLangCode("fa-IR")).toBe("fa");
    expect(toLangCode("hi-IN")).toBe("hi-deva");
    expect(toLangCode("xx")).toBe("en");
    expect(language("uk").native).toBe("Українська");
  });
});

describe("UI catalogues", () => {
  it("covers the first-run locales", () => {
    for (const c of ["hi-deva", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur", "es", "ar"]) expect(hasUiCatalogue(c)).toBe(true);
    expect(hasUiCatalogue("fr")).toBe(false);
  });

  it("never carries keys English lacks, nor empty strings, and keeps placeholders", () => {
    for (const [code, cat] of Object.entries(CATALOGUES)) {
      for (const [k, v] of Object.entries(cat)) {
        expect(k in en, `${code}: ${k}`).toBe(true);
        expect((v as string).trim().length, `${code}: ${k}`).toBeGreaterThan(0);
        const want = (en[k as UiKey].match(/\{\w+\}/g) ?? []).sort();
        const got = ((v as string).match(/\{\w+\}/g) ?? []).sort();
        expect(got, `${code}: ${k}`).toEqual(want);
      }
    }
  });

  it("translates the welcome and onboarding path fully in every catalogue", () => {
    const core: UiKey[] = ["landing.tagline", "landing.sub", "landing.create", "landing.join", "landing.signin", "welcome.title", "welcome.enter", "auth.titleOtherSide", "auth.continue", "other.parents", "picker.everyone"];
    for (const [code, cat] of Object.entries(CATALOGUES)) for (const k of core) expect(cat[k], `${code}: ${k}`).toBeTruthy();
  });

  it("falls back to English per key and fills placeholders", () => {
    expect(translate("fr", "landing.tagline")).toBe("The voice-first window between two homes.");
    expect(translate("hi-deva", "welcome.title", { name: "Asha" })).toBe("घर में स्वागत है, Asha");
    expect(translate("es", "window.callGood")).toBe("Buen momento para llamar");
    expect(translate("hi-latn", "landing.create")).toBe("Create");
  });

  it("exports the shared window and family keys", () => {
    expect(en["window.lampHold"]).toBe("Tap to light · hold for a heartbeat");
    expect(en["occasions.ourTraditions"]).toBe("Our traditions");
    expect(en["landing.sub"]).toBe("A window into your parents' day, and theirs into yours.");
  });

  it("sets html lang and dir", () => {
    expect(htmlLang("hi-deva")).toBe("hi");
    expect(htmlDir("ar")).toBe("rtl");
    expect(htmlDir("he")).toBe("rtl");
    expect(htmlDir("ta")).toBe("ltr");
  });

  it("keeps UI copy free of the reserved word", () => {
    for (const cat of [en, ...Object.values(CATALOGUES)]) for (const v of Object.values(cat)) expect(/\bcircle\b/i.test(v as string)).toBe(false);
  });
});
