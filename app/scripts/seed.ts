// `npm run seed`: write the SPEC Appendix A configuration (Hungarian, Europe/Budapest) into local KV.
// Local state lives in PERSIST_DIR (default .wrangler/state inside this worktree). A running dev server
// reads KV on every request, so seeding while it runs takes effect immediately.
import { persistDirectory, seedLocalConfig } from "./lib/state.ts";

const directory = persistDirectory();
await seedLocalConfig(directory);
console.log(`Seeded the reference configuration into local KV (${directory}).`);
