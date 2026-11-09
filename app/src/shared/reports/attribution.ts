import { decodeFence, encodeFence } from "./fence.ts";

/**
 * Who wrote a comment, and what it says (SPEC 4.3). Runtime-neutral: the Worker's status lookup and the Staff
 * dashboard share it. A comment is the Reporter's only when the expected Deployment Bot wrote it (numeric id,
 * login and `type: Bot`) AND its body is exactly the canonical Reporter envelope. Anything else is Staff, shown
 * as plain text: a Staff-authored lookalike, a Staff edit, conflicting App metadata.
 */

/** The fixed, never localized marker in front of a Reporter comment's fence. */
export const REPORTER_MARKER = "**Reporter:**";

/** What the Bot posts for a Reporter's comment: the marker outside the code block, the text inside it. */
export function buildReporterComment(text: string): string {
  return `${REPORTER_MARKER}\n\n${encodeFence(text)}`;
}

/** The Bot as the Deployment pins it (`StaffMeta["bot"]`), plus the App's id when the caller knows it. */
export interface ExpectedBot {
  login: string;
  id: number;
  type: "Bot";
  /** When given, a comment that carries other App metadata fails closed. A null App is not disqualifying. */
  appId?: number;
}

export interface CommentLike {
  body?: string | null | undefined;
  user: { login: string; id: number; type: string } | null;
  performed_via_github_app?: { id: number } | null;
}

export type ClassifiedComment = { author: "reporter" | "staff"; text: string };

/** The text after the marker, when `body` is exactly marker + blank line + canonical fence. */
export function decodeReporterComment(body: string): string | null {
  const prefix = `${REPORTER_MARKER}\n\n`;
  return body.startsWith(prefix) ? decodeFence(body.slice(prefix.length)) : null;
}

export function classifyComment(comment: CommentLike, bot: ExpectedBot): ClassifiedComment {
  const body = comment.body ?? "";
  const user = comment.user;
  const byBot =
    user !== null && user.login === bot.login && user.id === bot.id && user.type === "Bot";
  const app = comment.performed_via_github_app ?? null;
  const appConflicts = app !== null && bot.appId !== undefined && app.id !== bot.appId;
  if (byBot && !appConflicts) {
    const text = decodeReporterComment(body);
    if (text !== null) return { author: "reporter", text };
  }
  return { author: "staff", text: body };
}
