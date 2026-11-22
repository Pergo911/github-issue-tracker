import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/call-api.ts";
import type { StaffTokens } from "@shared/staff/session.ts";
import { createTokenStore, type StorageLike } from "../auth/token-store.ts";
import { createStaffSession, GitHubHttpError, SessionEndedError } from "./session.ts";

const base = "https://api.github.test";

function newStore(now: () => number = () => 0) {
  const data = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  const store = createTokenStore(storage, now);
  store.save({
    accessToken: "old",
    refreshToken: "r1",
    expiresIn: 28_800,
    refreshTokenExpiresIn: 1e6,
  });
  return store;
}

const pair = (n: number): StaffTokens => ({
  accessToken: `new${n}`,
  refreshToken: `r${n + 1}`,
  expiresIn: 28_800,
  refreshTokenExpiresIn: 1e6,
});

const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...init.headers },
    status: init.status ?? 200,
  });

describe("githubFetch", () => {
  it("sends the token and the pinned API version to the configured base", async () => {
    const seen: Request[] = [];
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: () => Promise.reject(new Error("unused")),
      fetch: async (input, init) => {
        seen.push(new Request(input, init));
        return json({ ok: true });
      },
    });
    await session.githubFetch("/repos/o/r");
    expect(seen[0]?.url).toBe(`${base}/repos/o/r`);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer old");
    expect(seen[0]?.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(seen[0]?.headers.get("accept")).toBe("application/vnd.github+json");
  });

  it("refreshes first when the access token is due, without waiting for a 401", async () => {
    let now = 0;
    const store = newStore(() => now);
    now = 28_800_000;
    let refreshes = 0;
    const tokens: string[] = [];
    const session = createStaffSession({
      store,
      githubBase: base,
      refresh: async () => {
        refreshes += 1;
        return pair(1);
      },
      fetch: async (input, init) => {
        tokens.push(new Request(input, init).headers.get("authorization") ?? "");
        return json({});
      },
    });
    await session.githubFetch("/user");
    expect(refreshes).toBe(1);
    expect(tokens).toEqual(["Bearer new1"]);
    expect(store.read()?.refreshToken).toBe("r2");
  });

  it("on a 401 refreshes once and retries once; concurrent 401s share one refresh", async () => {
    const store = newStore();
    let refreshes = 0;
    const session = createStaffSession({
      store,
      githubBase: base,
      refresh: async () => {
        refreshes += 1;
        await Promise.resolve();
        return pair(1);
      },
      fetch: async (input, init) =>
        new Request(input, init).headers.get("authorization") === "Bearer new1"
          ? json({ ok: true })
          : json({ message: "Bad credentials" }, { status: 401 }),
    });
    const results = await Promise.all([
      session.githubFetch("/a"),
      session.githubFetch("/b"),
      session.githubFetch("/c"),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(refreshes).toBe(1);
  });

  it("gives up after one retry: a second 401 ends the session, it is not a loop", async () => {
    let calls = 0;
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async () => {
        calls += 1;
        return json({ message: "Bad credentials" }, { status: 401 });
      },
    });
    await expect(session.githubFetch("/a")).rejects.toBeInstanceOf(SessionEndedError);
    expect(calls).toBe(2);
  });

  it("signs out when the refresh is rejected, so a fresh device flow starts", async () => {
    const store = newStore();
    const session = createStaffSession({
      store,
      githubBase: base,
      refresh: async () => {
        throw new ApiError("refresh_rejected", 401);
      },
      fetch: async () => json({}, { status: 401 }),
    });
    await expect(session.githubFetch("/a")).rejects.toBeInstanceOf(SessionEndedError);
    expect(store.read()).toBeNull();
  });

  it("keeps the tokens when the refresh merely could not be tried (network)", async () => {
    const store = newStore();
    const session = createStaffSession({
      store,
      githubBase: base,
      refresh: async () => {
        throw new ApiError("network_error", 0);
      },
      fetch: async () => json({}, { status: 401 }),
    });
    await expect(session.githubFetch("/a")).rejects.toBeInstanceOf(ApiError);
    expect(store.read()).not.toBeNull();
  });

  it("is signed out when there is no token at all", async () => {
    const store = newStore();
    store.clear();
    const session = createStaffSession({
      store,
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async () => json({}),
    });
    await expect(session.githubFetch("/a")).rejects.toBeInstanceOf(SessionEndedError);
  });

  it("uses cache: no-store and never sends Cache-Control or Pragma headers", async () => {
    const seen: { init: RequestInit | undefined; headers: Headers }[] = [];
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (input, init) => {
        const req = new Request(input, init);
        seen.push({ init, headers: req.headers });
        return json({ ok: true });
      },
    });
    await session.githubFetch("/repos/o/r");
    expect(seen[0]?.init?.cache).toBe("no-store");
    expect(seen[0]?.headers.has("cache-control")).toBe(false);
    expect(seen[0]?.headers.has("pragma")).toBe(false);
  });

  it("caches GET 200 responses by ETag, sends If-None-Match, and replays 304 responses repeatedly", async () => {
    const sentIfNoneMatch: (string | null)[] = [];
    let call = 0;
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (_input, init) => {
        sentIfNoneMatch.push(new Headers(init?.headers).get("if-none-match"));
        call += 1;
        if (call === 1) {
          return json({ id: 1, title: "v1" }, { headers: { etag: 'W/"v1"' } });
        }
        if (call === 2 || call === 3) {
          return new Response(null, { status: 304, headers: { etag: 'W/"v1"' } });
        }
        return json({ id: 1, title: "v2" }, { headers: { etag: 'W/"v2"' } });
      },
    });

    const r1 = await session.githubFetch("/repos/o/r/issues/1");
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ id: 1, title: "v1" });

    const r2 = await session.githubFetch("/repos/o/r/issues/1");
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ id: 1, title: "v1" });

    const r3 = await session.githubFetch("/repos/o/r/issues/1");
    expect(r3.status).toBe(200);
    expect(await r3.json()).toEqual({ id: 1, title: "v1" });

    const r4 = await session.githubFetch("/repos/o/r/issues/1");
    expect(r4.status).toBe(200);
    expect(await r4.json()).toEqual({ id: 1, title: "v2" });

    const r5 = await session.githubFetch("/repos/o/r/issues/1");
    expect(r5.status).toBe(200);
    expect(sentIfNoneMatch).toEqual([null, 'W/"v1"', 'W/"v1"', 'W/"v1"', 'W/"v2"']);
  });

  it("bypasses the ETag cache for caller If-None-Match and clears the entry when a 200 omits ETag", async () => {
    const sentIfNoneMatch: (string | null)[] = [];
    let calls = 0;
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (_input, init) => {
        sentIfNoneMatch.push(new Headers(init?.headers).get("if-none-match"));
        calls += 1;
        if (calls === 1) return json({ v: 1 }, { headers: { etag: '"e1"' } });
        return json({ v: calls });
      },
    });

    await session.githubFetch("/item");
    // Caller-supplied If-None-Match must not be overwritten.
    await session.githubFetch("/item", { headers: { "if-none-match": '"custom"' } });
    // Second GET got 200 without ETag, so the cache entry was cleared.
    await session.githubFetch("/item");
    await session.githubFetch("/item");

    expect(sentIfNoneMatch).toEqual([null, '"custom"', '"e1"', null]);
  });

  it("evicts the ETag cache after successful POST, PATCH, PUT, and DELETE mutations across cached paths", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      const sentIfNoneMatch: { path: string; method: string; header: string | null }[] = [];
      const session = createStaffSession({
        store: newStore(),
        githubBase: base,
        refresh: async () => pair(1),
        fetch: async (input, init) => {
          const reqMethod = (init?.method ?? "GET").toUpperCase();
          const path = new URL(String(input)).pathname;
          sentIfNoneMatch.push({
            path,
            method: reqMethod,
            header: new Headers(init?.headers).get("if-none-match"),
          });
          if (reqMethod === "GET") {
            return json({ ok: true }, { headers: { etag: `"etag-${path}"` } });
          }
          return method === "DELETE"
            ? new Response(null, { status: 204 })
            : json({ id: 99 }, { status: 201 });
        },
      });

      await session.githubFetch("/repos/o/r/issues/1");
      await session.githubFetch("/repos/o/r/issues/1/timeline");
      await session.githubFetch("/repos/o/r/issues/1/comments", {
        method,
        ...(method === "DELETE" ? {} : { body: "{}" }),
      });
      await session.githubFetch("/repos/o/r/issues/1");
      await session.githubFetch("/repos/o/r/issues/1/timeline");

      expect(sentIfNoneMatch).toEqual([
        { path: "/repos/o/r/issues/1", method: "GET", header: null },
        { path: "/repos/o/r/issues/1/timeline", method: "GET", header: null },
        { path: "/repos/o/r/issues/1/comments", method, header: null },
        { path: "/repos/o/r/issues/1", method: "GET", header: null },
        { path: "/repos/o/r/issues/1/timeline", method: "GET", header: null },
      ]);
    }
  });

  it("keeps cached ETags when a mutation fails", async () => {
    const sentIfNoneMatch: (string | null)[] = [];
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (_input, init) => {
        const reqMethod = (init?.method ?? "GET").toUpperCase();
        sentIfNoneMatch.push(new Headers(init?.headers).get("if-none-match"));
        if (reqMethod === "POST") return json({ message: "Validation Failed" }, { status: 422 });
        return json({ ok: true }, { headers: { etag: '"e1"' } });
      },
    });

    await session.githubFetch("/repos/o/r/issues/1/timeline");
    const failed = await session.githubFetch("/repos/o/r/issues/1/comments", {
      method: "POST",
      body: "{}",
    });
    expect(failed.status).toBe(422);
    await session.githubFetch("/repos/o/r/issues/1/timeline");

    expect(sentIfNoneMatch).toEqual([null, null, '"e1"']);
  });

  it("prevents an in-flight GET started before a mutation from re-populating the ETag cache", async () => {
    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const sentIfNoneMatch: (string | null)[] = [];
    let getCount = 0;

    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (_input, init) => {
        const reqMethod = (init?.method ?? "GET").toUpperCase();
        sentIfNoneMatch.push(new Headers(init?.headers).get("if-none-match"));
        if (reqMethod === "POST") {
          return json({ id: 42 }, { status: 201 });
        }
        getCount += 1;
        if (getCount === 1) {
          await getGate;
          return json([], { headers: { etag: '"stale-etag"' } });
        }
        return json([{ id: 42 }], { headers: { etag: '"fresh-etag"' } });
      },
    });

    const slowGet = session.githubFetch("/repos/o/r/issues/1/timeline");
    await Promise.resolve();
    await session.githubFetch("/repos/o/r/issues/1/comments", { method: "POST", body: "{}" });
    releaseGet();
    await slowGet;

    await session.githubFetch("/repos/o/r/issues/1/timeline");
    expect(sentIfNoneMatch).toEqual([null, null, null]);
  });

  it("clears the ETag cache when the token changes, on sign-out, or on 401 session end", async () => {
    const store = newStore();
    const seenIfNoneMatch: (string | null)[] = [];
    let force401 = false;
    const session = createStaffSession({
      store,
      githubBase: base,
      refresh: async () => {
        throw new ApiError("refresh_rejected", 401);
      },
      fetch: async (_input, init) => {
        seenIfNoneMatch.push(new Headers(init?.headers).get("if-none-match"));
        if (force401) return json({ message: "Bad credentials" }, { status: 401 });
        return json({ ok: true }, { headers: { etag: '"e1"' } });
      },
    });

    await session.githubFetch("/repos/o/r");
    // Token rotation / different user saved to store clears cache.
    store.save(pair(1));
    await session.githubFetch("/repos/o/r");

    // Sign-out clears cache even if the same token later signs back in.
    store.clear();
    store.save({
      accessToken: "new1",
      refreshToken: "r2",
      expiresIn: 28_800,
      refreshTokenExpiresIn: 1e6,
    });
    await session.githubFetch("/repos/o/r");

    // 401 ending the session clears cache too.
    force401 = true;
    await expect(session.githubFetch("/repos/o/r")).rejects.toBeInstanceOf(SessionEndedError);
    force401 = false;
    store.save({
      accessToken: "new1",
      refreshToken: "r2",
      expiresIn: 28_800,
      refreshTokenExpiresIn: 1e6,
    });
    await session.githubFetch("/repos/o/r");

    expect(seenIfNoneMatch).toEqual([null, null, null, '"e1"', null]);
  });

  it("evicts the oldest ETag cache entry once 200 entries are stored", async () => {
    const sentIfNoneMatch = new Map<string, (string | null)[]>();
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const list = sentIfNoneMatch.get(path) ?? [];
        list.push(new Headers(init?.headers).get("if-none-match"));
        sentIfNoneMatch.set(path, list);
        return json({ path }, { headers: { etag: `"etag-${path}"` } });
      },
    });

    for (let i = 1; i <= 200; i += 1) {
      await session.githubFetch(`/items/${i}`);
    }
    // Touch /items/1 so /items/2 becomes the least recently used entry.
    await session.githubFetch("/items/1");
    // Adding /items/201 evicts /items/2, keeping /items/1.
    await session.githubFetch("/items/201");
    await session.githubFetch("/items/1");
    await session.githubFetch("/items/2");

    expect(sentIfNoneMatch.get("/items/1")).toEqual([null, '"etag-/items/1"', '"etag-/items/1"']);
    expect(sentIfNoneMatch.get("/items/2")).toEqual([null, null]);
  });
});

