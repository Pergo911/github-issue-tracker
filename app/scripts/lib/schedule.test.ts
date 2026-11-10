import { describe, expect, it } from "vitest";
import { runQueue, type Job } from "./schedule.ts";

/** A job that takes 20ms, recording when it starts and ends so overlaps are visible. */
async function timed(job: Job, log: string[]) {
  log.push(`start ${job.name}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  log.push(`end ${job.name}`);
}

/** The highest number of jobs that were inside `timed` at once. */
function peak(log: string[]): number {
  let inside = 0;
  let highest = 0;
  for (const entry of log) {
    inside += entry.startsWith("start") ? 1 : -1;
    highest = Math.max(highest, inside);
  }
  return highest;
}

describe("runQueue", () => {
  it("runs every job exactly once", async () => {
    const jobs: Job[] = [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }];
    const log: string[] = [];
    await runQueue(jobs, 2, (job) => timed(job, log));
    expect(log.filter((entry) => entry.startsWith("start"))).toHaveLength(4);
    expect(log.filter((entry) => entry.startsWith("end"))).toHaveLength(4);
  });

  it("never runs more than the limit at once", async () => {
    const jobs: Job[] = ["a", "b", "c", "d", "e", "f"].map((name) => ({ name }));
    const log: string[] = [];
    await runQueue(jobs, 2, (job) => timed(job, log));
    expect(peak(log)).toBe(2);
  });

  it("never runs two jobs of the same group at once, even with free slots", async () => {
    const jobs: Job[] = [
      { name: "visual", group: "browser" },
      { name: "e2e", group: "browser" },
      { name: "lint" },
      { name: "unit" },
    ];
    const running = new Set<string>();
    await runQueue(jobs, 4, async (job) => {
      if (job.group !== undefined) {
        expect(running.has(job.group)).toBe(false);
        running.add(job.group);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (job.group !== undefined) running.delete(job.group);
    });
  });

  it("lets ungrouped jobs use every slot", async () => {
    const jobs: Job[] = ["a", "b", "c"].map((name) => ({ name }));
    const log: string[] = [];
    await runQueue(jobs, 3, (job) => timed(job, log));
    expect(peak(log)).toBe(3);
  });

  it("still runs a grouped job when the only slot is taken by the other member", async () => {
    const jobs: Job[] = [
      { name: "visual", group: "browser" },
      { name: "e2e", group: "browser" },
    ];
    const log: string[] = [];
    await runQueue(jobs, 2, (job) => timed(job, log));
    expect(log).toEqual(["start visual", "end visual", "start e2e", "end e2e"]);
  });

  it("finishes with no jobs", async () => {
    await expect(runQueue([], 4, async () => {})).resolves.toBeUndefined();
  });
});
