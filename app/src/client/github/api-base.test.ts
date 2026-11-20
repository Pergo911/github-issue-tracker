import { afterEach, describe, expect, it, vi } from "vitest";
import { githubApiBase } from "./api-base.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

// The SPA's GitHub API base is a build-time setting (ticket #22): `VITE_GITHUB_API_BASE`, defaulting to the
// real GitHub. `vite dev` sets it to the fake GitHub; a build leaves it alone, so production is unchanged.
describe("githubApiBase", () => {
  it("defaults to the real GitHub API", () => {
    vi.stubEnv("VITE_GITHUB_API_BASE", "");
    expect(githubApiBase()).toBe("https://api.github.com");
  });

  it("takes the build-time setting, without a trailing slash", () => {
    vi.stubEnv("VITE_GITHUB_API_BASE", "http://127.0.0.1:5999/github/");
    expect(githubApiBase()).toBe("http://127.0.0.1:5999/github");
  });
});
