import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localWorldPlugin, planLocalWorld } from "./fakes/node/local-world.ts";

// Concurrency rules (AGENTS.md "Parallel runs"): no fixed port, no shared global state.
//   PORT          the dev/preview port. Unset: Vite takes 5173 or the next free one. Set: that port or fail.
//   PERSIST_DIR   where local KV and Durable Object state lives. Default: .wrangler/state inside this worktree.
//   VITE_CACHE_DIR  Vite's dependency cache, so two dev servers in one worktree do not share it.
//   INSPECTOR_PORT  opt in to the Workers debugger on that port; off by default so servers never collide on 9229.
//   VITE_PSEUDO=1   enable the test-only pseudo-language (?lang=pseudo); the end-to-end servers set it.
//   FAKES_PORT      the port of the fake GitHub and fake Resend that `vite dev` hosts (default: a free one).
//   VITE_GITHUB_API_BASE  the SPA's GitHub API base, a build-time value (default https://api.github.com;
//                   `vite dev` points it at the fake GitHub).
const port = process.env["PORT"] ? Number(process.env["PORT"]) : undefined;
const inspectorPort = process.env["INSPECTOR_PORT"] ? Number(process.env["INSPECTOR_PORT"]) : false;

export default defineConfig(async ({ command }) => {
  // Only `vite dev` hosts the fakes (ticket #22); a build, and so production, never does.
  const world = command === "serve" ? await planLocalWorld(import.meta.dirname) : undefined;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(world ? [localWorldPlugin(world)] : []),
      cloudflare({
        // The plugin keeps its state in <path>/v3; scripts/lib/state.ts seeds into the same folder.
        persistState: { path: process.env["PERSIST_DIR"] ?? ".wrangler/state" },
        inspectorPort,
        // In `vite dev` the Worker reaches GitHub and Resend through the fakes.
        ...(world ? { config: (config) => ({ vars: { ...config.vars, ...world.vars } }) } : {}),
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve(import.meta.dirname, "src/shared"),
        "@worker": resolve(import.meta.dirname, "src/worker"),
        "@": resolve(import.meta.dirname, "src/client"),
      },
    },
    define: {
      __PSEUDO_LANGUAGE__: JSON.stringify(process.env["VITE_PSEUDO"] === "1"),
    },
    optimizeDeps: {
      // Scan every client route up front (including lazy `staff/` routes, excluding unit tests) so the first
      // visit to `/staff` in end-to-end runs does not trigger on-demand re-optimization and reload the page.
      entries: ["index.html", "src/client/**/*.{ts,tsx}", "!src/client/**/*.test.{ts,tsx}"],
    },
    cacheDir: process.env["VITE_CACHE_DIR"] ?? "node_modules/.vite",
    server: { port, strictPort: port !== undefined },
    preview: { port, strictPort: port !== undefined },
    build: { manifest: true },
  };
});
