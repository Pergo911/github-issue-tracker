// `npm run capture:webhooks`: records real `issues` webhook deliveries from `reports-sandbox` as test data
// (ticket #32). It creates a repo webhook with the operator's token (any target URL will do: GitHub keeps the
// delivery whether or not the target answers), makes the Bot and the operator do what the system relies on,
// reads the payloads back through the hook's recent-deliveries API, writes them to
// `fakes/testing/fixtures/github-webhooks/`, then deletes the hook and closes the issues it made as
// `not_planned`. Credentials: the same as the live contract suite (AGENTS.md).
//
// The delivery API returns the parsed payload, not GitHub's raw bytes, so each fixture's signature is re-made
// over the stored JSON with the fixed secret below; the receiver tests check the real headers' shape and
// verify that re-made signature.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { liveCredentials, liveTarget } from "../fakes/node/contract/target.ts";
import { FIXTURE_WEBHOOK_SECRET as FIXTURE_SECRET } from "../fakes/testing/constants.ts";

process.env["CONTRACT_LIVE"] = "1";
const live = liveCredentials();
if ("skip" in live) {
  console.error(`Cannot capture: ${live.skip}`);
  process.exit(1);
}
const target = liveTarget(live.credentials);
const OUT = join(import.meta.dirname, "..", "fakes", "testing", "fixtures", "github-webhooks");

const operator = target.operatorToken();
const bot = await target.botToken();
const as = (token: string) => (method: string, suffix: string, json?: unknown) =>
  target.github(method, target.path(suffix), { token, ...(json === undefined ? {} : { json }) });
const byBot = as(bot);
const byOperator = as(operator);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function must<T extends { status: number; text: string }>(reply: T, status = 200): T {
  if (reply.status !== status) throw new Error(`${reply.status}: ${reply.text.slice(0, 300)}`);
  return reply;
}

const hook = must(
  await byOperator("POST", "/hooks", {
    name: "web",
    active: true,
    events: ["issues"],
    config: {
      url: "https://example.invalid/api/github/webhook",
      content_type: "json",
      secret: FIXTURE_SECRET,
      insecure_ssl: "0",
    },
  }),
  201,
).json;
console.log(`webhook ${hook.id} created`);

