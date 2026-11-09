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
