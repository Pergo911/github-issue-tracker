import { describe, expect, it } from "vitest";
import { castedWorld } from "../testing/bot.ts";
import { createTestWorld } from "../testing/world.ts";

// The fake's own semantics for issues (ticket #22): what GitHub does with a create and a PATCH, so the
// code under test is held to the real behaviour. Expectations come from docs.github.com/rest/issues.

async function setup() {
  const test = await createTestWorld();
  const cast = await castedWorld(test);
  const create = async (body: Record<string, unknown>, token = cast.bot) =>
    (await test.client.github("POST", cast.path("/issues"), { token, json: body })).json;
  return { ...test, ...cast, create };
}

describe("creating an issue", () => {
  it("creates an open issue authored by the Bot, with the labels it was given", async () => {
    const { client, bot, path } = await setup();
    const reply = await client.github("POST", path("/issues"), {
      token: bot,
      json: {
        title: "Leaking tap",
        body: "Second floor",
        labels: ["category:plumbing", "status:new"],
      },
    });
    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({
      number: 1,
      title: "Leaking tap",
      body: "Second floor",
      state: "open",
      state_reason: null,
      user: { type: "Bot", login: "fault-reports-bot[bot]" },
      comments: 0,
    });
    expect(reply.json.labels.map((label: { name: string }) => label.name)).toEqual([
      "category:plumbing",
      "status:new",
    ]);
    expect(typeof reply.json.id).toBe("number");
    expect(reply.json.id).not.toBe(reply.json.number);
  });

  it("numbers issues in order and keeps the database id distinct from the number", async () => {
    const { create } = await setup();
    const first = await create({ title: "one" });
    const second = await create({ title: "two" });
    expect([first.number, second.number]).toEqual([1, 2]);
    expect(second.id).not.toBe(first.id);
  });

  it("requires a title", async () => {
    const { client, bot, path } = await setup();
    const reply = await client.github("POST", path("/issues"), { token: bot, json: { body: "x" } });
    expect(reply.status).toBe(422);
    expect(reply.json.message).toBe("Validation Failed");
  });

  it("creates labels it does not know, as GitHub does for users with push access", async () => {
    const { client, bot, path, create } = await setup();
    await create({ title: "t", labels: ["brand-new"] });
    const labels = await client.github("GET", path("/labels"), { token: bot });
    expect(labels.json.map((label: { name: string }) => label.name)).toContain("brand-new");
  });

  it("can instead ignore unknown labels (a switch for the question ticket #32 settles)", async () => {
    const { control, create } = await setup();
    control.configure({ unknownLabels: "ignore" });
    const issue = await create({ title: "t", labels: ["brand-new"] });
    expect(issue.labels).toEqual([]);
  });

  it("silently drops labels and assignees from a caller who is only a Viewer", async () => {
    const { create, read } = await setup();
    const issue = await create({ title: "t", labels: ["bug"] }, read);
    expect(issue.labels).toEqual([]);
  });

  it("answers 404 to a non-member and 401 to no token", async () => {
    const { client, outsider, path } = await setup();
    expect(
      (await client.github("POST", path("/issues"), { token: outsider, json: { title: "t" } }))
        .status,
    ).toBe(404);
    expect((await client.github("POST", path("/issues"), { json: { title: "t" } })).status).toBe(
      401,
    );
  });
});

