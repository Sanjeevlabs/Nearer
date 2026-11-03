import { describe, expect, it } from "vitest";
import { loadView } from "@/lib/load-state";

describe("loadView", () => {
  it("shows a skeleton while loading with nothing yet", () => expect(loadView({ loading: true, failed: false, hasData: false })).toBe("loading"));
  it("says so when the read failed and there is nothing to show", () => expect(loadView({ loading: false, failed: true, hasData: false })).toBe("failed"));
  it("failed beats a still-loading skeleton", () => expect(loadView({ loading: true, failed: true, hasData: false })).toBe("failed"));
  it("keeps cached data when a refresh failed", () => expect(loadView({ loading: false, failed: true, hasData: true })).toBe("show"));
  it("shows the empty state on success with nothing", () => expect(loadView({ loading: false, failed: false, hasData: false })).toBe("show"));
  it("shows data", () => expect(loadView({ loading: false, failed: false, hasData: true })).toBe("show"));
});
