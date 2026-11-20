import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFence } from "../../../src/shared/reports/fence.ts";
import type { Reply } from "../../testing/api.ts";
import {
  fakeTarget,
  liveCredentials,
  liveTarget,
  SANDBOX_REPO,
  type ContractTarget,
} from "./target.ts";

/**
 * The contract suite (ticket #32): the same scenarios against the fake GitHub and, when credentials are present,
 * against the live `reports-sandbox` repo with the real Bot. What passes live and fails on the fake is a
 * difference the fake must be taught; what the code relies on is asserted here, once, for both.
 *
 * Live runs are opt-in (`npm run test:contract:live`, see AGENTS.md). Every issue it creates is closed as
 * `not_planned`, every label it creates is deleted, and every title carries a per-run tag, so a re-run is safe.
 */

const RUN = Math.random().toString(36).slice(2, 8);
const TAG = `contract${RUN}`;

const live = liveCredentials();

const targets: { name: string; skip: string | null; make: () => Promise<ContractTarget> }[] = [
  { name: "fake", skip: null, make: fakeTarget },
  {
    name: `live ${SANDBOX_REPO}`,
    skip: "skip" in live ? live.skip : null,
    make: async () =>
      liveTarget((live as { credentials: Parameters<typeof liveTarget>[0] }).credentials),
  },
];

const FENCED_TEXTS = [
  "Plain text with @octocat, #1, example.hu and https://example.com/x",
  "Hungárian: árvíztűrő tükörfúrógép, ŐÚ, 12.5%",
  "Backticks ``` inside and ```` more",
  "<script>alert(1)</script> & <b>bold</b>",
  "Line one\n\nLine three with trailing spaces   \n  indented",
  "da39a3ee5e6b4b0d3255bfef95601890afd80709 and 0123456789abcdef0123456789abcdef",
];

function expectStatus(reply: Reply, status: number) {
  expect(reply.status, `${reply.status} ${reply.text.slice(0, 300)}`).toBe(status);
}

