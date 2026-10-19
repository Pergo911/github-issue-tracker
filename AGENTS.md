# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this repository is

A **fault-reporting and maintenance-tracking system** ("Hibabejelentő és karbantartás-kezelő rendszer") for a
building (társasház), institution, or organization, with reporter, maintenance-staff, and admin roles. This
repository is where the product lives. It currently holds only the Markdown design documents; there is no
application code yet. The original requirements brief is in Hungarian in
[`Ticket Management System Feladatleírás.md`](./Ticket%20Management%20System%20Feladatleírás.md). It
deliberately leaves the exact roles, permissions, categories, priorities, statuses, and stored data open;
`SPEC.md` records the decisions.

There are no build, lint, or test commands yet. The stack and repo layout are decided (`SPEC.md` §2.6, §2.7), but no
code exists: do not scaffold `app/` or `shell/` unless the user explicitly asks to start implementation.

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
not another round on the closed map. A new design change still updates the spec; completion is not a claim that code exists.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Pergo911/github-issue-tracker (via `gh`); PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
