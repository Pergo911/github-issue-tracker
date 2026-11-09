import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { correlationMarker } from "@shared/reports/body.ts";
import { normalizeEmail } from "@shared/reports/validate.ts";
import { registerEndpoint } from "../api/register.ts";
import { createBotClient, GitHubApiError } from "../github/bot-client.ts";
import { resolveBotIdentity } from "../github/bot-identity.ts";
import { findMarkerMatches } from "../recovery/scan.ts";
import { sha256Hex } from "../util/crypto.ts";

/**
 * The operator procedure for submissions that need a person (SPEC 4.1, ADR 0005): list, inspect, associate a
 * verified existing issue, or discard. Admin-gated through `requireRole`; the `scripts/recovery.ts` CLI calls it
 * with the operator's own GitHub token. It is tooling, not a dashboard screen.
 */
async function locate(
  env: Env,
  selector: { email?: string | undefined; reference?: string | undefined },
) {
  let emailHash: string;
  if (selector.email !== undefined) {
    emailHash = await sha256Hex(normalizeEmail(selector.email));
  } else {
    const entry = await env.GLOBAL_GATE.getByName("deployment").recoveryGet(
      selector.reference as string,
    );
    if (!entry) return null;
    emailHash = entry.emailHash;
  }
  const gate = env.EMAIL_GATE.getByName(emailHash);
  const detail = await gate.inspect();
  if (!detail) return null;
  if (selector.reference !== undefined && detail.reference !== selector.reference) return null;
  return { gate, detail };
}

export function registerRecovery(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.recoveryList, async ({ env }) => ({
    attempts: await env.GLOBAL_GATE.getByName("deployment").recoveryList(),
  }));

  registerEndpoint(app, endpoints.recoveryInspect, async ({ env, input, fail }) => {
    const found = await locate(env, input);
    if (!found) return fail("recovery_not_found");
    const { detail } = found;
    let matches: number[] | null = null;
    try {
      matches = await findMarkerMatches(env, detail.marker);
    } catch (error) {
      console.error("the marker scan for an operator failed", error);
    }
    return {
      reference: detail.reference,
      emailHash: detail.emailHash,
      email: detail.email,
      phase: detail.phase,
      issueNumber: detail.issueNumber,
      markerLine: correlationMarker(detail.marker),
      title: detail.title,
      category: detail.category,
      location: detail.location,
      startedAt: detail.startedAt,
      matches,
    };
  });

  registerEndpoint(app, endpoints.recoveryAssociate, async ({ env, input, fail }) => {
    const found = await locate(env, input);
    if (!found) return fail("recovery_not_found");

    // A verified existing issue: it exists, it is an issue (not a pull request), the Bot filed it, and no other
    // Report's mappings already point at it.
    const bot = createBotClient(env);
    let issue: GitHubIssue;
    try {
      issue = (await bot.request<GitHubIssue>("GET", bot.repoPath(`/issues/${input.issueNumber}`)))
        .data;
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 404 || error.status === 410)) {
        return fail("issue_unverified");
      }
      throw error;
    }
    const identity = await resolveBotIdentity(env);
    if (
      issue.pull_request ||
      issue.user.login !== identity.login ||
      issue.user.id !== identity.id ||
      (await env.KV.get(`issue-email:${input.issueNumber}`)) !== null
    ) {
      return fail("issue_unverified");
    }

    const view = await found.gate.associate(input.issueNumber);
    const outcome = view.kind === "complete" ? ("complete" as const) : ("saving" as const);
    return { outcome, number: input.issueNumber };
  });

  registerEndpoint(app, endpoints.recoveryDiscard, async ({ env, input, fail }) => {
    const found = await locate(env, input);
    if (!found) return fail("recovery_not_found");
    if (!(await found.gate.discard())) return fail("recovery_not_found");
    return { discarded: true } as const;
  });
}
