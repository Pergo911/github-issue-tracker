import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { on, once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireMachineLock, machineLockPath, type MachineLock } from "./machine-lock.ts";

const made: string[] = [];
const holders: MachineLock[] = [];

async function hold(path: string): Promise<MachineLock> {
  const lock = await acquireMachineLock({ path, task: "another verify" });
  holders.push(lock);
  return lock;
}

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
  vi.restoreAllMocks();
  for (const lock of holders.splice(0)) lock.release();
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("machineLockPath", () => {
  it("is one fixed name in the temp directory, so every worktree shares it", () => {
    expect(machineLockPath("/tmp")).toBe(join("/tmp", "fault-reports-verify.lock"));
    expect(machineLockPath("/tmp")).toBe(machineLockPath("/tmp"));
  });
});

describe("acquireMachineLock", () => {
  it("admits only one competing process at a time after a holder is killed", async () => {
    const path = machineLockPath(scratch());
    const children: ChildProcess[] = [];
    const start = () => {
      const child = fork(new URL("./testing/machine-lock-holder.ts", import.meta.url), [path], {
        execArgv: [],
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      children.push(child);
      const messages = on(child, "message");
      return { child, next: async () => (await messages.next()).value?.[0] as unknown };
    };
    try {
      const holder = start();
      expect(await holder.next()).toBe("held");
      const contenders = [start(), start(), start()];
      expect(await Promise.all(contenders.map((contender) => contender.next()))).toEqual([
        "waiting",
        "waiting",
        "waiting",
      ]);
      const killed = once(holder.child, "exit");
      holder.child.kill("SIGKILL");
      await killed;

      while (contenders.length > 0) {
        for (const contender of contenders) contender.child.send("retry");
        const states = await Promise.all(contenders.map((contender) => contender.next()));
        expect(states.filter((state) => state === "held")).toHaveLength(1);
        expect(states.every((state) => state === "held" || state === "waiting")).toBe(true);
        const [winner] = contenders.splice(states.indexOf("held"), 1);
        if (!winner) throw new Error("No contender acquired the lock.");
        const exited = once(winner.child, "exit");
        winner.child.send("release");
        await exited;
      }
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
        }),
      );
    }
  });

  it("never lets an old release remove a replacement holder's lock", async () => {
    const path = machineLockPath(scratch());
    const first = await acquireMachineLock({ path, task: "first" });
    first.release();
    const replacement = await acquireMachineLock({ path, task: "replacement" });
    try {
      first.release();
      const contender = await acquireMachineLock({
        path,
        task: "contender",
        wait: false,
        report: () => {},
      });
      try {
        expect(contender.held).toBe(false);
      } finally {
        contender.release();
      }
    } finally {
      replacement.release();
    }
  });

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
      report: (message) => messages.push(message),
    });

    expect(lock.held).toBe(true);
    expect(messages).toEqual([]); // a dead holder is never worth waiting for
    lock.release();
  });

  it("does not wait when told not to, and leaves the holder's lock alone", async () => {
    const path = machineLockPath(scratch());
    await hold(path);
    const messages: string[] = [];

    const lock = await acquireMachineLock({
      path,
      task: "the impatient run",
      wait: false,
      report: (message) => messages.push(message),
    });

    expect(lock.held).toBe(false);
    expect(messages.join("\n")).toContain(`another verify is running (pid ${process.pid}`);
    expect(JSON.parse(readFileSync(join(path, "holder.json"), "utf8"))).toMatchObject({
      task: "another verify",
    });

    lock.release();
    expect(JSON.parse(readFileSync(join(path, "holder.json"), "utf8"))).toMatchObject({
      task: "another verify",
    });
  });

  it("waits for a live holder, then takes the lock once it is released", async () => {
    const path = machineLockPath(scratch());
    const holder = await hold(path);
    const messages: string[] = [];
    let waited = 0;

    const lock = await acquireMachineLock({
      path,
      task: "the patient run",
      report: (message) => messages.push(message),
      // The other run finishes during the first pause.
      sleep: async () => {
        waited += 1;
        holder.release();
      },
    });

    expect(lock.held).toBe(true);
    expect(waited).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/waiting for another verify/);
    lock.release();
  });

  it("keeps waiting beyond thirty minutes until the holder releases", async () => {
    const path = machineLockPath(scratch());
    const holder = await hold(path);
    const messages: string[] = [];

    let now = 0;
    let waited = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const lock = await acquireMachineLock({
      path,
      task: "the tired run",
      report: (message) => messages.push(message),
      sleep: async () => {
        waited += 1;
        now += 31 * 60_000;
        if (waited === 2) holder.release();
      },
    });

    expect(lock.held).toBe(true);
    expect(waited).toBe(2);
    expect(messages.join("\n")).toMatch(/waiting for another verify/);
    expect(messages.join("\n")).not.toMatch(/running anyway/);
    lock.release();
  });

  it("takes over a directory whose holder file never appeared", async () => {
    const path = machineLockPath(scratch());
    mkdirSync(path);

    const lock = await acquireMachineLock({
      path,
      task: "the recovering run",
      report: () => {},
      sleep: async () => {},
    });

    expect(lock.held).toBe(true);
    lock.release();
  });

  it("does not reclaim a live lock just because its advisory holder file is missing", async () => {
    const path = machineLockPath(scratch());
    await hold(path);
    rmSync(join(path, "holder.json"));

    const contender = await acquireMachineLock({
      path,
      task: "contender",
      wait: false,
      report: () => {},
      sleep: async () => {},
    });
    try {
      expect(contender.held).toBe(false);
    } finally {
      contender.release();
    }
  });

  it("fails rather than running unlocked when the lock cannot be opened", async () => {
    const path = machineLockPath(scratch());
    writeFileSync(path, "not a lock directory");
    await expect(acquireMachineLock({ path, task: "the run" })).rejects.toThrow();
  });
});
