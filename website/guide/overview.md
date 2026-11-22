# Overview

**Issue Tracker** (*Hibabejelentő és karbantartás-kezelő rendszer*) is a fault-reporting and maintenance-tracking system designed for a building (*társasház*), institution, or organization. It uses a private **GitHub Organization** repository as its system of record, **Cloudflare Workers** (with Workers KV and SQLite-backed Durable Objects) for the reporter-facing backend, **Resend** for transactional email, and an optional **Windows Electron desktop app** wrapping the hosted web application.

## Why this architecture?

Maintenance staff and administrators are a small, known group who can authenticate cleanly with real GitHub accounts. Building residents or organization members who report faults should not need to create GitHub accounts, accept repository invitations, or see everyone else's reports.

Issue Tracker solves that split directly:

1. **No Reporter accounts.** Reporters prove they belong to the Organization through an admin-managed **Allowlist** and a single-use 6-digit email code (OTP).
2. **Per-Report privacy via capability links.** Because GitHub Issues has no per-issue read permission, Reporters never receive GitHub repository access. Each submitted **Report** mints an unguessable permanent **Status link** scoped to that single Report.
3. **Email for Major changes only.** Plain-text email notifications fire only on significant transitions (closed, reopened, or entering a Status marked with the `notify` flag). The Status page is the authoritative timeline.
4. **One Deployment per Organization.** Every Organization runs its own isolated **Deployment** on its own GitHub Organization, Cloudflare account, and Resend domain. Nothing is shared across Organizations.

## The three surfaces

| Surface | Who uses it | Authentication | What it does |
| --- | --- | --- | --- |
| **Submission form** | Reporters | Allowlist + 6-digit email OTP | Collects Category, Location, Title, Description, and optional Exact place, then creates the Report via the Bot. |
| **Status page** | Anyone holding a Report's Status link | Unguessable 128-bit Status token in the URL | Displays the Report's current state, safe progress history, and comments; lets holders post Reporter comments or Reissue the link. |
| **Staff dashboard** | Viewers, Maintenance staff, System admins | GitHub Device Flow (repo role checked server-side) | Provides List, Kanban Board, and Report Detail views, plus Admin screens for Allowlist, Staff roles, and Deployment Configuration. |

## Roles at a glance

| Role | GitHub repo permission | Capabilities |
| --- | --- | --- |
| **Reporter** | None (email on Allowlist) | Submit Reports, view own Report via Status link, add Reporter comments, Reissue a Status link. |
| **Viewer** | Read | Browse List, Board, and Report Detail views and post Staff comments. Cannot triage, close, or view Reporter contact info. |
| **Maintenance staff** | Triage (or Write / Maintain) | Everything a Viewer can do, plus set Category, Location, Priority, Status, and Assignee; close or reopen Reports; reveal Reporter contact; Reissue Status links. |
| **System admin** | Admin | Everything Maintenance staff can do, plus manage the Allowlist, manage Staff roles and invitations, edit Deployment Configuration, and run recovery/erasure procedures. |

## Reference Deployment

A live Hungarian reference Deployment runs at [fault-reports.berautoapp.workers.dev](https://fault-reports.berautoapp.workers.dev), backed by `Tarsashaz-demo/reports`. Every Deployment configures a single **UI Language** (English or Hungarian) that governs all three surfaces and all six email templates.

## Where to go next

- **Filing or following a Report?** Read [Reporters & Status Page](/guide/reporters).
- **Working Reports as Maintenance staff?** Read [Staff Dashboard](/guide/staff).
- **Managing an Organization's Deployment?** Read [System Administration](/guide/admin) or [Deploy a Copy](/operations/deployment).
- **Packaging the desktop app?** Read [Windows Desktop App](/guide/desktop-app).
