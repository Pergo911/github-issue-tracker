/**
 * Named points between the phases of a submission (ADR 0005). A test arms one with `probe.crashAt` to stop the
 * Worker exactly there, as a crash would, and then recovers. Production never arms it, so `reach` is a no-op.
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

export const probe: { crashAt: ProbePoint | null } = { crashAt: null };

export function reach(point: ProbePoint): void {
  if (probe.crashAt === point) {
    probe.crashAt = null;
    throw new Error(`stopped at ${point}`);
  }
}
