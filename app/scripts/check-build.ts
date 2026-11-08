// Runs after `vite build` (npm run build): checks the shape of what was built.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkChunks, type Manifest } from "./lib/chunks.ts";
import { APP_ROOT } from "./lib/state.ts";

const manifestPath = join(APP_ROOT, "dist", "client", ".vite", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const problems = checkChunks(manifest);
if (problems.length > 0) {
  console.error(`Build check failed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("Build check passed: staff/ is its own chunk and reporters never load it.");
