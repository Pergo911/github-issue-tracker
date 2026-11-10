import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  /** Whether this run holds the lock; false only when explicitly told to run beside the holder. */
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
  /** Prints the messages. Default `console.log`. */
  report?: (message: string) => void;
  /** Suspends between attempts. Injectable so a test does not spend real seconds. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** The lock every `verify` on this machine shares, whichever worktree or repository it runs from. */
export function machineLockPath(temporaryDirectory: string = tmpdir()): string {
  return join(temporaryDirectory, "fault-reports-verify.lock");
}

type ReadHolder = { kind: "holder"; holder: Holder } | { kind: "unknown" };

function readHolder(path: string): ReadHolder {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(path, "holder.json"), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Holder).pid === "number" &&
      typeof (parsed as Holder).task === "string" &&
      typeof (parsed as Holder).startedAt === "string"
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
 * Takes the machine-wide verify lock, unless explicitly told to run beside its holder.
 *
 * Concurrent verifies are the recorded cause of this repository's false reds: four worktrees each running five
 * steps at once turned a 240s run into 823s and made `test:e2e` and `test:visual` time out in ways that looked
 * like product bugs. Waiting turns that into a queue. SQLite's transaction lock is released by the OS when a
 * holder dies: no contender ever deletes a stale directory or database and accidentally removes a new lock.
 * The database stays in place between runs; holder.json is only advisory information for the waiting message.
 * Errors fail the run rather than silently disabling serialization; only `wait: false` permits an unlocked run.
 */
export async function acquireMachineLock(options: MachineLockOptions): Promise<MachineLock> {
  const path = options.path ?? machineLockPath();
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const report = options.report ?? ((message) => console.log(message));
  const wait = options.wait ?? true;
  const holder: Holder = {
    pid: process.pid,
    task: options.task,
    startedAt: new Date().toISOString(),
  };
  let announced = false;
  mkdirSync(path, { recursive: true });
  const database = new DatabaseSync(join(path, "lock.sqlite"));
  let held = false;
  try {
    // Poll asynchronously instead of blocking Node (and other acquisitions in this process) inside SQLite.
    database.exec("PRAGMA busy_timeout = 0");
    for (;;) {
      try {
        database.exec("BEGIN IMMEDIATE");
      } catch (error) {
        // SQLITE_BUSY means another connection owns the write lock. All other failures must fail closed.
        if ((error as { errcode?: number }).errcode !== 5) throw error;
        const current = readHolder(path);
        const description =
          current.kind === "holder" ? describe(current.holder) : "holder details not yet available";
        if (!wait) {
          report(`another verify is running (${description}); not waiting for it`);
          return { path, held: false, release: () => {} };
        }
        if (!announced) {
          announced = true;
          report(
            `waiting for another verify on this machine (${description}).\n` +
              `  VERIFY_NO_WAIT=1 runs beside it; that is what made the 800s runs and the false reds.`,
          );
        }
        await sleep(1000);
        continue;
      }
      writeFileSync(join(path, "holder.json"), `${JSON.stringify(holder)}\n`);
      held = true;
      let released = false;
      return {
        path,
        held: true,
        release() {
          if (released) return;
          released = true;
          try {
            // Remove only the advisory file, while this connection still exclusively owns the lock.
            rmSync(join(path, "holder.json"), { force: true });
          } finally {
            database.close();
          }
        },
      };
    }
  } finally {
    if (!held) database.close();
  }
}
