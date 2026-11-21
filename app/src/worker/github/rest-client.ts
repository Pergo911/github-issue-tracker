import { GITHUB_ACCEPT, GITHUB_API_VERSION, WORKER_USER_AGENT } from "@shared/github/constants.ts";
import type { GitHubErrorBody } from "@shared/github/types.ts";

/**
 * Shared GitHub REST transport for the Worker (`fetch` + timeouts + `Link` pagination + error typing).
 * Bot callers pass an installation-token supplier (`bot-client.ts`); Staff callers pass `caller.token`
 * directly (`createStaffClient`), keeping Bot and Staff credentials strictly separate (ADR 0006).
 */

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

export interface GitHubRestClient {
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

export interface GitHubRestClientOptions {
  apiBase: string;
  org: string;
  repo: string;
  getToken: (forceNew: boolean) => Promise<string>;
  /** Retry once with `getToken(true)` when GitHub answers 401 (used by cached installation tokens). */
  retryOnUnauthorized?: boolean;
  /** Looked up on every call (default: the global `fetch`), so a test can swap it. */
  fetch?: typeof fetch;
  /** Per request; a request with no answer by then fails as an uncertain network error. Default 10 s. */
  timeoutMs?: number;
}

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

export async function readGitHubError(
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

/** One request with a timeout. Network failures and timeouts become `GitHubNetworkError`. */
export async function fetchGitHubWithTimeout(
  send: typeof fetch,
  timeoutMs: number,
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

export function createGitHubRestClient(options: GitHubRestClientOptions): GitHubRestClient {
  const base = options.apiBase.replace(/\/+$/, "");
  const baseOrigin = new URL(base).origin;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const send: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init);

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
    requestOptions: RequestOptions,
  ): Promise<GitHubResponse<T>> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await options.getToken(attempt > 0)}`,
        accept: GITHUB_ACCEPT,
        "user-agent": WORKER_USER_AGENT,
        "x-github-api-version": GITHUB_API_VERSION,
      };
      const init: RequestInit = { method, headers };
      if (requestOptions.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(requestOptions.body);
      }
      const response = await fetchGitHubWithTimeout(
        send,
        timeoutMs,
        method,
        path,
        url,
        init,
        requestOptions.signal,
      );
      if (options.retryOnUnauthorized && response.status === 401 && attempt === 0) {
        await response.arrayBuffer();
        continue;
      }
      if (!response.ok) throw await readGitHubError(method, path, response);
      const text = await response.text();
      return {
        status: response.status,
        data: (text === "" ? undefined : JSON.parse(text)) as T,
        headers: response.headers,
      };
    }
  }

  return {
    request: (method, path, requestOptions = {}) =>
      requestUrl(method, path, urlFor(path, requestOptions.query), requestOptions),

    async paginate<T>(
      path: string,
      paginateOptions: Pick<RequestOptions, "query" | "signal"> & { maxPages?: number } = {},
    ): Promise<T[]> {
      const maxPages = paginateOptions.maxPages ?? DEFAULT_MAX_PAGES;
      const items: T[] = [];
      let url: string | null = urlFor(path, { per_page: 100, ...paginateOptions.query });
      for (let page = 1; url !== null; page++) {
        if (page > maxPages) {
          throw new Error(`GET ${path} has more than ${maxPages} pages: stopping`);
        }
        if (new URL(url).origin !== baseOrigin) {
          throw new Error(`GET ${path}: the next page is on a different origin; not following it`);
        }
        const response: GitHubResponse<T[]> = await requestUrl<T[]>("GET", path, url, {
          ...(paginateOptions.signal ? { signal: paginateOptions.signal } : {}),
        });
        items.push(...response.data);
        url = parseNextLink(response.headers.get("link"));
      }
      return items;
    },

    repoPath: (suffix = "") => `/repos/${options.org}/${options.repo}${suffix}`,
  };
}

/** GitHub REST client acting with the signed-in Staff member's own token (`caller.token`, ADR 0006). */
export function createStaffClient(
  env: Pick<Env, "GITHUB_API_BASE" | "GITHUB_ORG" | "GITHUB_REPO">,
  token: string,
): GitHubRestClient {
  return createGitHubRestClient({
    apiBase: env.GITHUB_API_BASE,
    org: env.GITHUB_ORG,
    repo: env.GITHUB_REPO,
    getToken: () => Promise.resolve(token),
    retryOnUnauthorized: false,
  });
}
