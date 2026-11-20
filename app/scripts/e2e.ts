// `npm run test:e2e [-- <playwright args>]`: the end-to-end suite against the real dev server, in your local
// browser. Starts three Vite servers on free ports with their own state (one seeded with the Appendix A
// configuration, two empty: one for the not-configured screen, one a journey configures), runs axe, the pseudo-language sweep and the journeys, and cleans up.
// Examples:  npm run test:e2e -- boot.spec.ts      npm run test:e2e -- -g "home page"
//
// Four browsers at once, not Playwright's default of half the processors (11 on a 22-thread machine): a journey
// that has to wait for a dev server under that many browsers times out instead. Measured on the thread that added
// the Board (#29): 12 of 23 failed at --workers=3, 3 at 2, and 23 of 23 passed at 1. To triage a failure, re-run
// it serially:  npm run test:e2e -- <spec> --workers=1   (E2E_WORKERS overrides the default.)
import { prepareRun, runPlaywright } from "./lib/run.ts";

const requested = process.argv.slice(2);
const hasWorkers = requested.some(
  (argument) => argument === "--workers" || argument.startsWith("--workers="),
);
const workers = process.env["E2E_WORKERS"] ?? "4";

const run = await prepareRun();
let code: number;
try {
  code = await runPlaywright(
    ["--project=chromium", ...(hasWorkers ? [] : [`--workers=${workers}`]), ...requested],
    run.env,
  );
} finally {
  run.cleanup();
}
process.exit(code);