for (const entry of targets) {
  describe.skipIf(entry.skip !== null)(`GitHub contract: ${entry.name}`, () => {
    let t: ContractTarget;
    let bot = "";
    let operator = "";
    const issues: number[] = [];
    const labels: string[] = [];

    const github = (
      method: string,
      suffix: string,
      options: Parameters<ContractTarget["github"]>[2] = {},
    ) => t.github(method, t.path(suffix), { token: bot, ...options });

    async function createIssue(title: string, extra: Record<string, unknown> = {}) {
      const reply = await github("POST", "/issues", {
        json: { title: `${title} ${TAG}`, ...extra },
      });
      expectStatus(reply, 201);
      issues.push(reply.json.number);
      return reply.json;
    }

    async function createLabel(name: string, color = "ff0000") {
      const full = `${TAG}:${name}`;
      const reply = await github("POST", "/labels", {
        json: { name: full, color, description: "contract" },
      });
      expectStatus(reply, 201);
      labels.push(full);
      return reply.json;
    }

    beforeAll(async () => {
      t = await entry.make();
      bot = await t.botToken();
      operator = t.operatorToken();
    }, 60_000);

    afterAll(async () => {
      if (!t) return;
      for (const number of issues) {
        await github("PATCH", `/issues/${number}`, {
          json: { state: "closed", state_reason: "not_planned" },
        });
      }
      for (const name of labels) await github("DELETE", `/labels/${encodeURIComponent(name)}`);
    }, 60_000);

    describe("the Bot's credentials", () => {
      it("exchanges a JWT for an installation token", async () => {
        const reply = await t.github(
          "POST",
          `/app/installations/${t.installationId}/access_tokens`,
          {
            token: t.signJwt(),
          },
        );
        expectStatus(reply, 201);
        expect(reply.json.token).toEqual(expect.stringMatching(/^ghs_/));
        expect(Date.parse(reply.json.expires_at)).not.toBeNaN();
        expect(reply.json.permissions).toEqual({ issues: "write", metadata: "read" });
        expect(reply.json.repository_selection).toBe("selected");
      });

      it("refuses a bad, a missing and a wrongly issued JWT, with GitHub's own messages", async () => {
        const path = `/app/installations/${t.installationId}/access_tokens`;
        const now = Math.floor(Date.now() / 1000);
        const valid = t.signJwt();
        const tampered = `${valid.slice(0, valid.lastIndexOf(".") + 1)}${valid.endsWith("A") ? "B" : "A"}${valid.slice(valid.lastIndexOf(".") + 2)}`;
        const cases: [string, string | undefined, number, string][] = [
          ["garbage", "garbage", 401, "Bad credentials"],
          ["two segments", "a.b", 401, "Bad credentials"],
          ["no credentials", undefined, 401, "Requires authentication"],
          [
            "expired",
            t.signJwt({ iat: 1_000_000_000, exp: 1_000_000_500 }),
            401,
            "Bad credentials",
          ],
          [
            "valid for too long",
            t.signJwt({ exp: now + 1200 }),
            401,
            "'Expiration time' claim ('exp') is too far in the future",
          ],
          [
            "issued in the future",
            t.signJwt({ iat: now + 3000, exp: now + 3300 }),
            401,
            "Bad credentials",
          ],
          ["wrong signature", tampered, 401, "A JSON web token could not be decoded"],
          ["another App's id", t.signJwt({ iss: "1" }), 404, "Integration not found"],
        ];
        for (const [name, token, status, message] of cases) {
          const reply = await t.github("POST", path, token === undefined ? {} : { token });
          expect([name, reply.status, reply.json?.message]).toEqual([name, status, message]);
        }
        const elsewhere = await t.github("POST", "/app/installations/1/access_tokens", {
          token: valid,
        });
        expectStatus(elsewhere, 404);
        const app = await t.github("GET", "/app", { token: valid });
        expectStatus(app, 200);
        expect(app.json).toMatchObject({ id: t.appId });
        expect(app.json.slug).toEqual(expect.any(String));
        expect(app.json.client_id).toEqual(expect.any(String));
      });

      it("answers an unknown token 401 and shows the Bot no repo permissions", async () => {
        const unknown = await t.github("GET", t.path(), { token: "ghs_notatoken" });
        expectStatus(unknown, 401);
        expect(unknown.json.message).toBe("Bad credentials");
        const repo = await github("GET", "");
        expectStatus(repo, 200);
        expect(repo.json.name).toBe(t.repo);
        // The installation token carries the permission in the token, not in the repo's `permissions`.
        expect(repo.json.permissions).toEqual({
          admin: false,
          maintain: false,
          push: false,
          triage: false,
          pull: false,
        });
      });

      it("shows the operator's own token its role as the repo `permissions` object", async () => {
        const reply = await t.github("GET", t.path(), { token: operator });
        expectStatus(reply, 200);
        expect(reply.json.permissions).toEqual({
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        });
      });
    });

    describe("issues and the fenced body", () => {
      it("creates an issue with labels, creating a label that does not exist, and lists labels by name", async () => {
        const known = await createLabel("known", "0000ff");
        const unknownName = `${TAG}:unknown`;
        labels.push(unknownName);
        const body = `**Category**\n${encodeFence("hello")}\n`;
        const issue = await createIssue("labels", { body, labels: [unknownName, known.name] });
        expect(issue.state).toBe("open");
        expect(issue.state_reason).toBeNull();
        expect(issue.body).toBe(body);
        expect(issue.assignees).toEqual([]);
        // Labels come back sorted by name, whatever the order they were sent in.
        expect(issue.labels.map((label: { name: string }) => label.name)).toEqual(
          [known.name, unknownName].sort(),
        );
        const created = issue.labels.find((label: { name: string }) => label.name === unknownName);
        expect(created).toMatchObject({ color: "ededed", description: null, default: false });
        expect(typeof created.id).toBe("number");
      });

      it("refuses an issue without a title with 422", async () => {
        const reply = await github("POST", "/issues", { json: {} });
        expectStatus(reply, 422);
        expect(typeof reply.json.message).toBe("string");
        expectStatus(await github("GET", "/issues/99999999"), 404);
      });

      it("round-trips every fenced test text byte for byte, and renders it inert", async () => {
        for (const text of FENCED_TEXTS) {
          const body = `**Description**\n${encodeFence(text)}\n`;
          const issue = await createIssue("roundtrip", { body });
          const raw = await github("GET", `/issues/${issue.number}`);
          expect(raw.json.body).toBe(body);

          const rendered = await github("GET", `/issues/${issue.number}`, {
            headers: { accept: "application/vnd.github.full+json" },
          });
          expectStatus(rendered, 200);
          expect(rendered.json.body).toBe(body);
          const html: string = rendered.json.body_html;
          expect(html).toContain("<pre");
          expect(html).not.toMatch(/<a[\s>]/);
          expect(html).not.toContain("user-mention");
          expect(html).not.toContain("<script");
          // The text is inside the code block, its HTML metacharacters escaped.
          const escaped = text
            .split("\n")[0]!
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          expect(html).toContain(escaped);
        }
      });

      it("renders a Reporter comment's fence inert, as the Bot posts it", async () => {
        const issue = await createIssue("comment fence");
        for (const text of FENCED_TEXTS) {
          const body = `**Reporter:**\n\n${encodeFence(text)}`;
          const comment = await github("POST", `/issues/${issue.number}/comments`, {
            json: { body },
          });
          expectStatus(comment, 201);
          expect(comment.json.body).toBe(body);
          const rendered = await github("GET", `/issues/comments/${comment.json.id}`, {
            headers: { accept: "application/vnd.github.full+json" },
          });
          expectStatus(rendered, 200);
          expect(rendered.json.body).toBe(body);
          const html: string = rendered.json.body_html;
          expect(html).toContain("<pre");
          expect(html).not.toMatch(/<a[\s>]/);
          expect(html).not.toContain("user-mention");
        }
        const timeline = await github("GET", `/issues/${issue.number}/timeline`);
        expect(timeline.json.map((e: { event: string }) => e.event)).not.toContain("mentioned");
        expect(timeline.json.map((e: { event: string }) => e.event)).not.toContain(
          "cross-referenced",
        );
      });
    });

    describe("Bot identity", () => {
      it("marks issues and comments as the Bot's: type, id, login, performed_via_github_app", async () => {
        const issue = await createIssue("identity");
        expect(issue.user).toMatchObject({ type: "Bot" });
        expect(issue.user.login).toMatch(/\[bot\]$/);
        expect(typeof issue.user.id).toBe("number");
        // GitHub leaves the App off the issue itself but names it on every comment.
        expect(issue.performed_via_github_app).toBeNull();

        const comment = await github("POST", `/issues/${issue.number}/comments`, {
          json: { body: "hello" },
        });
        expectStatus(comment, 201);
        expect(comment.json.user).toEqual(
          expect.objectContaining({
            type: "Bot",
            id: issue.user.id,
            login: issue.user.login,
          }),
        );
        expect(comment.json.performed_via_github_app).toMatchObject({ id: t.appId });
        expect(comment.json.performed_via_github_app.slug).toBe(
          issue.user.login.replace(/\[bot\]$/, ""),
        );
        expect(comment.json.issue_url).toMatch(new RegExp(`/issues/${issue.number}$`));
        expect(comment.json.html_url).toContain(`#issuecomment-${comment.json.id}`);
        expect(comment.json.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

        // Staff see the same author when they read the issue with their own token.
        const asOperator = await t.github("GET", t.path(`/issues/${issue.number}`), {
          token: operator,
        });
        expect(asOperator.json.user).toMatchObject({ type: "Bot", id: issue.user.id });
      });
    });

    describe("comments", () => {
      it("lists per issue and repo-wide, paginated with Link and filtered by since", async () => {
        const issue = await createIssue("comments");
        const ids: number[] = [];
        for (const text of ["c1", "c2", "c3", "c4", "c5"]) {
          const reply = await github("POST", `/issues/${issue.number}/comments`, {
            json: { body: text },
          });
          ids.push(reply.json.id);
        }

        const first = await github("GET", `/issues/${issue.number}/comments`, {
          query: { per_page: 2 },
        });
        expectStatus(first, 200);
        expect(first.json.map((c: { body: string }) => c.body)).toEqual(["c1", "c2"]);
        const link = first.headers.get("link") ?? "";
        expect(link).toMatch(/rel="next"/);
        expect(link).toMatch(/rel="last"/);

        // Follow `next` verbatim, as the Bot client does, to the end.
        const bodies = first.json.map((c: { body: string }) => c.body);
        let next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
        let pages = 1;
        while (next) {
          const target = t.kind === "fake" ? next.replace(/^https?:\/\/[^/]+\/github/, "") : next;
          const page = await t.github("GET", target, { token: bot });
          expectStatus(page, 200);
          bodies.push(...page.json.map((c: { body: string }) => c.body));
          next = /<([^>]+)>;\s*rel="next"/.exec(page.headers.get("link") ?? "")?.[1];
          pages += 1;
        }
        expect(bodies).toEqual(["c1", "c2", "c3", "c4", "c5"]);
        expect(pages).toBe(3);

        // `since`: the second comment's own timestamp includes it and everything later, never the first
        // unless they share a second; the future includes nothing.
        const all = await github("GET", `/issues/${issue.number}/comments`);
        const stamp = all.json[4].updated_at;
        const recent = await github("GET", `/issues/${issue.number}/comments`, {
          query: { since: stamp },
        });
        expect(recent.json.map((c: { body: string }) => c.body)).toContain("c5");
        const future = await github("GET", `/issues/${issue.number}/comments`, {
          query: { since: "2999-01-01T00:00:00Z" },
        });
        expect(future.json).toEqual([]);

        // Repo-wide, with the same `since`: every hit is a comment on some issue of this repo.
        const repoWide = await github("GET", "/issues/comments", {
          query: { since: stamp, per_page: 100, sort: "created", direction: "asc" },
        });
        expectStatus(repoWide, 200);
        const mine = repoWide.json.filter((c: { id: number }) => ids.includes(c.id));
        expect(mine.length).toBeGreaterThanOrEqual(1);
        for (const comment of repoWide.json) {
          expect(comment.issue_url).toMatch(/\/issues\/\d+$/);
          expect(Date.parse(comment.updated_at)).toBeGreaterThanOrEqual(Date.parse(stamp));
        }
        expect((await github("GET", `/issues/${issue.number}`)).json.comments).toBe(5);
      });
    });

    describe("labels", () => {
      it("creates, reads, recolours and renames a label, and refuses a duplicate with 422", async () => {
        const label = await createLabel("recolour", "ff0000");
        expect(label).toMatchObject({ color: "ff0000", description: "contract", default: false });
        const duplicate = await github("POST", "/labels", {
          json: { name: label.name, color: "ff0000" },
        });
        expectStatus(duplicate, 422);
        expect(duplicate.json.errors[0]).toMatchObject({
          resource: "Label",
          code: "already_exists",
          field: "name",
        });

        const recoloured = await github("PATCH", `/labels/${encodeURIComponent(label.name)}`, {
          json: { color: "00ff00" },
        });
        expectStatus(recoloured, 200);
        expect(recoloured.json).toMatchObject({
          id: label.id,
          color: "00ff00",
          description: "contract",
        });

        const renamed = `${TAG}:renamed`;
        labels[labels.indexOf(label.name)] = renamed;
        const rename = await github("PATCH", `/labels/${encodeURIComponent(label.name)}`, {
          json: { new_name: renamed },
        });
        expectStatus(rename, 200);
        expect(rename.json.name).toBe(renamed);
        expectStatus(await github("GET", `/labels/${encodeURIComponent(label.name)}`), 404);
        const read = await github("GET", `/labels/${encodeURIComponent(renamed)}`);
        expectStatus(read, 200);
        expect(read.json.color).toBe("00ff00");
        const listed = await github("GET", "/labels", { query: { per_page: 100 } });
        expect(listed.json.map((l: { name: string }) => l.name)).toContain(renamed);
      });
    });

    describe("timeline events, close and reopen", () => {
      it("shapes the events for labelling, assigning, renaming, closing (each reason) and reopening", async () => {
        const one = await createLabel("tl-one");
        const two = await createLabel("tl-two");
        const me = await t.github("GET", "/user", { token: operator });
        expectStatus(me, 200);
        const assignee: string = me.json.login;

        const original = await createIssue("original");
        const issue = await createIssue("timeline", { labels: [one.name] });
        const n = issue.number;

        // Assign, rename, and swap the labels in one PATCH each.
        expectStatus(
          await github("PATCH", `/issues/${n}`, { json: { assignees: [assignee] } }),
          200,
        );
        const rename = await github("PATCH", `/issues/${n}`, { json: { title: `renamed ${TAG}` } });
        expectStatus(rename, 200);
        const swap = await github("PATCH", `/issues/${n}`, { json: { labels: [two.name] } });
        expect(swap.json.labels.map((l: { name: string }) => l.name)).toEqual([two.name]);

        // Close with each reason, reopen in between.
        const closes: [Record<string, unknown>, string | null][] = [
          [{ state_reason: "completed" }, "completed"],
          [{ state_reason: "not_planned" }, "not_planned"],
          [{ state_reason: "duplicate", duplicate_issue_id: original.id }, "duplicate"],
        ];
        const closedTimeline: (string | null)[] = [];
        for (const [extra, reason] of closes) {
          const closed = await github("PATCH", `/issues/${n}`, {
            json: { state: "closed", ...extra },
          });
          expectStatus(closed, 200);
          expect(closed.json).toMatchObject({ state: "closed", state_reason: reason });
          expect(typeof closed.json.closed_at).toBe("string");
          const reopened = await github("PATCH", `/issues/${n}`, { json: { state: "open" } });
          expect(reopened.json).toMatchObject({
            state: "open",
            state_reason: "reopened",
            closed_at: null,
          });
          closedTimeline.push(reason);
        }

        // A single PATCH closes and swaps the label at once, and reopening swaps it back.
        const single = await github("PATCH", `/issues/${n}`, {
          json: { state: "closed", state_reason: "completed", labels: [one.name] },
        });
        expect(single.json.state).toBe("closed");
        expect(single.json.labels.map((l: { name: string }) => l.name)).toEqual([one.name]);
        const back = await github("PATCH", `/issues/${n}`, {
          json: { state: "open", labels: [two.name] },
        });
        expect(back.json.state).toBe("open");
        expect(back.json.labels.map((l: { name: string }) => l.name)).toEqual([two.name]);

        expectStatus(
          await github("PATCH", `/issues/${n}`, {
            json: { state: "closed", state_reason: "bogus" },
          }),
          422,
        );
        expectStatus(
          await github("PATCH", `/issues/${n}`, {
            json: { state: "closed", state_reason: "duplicate", duplicate_issue_id: 999 },
          }),
          422,
        );

        const timeline = await github("GET", `/issues/${n}/timeline`, { query: { per_page: 100 } });
        expectStatus(timeline, 200);
        const events: Record<string, any>[] = timeline.json;
        const of = (name: string) => events.filter((e) => e.event === name);

        for (const event of events) {
          expect(typeof event.event).toBe("string");
          expect(Date.parse(event.created_at)).not.toBeNaN();
          expect(event.performed_via_github_app ?? null).toBeNull();
          if (event.event !== "commented") expect(event.actor).toMatchObject({ type: "Bot" });
        }
        expect(of("labeled").map((e) => e.label.name)).toEqual([
          one.name,
          two.name,
          one.name,
          two.name,
        ]);
        expect(of("labeled")[0]!.label).toEqual({ name: one.name, color: "ff0000" });
        expect(of("unlabeled").map((e) => e.label.name)).toEqual([one.name, two.name, one.name]);
        expect(of("assigned")).toHaveLength(1);
        expect(of("assigned")[0]!.assignee.login).toBe(assignee);
        expect(of("renamed")[0]!.rename).toEqual({ from: `timeline ${TAG}`, to: `renamed ${TAG}` });
        // `completed` is the default reason: its `closed` event carries none, unlike the issue itself.
        expect(of("closed").map((e) => e.state_reason)).toEqual([
          null,
          "not_planned",
          "duplicate",
          null,
        ]);
        expect(of("reopened").map((e) => e.state_reason)).toEqual([
          "reopened",
          "reopened",
          "reopened",
          "reopened",
        ]);

        // The issue the duplicate points at gets its own event.
        const originalTimeline = await github("GET", `/issues/${original.number}/timeline`);
        expect(originalTimeline.json.map((e: { event: string }) => e.event)).toContain(
          "marked_as_duplicate",
        );
      });
    });

    describe("search", () => {
      it("finds an issue by title word, label and state qualifiers, scoped to the repo", async () => {
        const tag = await createLabel("search-hit", "0052cc");
        const hit = await createIssue("searchable", { labels: [tag.name] });
        const closed = await createIssue("searchable", { labels: [tag.name] });
        expectStatus(
          await github("PATCH", `/issues/${closed.number}`, {
            json: { state: "closed", state_reason: "not_planned" },
          }),
          200,
        );
        const query = `repo:${t.org}/${t.repo} is:issue is:open label:"${tag.name}" ${TAG}`;
        let found: number[] = [];
        // GitHub's index lags a few seconds behind the write.
        for (let attempt = 0; attempt < 15 && !found.includes(hit.number); attempt += 1) {
          const reply = await t.github("GET", "/search/issues", {
            token: bot,
            query: { q: query, sort: "created", order: "asc" },
          });
          expectStatus(reply, 200);
          expect(reply.json).toMatchObject({ incomplete_results: false });
          found = reply.json.items.map((i: { number: number }) => i.number);
          if (!found.includes(hit.number)) await new Promise((r) => setTimeout(r, 2000));
        }
        expect(found).toContain(hit.number);
        expect(found).not.toContain(closed.number);
      }, 60_000);
    });

    describe("device flow, without approval", () => {
      const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

      it("answers an unknown client id with 404", async () => {
        const reply = await t.web("POST", "/login/device/code", { client_id: "Iv1.nonexistent" });
        expectStatus(reply, 404);
        expect(reply.json).toEqual({ error: "Not Found" });
        const token = await t.web("POST", "/login/oauth/access_token", {
          client_id: "Iv1.nonexistent",
          device_code: "x",
          grant_type: GRANT,
        });
        expectStatus(token, 404);
      });

      it("hands out a code, then answers pending, slow_down and incorrect_device_code", async () => {
        const code = await t.web("POST", "/login/device/code", { client_id: t.staffClientId });
        expectStatus(code, 200);
        expect(code.json).toMatchObject({
          verification_uri: "https://github.com/login/device",
          interval: 5,
        });
        expect(code.json.expires_in).toBeGreaterThanOrEqual(895);
        expect(code.json.expires_in).toBeLessThanOrEqual(900);
        expect(code.json.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        expect(code.json.device_code).toMatch(/^[0-9a-f]{40}$/);

        const poll = (device_code: string) =>
          t.web("POST", "/login/oauth/access_token", {
            client_id: t.staffClientId,
            device_code,
            grant_type: GRANT,
          });
        const pending = await poll(code.json.device_code);
        expectStatus(pending, 200);
        expect(pending.json.error).toBe("authorization_pending");
        expect(typeof pending.json.error_description).toBe("string");
        const tooFast = await poll(code.json.device_code);
        expect(tooFast.json).toMatchObject({ error: "slow_down", interval: 10 });
        const unknown = await poll("0".repeat(40));
        expect(unknown.json.error).toBe("incorrect_device_code");
      });

      it("answers a wrong grant type, a missing code and a refresh without a secret incorrect_client_credentials", async () => {
        const base = { client_id: t.staffClientId };
        const wrongGrant = await t.web("POST", "/login/oauth/access_token", {
          ...base,
          device_code: "x",
          grant_type: "password",
        });
        expect(wrongGrant.json.error).toBe("incorrect_client_credentials");
        const noGrant = await t.web("POST", "/login/oauth/access_token", {
          ...base,
          device_code: "x",
        });
        expect(noGrant.json.error).toBe("incorrect_client_credentials");
        // GitHub refuses an unknown refresh token this way, not with `bad_refresh_token`.
        const refresh = await t.web("POST", "/login/oauth/access_token", {
          ...base,
          grant_type: "refresh_token",
          refresh_token: `ghr_${"a".repeat(36)}`,
        });
        expectStatus(refresh, 200);
        expect(refresh.json.error).toBe("incorrect_client_credentials");
      });
    });
  });
}

describe("the live half", () => {
  it.skipIf(!("skip" in live))(`is skipped cleanly without credentials`, () => {
    expect("skip" in live ? live.skip : "").toBeTruthy();
  });
});