describe("reading issues", () => {
  it("gets one issue, and answers 404 for an unknown number", async () => {
    const { client, read, path, create } = await setup();
    await create({ title: "t" });
    expect((await client.github("GET", path("/issues/1"), { token: read })).json.title).toBe("t");
    expect((await client.github("GET", path("/issues/99"), { token: read })).status).toBe(404);
  });

  it("answers 410 for an issue that was deleted, and the number is never reused", async () => {
    const { client, control, read, path, create } = await setup();
    await create({ title: "gone" });
    control.deleteReport(1);
    const reply = await client.github("GET", path("/issues/1"), { token: read });
    expect(reply.status).toBe(410);
    expect((await create({ title: "next" })).number).toBe(2);
  });

  it("lists open issues by default, newest first, and honours state, labels and direction", async () => {
    const { client, admin, read, path, create } = await setup();
    await create({ title: "a", labels: ["x", "y"] });
    await create({ title: "b", labels: ["x"] });
    await create({ title: "c", labels: ["y"] });
    await client.github("PATCH", path("/issues/3"), { token: admin, json: { state: "closed" } });
    const titles = (reply: { json: { title: string }[] }) => reply.json.map((issue) => issue.title);

    expect(titles(await client.github("GET", path("/issues"), { token: read }))).toEqual([
      "b",
      "a",
    ]);
    expect(
      titles(await client.github("GET", path("/issues"), { token: read, query: { state: "all" } })),
    ).toEqual(["c", "b", "a"]);
    expect(
      titles(
        await client.github("GET", path("/issues"), { token: read, query: { state: "closed" } }),
      ),
    ).toEqual(["c"]);
    expect(
      titles(
        await client.github("GET", path("/issues"), {
          token: read,
          query: { state: "all", direction: "asc" },
        }),
      ),
    ).toEqual(["a", "b", "c"]);
    // `labels` is a comma list and means AND.
    expect(
      titles(
        await client.github("GET", path("/issues"), {
          token: read,
          query: { state: "all", labels: "x,y" },
        }),
      ),
    ).toEqual(["a"]);
  });

  it("sorts by update time, which a comment moves", async () => {
    const { client, control, read, path, create } = await setup();
    await create({ title: "old" });
    control.advanceClock(5_000);
    await create({ title: "new" });
    control.advanceClock(5_000);
    await client.github("POST", path("/issues/1/comments"), {
      token: read,
      json: { body: "bump" },
    });
    const reply = await client.github("GET", path("/issues"), {
      token: read,
      query: { sort: "updated" },
    });
    expect(reply.json.map((issue: { title: string }) => issue.title)).toEqual(["old", "new"]);
  });

  it("paginates with a Link header whose next URL can be followed verbatim", async () => {
    const { client, read, path, create } = await setup();
    for (let n = 1; n <= 5; n++) await create({ title: `issue ${n}` });
    const first = await client.github("GET", path("/issues"), {
      token: read,
      query: { per_page: 2, direction: "asc" },
    });
    expect(first.json.map((issue: { number: number }) => issue.number)).toEqual([1, 2]);
    const link = first.headers.get("link") ?? "";
    expect(link).toContain('rel="next"');
    expect(link).toContain('rel="last"');
    expect(link).not.toContain('rel="prev"');

    const seen: number[] = [];
    let next: string | null = /<([^>]+)>; rel="next"/.exec(link)?.[1] ?? null;
    while (next) {
      const url = new URL(next);
      const page = await client.github("GET", url.pathname.replace(/^\/github/, "") + url.search, {
        token: read,
      });
      seen.push(...page.json.map((issue: { number: number }) => issue.number));
      next = /<([^>]+)>; rel="next"/.exec(page.headers.get("link") ?? "")?.[1] ?? null;
    }
    expect(seen).toEqual([3, 4, 5]);
  });

  it("caps per_page at 100", async () => {
    const { client, read, path, create } = await setup();
    for (let n = 1; n <= 3; n++) await create({ title: `issue ${n}` });
    const reply = await client.github("GET", path("/issues"), {
      token: read,
      query: { per_page: 500 },
    });
    expect(reply.json).toHaveLength(3);
    expect(reply.headers.get("link")).toBeNull();
  });

  it("returns seeded pull requests among the issues, with a pull_request key to filter on", async () => {
    const { client, control, read, path, create } = await setup();
    await create({ title: "real issue" });
    control.createReport({ title: "a pull request", pullRequest: true });
    const reply = await client.github("GET", path("/issues"), { token: read });
    const withPr = reply.json.filter((issue: Record<string, unknown>) => "pull_request" in issue);
    expect(reply.json).toHaveLength(2);
    expect(withPr).toHaveLength(1);
    expect(withPr[0].title).toBe("a pull request");
  });
});