describe("githubFetchAll", () => {
  it("follows the Link header's next page until there is none", async () => {
    const urls: string[] = [];
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        const page = Number(new URL(url).searchParams.get("page") ?? 1);
        return json([`item${page}`], {
          headers:
            page < 3 ? { link: `<${base}/things?per_page=1&page=${page + 1}>; rel="next"` } : {},
        });
      },
    });
    expect(await session.githubFetchAll<string>("/things", { per_page: 1 })).toEqual([
      "item1",
      "item2",
      "item3",
    ]);
    expect(urls).toHaveLength(3);
  });

  it("preserves Link headers when replaying paginated 304 responses", async () => {
    const sent: { url: string; ifNoneMatch: string | null }[] = [];
    let round = 1;
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async (input, init) => {
        const url = String(input);
        sent.push({ url, ifNoneMatch: new Headers(init?.headers).get("if-none-match") });
        const page = Number(new URL(url).searchParams.get("page") ?? 1);
        if (round === 1) {
          return json([`item${page}`], {
            headers: {
              etag: `"page-${page}"`,
              ...(page < 2 ? { link: `<${base}/things?per_page=1&page=2>; rel="next"` } : {}),
            },
          });
        }
        return new Response(null, { status: 304, headers: { etag: `"page-${page}"` } });
      },
    });

    expect(await session.githubFetchAll<string>("/things", { per_page: 1 })).toEqual([
      "item1",
      "item2",
    ]);
    round = 2;
    expect(await session.githubFetchAll<string>("/things", { per_page: 1 })).toEqual([
      "item1",
      "item2",
    ]);
    expect(sent.map((entry) => entry.ifNoneMatch)).toEqual([null, null, '"page-1"', '"page-2"']);
  });

  it("reads the items of a search answer, and refuses a next link to another origin", async () => {
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async () =>
        json({ items: [1] }, { headers: { link: `<https://evil.test/x>; rel="next"` } }),
    });
    await expect(
      session.githubFetchAll<number>(
        "/search/issues",
        { q: "x" },
        (body) => (body as { items: number[] }).items,
      ),
    ).rejects.toThrow(/origin/);
  });

  it("reports GitHub's error status and message", async () => {
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async () => json({ message: "Not Found" }, { status: 404 }),
    });
    const error = await session.githubFetchAll("/nope").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubHttpError);
    expect(error).toMatchObject({ status: 404, message: "Not Found" });
  });
});

describe("withToken (for the Worker's gated endpoints)", () => {
  it("retries once with a refreshed token when the call fails with 401", async () => {
    const session = createStaffSession({
      store: newStore(),
      githubBase: base,
      refresh: async () => pair(1),
      fetch: async () => json({}),
    });
    const used: string[] = [];
    const result = await session.withToken(async (token) => {
      used.push(token);
      if (token === "old") throw new ApiError("unauthorized", 401);
      return "done";
    });
    expect(result).toBe("done");
    expect(used).toEqual(["old", "new1"]);
  });
});
