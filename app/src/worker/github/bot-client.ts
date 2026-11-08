import { GITHUB_ACCEPT, GITHUB_API_VERSION, WORKER_USER_AGENT } from "@shared/github/constants.ts";
import type { GitHubErrorBody, GitHubInstallationToken } from "@shared/github/types.ts";
import { signAppJwt } from "./app-jwt.ts";

/**
 * The Bot's GitHub client (SPEC 2.6, 3.3): a hand-rolled `fetch` wrapper, not Octokit. It signs the App JWT,
 * exchanges it for an installation token cached until shortly before it expires, follows `Link` pagination,
 * and reports failures in a way ADR 0005 can build on: `uncertain` says whether a write may have been applied.
 * Types come from `@octokit/types` through `@shared/github/types.ts`, as type-only imports.
 */

/** The `Env` bindings the client reads. */
export interface BotClientEnv {
  GITHUB_API_BASE: string;
  GITHUB_ORG: string;
  GITHUB_REPO: string;
  BOT_APP_ID: string;
  BOT_INSTALLATION_ID: string;
  BOT_APP_PRIVATE_KEY: string;
}

/** GitHub answered with an error status. */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly body: GitHubErrorBody | undefined;
  /** Seconds from `Retry-After`, when GitHub sent it. */
  readonly retryAfterSeconds: number | null;
  /** A rate-limit refusal (403 or 429): definite, so the request may be repeated after waiting. */
  readonly rateLimited: boolean;
  /**
   * Whether the write may nevertheless have been applied: a 5xx to anything but a read. Never repeat an
   * uncertain create (ADR 0005); find out first.
   */
  readonly uncertain: boolean;

  constructor(
    method: string,
    path: string,
    status: number,
    body: GitHubErrorBody | undefined,
    headers: Headers,
  ) {
    super(body?.message ?? `GitHub answered ${status} to ${method} ${path}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.body = body;
    const retryAfter = Number(headers.get("retry-after"));
    this.retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    this.rateLimited =
      (status === 403 || status === 429) &&
      (/rate limit/i.test(body?.message ?? "") || headers.get("x-ratelimit-remaining") === "0");
    this.uncertain = status >= 500 && method !== "GET" && method !== "HEAD";
  }
}

/** No answer arrived: the connection failed or timed out. For a write, whether it was applied is unknown. */
export class GitHubNetworkError extends Error {
  readonly uncertain = true;
  readonly timedOut: boolean;
  constructor(method: string, path: string, timedOut: boolean, cause: unknown) {
    super(`No answer from GitHub to ${method} ${path}${timedOut ? " (timed out)" : ""}`);
    this.name = "GitHubNetworkError";
    this.timedOut = timedOut;
    this.cause = cause;
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface GitHubResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface BotClient {
  request<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<GitHubResponse<T>>;
  /** GETs every page of a list, following the `Link` header's `next` URL verbatim. */
  paginate<T = unknown>(
    path: string,
    options?: Pick<RequestOptions, "query" | "signal"> & { maxPages?: number },
  ): Promise<T[]>;
  /** `/repos/<org>/<repo><suffix>` for this Deployment. */
  repoPath(suffix?: string): string;
}

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
const DEFAULT_MAX_PAGES = 50;

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match) return match[1] as string;
  }
  return null;
}

export function createBotClient(env: BotClientEnv, deps: BotClientDeps = {}): BotClient {
  const base = env.GITHUB_API_BASE.replace(/\/+$/, "");
  const baseOrigin = new URL(base).origin;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const send: typeof fetch = (input, init) => (deps.fetch ?? fetch)(input, init);

  let cached: { token: string; expiresAt: number } | null = null;
  let minting: Promise<string> | null = null;

  /** One request with a timeout. Network failures and timeouts become `GitHubNetworkError`. */
  async function fetchWithTimeout(
    method: string,
    path: string,
    url: string,
    init: RequestInit,
    outer?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      return await send(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (outer?.aborted && !timedOut) throw error;
      throw new GitHubNetworkError(method, path, timedOut, error);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }

  async function readError(
    method: string,
    path: string,
    response: Response,
  ): Promise<GitHubApiError> {
    let body: GitHubErrorBody | undefined;
    try {
      body = await response.json<GitHubErrorBody>();
    } catch {
      body = undefined;
    }
    return new GitHubApiError(method, path, response.status, body, response.headers);
  }

  async function mintToken(): Promise<string> {
    const path = `/app/installations/${env.BOT_INSTALLATION_ID}/access_tokens`;
    // The JWT is signed on the real clock (GitHub checks it against its own); `now` only drives the token cache.
    const jwt = await signAppJwt(env.BOT_APP_PRIVATE_KEY, env.BOT_APP_ID);
    const response = await fetchWithTimeout("POST", path, `${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: GITHUB_ACCEPT,
        "user-agent": WORKER_USER_AGENT,
        "x-github-api-version": GITHUB_API_VERSION,
      },
    });
    if (!response.ok) throw await readError("POST", path, response);
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

  function urlFor(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async function requestUrl<T>(
    method: string,
    path: string,
    url: string,
    options: RequestOptions,
  ): Promise<GitHubResponse<T>> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await token(attempt > 0)}`,
        accept: GITHUB_ACCEPT,
        "user-agent": WORKER_USER_AGENT,
        "x-github-api-version": GITHUB_API_VERSION,
      };
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }
      const response = await fetchWithTimeout(method, path, url, init, options.signal);
      // A 401 means the request was not processed, so it is safe to repeat with a fresh token (once).
      if (response.status === 401 && attempt === 0) {
        await response.arrayBuffer();
        continue;
      }
      if (!response.ok) throw await readError(method, path, response);
      const text = await response.text();
      return {
        status: response.status,
        data: (text === "" ? undefined : JSON.parse(text)) as T,
        headers: response.headers,
      };
    }
  }

  return {
    request: (method, path, options = {}) =>
      requestUrl(method, path, urlFor(path, options.query), options),

    async paginate<T>(
      path: string,
      options: Pick<RequestOptions, "query" | "signal"> & { maxPages?: number } = {},
    ): Promise<T[]> {
      const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
      const items: T[] = [];
      let url: string | null = urlFor(path, { per_page: 100, ...options.query });
      for (let page = 1; url !== null; page++) {
        if (page > maxPages) {
          throw new Error(`GET ${path} has more than ${maxPages} pages: stopping`);
        }
        if (new URL(url).origin !== baseOrigin) {
          throw new Error(`GET ${path}: the next page is on a different origin; not following it`);
        }
        const response: GitHubResponse<T[]> = await requestUrl<T[]>("GET", path, url, {
          ...(options.signal ? { signal: options.signal } : {}),
        });
        items.push(...response.data);
        url = parseNextLink(response.headers.get("link"));
      }
      return items;
    },

    repoPath: (suffix = "") => `/repos/${env.GITHUB_ORG}/${env.GITHUB_REPO}${suffix}`,
  };
}
