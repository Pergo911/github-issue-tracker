import type { MiddlewareHandler } from "hono";
import { roleAtLeast, roleFromPermissions, type StaffRole } from "@shared/github/roles.ts";
import { GITHUB_ACCEPT, GITHUB_API_VERSION, WORKER_USER_AGENT } from "@shared/github/constants.ts";
import type { GitHubRepository, GitHubUser } from "@shared/github/types.ts";
import { commonErrorResponse } from "../api/errors.ts";

/** Who is calling a gated endpoint, as GitHub vouches for them right now. */
export interface StaffCaller {
  role: StaffRole;
  /** Their GitHub login (recorded, for example, as `addedBy` on an Allowlist entry). */
  login: string;
  /** Their GitHub token, for calls the endpoint makes on their behalf. */
  token: string;
}

export type StaffVerdict =
  | { ok: true; caller: StaffCaller }
  | { ok: false; reason: "unauthorized" | "forbidden" | "upstream_unavailable" };

type StaffEnv = Pick<Env, "GITHUB_API_BASE" | "GITHUB_ORG" | "GITHUB_REPO">;

/**
 * Resolves a Staff GitHub token to a dashboard role through the repo `permissions` object (SPEC 2.4), asking
 * GitHub with the caller's own token. A 401 is `unauthorized`; a 404 (not a member of the private repo), a
 * missing `permissions` object or one without Read is `forbidden`; anything that stops GitHub from answering
 * is `upstream_unavailable`: the check fails closed.
 */
export async function resolveStaff(
  env: StaffEnv,
  token: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<StaffVerdict> {
  const base = env.GITHUB_API_BASE.replace(/\/+$/, "");
  const headers = {
    authorization: `Bearer ${token}`,
    accept: GITHUB_ACCEPT,
    "user-agent": WORKER_USER_AGENT,
    "x-github-api-version": GITHUB_API_VERSION,
  };
  const timeout = () => AbortSignal.timeout(10_000);
  let repoResponse: Response;
  let userResponse: Response;
  try {
    [repoResponse, userResponse] = await Promise.all([
      fetcher(`${base}/repos/${env.GITHUB_ORG}/${env.GITHUB_REPO}`, { headers, signal: timeout() }),
      fetcher(`${base}/user`, { headers, signal: timeout() }),
    ]);
  } catch {
    return { ok: false, reason: "upstream_unavailable" };
  }
  try {
    if (repoResponse.status === 401 || userResponse.status === 401) {
      return { ok: false, reason: "unauthorized" };
    }
    if (repoResponse.status === 404 || repoResponse.status === 403) {
      return { ok: false, reason: "forbidden" };
    }
    if (!repoResponse.ok || !userResponse.ok) return { ok: false, reason: "upstream_unavailable" };
    const repository = await repoResponse.json<Partial<GitHubRepository>>();
    const user = await userResponse.json<Partial<GitHubUser>>();
    const role = roleFromPermissions(repository.permissions);
    if (role === null || typeof user.login !== "string") return { ok: false, reason: "forbidden" };
    return { ok: true, caller: { role, login: user.login, token } };
  } catch {
    return { ok: false, reason: "upstream_unavailable" };
  } finally {
    // Free the connection of whichever response was not read.
    await Promise.allSettled([repoResponse.body?.cancel(), userResponse.body?.cancel()]);
  }
}

/**
 * Hono middleware: the caller must present a GitHub token (`Authorization: Bearer`) whose repo role is at
 * least `minimum`. On success the caller is available as `c.get("caller")`. `registerEndpoint` installs it for
 * every endpoint that declares a `role`, which is how a gated endpoint cannot forget its gate.
 */
export function requireRole(
  minimum: StaffRole,
): MiddlewareHandler<{ Bindings: Env; Variables: { caller: StaffCaller } }> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    if (!match) return commonErrorResponse("unauthorized");
    const verdict = await resolveStaff(c.env, match[1] as string);
    if (!verdict.ok) return commonErrorResponse(verdict.reason);
    if (!roleAtLeast(verdict.caller.role, minimum)) return commonErrorResponse("forbidden");
    c.set("caller", verdict.caller);
    await next();
    return undefined;
  };
}
