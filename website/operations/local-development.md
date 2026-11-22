# Local Development

You do not need a GitHub Organization, Resend API key, or Cloudflare account to develop or evaluate Issue Tracker locally. Running `npm run dev` in `app/` launches a complete **local world** — stateful in-memory fakes of `api.github.com`, GitHub's Device Flow endpoints, and `api.resend.com` — wired directly to the local Worker and SPA.

## Prerequisites

- **Node 24+** (the repository targets Node 26 via `app/.node-version`)
- **npm**
- **Docker** *(only required for `npm run test:visual`)*

## Starting the local world

From `app/`:

```powershell
npm ci
npm run seed
npm run dev
```

`npm run seed` writes the reference configuration into local Wrangler KV (`.wrangler/state`). `npm run dev` starts the SPA, Worker, and local fake services on port `5173` (or the next free port; set `PORT=<n>` to pin one).

In a second terminal, populate sample Staff accounts, Taxonomy labels, and Reports into the running local world:

```powershell
cd app
npm run world -- seed
npm run world -- summary
```

### Useful `npm run world` commands

Because the local fakes hold state in memory, restarting `npm run dev` resets them. While the dev server is running, inspect and drive it with `npm run world -- <method>`:

| Command | Purpose |
| --- | --- |
| `npm run world -- seed` | Seeds labels, one Staff user per role (with tokens), and sample Reports. |
| `npm run world -- summary` | Prints current repositories, issues, users, tokens, and outbox summary. |
| `npm run world -- latestMailTo <email>` | Reads the latest email sent to an address (e.g., to copy a 6-digit OTP). |
| `npm run world -- outbox` | Lists all emails captured by the fake Resend server. |
| `npm run world -- deviceCodes` | Lists pending GitHub Device Flow codes. |
| `npm run world -- approveDeviceCode <CODE> <login>` | Approves a pending Device Flow login for a seeded Staff user. |
| `npm run world -- reset` | Clears in-memory fake GitHub and Resend state. |

To reset local Wrangler KV and Durable Object state on disk, run `npm run reset` (then `npm run seed` again).

## Running the Windows desktop shell locally

With `app/` running on `http://localhost:5173`, open another terminal in `shell/`:

```powershell
cd shell
npm ci
$env:APP_URL = "http://localhost:5173"
npm start
```

Unpackaged `npm start` permits `http://localhost` origins; packaged builds require HTTPS.

## Verification commands

Run from `app/`:

| Command | What it runs |
| --- | --- |
| `npm run verify -- --fast` | Typecheck, ESLint, Prettier check, unit tests, Worker tests, and tooling checks (no browser or Docker). |
| `npm run test:unit` | Vitest in Node (`shared/`, client logic, fakes, lint rules, i18n catalog completeness). |
| `npm run test:worker` | Vitest in the local Cloudflare Workers runtime (KV, Durable Objects, rate limits, fakes). |
| `npm run test:e2e` | Playwright end-to-end journeys, axe accessibility checks, and pseudo-language sweep against the dev server. |
| `npm run screenshots` | Captures all declared screens in light & dark mode at 1280px and 375px. |
| `npm run test:visual` | Compares declared screens against `app/e2e/reference/*.png` inside Playwright's Docker container. |
| `npm run verify` | Full verification suite (everything above). |

::: tip Parallel worktrees
Nothing in `app/` or `shell/` uses fixed ports or shared global state. `npm run verify` coordinates across worktrees with a lockfile so parallel runs do not contend for CPU or browser resources.
:::
