import type { GitHubComment } from "@shared/github/types.ts";
import { classifyComment, type ExpectedBot } from "@shared/reports/attribution.ts";

/** What the scan found on one issue: how many Reporter comments, and when the latest was written. */
export interface ReporterCommentInfo {
  count: number;
  /** ISO time of the latest Reporter comment. */
  last: string;
}

/** The scan's result, by issue number. An issue the scan found nothing on has no entry. */
export type ReporterScan = Record<number, ReporterCommentInfo>;

const issueNumberOf = (issueUrl: string): number | null => {
  const match = /\/issues\/(\d+)$/.exec(issueUrl);
  return match ? Number(match[1]) : null;
};

/**
 * Groups the repo-wide comments by issue, keeping only the Reporter's (SPEC 2.4, 4.3): the Bot's identity plus the
 * exact canonical envelope, the same classifier the Detail view and the Status page use. It places no limit on
 * which issues it reports on; a pull request's or an unfetched issue's number is simply never looked up.
 */
export function scanReporterComments(
  comments: readonly GitHubComment[],
  bot: ExpectedBot,
): ReporterScan {
  const scan: ReporterScan = {};
  for (const comment of comments) {
    const number = issueNumberOf(comment.issue_url);
    if (number === null || classifyComment(comment, bot).author !== "reporter") continue;
    const known = scan[number];
    scan[number] = {
      count: (known?.count ?? 0) + 1,
      last:
        known && Date.parse(known.last) >= Date.parse(comment.created_at)
          ? known.last
          : comment.created_at,
    };
  }
  return scan;
}
