import { describe, expect, it } from "vitest";
import { CATALOGUES, en, type UiKey, translate as translateAll } from "@/lib/ui-strings";
import { LOADERS, ensureCatalogue, hasUiCatalogue, translate } from "@/lib/ui-strings/lazy";

// The app reads the per-language loader (lib/ui-strings/lazy.ts) so a phone downloads one
// catalogue; the tests read the single module (lib/ui-strings/index.ts). They must agree.
describe("lazy UI catalogues", () => {
  it("list the same languages as the single module", () => {
    expect(Object.keys(LOADERS).sort()).toEqual(Object.keys(CATALOGUES).sort());
  });

  it("covers every English UI key in each translated catalogue", () => {
    const keys = (Object.keys(en) as UiKey[]).sort();
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const [code, catalogue] of Object.entries(CATALOGUES)) {
      expect(Object.keys(catalogue).sort(), code).toEqual(keys);
      for (const key of keys) {
        expect(placeholders(catalogue[key] ?? ""), `${code}: ${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it("each loader resolves to the same catalogue", async () => {
    for (const [code, load] of Object.entries(LOADERS)) expect(await load(), code).toBe(CATALOGUES[code]);
  });

  it("read English until a language has loaded, then match the single module", async () => {
    expect(translate("ta", "landing.signin")).toBe(translate("en", "landing.signin"));
    await ensureCatalogue("ta");
    expect(translate("ta", "landing.signin")).toBe(translateAll("ta", "landing.signin"));
    expect(translate("ta", "landing.signin")).not.toBe(translate("en", "landing.signin"));
    await ensureCatalogue("hi-deva");
    expect(translate("hi-deva", "landing.signin", {})).toBe(translateAll("hi-deva", "landing.signin"));
  });

  it("know which languages have words without loading them", () => {
    expect(hasUiCatalogue("en")).toBe(true);
    expect(hasUiCatalogue("hi-deva")).toBe(true);
    expect(hasUiCatalogue("hi-latn")).toBe(false);
  });
});
