// `npm run test:e2e [-- <playwright args>]`: the end-to-end suite against the real dev server, in your local
// browser. Starts two Vite servers on free ports with their own state (one seeded with the Appendix A
// configuration, one empty), runs axe, the pseudo-language sweep and the journeys, and cleans up.
// Examples:  npm run test:e2e -- boot.spec.ts      npm run test:e2e -- -g "home page"
import { prepareRun, runPlaywright } from "./lib/run.ts";

const extra = process.argv.slice(2);
const run = await prepareRun();
let code = 1;
try {
  code = await runPlaywright(["--project=chromium", ...extra], run.env);
} finally {
  run.cleanup();
}
process.exit(code);
