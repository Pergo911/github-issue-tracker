import type { Page, Route } from "@playwright/test";
import type { StaffRole } from "../../src/shared/github/roles.ts";
import { worldOf } from "./test.ts";

/** The repo role each dashboard role is made from, in the fake GitHub. */
export const REPO_ROLE = { viewer: "read", maintenance: "triage", admin: "admin" } as const;

/** Where the SPA keeps the Staff tokens (src/client/staff/auth/token-store.ts). */
const STORAGE_KEY = "staff.tokens";

/** A Staff user in the seeded world and a static token for it (never expires). */
export async function staffToken(
  login: string,
  role: StaffRole | "none",
): Promise<{ login: string; token: string }> {
  const repoRole = role === "none" ? "none" : REPO_ROLE[role];
  const { token } = await worldOf("seeded").addStaff({ login, role: repoRole });
  return { login, token };
}

/**
 * Starts the page signed in, as if the member had completed the device flow earlier: the token is in
 * `localStorage` before the SPA loads. (The device flow itself has its own journeys.) It is written once per
 * tab, so signing out and reloading really is signed out.
 */
export async function startSignedIn(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ([key, accessToken]) => {
      if (sessionStorage.getItem("e2e-signed-in")) return;
      sessionStorage.setItem("e2e-signed-in", "1");
      const hours = 3_600_000;
      localStorage.setItem(
        key as string,
        JSON.stringify({
          accessToken,
          refreshToken: "ghr_not_used_by_this_test",
          accessExpiresAt: Date.now() + 8 * hours,
          refreshExpiresAt: Date.now() + 24 * 30 * hours,
        }),
      );
    },
    [STORAGE_KEY, token],
  );
}

export interface IssueFixture {
  number: number;
  title: string;
  labels?: string[];
  state?: "open" | "closed";
  stateReason?: "completed" | "not_planned" | null;
  assignees?: string[];
  /** ISO time. */
  createdAt: string;
}

/** A GitHub issue payload with the fields the List reads, for requests the page answers itself. */
export function issuePayload(fixture: IssueFixture) {
  return {
    number: fixture.number,
    title: fixture.title,
    state: fixture.state ?? "open",
    state_reason: fixture.stateReason ?? null,
    created_at: fixture.createdAt,
    labels: (fixture.labels ?? []).map((name) => ({ name, color: "ededed" })),
    assignees: (fixture.assignees ?? []).map((login) => ({ login })),
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, accept, x-github-api-version, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
};

/** Fulfils a request with JSON, answering a CORS preflight itself. */
async function respond(route: Route, body: unknown): Promise<void> {
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: CORS });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: CORS,
    body: JSON.stringify(body),
  });
}

/**
 * Answers the List's GitHub requests with fixed Reports and a fixed clock, so a screen looks the same on every
 * run: the fixtures' ages are counted from the pinned time. Everything else (sign-in, the role check) still goes
 * through the real Worker and the fake GitHub.
 */
export async function serveReports(
  page: Page,
  issues: IssueFixture[],
  options: { searchHits?: IssueFixture[]; now?: string } = {},
): Promise<void> {
  await page.clock.setFixedTime(new Date(options.now ?? "2026-06-15T12:00:00Z"));
  await page.route(/\/repos\/[^/]+\/[^/]+\/issues\?/, (route) =>
    respond(route, issues.map(issuePayload)),
  );
  await page.route(/\/search\/issues\?/, (route) =>
    respond(route, {
      total_count: (options.searchHits ?? []).length,
      incomplete_results: false,
      items: (options.searchHits ?? []).map(issuePayload),
    }),
  );
}
