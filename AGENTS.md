# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this repository is

A **fault-reporting and maintenance-tracking system** ("Hibabejelentő és karbantartás-kezelő rendszer") for a
building (társasház), institution, or organization, with reporter, maintenance-staff, and admin roles. This
repository is where the product lives: the design documents, `app/` (the SPA and the Worker) and `shell/` (the
Windows Electron wrapper). The original requirements brief is in Hungarian in
[`Ticket Management System Feladatleírás.md`](./Ticket%20Management%20System%20Feladatleírás.md). It
deliberately leaves the exact roles, permissions, categories, priorities, statuses, and stored data open;
`SPEC.md` records the decisions.

The implementation plan is the sub-issues of [#19](https://github.com/Pergo911/github-issue-tracker/issues/19);
GitHub's blocking links show which are ready. Each ticket is done when it meets the definition of done below.

## Working in `app/`

Run everything from `app/`, with npm. `package.json` has the full script list; these are the ones to reach for:

| Command | What it checks | Run it |
| --- | --- | --- |
| `npm run verify` | **all of the below**, red on any failure (about 4 minutes on an idle machine) | before you call a ticket done |
| `npm run doctor` | this machine's processors, free memory and busiest processes, and what to run here | first, when a suite is slower or redder than it should be |
| `VERIFY_JOBS=2 npm run verify` | the same with two steps at a time | when the run has to share the machine |
| `npm run verify -- --fast` | typecheck, lint, format, unit, worker, tooling: no browser, no Docker | while you work |
| `npm run typecheck` | `wrangler types`, then `tsc -b` over client, worker, shared, tests, tooling | after type-level changes |
| `npm run lint` · `npm run format` | ESLint (`format:check` is Prettier's check) | before committing |
| `npm run test:unit` | Vitest in Node: `shared/`, client logic, the fakes (`fakes/`), lint rules, catalog completeness (about 3 s) | on every `shared/` or client-logic change |
| `npm run test:worker` | Vitest in the local Workers runtime, against the fake GitHub and Resend: KV, Durable Objects, rate limits | on every Worker change |
| `npm run test:tooling` | compile-time boundaries, seed and reset, chunk check | after touching tsconfig, scripts or the build |
| `npm run test:contract` | the contract suite against the fake only (it also runs inside `test:unit`) | after changing a fake |
| `npm run test:contract:live` | the same scenarios against the fake **and** the live `reports-sandbox` repo with the real Bot | after changing a fake or anything that depends on GitHub's behaviour; see below |
| `npm run check:titles` · `npm run capture:webhooks` | the live title-alphabet check · re-record the real webhook payloads | when GitHub's behaviour may have changed |
| `npm run test:e2e` | Playwright against the real dev server: journeys, axe, pseudo-language sweep | after UI or API changes |
| `npm run screenshots` | every declared screen, light and dark, 1280 and 375 px, Hungarian, in your local browser | for every screen you add or change |
| `npm run test:visual` | the same screens against `e2e/reference/*.png`, rendered in Playwright's Docker image | in `verify`; run it alone after UI changes |
| `npm run test:visual:update` | rewrites the reference images | only after you opened the diffs and each change is intended |
| `npm run dev` · `npm run seed` · `npm run reset` | the dev server (it hosts the fake GitHub and Resend) · Appendix A configuration into local KV · clear all local state | seed once per worktree before `dev` |
| `npm run recovery -- <list\|inspect\|associate\|discard> ...` | the operator CLI for submissions that need a person (`docs/runbook-submission-recovery.md`) | against a deployed Worker with your own GitHub token; the e2e tests run it against the dev server |
| `npm run world -- <method> [arg ...]` | drives the running local world: seed Reports and Staff users, approve a device code, read the outbox, inject faults | with `npm run dev` running; see below |

`npm run setup` installs the Chromium that `test:e2e` and `screenshots` use. `npm run test:visual` needs Docker
running. Extra arguments reach Playwright: `npm run test:e2e -- -g "home page"`. Run Playwright through these
scripts, never `npx playwright test`: they pick the ports and state the run needs.

A red `test:e2e` is the machine until a serial run says otherwise: re-run the journey alone with
`--workers=1` before you touch the code (the suite runs four browsers at once, `E2E_WORKERS` overrides it, and
at eleven — Playwright's default — recorded runs failed 12 of 23). While iterating on a screen, scope the
reference images the same way (`npm run test:visual -- -g <screen-id>`): the full list is every declared screen
at two sizes in two schemes, and about four minutes.

### Definition of done

1. `npm run verify` is green, with nothing skipped.
2. Every screen and state you add or change is declared in `app/e2e/screens.ts`. That one list drives the
   screenshots, the reference images, axe in light and dark, and the pseudo-language sweep that fails on any
   visible text or accessible name that did not come from the catalog. Name data that is legitimately not
   catalog wording (a Report's title, a date) in the entry's `allowText`.
3. `npm run screenshots`, then **open every image** of every screen you added or changed (the Read tool shows
   images) and check it against `docs/ui-github-look.md` and the catalog: measurements, tokens, wording, light
   and dark, 375 px. Fix what you find and capture again.
4. A red `test:visual` is a question: open the images in `.screenshots/diffs/index.html` (actual, expected, diff).
   An unintended change is a bug. An intended one gets `npm run test:visual:update`, then open each changed
   `e2e/reference/*.png` and commit it with the code.
5. The closing comment on the ticket lists the screens you opened, what you checked and what you fixed.

An interactive browser preview, where your environment has one, is for exploring on top of the screenshots,
never instead of them.

### Test-first, at a seam

Write the failing test first, at the public seam: a Zod schema, `callApi`, an endpoint through the real Worker,
a screen through the real dev server. Tests sit beside the code (`*.test.ts`), end-to-end specs in `e2e/`.
The tooling: Vitest 5, `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`, which is
deprecated; its test API is `import { env, exports } from "cloudflare:workers"`), fast-check for property
tests (codecs, validators), Playwright with `@axe-core/playwright`, ESLint 10 with typescript-eslint, Prettier.
Component tests need a DOM: add `happy-dom` to the `unit` project when the first one does.

### Conventions the code cannot confess

- **Three environments, one compiler.** `client` has DOM types, `worker` has Workers types, `shared` has
  neither, as three composite tsconfig projects, so a client↔worker import or an environment global in `shared/`
  fails to compile; the lint rule `reports/no-layer-crossing` says the same about `reporter/` and `staff/`.
  Reach `staff/` only through a lazy route or `import()`, so it stays its own chunk (`npm run build` checks).
- **One API contract.** A new endpoint is declared in `src/shared/api/endpoints.ts` (method, `/api/` path, Zod
  request schema, `type<Response>()`, error codes with HTTP statuses), registered in the Worker through
  `registerEndpoint`, and called from the SPA through `callApi`. Every error code needs an `api.error.<code>`
  message in `en.ts` and `hu.ts`; the types enforce it. An endpoint that declares `role: "viewer" | "maintenance" | "admin"`
  is gated: `registerEndpoint` installs `requireRole` for it (the caller's GitHub token as `Authorization: Bearer`, checked
  against the repo `permissions`, failing closed) and the handler receives `caller`; a gated endpoint cannot be registered
  without its gate. Path parameters are not in the contract yet: extend
  `defineEndpoint`, `registerEndpoint` and `callApi` together, with a test, when a ticket needs them.
- **Words live in the catalog.** Add each string to `src/shared/i18n/en.ts` and `hu.ts` and render
  `t("key")`; the catalog test fails when `hu` lacks one, and `reports/no-literal-text` rejects text in JSX.
  The boot screens that show before the configuration loads are English by design.
- **Colours live in the theme.** Components use the token classes of `src/client/ui/theme.css` (`bg-card`,
  `text-muted-foreground`, `border-border`, …); `reports/no-hardcoded-colors` rejects hex, rgb, hsl and
  Tailwind palette classes. A copied shadcn component is restyled to Primer's measurements, loses its Lucide
  icons for Octicons and its built-in English for catalog strings (`components.json` is set up for
  `npx shadcn add`).
- **Bindings and secrets** are declared once in `wrangler.jsonc` (secrets under `secrets.required`, mirrored in
  `.dev.vars.example`); run `npm run types` after editing it. Worker tests get the secrets as fixed values
  from `vitest.config.ts` (the Bot key is a throwaway generated per run). The GitHub and Resend base URLs are plain
  `vars`, defaulting to the real services.
- **Versions are pinned, and two are held back on purpose.** TypeScript stays on 6.0.x until typescript-eslint
  supports 7. npm 12 blocks install scripts unless `package.json` lists them under `allowScripts` (`esbuild`,
  `workerd`).
- **Scripts run as native TypeScript** (Node strips the types): erasable syntax only, `.ts` extensions on
  relative imports, no path aliases under `scripts/`.

### The local world: a fake GitHub and a fake Resend

`vite dev` is the whole local world. It hosts stateful fakes of `api.github.com`, github.com's device-flow
endpoints and `api.resend.com` (`fakes/`), points the Worker's variables (`GITHUB_API_BASE`, `GITHUB_WEB_BASE`,
`RESEND_API_BASE`) and the SPA's build-time `VITE_GITHUB_API_BASE` at them, and prints the URL. In production the
variables are the real services (the defaults in `wrangler.jsonc`) and `vite build` never hosts the fakes. The
fakes keep their state in memory: a dev-server restart is a reset.

- **Run, seed, inspect.** Start `npm run dev`, then `npm run world -- seed` (the Appendix A labels, one Staff user
  per role with its token, a few Reports), `summary` (everything, tokens included), `outbox` and
  `latestMailTo <address>` (read the OTP there), `deviceCodes` and `approveDeviceCode <ABCD-EFGH> <login>` (sign a
  Staff member in), `addFault '<json>'`, `reset`. Every method of the `Control` interface in `fakes/control.ts` works;
  `GET <world url>/control/summary` works in a browser. `npm run world` finds the world through
  `<PERSIST_DIR>/world.json` (or `WORLD_URL`). The Worker's smoke routes `POST /api/_dev/smoke` and
  `GET /api/_dev/whoami` exist only there (`LOCAL_WORLD`), as the demo. So does `POST /api/_dev/allowlist`
  (`{email}`), which puts an address on the Allowlist until the Allowlist screen exists. In the local world the
  per-IP limits key on an `x-dev-client-ip` request header when present, so parallel end-to-end tests give
  each journey its own address (`e2e/submission.spec.ts`). Screens that would spend the real code budget or
  the per-IP limit fake `/api/reports/*` with `page.route` instead (`e2e/screens.ts`).
- **Worker tests and the gates.** A Durable Object's storage persists across the tests of one file: give each
  test its own email (its Email gate keeps the 60 s cooldown), and note `setup.ts` empties the Global gate
  before every test. Hold the fake GitHub's webhooks (`holdWebhooks`) in a test that uses the `lost-response`
  fault, or the shared teardown waits for a delivery that never answers.
- **What the fakes model.** Issues, labels, comments, the timeline, search, the repo `permissions` per token, App JWT
  checking, installation tokens, device flow (every outcome scriptable), signed `issues` webhooks with switches for
  duplicate and out-of-order delivery, CORS, and faults (timeout, 5xx, "created, but the response was lost"). The
  fakes are stricter than GitHub in one way on purpose: they require `User-Agent` and `X-GitHub-Api-Version: 2022-11-28`
  (the one constant in `shared/github/constants.ts`). Live GitHub creates an unknown label (settled by ticket #32); whether Triage
  may set labels in a PATCH is still unconfirmed (no Triage account in the sandbox), so `triageCanLabel` stays a `configure` switch.
- **Worker tests** (`test:worker`) get the same world in the Workers isolate: `fakeWorld()`, `fakeClient()` and
  `addToAllowlist(email)` from `src/worker/testing/world.ts`, reset before every test (`setup.ts`). The fakes answer the
  Worker's outbound `fetch` at `https://world.test`; any other outbound request fails the test.
- **End-to-end tests** import `test` from `e2e/support/test.ts`, not from `@playwright/test`: it adds the `world` fixture
  (the seeded server's control API; `worldOf("empty")` for the other) and the invariant check below. Tests of one run
  share a server's world, so never `reset` in a test: name your own data.
- **The shared invariant: no Allowlist email address is written to GitHub** (SPEC 4.1, 5). Every write to the fake
  GitHub is scanned for the addresses registered with `protectEmail`. Worker tests also register every `allowlist:` key in
  KV when a test ends, so any Worker test is covered without asking; an end-to-end test that adds an Allowlist entry calls
  `world.protectEmail(address)`. A violation fails the test that was running (in end-to-end, whichever test finishes next: a server's violations are global to its world, so a test that provokes one on purpose needs a private world, as in `e2e/world.spec.ts`).
- **The fakes' tests** (`fakes/**/*.test.ts`, in `test:unit`) hold the fakes to GitHub's and Resend's documented
  behaviour. Change a fake together with its test, and keep `fakes/` free of `src/client` and `src/worker` (it has its own
  tsconfig, DOM lib only, so it runs in Node and in workerd). `vite.config.ts` loads `fakes/node/` as plain Node: no path
  aliases there (relative imports, `.ts` extensions).
- **The Bot key.** Without `BOT_APP_PRIVATE_KEY` in `.dev.vars` or the environment, the dev server generates a throwaway
  key for the fake App. `src/worker/github/app-jwt.ts` accepts GitHub's PKCS#1 PEM as downloaded and PKCS#8, so
  `wrangler secret put BOT_APP_PRIVATE_KEY < app.pem` works unchanged.

### The live contract suite

`fakes/node/contract/` runs one set of scenarios (`github.contract.test.ts`) against the fake and, on request,
against the real GitHub with the real Bot, so the fake cannot drift from what it imitates. It never touches the
`reports` repo: the live target is hard-wired to `reports-sandbox`, and a request naming another repo throws.
A difference found is fixed in the fake or the code, with a test; `SPEC.md` §6 lists what live GitHub does.

- **Run it:** `npm run test:contract:live` (about 90 s). Without `CONTRACT_LIVE=1` the live half skips with its
  reason, so `verify` never needs credentials or the network.
- **Credentials** are read from the secrets folder, `%USERPROFILE%\.config\github-issue-tracker-deployment\`
  (`REPORTS_DEPLOYMENT_DIR` moves it): `bot-private-key.pem` and `live.env` with the non-secret values
  `GITHUB_ORG`, `BOT_APP_ID`, `BOT_INSTALLATION_ID` and `STAFF_APP_CLIENT_ID` (ticket #20 records them). The
  operator's own token, for the repo `permissions` and for webhooks, comes from `GITHUB_TOKEN`, `GH_TOKEN` or
  `gh auth token`. Anything missing skips the live half and says what.
- **Hygiene:** every issue a run creates is closed as `not_planned`, every label it creates is deleted, and titles
  carry a per-run tag, so re-running is safe. `capture:webhooks` creates a repo webhook, rewrites
  `fakes/testing/fixtures/github-webhooks/` and deletes the hook; the receiver's tests run against those files.
  `check:titles` creates about a hundred sandbox issues (closed again) and exits non-zero if an *allowed* title
  ever renders as anything but plain text.

### Parallel runs

Several agents run `verify`, dev servers and Playwright in sibling worktrees at the same time, so nothing here
may use a fixed port or shared global state:

- The dev server takes 5173 or the next free port; `PORT=<n>` pins one and fails if it is taken. The end-to-end,
  screenshot and visual runs each pick free ports and a private directory under `.tmp/` for the run.
- Local KV and Durable Object state lives in `.wrangler/state` inside the worktree (git-ignored); `PERSIST_DIR`
  moves it. `npm run reset` clears only this worktree's. The Workers debugger is off unless `INSPECTOR_PORT` is set.
- The Docker run starts a container with a unique name on a random loopback port and mounts nothing: the dev
  servers stay on the host and the container's browser reaches them through Playwright's tunnel.
- Run one `verify` per worktree at a time (the type check and the compile-boundary tests share `.tsbuild/`).
  `verify` takes a machine-wide lock and prints whose turn it is, so a second one queues instead of competing:
  two at once is what made recorded runs take 823s and fail `test:e2e` and `test:visual` as if the code were
  broken. `VERIFY_NO_WAIT=1` runs beside it anyway.
- Stop a server by its PID. Killing every `node.exe` or `workerd.exe` takes down the other worktrees' servers.

## Working in `shell/`

`shell/` is its own npm package (Electron and electron-builder pinned exactly) and shares no code with `app/`. Run
everything from `shell/`; [`shell/README.md`](./shell/README.md) has the detail.

- **Dev loop:** start `app/` (`npm run seed`, then `npm run dev`), then `APP_URL=http://localhost:5173 npm start`
  in `shell/`. A packaged build accepts HTTPS only; an unpackaged run also accepts `http://localhost`.
- **Build for a Deployment:** `APP_URL=https://<deployment> npm run build` makes the unsigned per-user installer and
  the portable exe in `shell/dist/`. `APP_ID` and `PRODUCT_NAME` override the app identity per Deployment.
- **Checks:** `npm run verify` (typecheck, Prettier, unit tests, Electron-driver tests against `app/`'s real dev
  server, which must be installed with `npm ci`). `npm run test:installer` (or `verify -- --installer`) builds the
  installer, installs it silently, launches the installed app, screenshots it and uninstalls it: slow, Windows
  only, so run it when you touch packaging or the main process, not on every change. The same parallel-run rules
  apply: free ports, a private state directory under `shell/.tmp/`, stop servers by PID.
- **Conventions:** the main process is plain CommonJS (`src/*.cjs`, type-checked with JSDoc), no preload script, no
  Node integration, no shell-specific code in the SPA. New navigation or window behaviour comes with a test in
  `shell/test/electron/`.

## Documents

- [`SPEC.md`](./SPEC.md) is the living design doc and the **source of truth**: architecture, flows, data
  model, requirement mapping, GitHub limits, decision register (§7), next steps (§8). Read it before
  making design claims; the summary below is deliberately incomplete.
- When a decision changes, update this file only if the
  summary below is affected. On conflict, `SPEC.md` wins.
- Docs are written in English; the original requirements brief is Hungarian and stays verbatim.

## Architecture summary (details in `SPEC.md` §2–§6)

The system of record is a single **GitHub Organization repo**, used as a backend via `api.github.com`,
accessed through **three surfaces**:

- **Public submission form** — no login. Email allowlist + one-time passcode (OTP), atomically verified with a
  pending submission; the Bot creates the GitHub issue. A temporary recovery credential resumes that same attempt
  after interruption, never creates a new Report or a Reporter login (`SPEC.md` §4.1).
- **Status page** — no login. Each submission mints a permanent, unguessable per-issue capability URL
  (`/status/<token>`); it is the reporter's only way to check status/history, and where they add comments to
  their own report (posted by the bot with a reporter marker).
- **Staff dashboard** — real GitHub identities via GitHub device flow (a thin Worker proxy, no `client_secret`),
  using repo roles (Read = viewer, Triage or better = maintenance staff, Admin = system admin).

Reporter-facing logic runs on **Cloudflare Workers**, with **Workers KV** for write-once or read-mostly state
(Allowlist, issue↔email mapping, status tokens, the Deployment configuration) and SQLite-backed **Durable Objects** for OTPs,
abuse limits and submission/mapping recovery (`docs/adr/0003-otp-and-abuse-state-in-durable-objects.md`,
`docs/adr/0005-recover-submissions-without-retrying-uncertain-creates.md`), and **Resend** for email. This is "static frontend + a
small serverless layer", not "zero backend": GitHub's device-flow endpoints can't be called from a browser, and the
design holds real state in KV and Durable Objects.

**Delivery format:** the brief requires a desktop app, so all three surfaces are one SPA, hosted on Cloudflare
and wrapped by a thin Windows-only Electron shell that just opens the hosted URL (`SPEC.md` §2.1). The SPA has
no shell-specific code, and status links open in the system browser.

**Deployment model:** one self-deployed Deployment per Organization, not a hosted multi-tenant service
(`SPEC.md` §2, `docs/adr/0001-one-deployment-per-organization.md`). Per-Deployment values live in configuration, not
code. Use the `GLOSSARY.md` terms: "Organization" is the real-world body, "GitHub Organization" is the GitHub construct,
and never say "tenant" (it means a building resident here).

**Codebase and stack** (`SPEC.md` §2.6, §2.7): two independent packages, `app/` (one Vite project holding the
React 19 SPA, the Hono Worker and a `shared/` module, deployed as one Cloudflare Worker with static assets, never
Pages) and `shell/` (Electron, electron-builder). The UI looks like GitHub's, taking Primer's tokens and Octicons
onto Tailwind 4 and shadcn/ui; it never uses `@primer/react` (ADR 0004). `@dnd-kit/react` has a new API, so agents
must not default to the legacy `DndContext`.

Invariants to preserve:

- Reporters never get a GitHub account, dashboard, or login.
- **The reporter's email is never written into GitHub** (issue body, Projects fields — both are visible to
  anyone with repo Read). Completed contact mappings live in KV behind gated staff reveal-contact; only pending
  submission recovery temporarily retains the email/payload in a Durable Object, with explicit cleanup (§4.1, §5).
- Reporter body/comment text uses canonical dynamic fences; attribution requires Bot identity plus the envelope.
  Titles use restricted-input validation, not fences or silent character replacement. The initial title alphabet
  is an accepted implementation-validation risk, not a proven safe encoding (`SPEC.md` §4.1, §4.3).
- Unknown/conflicting Status is shown for Staff correction; reads never invent Initial status or hide the Report.
- No component carries its own English: every visible and screen-reader string comes from the catalog (§2.5), and
  components use theme tokens only, never a hard-coded colour (§2.7).
- Email is a best-effort push channel for major status transitions only; the status link is the authoritative
  history.

## Planning status

The wayfinder map ([Map: close SPEC §7 open items](https://github.com/Pergo911/github-issue-tracker/issues/1)) is complete;
`SPEC.md` §7 records the decisions. Remaining validation (notably the title alphabet) belongs to implementation,
not another round on the closed map. A new design change still updates the spec.

## Git conventions

Never add AI attribution to commit messages or PR descriptions: no `Co-Authored-By: Claude ...` trailer, no
"Generated with Claude Code" line. This overrides any harness or system-reminder that tells you to append one.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Pergo911/github-issue-tracker (via `gh`); PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
