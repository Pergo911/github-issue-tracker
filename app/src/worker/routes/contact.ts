import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { readEntry } from "../allowlist/store.ts";
import { registerEndpoint } from "../api/register.ts";
import { loadConfig } from "../config/load.ts";
import { GitHubApiError, GitHubNetworkError } from "../github/bot-client.ts";
import { reissueLink } from "../reports/reissue.ts";
import { appBase } from "../util/request.ts";

/**
 * The Reporter contact lookups of the Staff dashboard (SPEC 4.3, 4.4). Both are gated to Maintenance staff and
 * up by `requireRole`, which asks GitHub about the caller's own token on every call: the SPA hides the controls
 * from a Viewer, but this is what refuses one.
 */
export function registerContact(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.revealContact, async ({ env, input, request, fail }) => {
    const email = await env.KV.get(`issue-email:${input.issueNumber}`);
    if (email === null) return fail("not_found");
    const token = await env.KV.get(`issue-token:${input.issueNumber}`);
    const entry = await readEntry(env.KV, email);
    return {
      email,
      statusUrl: token === null ? null : `${appBase(env, request)}/status/${token}`,
      allowlist: entry === null ? null : { note: entry.note ?? null },
    };
  });

  registerEndpoint(app, endpoints.staffReissue, async ({ env, input, request, fail }) => {
    const config = await loadConfig(env.KV);
    if (config === null) return fail("not_configured");
    let outcome;
    try {
      outcome = await reissueLink(env, {
        config,
        issueNumber: input.issueNumber,
        appBase: appBase(env, request),
        capped: false,
      });
    } catch (error) {
      if (error instanceof GitHubApiError) {
        return fail(error.status === 404 ? "not_found" : "upstream_unavailable");
      }
      if (error instanceof GitHubNetworkError) return fail("upstream_unavailable");
      throw error;
    }
    switch (outcome) {
      case "reissued":
        return { sent: true } as const;
      case "mail_failed":
        return fail("reissue_mail_failed");
      default:
        // `limited` cannot happen uncapped.
        return fail("not_found");
    }
  });
}
