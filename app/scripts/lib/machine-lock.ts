import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Who holds the machine lock, so a run that has to wait can say whose turn it is. */
export interface Holder {
  pid: number;
  /** What the holding run is doing, in its own words. */
  task: string;
  /** ISO timestamp of when it took the lock. */
  startedAt: string;
}

export interface MachineLock {
  path: string;
  /** Whether this run holds the lock; false when it was told to run beside the holder, or gave up waiting. */
  held: boolean;
  release(): void;
}

export interface MachineLockOptions {
  /** What this run is doing: printed by whichever run has to wait for it. */
  task: string;
  /** The lock's directory. Default: one fixed name in the system temp directory, shared by every worktree. */
  path?: string;
  /** Wait for the holder instead of running beside it. Default true. */
  wait?: boolean;
  /** How long to wait before running anyway, in milliseconds. Default 30 minutes. */
  timeoutMs?: number;
  /** Prints the messages. Default `console.log`. */
  report?: (message: string) => void;
  /** Whether a process is still running. Injectable so a test can describe a dead holder. */
  alive?: (pid: number) => boolean;
  /** Suspends between attempts. Injectable so a test does not spend real seconds. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** The lock every `verify` on this machine shares, whichever worktree or repository it runs from. */
export function machineLockPath(temporaryDirectory: string = tmpdir()): string {
  return join(temporaryDirectory, "fault-reports-verify.lock");
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means a live process owned by somebody else. Any other code means it is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type ReadHolder = { kind: "holder"; holder: Holder } | { kind: "unknown" };

function readHolder(path: string): ReadHolder {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(path, "holder.json"), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Holder).pid === "number" &&
      typeof (parsed as Holder).task === "string"
    ) {
      return { kind: "holder", holder: parsed as Holder };
    }
  } catch {
    // Missing or half-written: the caller decides how long to give it.
  }
  return { kind: "unknown" };
}

function describe(holder: Holder): string {
  const started = holder.startedAt.slice(11, 16);
  return `pid ${holder.pid}, started ${started}, ${holder.task}`;
}

/**
 * Takes the machine-wide verify lock, or explains why it did not.
 *
 * Concurrent verifies are the recorded cause of this repository's false reds: four worktrees each running five
 * steps at once turned a 240s run into 823s and made `test:e2e` and `test:visual` time out in ways that looked
 * like product bugs. Waiting turns that into a queue. A killed holder is detected by its pid and taken over, and
 * a lock that cannot be created at all (a read-only temp directory) only warns: it must never block a run.
 */
export async function acquireMachineLock(options: MachineLockOptions): Promise<MachineLock> {
  const path = options.path ?? machineLockPath();
  const alive = options.alive ?? isRunning;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const report = options.report ?? ((message) => console.log(message));
  const wait = options.wait ?? true;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const holder: Holder = {
    pid: process.pid,
    task: options.task,
    startedAt: new Date().toISOString(),
  };
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  let unknownTries = 0;

  const release = (): void => {
    // Never delete a lock somebody else took over: after a kill, the next run may already hold it.
    const current = readHolder(path);
    if (current.kind === "holder" && current.holder.pid !== process.pid) return;
    rmSync(path, { recursive: true, force: true });
  };

  for (;;) {
    try {
      // `mkdir` is the atomic part on both Windows and POSIX: it fails when the directory is already there.
      mkdirSync(path);
      writeFileSync(join(path, "holder.json"), `${JSON.stringify(holder)}\n`);
      return { path, held: true, release };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        report(`could not take the verify lock (${(error as Error).message}): running without it`);
        return { path, held: false, release: () => {} };
      }
    }

    const current = readHolder(path);
    if (current.kind === "unknown") {
      // Either a run is writing its holder file right now, or a killed one left the directory behind.
      unknownTries += 1;
      if (unknownTries < 10) {
        await sleep(200);
        continue;
      }
      rmSync(path, { recursive: true, force: true });
      unknownTries = 0;
      continue;
    }
    unknownTries = 0;

    if (!alive(current.holder.pid)) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }

    if (!wait) {
      report(`another verify is running (${describe(current.holder)}); not waiting for it`);
      return { path, held: false, release: () => {} };
    }
    if (!announced) {
      announced = true;
      report(
        `waiting for another verify on this machine (${describe(current.holder)}).\n` +
          `  VERIFY_NO_WAIT=1 runs beside it; that is what made the 800s runs and the false reds.`,
      );
    }
    if (Date.now() >= deadline) {
      report(`waited ${Math.round(timeoutMs / 60_000)} minutes; running anyway`);
      return { path, held: false, release: () => {} };
    }
    await sleep(1000);
  }
}
