import { cpus } from "node:os";

/**
 * The most steps `verify` runs at once, however large the machine. Past four they compete for the same memory,
 * and the two browser suites are the ones that lose: a saturated box turns a 200s screenshot run into 800s.
 */
const VERIFY_STEP_CEILING = 4;

/**
 * The most parallel Playwright browsers a suite spawns by default: caps larger laptops so parallel browsers do
 * not thrash memory (Playwright's default of half the threads was 11 on a 22-thread box).
 */
const PLAYWRIGHT_WORKER_CEILING = 4;

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * How many of `verify`'s steps may run at once on a machine with `logicalCpus` processors: half of them, at most
 * four and at least one. A constant of five was both too much for a 4-vCPU CI runner (both browser suites timed
 * out) and a poor fit for a 22-thread laptop shared with four other worktrees.
 */
export function defaultJobLimit(logicalCpus: number): number {
  return Math.max(1, Math.min(VERIFY_STEP_CEILING, Math.floor(logicalCpus / 2)));
}

/** `VERIFY_JOBS` wins when it is a positive whole number; anything else falls back to the machine's limit. */
export function jobLimit(requested: string | undefined, logicalCpus: number): number {
  return parsePositiveInt(requested) ?? defaultJobLimit(logicalCpus);
}

/** The limit this machine and environment ask for. */
export function machineJobLimit(environment: NodeJS.ProcessEnv = process.env): number {
  return jobLimit(environment["VERIFY_JOBS"], cpus().length);
}

/**
 * Default Playwright browser workers: match small CI runners (2 on a 2-vCPU runner) and cap at four on larger
 * laptops so parallel browsers do not thrash memory.
 */
export function defaultPlaywrightWorkers(logicalCpus: number): number {
  return Math.max(1, Math.min(PLAYWRIGHT_WORKER_CEILING, logicalCpus));
}

/** An explicit positive whole number wins; anything else falls back to `defaultPlaywrightWorkers`. */
export function playwrightWorkers(requested: string | undefined, logicalCpus: number): number {
  return parsePositiveInt(requested) ?? defaultPlaywrightWorkers(logicalCpus);
}

/** True when the caller already passed Playwright's `--workers` or `-j` flag. */
export function hasWorkersFlag(args: readonly string[]): boolean {
  return args.some(
    (argument) =>
      argument === "--workers" ||
      argument.startsWith("--workers=") ||
      argument === "-j" ||
      argument.startsWith("-j=") ||
      /^-j\d+$/.test(argument),
  );
}

/** Returns `["--workers=<n>"]` unless the caller already passed a worker flag on the CLI. */
export function playwrightWorkerArgs(
  envVar: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  logicalCpus: number = cpus().length,
): string[] {
  return hasWorkersFlag(args)
    ? []
    : [`--workers=${playwrightWorkers(environment[envVar], logicalCpus)}`];
}
