# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A **fault-reporting and maintenance-tracking system** ("Hibabejelentő és karbantartás-kezelő rendszer") for a
building (társasház), institution, or organization, with reporter, maintenance-staff, and admin roles. This
repository is where the product lives. It currently holds only the Markdown design documents; there is no
application code yet. The original requirements brief is in Hungarian in
[`Ticket Management System Feladatleírás.md`](./Ticket%20Management%20System%20Feladatleírás.md). It
deliberately leaves the exact roles, permissions, categories, priorities, statuses, and stored data open;
`SPEC.md` records the decisions.

There are no build, lint, or test commands yet. Do not invent a stack or scaffold code unless the user
explicitly asks to start implementation.

## Documents

- [`SPEC.md`](./SPEC.md) is the living design doc and the **source of truth**: architecture, flows, data
  model, requirement mapping, GitHub limits, open items (§7), next steps (§8). Read it before
  making design claims; the summary below is deliberately incomplete.
- When a decision changes, update this file only if the
  summary below is affected. On conflict, `SPEC.md` wins.
- Docs are written in English; the original requirements brief is Hungarian and stays verbatim.

## Architecture summary (details in `SPEC.md` §2–§6)

The system of record is a single **GitHub Organization repo**, used as a backend via `api.github.com`,
accessed through **three surfaces**:

- **Public submission form** — no login. Email allowlist + one-time passcode (OTP), verified in the same
  request that creates the GitHub issue via a bot credential.
- **Status page** — no login. Each submission mints a permanent, unguessable per-issue capability URL
  (`/status/<token>`); it is the reporter's only way to check status/history, and where they add comments to
  their own report (posted by the bot with a reporter marker).
- **Staff dashboard** — real GitHub identities via GitHub device flow (a thin Worker proxy, no `client_secret`),
  using org roles (Read / Triage = maintenance staff / Admin = system admin).

Reporter-facing logic runs on **Cloudflare Workers + Workers KV**, with **Resend** for email. This is "static
frontend + a small serverless layer", not "zero backend": GitHub's device-flow endpoints can't be called from a
browser, and the design holds real state (OTPs, issue↔email mapping, status tokens) in KV.

**Delivery format:** the brief requires a desktop app, so all three surfaces are one SPA, hosted on Cloudflare
and wrapped by a thin Windows-only Electron shell that just opens the hosted URL (`SPEC.md` §2.1). The SPA has
no shell-specific code, and status links open in the system browser.

Invariants to preserve:

- Reporters never get a GitHub account, dashboard, or login.
- **The reporter's email is never written into GitHub** (issue body, Projects fields — both are visible to
  anyone with repo Read). It lives only in KV, behind a gated staff reveal-contact endpoint.
- Email is a best-effort push channel for major status transitions only; the status link is the authoritative
  history.

## Open items

The delivery format is settled (see the Architecture summary). The first thing to verify is the staff
device-flow login, which still needs a spike (`SPEC.md` §7 item 13). Everything else open (GitHub org not yet
created, label taxonomy, email domain, PAT vs GitHub App, OTP parameters, …) is listed in `SPEC.md` §7. Don't
treat any of it as settled.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Pergo911/github-issue-tracker (via `gh`); PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
