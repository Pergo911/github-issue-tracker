import { GITHUB_API_BASE_DEFAULT } from "@shared/github/constants.ts";

/**
 * The GitHub REST API base the SPA's `githubFetch` (ticket #27) calls: the build-time `VITE_GITHUB_API_BASE`,
 * else the dev server's `local-world-github-api-base` meta tag (injected only by `vite dev`), else
 * `https://api.github.com`. A production build leaves the env unset and drops the dev branch.
 */
export function githubApiBase(): string {
  const configured = import.meta.env["VITE_GITHUB_API_BASE"] as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV && typeof document !== "undefined") {
    const devBase = document
      .querySelector('meta[name="local-world-github-api-base"]')
      ?.getAttribute("content");
    if (devBase) return devBase.replace(/\/+$/, "");
  }
  return GITHUB_API_BASE_DEFAULT.replace(/\/+$/, "");
}
