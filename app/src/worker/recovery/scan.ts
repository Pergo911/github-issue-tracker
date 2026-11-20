import { correlationMarker } from "@shared/reports/body.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { createBotClient } from "../github/bot-client.ts";
import { resolveBotIdentity } from "../github/bot-identity.ts";

/**
 * Settling an uncertain create (ADR 0005): every issue of the repository, open or closed, scanned for the exact
 * correlation marker authored by the expected Bot identity. A pull request is not a Report. The caller adopts
 * a unique match and leaves zero or several for a person.
 */
export function selectMatches(
  issues: readonly Pick<GitHubIssue, "number" | "body" | "user" | "pull_request">[],
  marker: string,
  bot: { login: string; id: number },
): number[] {
  const line = correlationMarker(marker);
  return issues
    .filter(
      (issue) =>
        !issue.pull_request &&
        issue.user.type === "Bot" &&
        issue.user.login === bot.login &&
        issue.user.id === bot.id &&
        (issue.body ?? "").split("\n").some((candidate) => candidate.trim() === line),
    )
    .map((issue) => issue.number);
}

export async function findMarkerMatches(env: Env, marker: string): Promise<number[]> {
  const identity = await resolveBotIdentity(env);
  const bot = createBotClient(env);
  const issues = await bot.paginate<GitHubIssue>(bot.repoPath("/issues"), {
    query: { state: "all" },
    maxPages: 500,
  });
  return selectMatches(issues, marker, identity);
}

/** Whether the issue still exists on GitHub: `unknown` when GitHub could not say (never read as gone). */
export async function issueExists(env: Env, issueNumber: number): Promise<boolean> {
  const bot = createBotClient(env);
  try {
    await bot.request("GET", bot.repoPath(`/issues/${issueNumber}`));
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 410) return false;
    throw error;
  }
}
