import type { PublicConfig } from "@shared/config/public.ts";
import type { GitHubIssue, GitHubTimelineEvent } from "@shared/github/types.ts";
import type { ExpectedBot } from "@shared/reports/attribution.ts";
import {
  bodyOf,
  closeReasonOf,
  timelineEntries,
  type CloseReason,
  type StatusBody,
  type StatusTimelineItem,
} from "@shared/status/view.ts";
import { toReportRow, type ReportRow } from "./model.ts";

/** A timeline item; a comment also names its GitHub author (the dashboard shows who, unlike the Status page). */
export type DetailTimelineItem = StatusTimelineItem & { login?: string };

/** What the Detail view shows of one Report (SPEC 2.4): the List's row plus the body, history and times. */
export interface ReportDetail {
  row: ReportRow;
  closeReason: CloseReason | null;
  body: StatusBody;
  updatedAt: string;
  closedAt: string | null;
  timeline: DetailTimelineItem[];
}

/**
 * Builds the Detail view's model from the issue and its whole timeline, with the same decoder and the same
 * Bot-identity classifier the Status page uses (`shared/`), so a comment is the Reporter's only when the Bot wrote
 * it in the canonical envelope. Anything non-canonical stays plain text.
 */
export function toReportDetail(
  issue: GitHubIssue,
  timeline: readonly GitHubTimelineEvent[],
  taxonomy: PublicConfig["taxonomy"],
  bot: ExpectedBot,
): ReportDetail {
  const closed = issue.state === "closed";
  return {
    row: toReportRow(issue, taxonomy),
    closeReason: closed ? closeReasonOf(issue.state_reason) : null,
    body: bodyOf(issue, bot),
    updatedAt: issue.updated_at,
    closedAt: closed ? issue.closed_at : null,
    timeline: timelineEntries(timeline, taxonomy, bot).map(({ item, event }) =>
      item.kind === "comment" && event.event === "commented" && event.user
        ? { ...item, ...(item.author === "staff" ? { login: event.user.login } : {}) }
        : item,
    ),
  };
}
