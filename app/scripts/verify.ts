// `npm run verify`: the definition of done. Runs every check, in parallel where it is safe, and fails (exit 1)
// if any of them fails. Nothing is skipped unless you ask, and a skip is printed in the summary.
//
//   npm run verify                        everything: the full loop, including browsers and Docker
//   npm run verify -- --fast              typecheck, lint, format, unit, worker, tooling: no browser, no Docker
//   npm run verify -- --only lint,test:unit
//   npm run verify -- --skip test:visual  (VERIFY_SKIP=test:visual does the same, for a machine without Docker)
//   VERIFY_JOBS=2 npm run verify          fewer steps at once (default: half the processors, at most 4)
//   VERIFY_NO_WAIT=1 npm run verify       run beside another verify instead of queueing behind it
//
// One verify per machine at a time: the run takes a lock (scripts/lib/machine-lock.ts) and waits while another
// worktree's verify holds it, because two at once is what made recorded runs take 800s and turn into false reds.
// Each step's full output goes to .tmp/verify-<time>/<step>.log; a failed step prints its tail here.
import { cpus } from "node:os";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { machineJobLimit } from "./lib/jobs.ts";
import { acquireMachineLock } from "./lib/machine-lock.ts";
import { runQueue } from "./lib/schedule.ts";
import { APP_ROOT } from "./lib/state.ts";

interface Step {
  name: string;
  /** What it checks, for the summary. */
  covers: string;
  /** In the `--fast` subset: needs no browser and no Docker. */
  fast: boolean;
  /** Steps that share a group never run at the same time: they compete for the same memory. */
  group?: string;
}

// Slowest first, so the parallel stage overlaps them with the quick ones.
const STEPS: Step[] = [
  {
    name: "typecheck",
    covers: "tsc over the client, worker, shared, test and tooling projects",
    fast: true,
  },
  {
    name: "test:visual",
    covers: "reference screenshots, rendered in Playwright's Docker image",
    fast: false,
    group: "browser",
  },
  {
    name: "test:e2e",
    covers: "journeys, axe, pseudo-language sweep, in the real dev server",
    fast: false,
    group: "browser",
  },
  {
    name: "test:tooling",
    covers: "boundaries (compile), seed and reset, build checks",
    fast: true,
  },
  {
    name: "lint",
    covers: "ESLint: boundaries, no literal text, no hard-coded colours",
    fast: true,
  },
  {
    name: "test:worker",
    covers: "the Worker in the local Workers runtime (KV, Durable Objects, rate limits)",
    fast: true,
  },
  { name: "build", covers: "vite build and the staff-chunk check", fast: false },
  { name: "format:check", covers: "Prettier", fast: true },
  {
    name: "test:unit",
    covers: "shared, client, lint rules, catalog completeness, property tests",
    fast: true,
  },
];

/** Steps that must not overlap with each other: both build into .tsbuild/, so typecheck goes first, alone. */
const FIRST = "typecheck";
/** Steps run at once: as many as the machine carries, and never two browser suites together (see `group`). */
const PARALLEL = machineJobLimit();

function option(name: string): string[] {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value ? value.split(",").filter(Boolean) : [];
}

const only = option("only");
const skip = [...option("skip"), ...(process.env["VERIFY_SKIP"]?.split(",").filter(Boolean) ?? [])];
const fast = process.argv.includes("--fast");
for (const name of [...only, ...skip]) {
  if (!STEPS.some((step) => step.name === name)) {
    console.error(`Unknown step "${name}". Steps: ${STEPS.map((step) => step.name).join(", ")}`);
    process.exit(2);
  }
}

const selected = (step: Step) =>
  (only.length === 0 || only.includes(step.name)) && (!fast || step.fast);
const skipped = STEPS.filter((step) => !selected(step) || skip.includes(step.name));
const toRun = STEPS.filter((step) => !skipped.includes(step));

const logs = join(APP_ROOT, ".tmp", `verify-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(logs, { recursive: true });

interface Outcome {
  step: Step;
  ok: boolean;
  seconds: number;
  tail: string;
}

function runStep(step: Step): Promise<Outcome> {
  const started = Date.now();
  console.log(`▶ ${step.name}`);
  return new Promise((resolve) => {
    const log = createWriteStream(join(logs, `${step.name.replace(/:/g, "-")}.log`));
    const lines: string[] = [];
    const child = spawn(`npm run --silent ${step.name}`, {
      cwd: APP_ROOT,
      shell: true,
      env: process.env,
    });
    const keep = (chunk: Buffer) => {
      log.write(chunk);
      lines.push(...chunk.toString().split("\n"));
      if (lines.length > 400) lines.splice(0, lines.length - 400);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.once("error", (error) => keep(Buffer.from(String(error))));
    child.once("close", (code) => {
      log.end();
      const seconds = (Date.now() - started) / 1000;
      const ok = code === 0;
      console.log(`${ok ? "✔" : "✘"} ${step.name} (${seconds.toFixed(1)}s)`);
      resolve({ step, ok, seconds, tail: lines.slice(-60).join("\n").trimEnd() });
    });
  });
}

async function runAll(): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const first = toRun.find((step) => step.name === FIRST);
  if (first) outcomes.push(await runStep(first));
  const queue = toRun.filter((step) => step !== first);
  await runQueue(queue, PARALLEL, async (step) => {
    outcomes.push(await runStep(step));
  });
  return outcomes;
}

console.log(
  `verify: ${toRun.length} steps, up to ${PARALLEL} at a time on ${cpus().length} processors.`,
);

const lock = await acquireMachineLock({
  task: `npm run verify in ${APP_ROOT}`,
  wait: process.env["VERIFY_NO_WAIT"] !== "1",
});

const started = Date.now();
const outcomes = await (async () => {
  try {
    return await runAll();
  } finally {
    lock.release();
  }
})();
const failed = outcomes.filter((outcome) => !outcome.ok);

for (const outcome of failed) {
  console.log(
    `\n──── ${outcome.step.name} FAILED (last lines; full log: ${logs}) ────\n${outcome.tail}`,
  );
}

console.log("\nverify summary");
for (const step of STEPS) {
  const outcome = outcomes.find((candidate) => candidate.step === step);
  const mark = outcome ? (outcome.ok ? "pass" : "FAIL") : "SKIPPED";
  const time = outcome ? `${outcome.seconds.toFixed(1)}s` : "";
  console.log(`  ${mark.padEnd(8)} ${step.name.padEnd(13)} ${time.padStart(7)}  ${step.covers}`);
}
console.log(`  total ${((Date.now() - started) / 1000).toFixed(1)}s, logs in ${logs}`);

if (skipped.length > 0) {
  console.log(`\nNOT A FULL VERIFY: skipped ${skipped.map((step) => step.name).join(", ")}.`);
}
if (failed.length > 0) {
  console.log(`\nverify FAILED: ${failed.map((outcome) => outcome.step.name).join(", ")}`);
  process.exit(1);
}
console.log(skipped.length > 0 ? "\nverify passed (partial)." : "\nverify passed.");
