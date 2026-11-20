// `npm run reset`: clear all local state (KV, Durable Objects, rate-limit counters) for this worktree.
// Stop the dev server first; it keeps the state files open.
import { persistDirectory, resetLocalState } from "./lib/state.ts";

const directory = persistDirectory();
resetLocalState(directory);
console.log(`Cleared all local state (${directory}). Run "npm run seed" to configure it again.`);
