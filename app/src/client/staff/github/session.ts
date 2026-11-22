import { ApiError } from "@/api/call-api.ts";
import { GITHUB_ACCEPT, GITHUB_API_VERSION } from "@shared/github/constants.ts";
import type { StaffTokens } from "@shared/staff/session.ts";
import type { TokenStore } from "../auth/token-store.ts";

/** The member is no longer signed in: there was no token, or the refresh token was refused. */
export class SessionEndedError extends Error {
  constructor() {
    super("The Staff session has ended");
    this.name = "SessionEndedError";
  }
}

/** GitHub answered with an error status. */
export class GitHubHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubHttpError";
    this.status = status;
  }
}

class Unauthorized extends Error {}

export interface StaffSessionDeps {
  store: TokenStore;
  /** The GitHub REST base (`githubApiBase()` in the app), without a trailing slash. */
  githubBase: string;
  /** Exchanges a refresh token for a new pair (the Worker's `staffRefresh`). */
  refresh: (refreshToken: string) => Promise<StaffTokens>;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number>;

const MAX_ETAG_CACHE_ENTRIES = 200;

interface EtagEntry {
  etag: string;
  body: string;
  headers: [string, string][];
}

/**
 * The Staff member's session (SPEC 2.2, 2.6): the one place that adds the token to a call, refreshes it silently
 * when it is due or when GitHub (or the Worker) answers 401, retries once, and follows `Link` pagination. When
 * the refresh token is refused the tokens are cleared, so the dashboard falls back to a fresh device flow.
 */
export function createStaffSession(deps: StaffSessionDeps) {
  const { store } = deps;
  const send: typeof fetch = (input, init) => (deps.fetch ?? fetch)(input, init);
  const base = deps.githubBase.replace(/\/+$/, "");
  let refreshing: Promise<void> | null = null;
  const etagCache = new Map<string, EtagEntry>();
  let cachedToken: string | null = store.read()?.accessToken ?? null;

  function syncToken(nextToken: string | null): void {
    if (nextToken === cachedToken) return;
    etagCache.clear();
    cachedToken = nextToken;
  }

  store.subscribe(() => {
    syncToken(store.read()?.accessToken ?? null);
  });

  function setEtagEntry(key: string, entry: EtagEntry): void {
    if (etagCache.has(key)) {
      etagCache.delete(key);
    } else if (etagCache.size >= MAX_ETAG_CACHE_ENTRIES) {
      const oldest = etagCache.keys().next().value;
      if (oldest !== undefined) etagCache.delete(oldest);
    }
    etagCache.set(key, entry);
  }

  /** One refresh at a time: a refresh token works once, so concurrent callers must share it. */
  function refresh(): Promise<void> {
    refreshing ??= (async () => {
      const tokens = store.read();
      if (!tokens) throw new SessionEndedError();
      try {
        store.save(await deps.refresh(tokens.refreshToken));
      } catch (error) {
        if (error instanceof ApiError && error.code === "refresh_rejected") {
          store.clear();
          throw new SessionEndedError();
        }
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function currentToken(): Promise<string> {
    if (store.read() === null) throw new SessionEndedError();
    if (store.accessTokenDue()) await refresh();
    const tokens = store.read();
    if (!tokens) throw new SessionEndedError();
    return tokens.accessToken;
  }

  const unauthorized = (error: unknown) =>
    error instanceof Unauthorized || (error instanceof ApiError && error.status === 401);

  /** Runs `operation` with the token; on a 401 refreshes once and tries once more. */
  async function withToken<T>(operation: (token: string) => Promise<T>): Promise<T> {
    const token = await currentToken();
    try {
      return await operation(token);
    } catch (error) {
      if (!unauthorized(error)) throw error;
    }
    // Another caller may have refreshed already: only refresh when the token is still the one that failed.
    if (store.read()?.accessToken === token) await refresh();
    const retried = store.read();
    if (!retried) throw new SessionEndedError();
    try {
      return await operation(retried.accessToken);
    } catch (error) {
      if (unauthorized(error)) {
        store.clear();
        throw new SessionEndedError();
      }
      throw error;
    }
  }

  function urlOf(path: string, query?: Query): string {
    const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async function githubFetch(path: string, init: RequestInit = {}, query?: Query) {
    const url = urlOf(path, query);
    const method = (init.method ?? "GET").toUpperCase();
    const callerProvidedIfNoneMatch = new Headers(init.headers).has("if-none-match");
    const cacheable = method === "GET" && !callerProvidedIfNoneMatch;

    return withToken(async (token) => {
      syncToken(token);
      const cached = cacheable ? etagCache.get(url) : undefined;
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("accept", GITHUB_ACCEPT);
      headers.set("x-github-api-version", GITHUB_API_VERSION);
      if (cached) headers.set("if-none-match", cached.etag);

      const response = await send(url, { ...init, cache: "no-store", headers });
      if (response.status === 401) {
        await response.arrayBuffer();
        throw new Unauthorized();
      }
      if (cacheable && response.status === 304 && cached) {
        const mergedHeaders = new Headers(cached.headers);
        const freshEtag = response.headers.get("etag");
        if (freshEtag !== null) mergedHeaders.set("etag", freshEtag);
        const freshLink = response.headers.get("link");
        if (freshLink !== null) mergedHeaders.set("link", freshLink);
        if (cachedToken === token) {
          setEtagEntry(url, {
            etag: freshEtag ?? cached.etag,
            body: cached.body,
            headers: [...mergedHeaders.entries()],
          });
        }
        return new Response(cached.body, {
          status: 200,
          statusText: "OK",
          headers: mergedHeaders,
        });
      }
      if (cacheable && response.status === 200) {
        const etag = response.headers.get("etag");
        if (etag) {
          const body = await response.clone().text();
          if (cachedToken === token) {
            setEtagEntry(url, {
              etag,
              body,
              headers: [...response.headers.entries()],
            });
          }
        } else if (cachedToken === token) {
          etagCache.delete(url);
        }
      }
      return response;
    });
  }

  async function failure(response: Response): Promise<GitHubHttpError> {
    let message = `GitHub answered ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the generic message.
    }
    return new GitHubHttpError(response.status, message);
  }

  /** Every page of a list, following `Link: rel="next"` (on GitHub's own origin only). */
  async function githubFetchAll<T>(
    path: string,
    query?: Query,
    itemsOf: (body: unknown) => T[] = (body) => body as T[],
    maxPages = 50,
  ): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = urlOf(path, { per_page: 100, ...query });
    for (let page = 1; url !== null; page++) {
      if (page > maxPages) throw new Error(`More than ${maxPages} pages: stopping`);
      if (new URL(url).origin !== new URL(base).origin) {
        throw new Error("The next page is on a different origin: not following it");
      }
      const response = await githubFetch(url);
      if (!response.ok) throw await failure(response);
      items.push(...itemsOf(await response.json()));
      url = /<([^>]+)>\s*;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
    }
    return items;
  }

  /** One GitHub answer as JSON, or a `GitHubHttpError` for an error status. */
  async function githubJson<T>(path: string, query?: Query): Promise<T> {
    const response = await githubFetch(path, {}, query);
    if (!response.ok) throw await failure(response);
    return (await response.json()) as T;
  }

  return { githubFetch, githubFetchAll, githubJson, withToken };
}

export type StaffSession = ReturnType<typeof createStaffSession>;
