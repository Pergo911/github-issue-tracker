// `npm run test:e2e [-- <playwright args>]`: the end-to-end suite against the real dev server, in your local
// browser. Starts three Vite servers on free ports with their own state (one seeded with the Appendix A
// configuration, two empty: one for the not-configured screen, one a journey configures), runs axe, the pseudo-language sweep and the journeys, and cleans up.
// Examples:  npm run test:e2e -- boot.spec.ts      npm run test:e2e -- -g "home page"
//
// Four browsers at once, not Playwright's default of half the processors (11 on a 22-thread machine): a journey
// that has to wait for a dev server under that many browsers times out instead. Measured on the thread that added
// the Board (#29): 12 of 23 failed at --workers=3, 3 at 2, and 23 of 23 passed at 1. To triage a failure, re-run
// it serially:  npm run test:e2e -- <spec> --workers=1   (E2E_WORKERS overrides the default.)
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { playwrightWorkerArgs } from "./lib/jobs.ts";
import { prepareRun, runPlaywright } from "./lib/run.ts";
import { APP_ROOT } from "./lib/state.ts";

const requested = process.argv.slice(2);
const failureResults = join(APP_ROOT, ".tmp", "e2e-results");

const run = await prepareRun();
let code: number;
try {
  code = await runPlaywright(
    ["--project=chromium", ...playwrightWorkerArgs("E2E_WORKERS", requested), ...requested],
    run.env,
  );
  // Preserve Playwright's failure evidence before `run.cleanup()` deletes the private run directory.
  if (code !== 0) {
    const testResults = join(run.directory, "test-results");
    if (existsSync(testResults)) {
      rmSync(failureResults, { recursive: true, force: true });
      cpSync(testResults, failureResults, { recursive: true });
    }
  }
} finally {
  run.cleanup();
}
process.exit(code);
