/**
 * Test seams for submission recovery (ADR 0005). A test arms `probe.crashAt` to stop the Worker between two
 * phases, or sets `probe.botTimeoutMs` to exercise the upstream create timeout without waiting 10 s.
 * Production never arms either field, so `reach` is a no-op and `botTimeoutMs` stays `null`.
 */
export type ProbePoint =
  | "after-fence"
  | "after-create"
  | "after-record-issue"
  | "after-register"
  | "after-kv-issue-email"
  | "after-kv-status-token"
  | "after-kv-issue-token"
  | "before-complete";

export const probe: { crashAt: ProbePoint | null; botTimeoutMs: number | null } = {
  crashAt: null,
  botTimeoutMs: null,
};

export function reach(point: ProbePoint): void {
  if (probe.crashAt === point) {
    probe.crashAt = null;
    throw new Error(`stopped at ${point}`);
  }
}
