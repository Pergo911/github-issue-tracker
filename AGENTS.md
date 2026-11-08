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
| `npm run verify` | **all of the below**, in parallel, red on any failure (about 2 minutes) | before you call a ticket done |
| `npm run verify -- --fast` | typecheck, lint, format, unit, worker, tooling: no browser, no Docker | while you work |
| `npm run typecheck` | `wrangler types`, then `tsc -b` over client, worker, shared, tests, tooling | after type-level changes |
| `npm run lint` · `npm run format` | ESLint (`format:check` is Prettier's check) | before committing |
| `npm run test:unit` | Vitest in Node: `shared/`, client logic, lint rules, catalog completeness (about 2 s) | on every `shared/` or client-logic change |
| `npm run test:worker` | Vitest in the local Workers runtime: KV, Durable Objects, rate limits | on every Worker change |
| `npm run test:tooling` | compile-time boundaries, seed and reset, chunk check | after touching tsconfig, scripts or the build |
| `npm run test:e2e` | Playwright against the real dev server: journeys, axe, pseudo-language sweep | after UI or API changes |
| `npm run screenshots` | every declared screen, light and dark, 1280 and 375 px, Hungarian, in your local browser | for every screen you add or change |
| `npm run test:visual` | the same screens against `e2e/reference/*.png`, rendered in Playwright's Docker image | in `verify`; run it alone after UI changes |
| `npm run test:visual:update` | rewrites the reference images | only after you opened the diffs and each change is intended |
| `npm run dev` · `npm run seed` · `npm run reset` | the dev server · Appendix A configuration into local KV · clear all local state | seed once per worktree before `dev` |

`npm run setup` installs the Chromium that `test:e2e` and `screenshots` use. `npm run test:visual` needs Docker
running. Extra arguments reach Playwright: `npm run test:e2e -- -g "home page"`. Run Playwright through these
scripts, never `npx playwright test`: they pick the ports and state the run needs.

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
  message in `en.ts` and `hu.ts`; the types enforce it. Path parameters are not in the contract yet: extend
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
  from `vitest.config.ts`.
- **Versions are pinned, and two are held back on purpose.** TypeScript stays on 6.0.x until typescript-eslint
  supports 7. npm 12 blocks install scripts unless `package.json` lists them under `allowScripts` (`esbuild`,
  `workerd`).
- **Scripts run as native TypeScript** (Node strips the types): erasable syntax only, `.ts` extensions on
  relative imports, no path aliases under `scripts/`.

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

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Pergo911/github-issue-tracker (via `gh`); PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
