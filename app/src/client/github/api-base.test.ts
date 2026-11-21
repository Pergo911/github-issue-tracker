import { afterEach, describe, expect, it, vi } from "vitest";
import { githubApiBase } from "./api-base.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The SPA's GitHub API base is a build-time setting (ticket #22): `VITE_GITHUB_API_BASE`, defaulting to the
// real GitHub. `vite dev` injects a meta tag pointing at the fake GitHub; a build leaves it alone.
describe("githubApiBase", () => {
  it("defaults to the real GitHub API", () => {
    vi.stubEnv("VITE_GITHUB_API_BASE", "");
    expect(githubApiBase()).toBe("https://api.github.com");
  });

  it("takes the build-time setting, without a trailing slash", () => {
    vi.stubEnv("VITE_GITHUB_API_BASE", "http://127.0.0.1:5999/github/");
    expect(githubApiBase()).toBe("http://127.0.0.1:5999/github");
  });

  it("reads the dev server's meta tag when VITE_GITHUB_API_BASE is unset in dev", () => {
    vi.stubEnv("VITE_GITHUB_API_BASE", "");
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === 'meta[name="local-world-github-api-base"]'
          ? { getAttribute: () => "http://127.0.0.1:45123/github/" }
          : null,
    });
    expect(githubApiBase()).toBe("http://127.0.0.1:45123/github");
  });
});
