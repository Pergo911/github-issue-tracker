import { ApiError } from "@/api/call-api.ts";
import type { ApiErrorCode } from "@shared/api/endpoints.ts";
import type { StaffDeviceCode, StaffDevicePoll, StaffTokens } from "@shared/staff/session.ts";

/** What the sign-in screen shows (SPEC 2.2). `pending` carries the code to display. */
export type DeviceFlowState =
  | { kind: "requesting" }
  | { kind: "pending"; code: StaffDeviceCode }
  | { kind: "authorized"; tokens: StaffTokens }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "error"; code: ApiErrorCode }
  | { kind: "aborted" };

export type DeviceFlowResult = Exclude<DeviceFlowState, { kind: "requesting" | "pending" }>;

export interface DeviceFlowDeps {
  start: () => Promise<StaffDeviceCode>;
  poll: (deviceCode: string) => Promise<StaffDevicePoll>;
  /** Waits; resolves early (or rejects) is not needed: the loop checks `signal` after every wait. */
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  onState: (state: DeviceFlowState) => void;
  signal: AbortSignal;
}

/** A failed poll the member can do nothing about and that may pass: keep polling. */
const TRANSIENT: readonly ApiErrorCode[] = [
  "network_error",
  "upstream_unavailable",
  "rate_limited",
];

/**
 * The device flow's polling loop (SPEC 2.2): request a code, then poll at the returned interval, honouring
 * `slow_down`, until the member approves, refuses, or the code's 900 seconds are over. The first poll comes one
 * interval after the code is shown, as GitHub asks.
 */
export async function runDeviceFlow(deps: DeviceFlowDeps): Promise<DeviceFlowResult> {
  const { signal } = deps;
  const finish = (result: DeviceFlowResult): DeviceFlowResult => {
    deps.onState(result);
    return result;
  };
  const codeOf = (error: unknown): ApiErrorCode =>
    error instanceof ApiError ? error.code : "network_error";

  deps.onState({ kind: "requesting" });
  let code: StaffDeviceCode;
  try {
    code = await deps.start();
  } catch (error) {
    return signal.aborted
      ? finish({ kind: "aborted" })
      : finish({ kind: "error", code: codeOf(error) });
  }
  if (signal.aborted) return finish({ kind: "aborted" });
  deps.onState({ kind: "pending", code });

  const expiresAt = deps.now() + code.expiresIn * 1000;
  let interval = code.interval;
  for (;;) {
    await deps.sleep(interval * 1000, signal);
    if (signal.aborted) return finish({ kind: "aborted" });
    if (deps.now() >= expiresAt) return finish({ kind: "expired" });
    let answer: StaffDevicePoll;
    try {
      answer = await deps.poll(code.deviceCode);
    } catch (error) {
      if (signal.aborted) return finish({ kind: "aborted" });
      const failure = codeOf(error);
      if (TRANSIENT.includes(failure)) continue;
      return finish({ kind: "error", code: failure });
    }
    if (signal.aborted) return finish({ kind: "aborted" });
    switch (answer.status) {
      case "authorized": {
        const { status: _status, ...tokens } = answer;
        return finish({ kind: "authorized", tokens });
      }
      case "expired":
        return finish({ kind: "expired" });
      case "denied":
        return finish({ kind: "denied" });
      case "slow_down":
        interval = Math.max(interval, answer.interval);
        break;
      case "pending":
        break;
    }
  }
}
