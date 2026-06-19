import { afterEach, describe, expect, it, vi } from "vitest";
import { redesignUiEnabled } from "./flags";

describe("redesignUiEnabled", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns true only when the flag is exactly 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "true");
    expect(redesignUiEnabled()).toBe(true);
  });

  it("returns false when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "");
    expect(redesignUiEnabled()).toBe(false);
  });

  it("returns false for truthy-but-not-'true' values", () => {
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "1");
    expect(redesignUiEnabled()).toBe(false);
  });
});
