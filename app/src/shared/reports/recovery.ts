/**
 * Submission recovery as the Reporter's tab and the operator see it (SPEC 4.1, ADR 0005). Shapes only: the
 * Worker's gates produce them and the SPA and the operator CLI read them.
 */

/** A reference as a Reporter reads it out: `ABCD-1234`. */
export const REFERENCE_PATTERN = /^[0-9A-F]{4}-[0-9A-F]{4}$/;

/** Where a verified submission stands when its tab asks to resume it. */
export type ResumeResult =
  | { status: "complete"; number: number; title: string; statusUrl: string }
  /** Still being saved: ask again shortly. */
  | { status: "saving" }
  /** Settled by a person: the Reporter is shown the reference and the contact instructions. */
  | { status: "needs_help"; reference: string };

/** One retained attempt in the operator's list: no email, no payload. */
export interface RecoveryEntry {
  reference: string;
  emailHash: string;
  phase: string;
  since: number;
}

/** One retained attempt, inspected by an admin. */
export interface RecoveryDetail {
  reference: string;
  emailHash: string;
  email: string;
  phase: string;
  issueNumber: number | null;
  /** The exact line to look for in GitHub's issues. */
  markerLine: string;
  title: string;
  category: string;
  location: string;
  startedAt: number;
  /** Issues a fresh scan found carrying the marker from the Bot; `null` when GitHub could not be asked. */
  matches: number[] | null;
}