const issues: number[] = [];
try {
  // The labels the reference Deployment uses, created once and left in the sandbox.
  for (const [name, color] of [
    ["category:elevator", "1d76db"],
    ["status:new", "ededed"],
    ["status:in-progress", "fbca04"],
  ] as const) {
    const have = await byBot("GET", `/labels/${encodeURIComponent(name)}`);
    if (have.status === 404) must(await byBot("POST", "/labels", { name, color }), 201);
  }

  const original = must(
    await byBot("POST", "/issues", { title: "Capture original", labels: ["status:new"] }),
    201,
  ).json;
  issues.push(original.number);
  const created = must(
    await byBot("POST", "/issues", {
      title: "Capture lift stuck",
      body: "**Description**\n```\nThe lift is stuck.\n```\n",
      labels: ["category:elevator", "status:new"],
    }),
    201,
  ).json;
  issues.push(created.number);
  const n = created.number;

  const me = must(await target.github("GET", "/user", { token: operator })).json.login;
  // Staff acting through the dashboard: a status change, an assignment, a rename, each close reason.
  must(
    await byOperator("PATCH", `/issues/${n}`, {
      labels: ["category:elevator", "status:in-progress"],
    }),
  );
  must(await byOperator("PATCH", `/issues/${n}`, { assignees: [me] }));
  must(await byOperator("PATCH", `/issues/${n}`, { assignees: [] }));
  must(await byOperator("PATCH", `/issues/${n}`, { title: "Capture lift stuck (renamed)" }));
  must(await byOperator("PATCH", `/issues/${n}`, { body: "**Description**\n```\nEdited.\n```\n" }));
  must(await byOperator("PATCH", `/issues/${n}`, { state: "closed", state_reason: "completed" }));
  must(await byOperator("PATCH", `/issues/${n}`, { state: "open" }));
  must(await byOperator("PATCH", `/issues/${n}`, { state: "closed", state_reason: "not_planned" }));
  must(await byOperator("PATCH", `/issues/${n}`, { state: "open" }));
  must(
    await byOperator("PATCH", `/issues/${n}`, {
      state: "closed",
      state_reason: "duplicate",
      duplicate_issue_id: original.id,
    }),
  );
  // The same close and reopen, done by the Bot: the receiver must recognise these as its own.
  must(await byBot("PATCH", `/issues/${n}`, { state: "open" }));
  must(await byBot("PATCH", `/issues/${n}`, { state: "closed", state_reason: "not_planned" }));
  // An erasure: deleting an issue is a GraphQL mutation only an admin may run.
  const doomed = must(await byBot("POST", "/issues", { title: "Capture doomed" }), 201).json;
  const deleted = await target.github("POST", "/graphql", {
    token: operator,
    json: {
      query: "mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }",
      variables: { id: doomed.node_id },
    },
  });
  if (deleted.status !== 200 || deleted.json.errors) {
    console.warn("deleteIssue failed:", deleted.text.slice(0, 300));
    issues.push(doomed.number);
  }

  console.log("waiting for deliveries");
  await wait(15_000);

  // Delivery ids exceed JavaScript's safe integers (3.8e18): read them from the raw text, not the parsed JSON.
  const listing = must(await byOperator("GET", `/hooks/${hook.id}/deliveries?per_page=100`));
  const listed = (listing.json as { guid: string; event: string; action: string | null }[]).map(
    (summary) => ({
      ...summary,
      id: new RegExp(String.raw`"id":(\d+),"guid":"${summary.guid}"`).exec(
        listing.text,
      )?.[1] as string,
    }),
  );
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const counts = new Map<string, number>();
  for (const summary of listed.reverse()) {
    const detail = must(await byOperator("GET", `/hooks/${hook.id}/deliveries/${summary.id}`)).json;
    const payload = detail.request.payload;
    const kind = `${summary.event}.${summary.action ?? "none"}`;
    const detailName =
      summary.action === "closed"
        ? `.${payload.issue.state_reason ?? "completed"}.by-${payload.sender.type === "Bot" ? "bot" : "staff"}`
        : summary.action === "labeled" || summary.action === "unlabeled"
          ? `.${String(payload.label.name).replace(/[^a-z0-9]+/gi, "-")}.by-${payload.sender.type === "Bot" ? "bot" : "staff"}`
          : summary.action === "opened" || summary.action === "reopened"
            ? `.by-${payload.sender.type === "Bot" ? "bot" : "staff"}`
            : "";
    const base = `${kind}${detailName}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    const name = count === 1 ? base : `${base}.${count}`;
    const body = JSON.stringify(payload);
    const headers = detail.request.headers as Record<string, string>;
    const pick = (key: string) =>
      Object.entries(headers).find(([k]) => k.toLowerCase() === key)?.[1] ?? null;
    writeFileSync(
      join(OUT, `${name}.json`),
      `${JSON.stringify(
        {
          note: "A real delivery recorded from reports-sandbox by scripts/capture-webhooks.ts (ticket #32).",
          event: pick("x-github-event"),
          guid: summary.guid,
          headers: {
            "content-type": pick("content-type"),
            "user-agent": pick("user-agent"),
            "x-github-event": pick("x-github-event"),
            "x-github-delivery": pick("x-github-delivery"),
            "x-github-hook-installation-target-type": pick(
              "x-github-hook-installation-target-type",
            ),
            "x-hub-signature-256": `sha256=${createHmac("sha256", FIXTURE_SECRET).update(body).digest("hex")}`,
          },
          payload,
        },
        null,
        2,
      )}\n`,
    );
    console.log("saved", name);
  }
} finally {
  await byOperator("DELETE", `/hooks/${hook.id}`);
  for (const number of issues) {
    await byBot("PATCH", `/issues/${number}`, { state: "closed", state_reason: "not_planned" });
  }
  console.log("webhook deleted, issues closed");
}
