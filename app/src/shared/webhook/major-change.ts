import { labelName, type Taxonomy } from "../config/schema.ts";
import type { GitHubIssuesWebhookPayload } from "../github/types.ts";
import { closeReasonOf, type CloseReason } from "../status/view.ts";

/**
 * The webhook receiver's decision for one `issues` delivery (SPEC 4.2): what can never be emailed is dropped
 * first, then the Major-change filter, written against the Status flags and never against names (SPEC 2.3).
 * Pure and runtime-neutral: the Worker supplies the Bot's identity and acts on the answer.
 */

export type IgnoreReason =
  "transferred" | "bot" | "stale-state" | "stale-status" | "initial" | "no-major-change";

export type Classification =
  /** The Report was deleted on GitHub: erase what the system holds about its Reporter. */
  | { kind: "erase" }
  | { kind: "ignore"; why: IgnoreReason }
  /** A Major change: one email of this template, with these template-specific parameters. */
  | { kind: "email"; template: "closed"; params: { reason: CloseReason } }
  | { kind: "email"; template: "reopened"; params: Record<string, never> }
  | { kind: "email"; template: "statusEntered"; params: { status: string } };

/** `transferred` is not in GitHub's typed union here on purpose: the design ignores it (SPEC 4.2). */
type Action = GitHubIssuesWebhookPayload["action"] | "transferred";

export function classifyIssuesEvent(
  payload: Omit<GitHubIssuesWebhookPayload, "action"> & { action: Action },
  taxonomy: Taxonomy,
  bot: { login: string; id: number },
): Classification {
  if (payload.action === "deleted") return { kind: "erase" };
  if (payload.action === "transferred") return { kind: "ignore", why: "transferred" };

  // GitHub fires one `labeled` per label at creation: the Bot's own events are never a change of status.
  const { sender } = payload;
  if (sender.type === "Bot" && sender.login === bot.login && sender.id === bot.id) {
    return { kind: "ignore", why: "bot" };
  }

  // GitHub renders a delivery's `issue` when it sends it, not when the event happened (measured live, ticket
  // #32): a `closed` for an issue that was reopened a moment later arrives showing an open issue. The later
  // `reopened` delivery carries the change the Reporter should hear about, so the stale one sends nothing.
  if (payload.action === "closed" && payload.issue.state !== "closed") {
    return { kind: "ignore", why: "stale-state" };
  }
  if (payload.action === "reopened" && payload.issue.state !== "open") {
    return { kind: "ignore", why: "stale-state" };
  }

  switch (payload.action) {
    case "closed":
      return {
        kind: "email",
        template: "closed",
        params: { reason: closeReasonOf(payload.issue.state_reason) },
      };
    case "reopened":
      return { kind: "email", template: "reopened", params: {} };
    case "labeled": {
      const status = taxonomy.status.find(
        (candidate) => labelName("status", candidate.id) === payload.label?.name,
      );
      if (!status) return { kind: "ignore", why: "no-major-change" };
      // Closed is GitHub's state: a Status entered on a closed Report is a stale label.
      if (payload.issue.state === "closed") return { kind: "ignore", why: "stale-status" };
      // The dashboard applies `initial` right after `reopened`: a reopen sends one email, not two.
      if (status.initial) return { kind: "ignore", why: "initial" };
      if (!status.notify) return { kind: "ignore", why: "no-major-change" };
      return { kind: "email", template: "statusEntered", params: { status: status.name } };
    }
    default:
      return { kind: "ignore", why: "no-major-change" };
  }
}
