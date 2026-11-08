import { describe, expect, it } from "vitest";
import { castedWorld } from "../testing/bot.ts";
import { createTestWorld } from "../testing/world.ts";

async function setup() {
  const test = await createTestWorld();
  const cast = await castedWorld(test);
  const create = async (body: Record<string, unknown>) =>
    (await test.client.github("POST", cast.path("/issues"), { token: cast.bot, json: body })).json;
  const comment = async (number: number, body: string, token = cast.bot) =>
    (
      await test.client.github("POST", cast.path(`/issues/${number}/comments`), {
        token,
        json: { body },
      })
    ).json;
  return { ...test, ...cast, create, comment };
}

describe("comments", () => {
  it("creates a comment as the caller, and the issue counts it", async () => {
    const { client, read, path, create } = await setup();
    await create({ title: "t" });
    const reply = await client.github("POST", path("/issues/1/comments"), {
      token: read,
      json: { body: "A viewer's remark" },
    });
    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({
      body: "A viewer's remark",
      user: { login: "vera-viewer", type: "User" },
    });
    expect(reply.json.issue_url).toMatch(/\/repos\/fake-org\/reports\/issues\/1$/);
    expect((await client.github("GET", path("/issues/1"), { token: read })).json.comments).toBe(1);
  });

  it("requires a body and an existing issue, and refuses a non-member", async () => {
    const { client, read, outsider, path, create } = await setup();
    await create({ title: "t" });
    expect(
      (await client.github("POST", path("/issues/1/comments"), { token: read, json: { body: "" } }))
        .status,
    ).toBe(422);
    expect(
      (
        await client.github("POST", path("/issues/9/comments"), {
          token: read,
          json: { body: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await client.github("POST", path("/issues/1/comments"), {
          token: outsider,
          json: { body: "x" },
        })
      ).status,
    ).toBe(404);
  });

  it("lists an issue's comments oldest first, filtered by `since` (updated at or after) and paginated", async () => {
    const { client, control, read, path, create, comment } = await setup();
    await create({ title: "t" });
    await comment(1, "one");
    control.advanceClock(10_000);
    const since = new Date(control.clockNow()).toISOString();
    await comment(1, "two");
    await comment(1, "three");
    const all = await client.github("GET", path("/issues/1/comments"), { token: read });
    expect(all.json.map((entry: { body: string }) => entry.body)).toEqual(["one", "two", "three"]);
    const recent = await client.github("GET", path("/issues/1/comments"), {
      token: read,
      query: { since },
    });
    expect(recent.json.map((entry: { body: string }) => entry.body)).toEqual(["two", "three"]);
    const page = await client.github("GET", path("/issues/1/comments"), {
      token: read,
      query: { per_page: 2 },
    });
    expect(page.json).toHaveLength(2);
    expect(page.headers.get("link")).toContain('rel="next"');
  });

  it("lists comments repo-wide, with sort, direction, since and pagination", async () => {
    const { client, control, read, path, create, comment } = await setup();
    await create({ title: "a" });
    await create({ title: "b" });
    await comment(1, "first");
    control.advanceClock(10_000);
    await comment(2, "second");
    control.advanceClock(10_000);
    await comment(1, "third");
    const bodies = (reply: { json: { body: string }[] }) => reply.json.map((entry) => entry.body);

    expect(bodies(await client.github("GET", path("/issues/comments"), { token: read }))).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(
      bodies(
        await client.github("GET", path("/issues/comments"), {
          token: read,
          query: { sort: "created", direction: "desc" },
        }),
      ),
    ).toEqual(["third", "second", "first"]);
    const since = new Date(control.clockNow() - 15_000).toISOString();
    expect(
      bodies(
        await client.github("GET", path("/issues/comments"), { token: read, query: { since } }),
      ),
    ).toEqual(["second", "third"]);
    const page = await client.github("GET", path("/issues/comments"), {
      token: read,
      query: { per_page: 2, page: 2 },
    });
    expect(bodies(page)).toEqual(["third"]);
    // The issue number is only in `issue_url`: there is no `issue_number` field.
    expect(page.json[0].issue_url).toMatch(/\/issues\/1$/);
    expect("issue_number" in page.json[0]).toBe(false);
  });

  it("edits a comment, which moves its updated_at but not its created_at", async () => {
    const { client, control, bot, path, create, comment } = await setup();
    await create({ title: "t" });
    const made = await comment(1, "before");
    control.advanceClock(60_000);
    const edited = await client.github("PATCH", path(`/issues/comments/${made.id}`), {
      token: bot,
      json: { body: "after" },
    });
    expect(edited.json.body).toBe("after");
    expect(edited.json.created_at).toBe(made.created_at);
    expect(edited.json.updated_at).not.toBe(made.created_at);
  });

  it("lets only the author, or Write and above, edit or delete a comment", async () => {
    const { client, bot, triage, admin, path, create, comment } = await setup();
    await create({ title: "t" });
    const made = await comment(1, "by the bot");
    expect(
      (
        await client.github("PATCH", path(`/issues/comments/${made.id}`), {
          token: triage,
          json: { body: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await client.github("DELETE", path(`/issues/comments/${made.id}`), { token: triage }))
        .status,
    ).toBe(403);
    expect(
      (
        await client.github("PATCH", path(`/issues/comments/${made.id}`), {
          token: bot,
          json: { body: "mine" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await client.github("DELETE", path(`/issues/comments/${made.id}`), { token: admin })).status,
    ).toBe(204);
  });

  it("deletes a comment from the list, the count and the timeline", async () => {
    const { client, bot, read, path, create, comment } = await setup();
    await create({ title: "t" });
    const made = await comment(1, "temporary");
    await client.github("DELETE", path(`/issues/comments/${made.id}`), { token: bot });
    expect((await client.github("GET", path("/issues/1/comments"), { token: read })).json).toEqual(
      [],
    );
    expect((await client.github("GET", path("/issues/1"), { token: read })).json.comments).toBe(0);
    expect((await client.github("GET", path("/issues/1/timeline"), { token: read })).json).toEqual(
      [],
    );
    expect(
      (await client.github("GET", path(`/issues/comments/${made.id}`), { token: read })).status,
    ).toBe(404);
  });
});

describe("labels", () => {
  it("creates, lists and fetches a label, with the colour as bare lower-case hex", async () => {
    const { client, admin, read, path } = await setup();
    const made = await client.github("POST", path("/labels"), {
      token: admin,
      json: { name: "category:plumbing", color: "#0075CA", description: "Pipes" },
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({
      name: "category:plumbing",
      color: "0075ca",
      description: "Pipes",
      default: false,
    });
    expect((await client.github("GET", path("/labels"), { token: read })).json).toHaveLength(1);
    // `:` is URL-encoded as %3A in the path.
    const fetched = await client.github("GET", path("/labels/category%3Aplumbing"), {
      token: read,
    });
    expect(fetched.json.name).toBe("category:plumbing");
  });

  it("refuses a duplicate name (any case) with GitHub's already_exists error", async () => {
    const { client, admin, path } = await setup();
    await client.github("POST", path("/labels"), { token: admin, json: { name: "Bug" } });
    const again = await client.github("POST", path("/labels"), {
      token: admin,
      json: { name: "bug" },
    });
    expect(again.status).toBe(422);
    expect(again.json.errors[0]).toMatchObject({
      resource: "Label",
      code: "already_exists",
      field: "name",
    });
  });

  it("updates a label's colour, and renaming it renames it on the issues that carry it", async () => {
    const { client, admin, read, path, create } = await setup();
    await create({ title: "t", labels: ["status:new"] });
    const recoloured = await client.github("PATCH", path("/labels/status%3Anew"), {
      token: admin,
      json: { color: "1d76db" },
    });
    expect(recoloured.json.color).toBe("1d76db");
    await client.github("PATCH", path("/labels/status%3Anew"), {
      token: admin,
      json: { new_name: "status:fresh" },
    });
    const issue = await client.github("GET", path("/issues/1"), { token: read });
    expect(issue.json.labels[0]).toMatchObject({ name: "status:fresh", color: "1d76db" });
    expect((await client.github("GET", path("/labels/status%3Anew"), { token: read })).status).toBe(
      404,
    );
  });

  it("rejects an invalid colour, an unknown label, and a Viewer", async () => {
    const { client, admin, read, path } = await setup();
    await client.github("POST", path("/labels"), { token: admin, json: { name: "x" } });
    expect(
      (await client.github("PATCH", path("/labels/x"), { token: admin, json: { color: "nope" } }))
        .status,
    ).toBe(422);
    expect(
      (
        await client.github("PATCH", path("/labels/missing"), {
          token: admin,
          json: { color: "ffffff" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await client.github("POST", path("/labels"), { token: read, json: { name: "y" } })).status,
    ).toBe(403);
  });
});

describe("search", () => {
  async function seeded() {
    const world = await setup();
    await world.create({
      title: "Leaking tap",
      body: "water on the floor",
      labels: ["category:plumbing", "status:new"],
    });
    await world.create({
      title: "Broken lamp",
      body: "stairwell is dark",
      labels: ["category:electrical", "status:new"],
    });
    await world.create({ title: "Old noise", body: "water hammer", labels: ["category:plumbing"] });
    await world.client.github("PATCH", world.path("/issues/3"), {
      token: world.admin,
      json: { state: "closed" },
    });
    world.control.createReport({ title: "water pull request", pullRequest: true });
    const search = async (q: string) =>
      (await world.client.github("GET", "/search/issues", { token: world.read, query: { q } }))
        .json;
    return { ...world, search };
  }

  it("refuses a query without is:issue or is:pull-request, as it does for GitHub App user tokens", async () => {
    const { client, read } = await seeded();
    const reply = await client.github("GET", "/search/issues", {
      token: read,
      query: { q: "repo:fake-org/reports water" },
    });
    expect(reply.status).toBe(422);
    expect(reply.json.errors[0].message).toContain("is:issue");
  });

  it("matches free words in the title and body, and narrows by repo, state and label", async () => {
    const { search } = await seeded();
    const numbers = (result: { items: { number: number }[] }) =>
      result.items.map((item) => item.number).sort();
    expect(numbers(await search("repo:fake-org/reports is:issue water"))).toEqual([1, 3]);
    expect(numbers(await search("repo:fake-org/reports is:issue is:open water"))).toEqual([1]);
    expect(numbers(await search("repo:fake-org/reports is:issue is:closed"))).toEqual([3]);
    expect(
      numbers(await search('repo:fake-org/reports is:issue label:"category:plumbing"')),
    ).toEqual([1, 3]);
    expect(
      numbers(
        await search('repo:fake-org/reports is:issue label:"category:plumbing" label:"status:new"'),
      ),
    ).toEqual([1]);
    expect(numbers(await search('repo:fake-org/reports is:issue -label:"status:new"'))).toEqual([
      3,
    ]);
    expect(numbers(await search("repo:fake-org/other is:issue"))).toEqual([]);
  });

  it("separates issues from pull requests, reports a total, and paginates", async () => {
    const { client, read, search } = await seeded();
    const prs = await search("repo:fake-org/reports is:pull-request");
    expect(prs.total_count).toBe(1);
    const result = await search("repo:fake-org/reports is:issue");
    expect(result).toMatchObject({ total_count: 3, incomplete_results: false });
    const paged = await client.github("GET", "/search/issues", {
      token: read,
      query: { q: "repo:fake-org/reports is:issue", per_page: 2 },
    });
    expect(paged.json.items).toHaveLength(2);
    expect(paged.headers.get("link")).toContain('rel="next"');
  });

  it("restricts `in:` to the fields it names", async () => {
    const { search } = await seeded();
    expect((await search("is:issue water in:title")).total_count).toBe(0);
    expect((await search("is:issue lamp in:title")).total_count).toBe(1);
  });
});
