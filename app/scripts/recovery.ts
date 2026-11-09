// `node scripts/recovery.ts <list|inspect|associate|discard> ...`: the operator procedure for submissions that need a
// person (SPEC 4.1, docs/runbook-submission-recovery.md). It calls the Admin-gated Worker endpoints with your own
// GitHub token (for example from `gh auth token`). Run it with no arguments for the usage.
import { runRecovery, USAGE } from "./lib/recovery.ts";

try {
  if (process.argv.length <= 2) {
    console.log(USAGE);
  } else {
    await runRecovery(process.argv.slice(2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
