import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { buildReporterComment } from "@shared/reports/attribution.ts";
import type { GitHubComment, GitHubIssue, GitHubTimelineEvent } from "@shared/github/types.ts";
import { buildStatusView, type StatusCommentItem, type StatusView } from "@shared/status/view.ts";
import { registerEndpoint } from "../api/register.ts";
import { loadConfig } from "../config/load.ts";
import {
  GitHubApiError,
  GitHubNetworkError,
  createBotClient,
  type GitHubResponse,
} from "../github/bot-client.ts";
import { resolveBotIdentity } from "../github/bot-identity.ts";
import { reissueLink } from "../reports/reissue.ts";
import { cacheView, evictView, readCachedView } from "../status/cache.ts";
import { appBase, clientKey } from "../util/request.ts";

/**
 * The Status page's endpoints (SPEC 4.3, 4.5): read the Report a Status link names, add a Reporter comment, and
 * Reissue the link. All three resolve `status-token:<token>` in KV first, and an unknown, malformed or replaced token
 * is the same generic `not_found`. The Reporter has no GitHub credential: the Bot reads and writes.
 */

const COMMENT_MIN = 1;
const COMMENT_MAX = 2000;

/** The issue a token names, or `null` for a token that is unknown, malformed or replaced. */
async function issueFor(env: Env, token: string): Promise<number | null> {
  const stored = await env.KV.get(`status-token:${token}`);
  const number = stored === null ? NaN : Number(stored);
  return Number.isInteger(number) ? number : null;
}

/** GitHub being unreachable or refusing is the common `upstream_unavailable`; a vanished Report is a 404. */
function upstream(error: unknown): "not_found" | "upstream_unavailable" | null {
  if (error instanceof GitHubApiError)
    return error.status === 404 ? "not_found" : "upstream_unavailable";
  if (error instanceof GitHubNetworkError) return "upstream_unavailable";
  return null;
}

export function registerStatus(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(
    app,
    endpoints.statusLookup,
    async ({ env, input, request, waitUntil, fail }) => {
      const config = await loadConfig(env.KV);
      if (config === null) return fail("not_configured");

      if (!(await env.RL_STATUS_IP.limit({ key: clientKey(env, request) })).success) {
        return fail("rate_limited");
      }
      if (!(await env.RL_STATUS_TOKEN.limit({ key: input.token })).success) {
        return fail("rate_limited");
      }
      const number = await issueFor(env, input.token);
      if (number === null) return fail("not_found");

      const cached = await readCachedView(input.token);
      if (cached !== null) return cached;

      let view: StatusView;
      try {
        const bot = createBotClient(env);
        const [issue, timeline, identity] = await Promise.all([
          bot.request<GitHubIssue>("GET", bot.repoPath(`/issues/${number}`)),
          bot.paginate<GitHubTimelineEvent>(bot.repoPath(`/issues/${number}/timeline`)),
          resolveBotIdentity(env),
        ]);
        view = buildStatusView({
          issue: issue.data,
          timeline,
          taxonomy: config.taxonomy,
          bot: { ...identity, appId: Number(env.BOT_APP_ID) },
        });
      } catch (error) {
        const code = upstream(error);
        if (code === null) throw error;
        return fail(code);
      }
      waitUntil(cacheView(input.token, view));
      return view;
    },
  );

  registerEndpoint(app, endpoints.statusComment, async ({ env, input, request, fail }) => {
    if (!(await env.RL_COMMENT_IP.limit({ key: clientKey(env, request) })).success) {
      return fail("rate_limited");
    }
    if (!(await env.RL_COMMENT_TOKEN.limit({ key: input.token })).success) {
      return fail("rate_limited");
    }
    const number = await issueFor(env, input.token);
    if (number === null) return fail("not_found");

    const text = input.text.trim();
    const length = [...text].length;
    if (length < COMMENT_MIN || length > COMMENT_MAX) return fail("comment_length");

    if (!(await env.REPORT_GATE.getByName(String(number)).take("comment"))) {
      return fail("rate_limited");
    }
    let created: GitHubResponse<GitHubComment>;
    try {
      const bot = createBotClient(env);
      created = await bot.request<GitHubComment>(
        "POST",
        bot.repoPath(`/issues/${number}/comments`),
        {
          body: { body: buildReporterComment(text) },
        },
      );
    } catch (error) {
      const code = upstream(error);
      if (code === null) throw error;
      return fail(code);
    }
    await evictView(input.token);
    const comment: StatusCommentItem = {
      kind: "comment",
      author: "reporter",
      text,
      at: created.data.created_at,
    };
    return { accepted: true, comment } as const;
  });

  registerEndpoint(app, endpoints.statusReissue, async ({ env, input, request, fail }) => {
    const config = await loadConfig(env.KV);
    if (config === null) return fail("not_configured");
    const number = await issueFor(env, input.token);
    if (number === null) return fail("not_found");

    let outcome;
    try {
      outcome = await reissueLink(env, {
        config,
        issueNumber: number,
        appBase: appBase(env, request),
        capped: true,
        presentedToken: input.token,
      });
    } catch (error) {
      const code = upstream(error);
      if (code === null) throw error;
      return fail(code);
    }
    switch (outcome) {
      case "reissued":
        return { sent: true } as const;
      case "not_found":
        return fail("not_found");
      case "limited":
        return fail("rate_limited");
      case "mail_failed":
        return fail("reissue_mail_failed");
    }
  });
}
