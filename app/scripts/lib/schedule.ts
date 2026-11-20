/** A unit of work for `runQueue`. */
export interface Job {
  name: string;
  /**
   * Jobs that share a group never run at the same time. The two browser suites (`test:visual` renders in
   * Playwright's Docker image, `test:e2e` drives three dev servers) are the pair: they are the two steps that
   * compete for the machine's memory, and running them together was the shape of every recorded timeout.
   */
  group?: string;
}

/**
 * Runs `jobs` with at most `limit` at once, and never two jobs of the same group at once. A worker that finds
 * nothing it may start but work still queued waits for a slot to free up, rather than giving up early.
 */
export async function runQueue<T extends Job>(
  jobs: readonly T[],
  limit: number,
  run: (job: T) => Promise<void>,
): Promise<void> {
  const queue = [...jobs];
  const busyGroups = new Set<string>();
  const waiters: (() => void)[] = [];
  const wake = () => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  async function take(): Promise<T | undefined> {
    for (;;) {
      const index = queue.findIndex((job) => job.group === undefined || !busyGroups.has(job.group));
      if (index !== -1) {
        const job = queue.splice(index, 1)[0] as T;
        if (job.group !== undefined) busyGroups.add(job.group);
        return job;
      }
      if (queue.length === 0) return undefined;
      // Everything left is waiting on a group that is running: wait for one of those to finish.
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const job = await take();
      if (job === undefined) return;
      try {
        await run(job);
      } finally {
        if (job.group !== undefined) busyGroups.delete(job.group);
        wake();
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, jobs.length));
  await Promise.all(Array.from({ length: workers }, worker));
}
