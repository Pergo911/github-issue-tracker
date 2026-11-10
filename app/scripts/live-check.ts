// Real-provider acceptance check for #33. No credentials, codes or capability URLs are logged.
// Uses the operator's token (never the Bot's) for close/delete. Only its own Report is deleted.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext } from "@playwright/test";
import { endpoints } from "../src/shared/api/endpoints.ts";
import { GITHUB_API_VERSION } from "../src/shared/github/constants.ts";
import type { PublicConfig } from "../src/shared/config/public.ts";
import type { StatusView } from "../src/shared/status/view.ts";
import { parseDevVars } from "../fakes/node/local-world.ts";

const directory =
  process.env["REPORTS_DEPLOYMENT_DIR"] ??
  join(homedir(), ".config", "github-issue-tracker-deployment");
const secrets = existsSync(join(directory, "secrets.env"))
  ? parseDevVars(readFileSync(join(directory, "secrets.env"), "utf8"))
  : {};
const appUrl = process.env["APP_URL"] ?? "https://fault-reports.berautoapp.workers.dev";
const org = process.env["GITHUB_ORG"] ?? "Tarsashaz-demo";
const repo = process.env["GITHUB_REPO"] ?? "reports";
const githubBase = process.env["GITHUB_API_BASE"] ?? "https://api.github.com";
const resendBase = process.env["RESEND_API_BASE"] ?? "https://api.resend.com";
const operator =
  process.env["GITHUB_TOKEN"] ??
  process.env["GH_TOKEN"] ??
  execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const resendKey = process.env["RESEND_LIVE_CHECK_KEY"] ?? secrets["RESEND_LIVE_CHECK_KEY"];
if (!resendKey) throw new Error("RESEND_LIVE_CHECK_KEY is missing from the secrets folder");
const email = "delivered+live@resend.dev";
const journalPath = join(directory, "live-check.json");
const screenshots = resolve(".screenshots", "live");

interface Journal {
  appUrl: string;
  org: string;
  repo: string;
  email: string;
  credential: string;
  number?: number;
  nodeId?: string;
  statusUrl?: string;
  allowlistAdded: boolean;
}
let journal: Journal = {
  appUrl,
  org,
  repo,
  email,
  credential: randomBytes(16).toString("base64url"),
  allowlistAdded: false,
};
const save = () => writeFileSync(journalPath, JSON.stringify(journal), { mode: 0o600 });

