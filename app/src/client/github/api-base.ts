import { GITHUB_API_BASE_DEFAULT } from "@shared/github/constants.ts";

/**
 * The GitHub REST API base the SPA's `githubFetch` (ticket #27) calls: the build-time `VITE_GITHUB_API_BASE`,
 * else `https://api.github.com`. `vite dev` points it at the fake GitHub of the local world; a production
 * build leaves it unset.
 */
export function githubApiBase(): string {
  const configured = import.meta.env["VITE_GITHUB_API_BASE"] as string | undefined;
  return (configured ? configured : GITHUB_API_BASE_DEFAULT).replace(/\/+$/, "");
}