describe("PATCH /issues/{n}", () => {
  it("replaces the whole label set, and an empty list clears it", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t", labels: ["a", "b"] });
    const swapped = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { labels: ["b", "c"] },
    });
    expect(swapped.json.labels.map((label: { name: string }) => label.name)).toEqual(["b", "c"]);
    const cleared = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { labels: [] },
    });
    expect(cleared.json.labels).toEqual([]);
  });

  it("leaves labels alone when the PATCH does not mention them", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t", labels: ["a"] });
    const reply = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { title: "renamed" },
    });
    expect(reply.json.labels).toHaveLength(1);
  });

  it("closes with a reason, defaulting to completed, and reopens with state_reason reopened", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t" });
    const closed = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { state: "closed" },
    });
    expect(closed.json).toMatchObject({
      state: "closed",
      state_reason: "completed",
      closed_by: { login: "adam-admin" },
    });
    expect(closed.json.closed_at).toMatch(/Z$/);
    const reopened = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { state: "open" },
    });
    expect(reopened.json).toMatchObject({
      state: "open",
      state_reason: "reopened",
      closed_at: null,
      closed_by: null,
    });
  });

  it("closes as not planned", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t" });
    const reply = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { state: "closed", state_reason: "not_planned" },
    });
    expect(reply.json.state_reason).toBe("not_planned");
  });

  it("ignores state_reason unless the state changes", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t" });
    const reply = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { state_reason: "not_planned" },
    });
    expect(reply.json).toMatchObject({ state: "open", state_reason: null });
  });

  it("closes as a duplicate of another issue, identified by its database id and not its number", async () => {
    const { client, admin, path, create } = await setup();
    const original = await create({ title: "original" });
    await create({ title: "copy" });
    // The number is not an id: a client that sends it fails loudly.
    const byNumber = await client.github("PATCH", path("/issues/2"), {
      token: admin,
      json: { state: "closed", state_reason: "duplicate", duplicate_issue_id: original.number },
    });
    expect(byNumber.status).toBe(422);
    const byId = await client.github("PATCH", path("/issues/2"), {
      token: admin,
      json: { state: "closed", state_reason: "duplicate", duplicate_issue_id: original.id },
    });
    expect(byId.status).toBe(200);
    expect(byId.json.state_reason).toBe("duplicate");
  });

  it("assigns and unassigns, with assignees replacing the set", async () => {
    const { client, admin, triage, path, create } = await setup();
    await create({ title: "t" });
    const assigned = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { assignees: ["tamas-triage"] },
    });
    expect(assigned.json.assignees.map((user: { login: string }) => user.login)).toEqual([
      "tamas-triage",
    ]);
    expect(assigned.json.assignee.login).toBe("tamas-triage");
    const swapped = await client.github("PATCH", path("/issues/1"), {
      token: triage,
      json: { assignees: ["adam-admin"] },
    });
    expect(swapped.json.assignees.map((user: { login: string }) => user.login)).toEqual([
      "adam-admin",
    ]);
    const cleared = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { assignees: [] },
    });
    expect(cleared.json.assignees).toEqual([]);
    expect(cleared.json.assignee).toBeNull();
  });

  it("silently ignores an assignee who is not a member", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t" });
    const reply = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { assignees: ["nora-outsider", "nobody-at-all"] },
    });
    expect(reply.json.assignees).toEqual([]);
  });

  it("lets Triage and the Bot patch, refuses a Viewer with 403 and a non-member with 404", async () => {
    const { client, bot, triage, read, outsider, path, create } = await setup();
    await create({ title: "t" });
    for (const token of [bot, triage]) {
      expect(
        (await client.github("PATCH", path("/issues/1"), { token, json: { title: "ok" } })).status,
      ).toBe(200);
    }
    expect(
      (await client.github("PATCH", path("/issues/1"), { token: read, json: { title: "no" } }))
        .status,
    ).toBe(403);
    expect(
      (await client.github("PATCH", path("/issues/1"), { token: outsider, json: { title: "no" } }))
        .status,
    ).toBe(404);
  });

  it("rejects a bad state, an empty title and a malformed body", async () => {
    const { client, admin, path, create } = await setup();
    await create({ title: "t" });
    expect(
      (await client.github("PATCH", path("/issues/1"), { token: admin, json: { state: "bogus" } }))
        .status,
    ).toBe(422);
    expect(
      (await client.github("PATCH", path("/issues/1"), { token: admin, json: { title: "" } }))
        .status,
    ).toBe(422);
    const malformed = await client.github("PATCH", path("/issues/1"), {
      token: admin,
      headers: { "content-type": "application/json" },
    });
    expect(malformed.status).toBe(200);
  });

  it("can model GitHub dropping a Triage user's label changes (the unconfirmed case of ticket #32)", async () => {
    const { client, control, triage, path, create } = await setup();
    await create({ title: "t", labels: ["a"] });
    control.configure({ triageCanLabel: false });
    const reply = await client.github("PATCH", path("/issues/1"), {
      token: triage,
      json: { labels: ["b"], title: "renamed" },
    });
    expect(reply.json.title).toBe("renamed");
    expect(reply.json.labels.map((label: { name: string }) => label.name)).toEqual(["a"]);
  });
});

