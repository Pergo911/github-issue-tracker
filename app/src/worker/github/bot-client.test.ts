import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GITHUB_API_VERSION } from "@shared/github/constants.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { fakeWorld } from "../testing/world.ts";
import { createBotClient, GitHubApiError, GitHubNetworkError } from "./bot-client.ts";

// The Bot's GitHub client, against the fake GitHub in the Workers runtime (ticket #22, SPEC 2.6, 3.3).

/** `fetch` that records every request's URL and headers, then lets the fake answer. */
function recording() {
  const calls: { method: string; url: string; headers: Headers }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    calls.push({ method: request.method, url: request.url, headers: request.headers });
    return fetch(request);
  };
  return { calls, fetcher };
}

const exchanges = (calls: { url: string }[]) =>
  calls.filter((call) => call.url.endsWith("/access_tokens")).length;

describe("the Bot client", () => {
  it("creates an issue and reads it back, as the Bot (the demo of ticket #22)", async () => {
    const client = createBotClient(env);
    const created = await client.request<GitHubIssue>("POST", client.repoPath("/issues"), {
      body: { title: "Leaking tap", body: "Second floor", labels: ["category:plumbing"] },
    });
    expect(created.status).toBe(201);
    expect(created.data.user).toMatchObject({ type: "Bot", login: "fault-reports-bot[bot]" });

    const read = await client.request<GitHubIssue>("GET", client.repoPath("/issues/1"));
    expect(read.data).toMatchObject({ number: 1, title: "Leaking tap", state: "open" });
    expect(read.data.labels.map((label) => label.name)).toEqual(["category:plumbing"]);
  });

  it("sends the headers GitHub requires, the pinned API version among them", async () => {
    const { calls, fetcher } = recording();
    const client = createBotClient(env, { fetch: fetcher });
    await client.request("GET", client.repoPath());
    const exchange = calls.find((call) => call.url.endsWith("/access_tokens"))!;
    expect(exchange.headers.get("authorization")).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const read = calls.find((call) => call.url.endsWith("/repos/fake-org/reports"))!;
    expect(read.headers.get("authorization")).toMatch(/^Bearer ghs_/);
    expect(read.headers.get("x-github-api-version")).toBe(GITHUB_API_VERSION);
    expect(read.headers.get("accept")).toBe("application/vnd.github+json");
    expect(read.headers.get("user-agent")).toBeTruthy();
  });

  it("reaches GitHub through the GITHUB_API_BASE variable only", async () => {
    const { calls, fetcher } = recording();
    const client = createBotClient(
      { ...env, GITHUB_API_BASE: "https://world.test/github/" },
      { fetch: fetcher },
    );
    await client.request("GET", client.repoPath());
    expect(calls.every((call) => call.url.startsWith("https://world.test/github/"))).toBe(true);
    expect(
      calls.some((call) => call.url.includes("//repos") || call.url.includes("github//")),
    ).toBe(false);
  });

  describe("the installation token", () => {
    it("is minted once and reused", async () => {
      const { calls, fetcher } = recording();
      const client = createBotClient(env, { fetch: fetcher });
      for (let n = 0; n < 3; n++) await client.request("GET", client.repoPath());
      expect(exchanges(calls)).toBe(1);
    });

    it("is minted again shortly before it expires, not only after", async () => {
      const { calls, fetcher } = recording();
      let now = Date.now();
      const client = createBotClient(env, { fetch: fetcher, now: () => now });
      await client.request("GET", client.repoPath());
      now += 54 * 60_000; // an hour's token, 6 minutes left: still good
      await client.request("GET", client.repoPath());
      expect(exchanges(calls)).toBe(1);
      now += 2 * 60_000; // under 5 minutes left: renew
      await client.request("GET", client.repoPath());
      expect(exchanges(calls)).toBe(2);
    });

    it("is minted once for concurrent first calls", async () => {
      const { calls, fetcher } = recording();
      const client = createBotClient(env, { fetch: fetcher });
      await Promise.all(Array.from({ length: 5 }, () => client.request("GET", client.repoPath())));
      expect(exchanges(calls)).toBe(1);
    });

    it("is replaced once, transparently, when GitHub says it is no longer valid", async () => {
      const { calls, fetcher } = recording();
      const client = createBotClient(env, { fetch: fetcher });
      await client.request("GET", client.repoPath());
      // GitHub's clock moves on while this isolate's cache still believes the token is fresh.
      fakeWorld().control.advanceClock(61 * 60_000);
      const reply = await client.request("GET", client.repoPath());
      expect(reply.status).toBe(200);
      expect(exchanges(calls)).toBe(2);
    });

    it("is not retried in a loop when the credentials are simply wrong", async () => {
      const { calls, fetcher } = recording();
      const other = createBotClient({ ...env, BOT_APP_ID: "999" }, { fetch: fetcher });
      await expect(other.request("GET", other.repoPath())).rejects.toMatchObject({
        name: "GitHubApiError",
        status: 401,
      });
      expect(exchanges(calls)).toBe(1);
    });

    it("fails with a clear error when the key is not a key, before any request", async () => {
      const { calls, fetcher } = recording();
      const client = createBotClient(
        { ...env, BOT_APP_PRIVATE_KEY: "local-development-placeholder" },
        { fetch: fetcher },
      );
      await expect(client.request("GET", client.repoPath())).rejects.toThrow(
        /not a PEM private key/,
      );
      expect(calls).toEqual([]);
    });
  });

  describe("pagination", () => {
    async function withIssues(count: number) {
      const client = createBotClient(env);
      for (let n = 1; n <= count; n++) {
        await client.request("POST", client.repoPath("/issues"), { body: { title: `issue ${n}` } });
      }
      return client;
    }

    it("follows the Link header's next URL until there is none", async () => {
      const client = await withIssues(5);
      const { calls, fetcher } = recording();
      const paged = createBotClient(env, { fetch: fetcher });
      const issues = await paged.paginate<GitHubIssue>(paged.repoPath("/issues"), {
        query: { per_page: 2, state: "all", direction: "asc" },
      });
      expect(issues.map((issue) => issue.number)).toEqual([1, 2, 3, 4, 5]);
      expect(calls.filter((call) => call.url.includes("/issues?")).length).toBe(3);
      void client;
    });

    it("returns an empty list, and a single page, without a Link header", async () => {
      const client = createBotClient(env);
      expect(await client.paginate(client.repoPath("/issues"))).toEqual([]);
      await client.request("POST", client.repoPath("/issues"), { body: { title: "only" } });
      expect(await client.paginate(client.repoPath("/issues"))).toHaveLength(1);
    });

    it("refuses a next link that leaves the API's origin, so the token is never sent elsewhere", async () => {
      const evil: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        if (!request.url.includes("/issues")) return fetch(request);
        return Response.json([], { headers: { link: '<https://evil.example/steal>; rel="next"' } });
      };
      const client = createBotClient(env, { fetch: evil });
      await expect(client.paginate(client.repoPath("/issues"))).rejects.toThrow(/different origin/);
    });

    it("stops at a page limit rather than looping forever", async () => {
      const looping: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        if (!request.url.includes("/issues")) return fetch(request);
        return Response.json([{ number: 1 }], {
          headers: { link: `<${request.url}>; rel="next"` },
        });
      };
      const client = createBotClient(env, { fetch: looping });
      await expect(client.paginate(client.repoPath("/issues"), { maxPages: 3 })).rejects.toThrow(
        /more than 3 pages/,
      );
    });
  });

  describe("failures", () => {
    it("raises GitHubApiError with the status and GitHub's message for a refusal", async () => {
      const client = createBotClient(env);
      const error = await client
        .request("GET", client.repoPath("/issues/99"))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubApiError);
      expect(error).toMatchObject({ status: 404, message: "Not Found", uncertain: false });
    });

    it("keeps the validation errors GitHub reports", async () => {
      const client = createBotClient(env);
      const error = (await client
        .request("POST", client.repoPath("/issues"), { body: { body: "no title" } })
        .catch((e: unknown) => e)) as GitHubApiError;
      expect(error.status).toBe(422);
      expect(error.body).toMatchObject({ message: "Validation Failed" });
    });

    it("marks a failed write as uncertain when it may have been applied (5xx), a failed read as not", async () => {
      const client = createBotClient(env);
      fakeWorld().control.addFault({
        service: "github",
        method: "POST",
        path: "/issues$",
        effect: { type: "status", status: 502 },
      });
      fakeWorld().control.addFault({
        service: "github",
        method: "GET",
        path: "/labels$",
        effect: { type: "status", status: 502 },
      });
      const write = (await client
        .request("POST", client.repoPath("/issues"), { body: { title: "t" } })
        .catch((e: unknown) => e)) as GitHubApiError;
      const read = (await client
        .request("GET", client.repoPath("/labels"))
        .catch((e: unknown) => e)) as GitHubApiError;
      expect(write).toMatchObject({ status: 502, uncertain: true });
      expect(read).toMatchObject({ status: 502, uncertain: false });
    });

    it("reads a secondary rate limit: its status, its retry-after, and that it was a refusal", async () => {
      const client = createBotClient(env);
      fakeWorld().control.addFault({
        service: "github",
        method: "POST",
        path: "/issues$",
        effect: {
          type: "status",
          status: 403,
          body: {
            message:
              "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
          },
          headers: { "retry-after": "60" },
        },
      });
      const error = (await client
        .request("POST", client.repoPath("/issues"), { body: { title: "t" } })
        .catch((e: unknown) => e)) as GitHubApiError;
      expect(error).toMatchObject({
        status: 403,
        rateLimited: true,
        retryAfterSeconds: 60,
        uncertain: false,
      });
    });

    it("raises GitHubNetworkError, an uncertain outcome, when the connection is lost after the write", async () => {
      const client = createBotClient(env);
      fakeWorld().control.addFault({
        service: "github",
        method: "POST",
        path: "/issues$",
        effect: { type: "lost-response" },
      });
      const error = await client
        .request("POST", client.repoPath("/issues"), { body: { title: "ghost" } })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubNetworkError);
      expect(error).toMatchObject({ uncertain: true });
      // ...and the Report really was created: that is why the outcome is uncertain, not failed.
      const issues = await client.paginate<GitHubIssue>(client.repoPath("/issues"));
      expect(issues.map((issue) => issue.title)).toEqual(["ghost"]);
    });

    it("times out, as an uncertain outcome, instead of waiting forever", async () => {
      const client = createBotClient(env, { timeoutMs: 50 });
      await client.request("GET", client.repoPath());
      fakeWorld().control.addFault({
        service: "github",
        method: "POST",
        path: "/issues$",
        effect: { type: "timeout" },
      });
      const error = await client
        .request("POST", client.repoPath("/issues"), { body: { title: "t" } })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubNetworkError);
      expect(error).toMatchObject({ uncertain: true, timedOut: true });
    });
  });
});
