import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireMachineLock, machineLockPath } from "./machine-lock.ts";

const made: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "verify-lock-test-"));
  made.push(directory);
  return directory;
}

/** Plants a lock as another run would have left it. */
function plantLock(path: string, pid: number, task = "npm run verify (#24 recovery)"): void {
  mkdirSync(path);
  writeFileSync(
    join(path, "holder.json"),
    `${JSON.stringify({ pid, task, startedAt: "2026-11-09T12:52:31.650Z" })}\n`,
  );
}

afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("machineLockPath", () => {
  it("is one fixed name in the temp directory, so every worktree shares it", () => {
    expect(machineLockPath("/tmp")).toBe(join("/tmp", "fault-reports-verify.lock"));
    expect(machineLockPath("/tmp")).toBe(machineLockPath("/tmp"));
  });
});

describe("acquireMachineLock", () => {
  it("takes the lock, records the holder, and gives it back", async () => {
    const path = machineLockPath(scratch());
    const lock = await acquireMachineLock({ path, task: "the test" });

    expect(lock.held).toBe(true);
    expect(JSON.parse(readFileSync(join(path, "holder.json"), "utf8"))).toMatchObject({
      pid: process.pid,
      task: "the test",
    });

    lock.release();
    expect(() => readFileSync(join(path, "holder.json"), "utf8")).toThrow();
  });

  it("takes over a lock whose holder is gone", async () => {
    const path = machineLockPath(scratch());
    plantLock(path, 999_999);
    const messages: string[] = [];

    const lock = await acquireMachineLock({
      path,
      task: "the next run",
      alive: () => false,
      report: (message) => messages.push(message),
    });

    expect(lock.held).toBe(true);
    expect(messages).toEqual([]); // a dead holder is never worth waiting for
    lock.release();
  });

  it("does not wait when told not to, and leaves the holder's lock alone", async () => {
    const path = machineLockPath(scratch());
    plantLock(path, 4242);
    const messages: string[] = [];

    const lock = await acquireMachineLock({
      path,
      task: "the impatient run",
      wait: false,
      alive: () => true,
      report: (message) => messages.push(message),
    });

    expect(lock.held).toBe(false);
    expect(messages.join("\n")).toMatch(/another verify is running .*pid 4242/);
    expect(JSON.parse(readFileSync(join(path, "holder.json"), "utf8"))).toMatchObject({
      pid: 4242,
    });

    lock.release();
    expect(JSON.parse(readFileSync(join(path, "holder.json"), "utf8"))).toMatchObject({
      pid: 4242,
    });
  });

  it("waits for a live holder, then takes the lock once it is released", async () => {
    const path = machineLockPath(scratch());
    plantLock(path, 4242);
    const messages: string[] = [];
    let waited = 0;

    const lock = await acquireMachineLock({
      path,
      task: "the patient run",
      alive: () => true,
      report: (message) => messages.push(message),
      // The other run finishes during the first pause.
      sleep: async () => {
        waited += 1;
        rmSync(path, { recursive: true, force: true });
      },
    });

    expect(lock.held).toBe(true);
    expect(waited).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/waiting for another verify/);
    lock.release();
  });

  it("says so once and runs beside a holder it has waited too long for", async () => {
    const path = machineLockPath(scratch());
    plantLock(path, 4242);
    const messages: string[] = [];

    const lock = await acquireMachineLock({
      path,
      task: "the tired run",
      alive: () => true,
      timeoutMs: 0,
      report: (message) => messages.push(message),
      sleep: async () => {},
    });

    expect(lock.held).toBe(false);
    expect(messages.join("\n")).toMatch(/waiting for another verify/);
    expect(messages.join("\n")).toMatch(/running anyway/);
    lock.release();
    expect(JSON.parse(readFileSync(join(path, "holder.json"), "utf8"))).toMatchObject({
      pid: 4242,
    });
  });

  it("takes over a directory whose holder file never appeared", async () => {
    const path = machineLockPath(scratch());
    mkdirSync(path);

    const lock = await acquireMachineLock({
      path,
      task: "the recovering run",
      alive: () => true,
      report: () => {},
      sleep: async () => {},
    });

    expect(lock.held).toBe(true);
    lock.release();
  });
});