async function http<T>(
  base: string,
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "user-agent": "fault-reports-live-check",
      ...(base === githubBase ? { "x-github-api-version": GITHUB_API_VERSION } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as T;
  return { status: response.status, data };
}

async function api<T>(
  endpoint: { method: string; path: string },
  body?: unknown,
  staff = false,
): Promise<T> {
  const query = endpoint.method === "GET" || endpoint.method === "DELETE";
  const params = query && body ? new URLSearchParams(body as Record<string, string>) : null;
  const { status, data } = await http<T>(
    appUrl,
    `${endpoint.path}${params ? `?${params}` : ""}`,
    endpoint.method,
    query ? undefined : body,
    staff ? operator : undefined,
  );
  if (status < 200 || status >= 300) throw new Error(`${endpoint.path} answered HTTP ${status}`);
  return data;
}

async function until<T>(
  name: string,
  work: () => Promise<T | null>,
  interval = 12_000,
): Promise<T> {
  const end = Date.now() + 240_000;
  do {
    const result = await work();
    if (result !== null) return result;
    await delay(interval);
  } while (Date.now() < end);
  throw new Error(`Timed out waiting for ${name}`);
}

interface Mail {
  id: string;
  to: string[];
  subject: string;
  text?: string | null;
}
async function listMail(): Promise<Mail[]> {
  // Pagination ensures an active Deployment does not hide the test message behind other sends.
  let after = "";
  const mails: Mail[] = [];
  for (let page = 0; page < 10; page++) {
    const { status, data } = await http<{ data: Mail[]; has_more: boolean }>(
      resendBase,
      `/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      "GET",
      undefined,
      resendKey,
    );
    if (status !== 200) throw new Error(`Resend list answered HTTP ${status}`);
    mails.push(...data.data);
    if (!data.has_more || data.data.length === 0) break;
    after = data.data.at(-1)?.id ?? "";
    await delay(600);
  }
  return mails;
}

async function mailAfter(before: Set<string>, subject: (value: string) => boolean): Promise<Mail> {
  return until("Resend message", async () => {
    const mail = (await listMail()).find(
      (item) => !before.has(item.id) && item.to.includes(email) && subject(item.subject),
    );
    if (!mail) return null;
    await delay(600);
    const { status, data } = await http<Mail>(
      resendBase,
      `/emails/${mail.id}`,
      "GET",
      undefined,
      resendKey,
    );
    if (status !== 200) throw new Error(`Resend retrieve answered HTTP ${status}`);
    return data;
  });
}

const tokenOf = (url: string) => new URL(url).pathname.split("/").at(-1) as string;
async function statusIs(token: string, expected: number): Promise<boolean> {
  return (await http(appUrl, endpoints.statusLookup.path, "POST", { token })).status === expected;
}

async function erase() {
  if (!journal.number) return;
  const path = `/repos/${org}/${repo}/issues/${journal.number}`;
  const issue = await http<{ node_id: string }>(githubBase, path, "GET", undefined, operator);
  if (issue.status === 200) {
    const nodeId = journal.nodeId ?? issue.data.node_id;
    const deleted = await http<{ errors?: unknown[]; data?: { deleteIssue?: unknown } }>(
      githubBase,
      "/graphql",
      "POST",
      {
        query: "mutation($id:ID!){deleteIssue(input:{issueId:$id}){clientMutationId}}",
        variables: { id: nodeId },
      },
      operator,
    );
    if (deleted.status !== 200 || deleted.data.errors || !deleted.data.data?.deleteIssue)
      throw new Error("GraphQL deleteIssue failed");
  } else if (issue.status !== 404 && issue.status !== 410)
    throw new Error(`Cleanup issue read answered HTTP ${issue.status}`);
  await until("erasure webhook and contact purge", async () => {
    const contact = await http(
      appUrl,
      endpoints.revealContact.path,
      "POST",
      { issueNumber: journal.number },
      operator,
    );
    const gone = !journal.statusUrl || (await statusIs(tokenOf(journal.statusUrl), 404));
    return contact.status === 404 && gone ? true : null;
  });
  console.log(`Report #${journal.number} deleted; contact and Status link no longer resolve.`);
}

async function cleanup() {
  // Do not stop Allowlist cleanup if erasure failed. Preserve the journal for an explicit --cleanup retry.
  let failure: unknown;
  try {
    await erase();
  } catch (error) {
    failure = error;
  }
  if (journal.allowlistAdded) {
    try {
      await api(endpoints.allowlistRemove, { email }, true);
      await until("Allowlist removal", async () => {
        const { entries } = await api<{ entries: { email: string }[] }>(
          endpoints.allowlistList,
          undefined,
          true,
        );
        return entries.some((entry) => entry.email === email) ? null : true;
      });
      journal.allowlistAdded = false;
      save();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  // An uncertain submission must be inspected through recovery, never blindly resubmitted or discarded.
  if (!journal.number && journal.statusUrl === "pending")
    throw new Error(
      "Submission outcome uncertain: inspect recovery before removing the private journal",
    );
  unlinkSync(journalPath);
}

async function capture(context: BrowserContext, name: string, path: string) {
  const page = await context.newPage();
  try {
    await page.goto(new URL(path, appUrl).href);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("progressbar")
      .waitFor({ state: "hidden" })
      .catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true });
  } finally {
    await page.close();
  }
}

async function captureSite(statusUrl: string, number: number) {
  mkdirSync(screenshots, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const colorScheme of ["light", "dark"] as const) {
      for (const width of [1280, 375]) {
        const suffix = `${colorScheme}--${width}`;
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
          locale: "hu-HU",
          timezoneId: "Europe/Budapest",
        });
        try {
          await capture(context, `home--${suffix}`, "/");
          await capture(context, `form--${suffix}`, "/report");
          await capture(context, `status--${suffix}`, statusUrl);
          await context.addInitScript(
            ({ origin, token }) => {
              if (location.origin === origin)
                localStorage.setItem(
                  "staff.tokens",
                  JSON.stringify({
                    accessToken: token,
                    refreshToken: "not-a-refresh-token",
                    accessExpiresAt: Date.now() + 3_600_000,
                    refreshExpiresAt: Date.now() + 3_600_000,
                  }),
                );
            },
            { origin: new URL(appUrl).origin, token: operator },
          );
          await capture(context, `list--${suffix}`, "/staff/reports");
          await capture(context, `board--${suffix}`, "/staff/reports?layout=board");
          await capture(context, `detail--${suffix}`, `/staff/reports/${number}`);
          await capture(context, `allowlist--${suffix}`, "/staff/allowlist");
          await capture(context, `configuration--${suffix}`, "/staff/configuration");
        } finally {
          await context.close();
        }
      }
    }
    console.log(`Live screenshots captured in ${screenshots}.`);
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(directory, { recursive: true });
  if (existsSync(journalPath)) {
    if (!process.argv.includes("--cleanup"))
      throw new Error(
        "Private live-check journal exists. Run with --cleanup first; do not start a second submission.",
      );
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    if (
      journal.appUrl !== appUrl ||
      journal.org !== org ||
      journal.repo !== repo ||
      journal.email !== email
    )
      throw new Error("Cleanup target differs from the saved journal");
    await cleanup();
    console.log("Previous live-check data cleaned up.");
    return;
  }
  if (process.argv.includes("--cleanup")) {
    console.log("No live-check journal to clean up.");
    return;
  }
  const config = await api<PublicConfig>(endpoints.publicConfig);
  if (config.language !== "hu" || config.timezone !== "Europe/Budapest")
    throw new Error("Expected Hungarian / Europe/Budapest configuration");
  const { entries } = await api<{ entries: { email: string }[] }>(
    endpoints.allowlistList,
    undefined,
    true,
  );
  if (entries.some((entry) => entry.email === email))
    throw new Error("Live-check address is already listed; refusing to overwrite existing data");
  const before = new Set((await listMail()).map((mail) => mail.id));
  save();
  try {
    await api(endpoints.allowlistAdd, { email, note: "Temporary live deployment check" }, true);
    journal.allowlistAdded = true;
    save();
    // Negative KV caches may survive about a minute. A fresh code cannot be requested repeatedly (cooldown).
    console.log("Allowlist added; waiting 65 seconds for KV propagation.");
    await delay(65_000);
    await api(endpoints.requestCode, { email });
    const otpMail = await mailAfter(
      before,
      (subject) => subject === "Ellenőrző kód a hibabejelentéshez",
    );
    const code = /\b(\d{6})\b/.exec(otpMail.text ?? "")?.[1];
    if (!code) throw new Error("OTP was not found in the retrieved email");
    journal.statusUrl = "pending";
    save();
    const submitted = await api<{ number: number; title: string; statusUrl: string }>(
      endpoints.submitReport,
      {
        email,
        code,
        credential: journal.credential,
        category: config.taxonomy.category[0]?.id,
        location: config.taxonomy.location[0]?.id,
        title: `Live deployment check ${Date.now()}`,
        description: "Éles telepítési ellenőrzés. A bejelentést az ellenőrzés végén töröljük.",
      },
    );
    journal.number = submitted.number;
    journal.statusUrl = submitted.statusUrl;
    save();
    const issue = await http<{
      node_id: string;
      body: string;
      user: { id: number; login: string };
    }>(githubBase, `/repos/${org}/${repo}/issues/${submitted.number}`, "GET", undefined, operator);
    if (issue.status !== 200) throw new Error("Created issue could not be read");
    journal.nodeId = issue.data.node_id;
    save();
    if (issue.data.body.includes(email))
      throw new Error("Privacy invariant failed: Reporter email found in GitHub");
    const token = tokenOf(submitted.statusUrl);
    await until("Status link", async () => ((await statusIs(token, 200)) ? true : null));
    await api(endpoints.statusComment, {
      token,
      text: "Éles ellenőrzés: a bejelentő megjegyzése.",
    });
    console.log(`Report #${submitted.number} created and Reporter comment accepted.`);
    const confirm = await mailAfter(
      before,
      (subject) => subject.includes(`#${submitted.number}`) && subject.endsWith("beérkezett"),
    );
    if (!confirm.text?.includes(submitted.statusUrl))
      throw new Error("Confirmation email lacks the Status link");
    if (process.argv.includes("--screenshots"))
      await captureSite(submitted.statusUrl, submitted.number);
    // Let the webhook's region observe the contact mapping before closing (notifications are best-effort).
    await delay(65_000);
    const closed = await http(
      githubBase,
      `/repos/${org}/${repo}/issues/${submitted.number}`,
      "PATCH",
      {
        state: "closed",
        state_reason: "completed",
        labels: [
          `category:${config.taxonomy.category[0]?.id}`,
          `location:${config.taxonomy.location[0]?.id}`,
        ],
      },
      operator,
    );
    if (closed.status !== 200) throw new Error(`Close answered HTTP ${closed.status}`);
    await mailAfter(
      before,
      (subject) => subject.includes(`#${submitted.number}`) && subject.endsWith("lezárva"),
    );
    console.log("Closed email retrieved through Resend.");
    await api(endpoints.staffReissue, { issueNumber: submitted.number }, true);
    const reissued = await mailAfter(
      before,
      (subject) => subject.includes(`#${submitted.number}`) && subject.endsWith("új hivatkozás"),
    );
    const nextUrl = reissued.text?.match(/https?:\/\/[^\s]+\/status\/[A-Za-z0-9_-]+/)?.[0];
    if (
      !nextUrl ||
      new URL(nextUrl).origin !== new URL(appUrl).origin ||
      nextUrl === submitted.statusUrl
    )
      throw new Error("Reissue email lacks a new Status link");
    journal.statusUrl = nextUrl;
    save();
    await until("old link revoked and new link usable", async () =>
      (await statusIs(token, 404)) && (await statusIs(tokenOf(nextUrl), 200)) ? true : null,
    );
    const state = await api<StatusView>(endpoints.statusLookup, { token: tokenOf(nextUrl) });
    if (state.state !== "closed") throw new Error("Status page does not show Closed");
    console.log("Reissue verified: old link 404, new link works and shows Closed.");
  } finally {
    await cleanup();
  }
  console.log("Live check passed; test Report and Allowlist entry erased.");
}

await main().catch((error: unknown) => {
  console.error(
    error instanceof Error && !("stderr" in error)
      ? error.message
      : "Live check failed; credentials were not printed.",
  );
  process.exitCode = 1;
});
