import { afterEach, describe, expect, it, vi } from "vitest";
import { redesignUiEnabled } from "./flags";

describe("redesignUiEnabled", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  // The redesign is permanent post-cutover (Phase 4, 4d): this is unconditionally
  // true and ignores NEXT_PUBLIC_REDESIGN_ENABLED (retired). Guards against
  // anyone re-introducing an env gate that could hide the app.
  it("is always true regardless of the (retired) env flag", () => {
    expect(redesignUiEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "");
    expect(redesignUiEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "false");
    expect(redesignUiEnabled()).toBe(true);
  });
});
