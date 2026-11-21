import { GITHUB_ACCEPT, GITHUB_API_VERSION, WORKER_USER_AGENT } from "@shared/github/constants.ts";
import type { GitHubInstallationToken } from "@shared/github/types.ts";
import { signAppJwt } from "./app-jwt.ts";
import {
  createGitHubRestClient,
  fetchGitHubWithTimeout,
  GitHubApiError,
  GitHubNetworkError,
  readGitHubError,
  type GitHubResponse,
  type GitHubRestClient,
  type RequestOptions,
} from "./rest-client.ts";

/**
 * The Bot's GitHub client (SPEC 2.6, 3.3): a hand-rolled `fetch` wrapper, not Octokit. It signs the App JWT,
 * exchanges it for an installation token cached until shortly before it expires, follows `Link` pagination,
 * and reports failures in a way ADR 0005 can build on: `uncertain` says whether a write may have been applied.
 * Types come from `@octokit/types` through `@shared/github/types.ts`, as type-only imports.
 */

export { GitHubApiError, GitHubNetworkError, type GitHubResponse, type RequestOptions };

/** The `Env` bindings the client reads. */
export interface BotClientEnv {
  GITHUB_API_BASE: string;
  GITHUB_ORG: string;
  GITHUB_REPO: string;
  BOT_APP_ID: string;
  BOT_INSTALLATION_ID: string;
  BOT_APP_PRIVATE_KEY: string;
}

export type BotClient = GitHubRestClient;

export interface BotClientDeps {
  /** Looked up on every call (default: the global `fetch`), so a test can swap it. */
  fetch?: typeof fetch;
  /** Drives the installation-token cache only (default `Date.now`). */
  now?: () => number;
  /** Per request; a request with no answer by then fails as an uncertain network error. Default 10 s. */
  timeoutMs?: number;
}

/** Renew the installation token this long before GitHub says it expires. */
const RENEW_BEFORE_EXPIRY_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export function createBotClient(env: BotClientEnv, deps: BotClientDeps = {}): BotClient {
  const base = env.GITHUB_API_BASE.replace(/\/+$/, "");
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const send: typeof fetch = (input, init) => (deps.fetch ?? fetch)(input, init);

  let cached: { token: string; expiresAt: number } | null = null;
  let minting: Promise<string> | null = null;

  async function mintToken(): Promise<string> {
    const path = `/app/installations/${env.BOT_INSTALLATION_ID}/access_tokens`;
    // The JWT is signed on the real clock (GitHub checks it against its own); `now` only drives the token cache.
    const jwt = await signAppJwt(env.BOT_APP_PRIVATE_KEY, env.BOT_APP_ID);
    const response = await fetchGitHubWithTimeout(send, timeoutMs, "POST", path, `${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: GITHUB_ACCEPT,
        "user-agent": WORKER_USER_AGENT,
        "x-github-api-version": GITHUB_API_VERSION,
      },
    });
    if (!response.ok) throw await readGitHubError("POST", path, response);
    const minted = await response.json<GitHubInstallationToken>();
    cached = { token: minted.token, expiresAt: Date.parse(minted.expires_at) };
    return minted.token;
  }

  function token(forceNew = false): Promise<string> {
    if (!forceNew && cached && cached.expiresAt - RENEW_BEFORE_EXPIRY_MS > now()) {
      return Promise.resolve(cached.token);
    }
    // Concurrent callers share one exchange.
    minting ??= mintToken().finally(() => {
      minting = null;
    });
    return minting;
  }

  return createGitHubRestClient({
    apiBase: env.GITHUB_API_BASE,
    org: env.GITHUB_ORG,
    repo: env.GITHUB_REPO,
    getToken: token,
    retryOnUnauthorized: true,
    timeoutMs,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}
