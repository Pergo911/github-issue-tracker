import type { Config } from "@shared/config/schema.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { createBotClient } from "../github/bot-client.ts";
import { evictView } from "../status/cache.ts";
import { randomToken } from "../util/crypto.ts";
import { sendTemplate } from "../util/request.ts";

export type ReissueOutcome =
  | "reissued"
  /** No such Report mapping, or the presented link was already replaced. Nothing changed. */
  | "not_found"
  /** A holder's third Reissue of the day for this Report is spent. Nothing changed. */
  | "limited"
  /** The link was replaced, but the email with the new one could not be sent. */
  | "mail_failed";

/**
 * Reissues a Report's Status link (SPEC 4.3): the one function the holder's button and the Staff action share.
 * Under the Report gate's lifecycle it mints a new token, writes `status-token:<new>`, updates `issue-token` and
 * deletes the old token, then evicts the cached view and emails the Reissued template with the new link to the
 * address in KV. The new link is never returned: only the Reporter's mailbox learns it.
 *
 * `capped` is the holder path (3 a day per Report); Staff pass `false`. A holder also passes `presentedToken`,
 * so a link that was replaced a moment ago cannot be reissued again.
 */
export async function reissueLink(
  env: Env,
  input: {
    config: Config;
    issueNumber: number;
    /** The Status link's base, without a trailing slash. */
    appBase: string;
    capped: boolean;
    presentedToken?: string;
  },
): Promise<ReissueOutcome> {
  const { config, issueNumber } = input;
  const gate = env.REPORT_GATE.getByName(String(issueNumber));
  if (input.capped && !(await gate.take("reissue"))) return "limited";

  // Read the title before anything changes, so a GitHub failure here leaves the old link working.
  const bot = createBotClient(env);
  const issue = await bot.request<GitHubIssue>("GET", bot.repoPath(`/issues/${issueNumber}`));

  const replaced = await gate.replaceToken({
    issueNumber,
    newToken: randomToken(16),
    ...(input.presentedToken === undefined ? {} : { presentedToken: input.presentedToken }),
  });
  if (replaced.kind !== "replaced") return "not_found";

  await evictView(replaced.oldToken);
  try {
    await sendTemplate(env, config, "linkReissued", replaced.email, {
      number: issueNumber,
      title: issue.data.title,
      link: `${input.appBase}/status/${replaced.newToken}`,
    });
  } catch (error) {
    console.error("the Reissued link email could not be sent", error);
    return "mail_failed";
  }
  return "reissued";
}
