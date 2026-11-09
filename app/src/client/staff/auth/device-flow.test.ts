import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/call-api.ts";
import type { StaffDeviceCode, StaffDevicePoll } from "@shared/staff/session.ts";
import { runDeviceFlow, type DeviceFlowState } from "./device-flow.ts";

const code: StaffDeviceCode = {
  deviceCode: "dc",
  userCode: "ABCD-EFGH",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 5,
};
const tokens = {
  accessToken: "a",
  refreshToken: "r",
  expiresIn: 28_800,
  refreshTokenExpiresIn: 1e6,
};

function harness(answers: (StaffDevicePoll | Error)[]) {
  let now = 0;
  const sleeps: number[] = [];
  const states: DeviceFlowState[] = [];
  const queue = [...answers];
  const controller = new AbortController();
  const run = () =>
    runDeviceFlow({
      start: async () => code,
      poll: async () => {
        const next = queue.shift() ?? { status: "pending" };
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      now: () => now,
      onState: (state) => states.push(state),
      signal: controller.signal,
    });
  return { run, sleeps, states, controller };
}

describe("runDeviceFlow", () => {
  it("shows the code, polls at the returned interval, and ends authorized", async () => {
    const { run, sleeps, states } = harness([
      { status: "pending" },
      { status: "pending" },
      { status: "authorized", ...tokens },
    ]);
    const result = await run();
    expect(result).toEqual({ kind: "authorized", tokens });
    expect(states[0]).toEqual({ kind: "requesting" });
    expect(states[1]).toEqual({ kind: "pending", code });
    expect(sleeps).toEqual([5000, 5000, 5000]);
  });

  it("honours slow_down: the new interval applies to every later poll", async () => {
    const { run, sleeps } = harness([
      { status: "slow_down", interval: 10 },
      { status: "pending" },
      { status: "authorized", ...tokens },
    ]);
    await run();
    expect(sleeps).toEqual([5000, 10_000, 10_000]);
  });

  it("shows the code as expired after 900 seconds, without asking GitHub again", async () => {
    let polls = 0;
    let now = 0;
    const result = await runDeviceFlow({
      start: async () => code,
      poll: async () => {
        polls += 1;
        return { status: "pending" };
      },
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
      onState: () => undefined,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ kind: "expired" });
    expect(polls).toBe(179);
    expect(now).toBeGreaterThanOrEqual(900_000);
  });

  it("ends expired when GitHub says so, and denied when the member refused", async () => {
    expect(await harness([{ status: "expired" }]).run()).toEqual({ kind: "expired" });
    expect(await harness([{ status: "denied" }]).run()).toEqual({ kind: "denied" });
  });

  it("keeps polling through a failed poll that may pass, and stops on one that will not", async () => {
    const transient = harness([
      new ApiError("network_error", 0),
      new ApiError("upstream_unavailable", 502),
      { status: "authorized", ...tokens },
    ]);
    expect((await transient.run()).kind).toBe("authorized");

    const fatal = harness([new ApiError("invalid_request", 400)]);
    expect(await fatal.run()).toEqual({ kind: "error", code: "invalid_request" });
  });

  it("reports a failure to start", async () => {
    const result = await runDeviceFlow({
      start: async () => {
        throw new ApiError("upstream_unavailable", 502);
      },
      poll: async () => ({ status: "pending" }),
      sleep: async () => undefined,
      now: () => 0,
      onState: () => undefined,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ kind: "error", code: "upstream_unavailable" });
  });

  it("stops quietly when aborted (the member left the screen)", async () => {
    const { run, controller } = harness([{ status: "pending" }]);
    controller.abort();
    expect(await run()).toEqual({ kind: "aborted" });
  });
});