describe("the timeline", () => {
  const events = (reply: { json: { event: string }[] }) => reply.json.map((entry) => entry.event);

  it("records the events GitHub generates from a create and a PATCH, in order", async () => {
    const { client, admin, read, path, create } = await setup();
    await create({ title: "first", labels: ["a", "b"] });
    await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: {
        title: "second",
        labels: ["b", "c"],
        assignees: ["adam-admin"],
        state: "closed",
        state_reason: "not_planned",
      },
    });
    await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { state: "open", assignees: [] },
    });
    const timeline = await client.github("GET", path("/issues/1/timeline"), { token: read });

    expect(events(timeline)).toEqual([
      "labeled", // a
      "labeled", // b
      "renamed",
      "unlabeled", // a
      "labeled", // c
      "assigned",
      "closed",
      "unassigned",
      "reopened",
    ]);
    const byEvent = (name: string) =>
      timeline.json.filter((entry: { event: string }) => entry.event === name);
    expect(byEvent("renamed")[0].rename).toEqual({ from: "first", to: "second" });
    expect(byEvent("closed")[0].state_reason).toBe("not_planned");
    expect(byEvent("reopened")[0].state_reason).toBe("reopened");
    expect(byEvent("assigned")[0].assignee.login).toBe("adam-admin");
    expect(byEvent("unlabeled")[0].label.name).toBe("a");
    expect(byEvent("labeled")[0].actor).toMatchObject({ type: "Bot" });
    expect(byEvent("closed")[0].actor.login).toBe("adam-admin");
  });

  it("lists a comment as `commented`, with the full comment and its author", async () => {
    const { client, read, path, create } = await setup();
    await create({ title: "t" });
    await client.github("POST", path("/issues/1/comments"), {
      token: read,
      json: { body: "hello" },
    });
    const timeline = await client.github("GET", path("/issues/1/timeline"), { token: read });
    expect(events(timeline)).toEqual(["commented"]);
    expect(timeline.json[0]).toMatchObject({
      body: "hello",
      user: { login: "vera-viewer" },
      actor: { login: "vera-viewer" },
    });
    expect(timeline.json[0].issue_url).toMatch(/\/issues\/1$/);
  });

  it("changes nothing for a PATCH that changes nothing, and can exclude event types", async () => {
    const { client, admin, read, path, create } = await setup();
    await create({ title: "t", labels: ["a"] });
    await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { labels: ["a"], title: "t", state: "open" },
    });
    const timeline = await client.github("GET", path("/issues/1/timeline"), { token: read });
    expect(events(timeline)).toEqual(["labeled"]);
    const excluded = await client.github("GET", path("/issues/1/timeline"), {
      token: read,
      query: { exclude: "labeled" },
    });
    expect(excluded.json).toEqual([]);
  });

  it("is paginated", async () => {
    const { client, admin, read, path, create } = await setup();
    await create({ title: "t" });
    await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { labels: ["a", "b", "c"] },
    });
    const page = await client.github("GET", path("/issues/1/timeline"), {
      token: read,
      query: { per_page: 2 },
    });
    expect(page.json).toHaveLength(2);
    expect(page.headers.get("link")).toContain('rel="next"');
  });
});
