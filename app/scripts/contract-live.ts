// `npm run test:contract:live`: the contract suite (fakes/node/contract) against the fake AND the live
// `reports-sandbox` repo with the real Bot. Credentials: see AGENTS.md ("The live contract suite").
// Extra arguments reach Vitest. Every sandbox issue the run creates is closed as `not_planned`.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--project",
    "unit",
    "fakes/node/contract",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: { ...process.env, CONTRACT_LIVE: "1" } },
);
process.exit(result.status ?? 1);
