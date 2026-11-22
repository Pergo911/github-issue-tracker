# Spec — Issue Tracker

**Editing:** edit in place and state the current design only; history lives in git and the ADRs. **Precedence:** this doc is the source of truth for the design; [`AGENTS.md`](./AGENTS.md) only summarizes it, so update this doc first.

The system uses a GitHub Organization repo as its backend (GitHub Issues for reports; repo roles for staff).
Two problems shape the design: **reporters shouldn't need a GitHub account**, and **"entirely serverless"
breaks down once OAuth and email are involved**. Both are addressed below, each backed by a dedicated
feasibility check (§3).

---

## 1. Problem statement

Staff and admins (a small, known, technical-enough group) authenticate as real GitHub identities via GitHub Organization
membership. That's a bad fit for reporters (building residents/tenants), who shouldn't need to understand
GitHub accounts, OAuth consent screens, or GitHub Organization invitations just to report a broken light.

Three design decisions follow from that:

1. **Reporter auth is an email-OTP gate restricted to a predefined allowlist**, instead of GitHub OAuth.
   Residents don't get GitHub accounts at all.
2. **Reporters get no GitHub-backed dashboard and never log in.** Since GitHub Issues has no per-issue privacy
   (anyone with repo Read sees every issue), reporters never get repo Read access at all. Instead, each submission mints an **unguessable permanent link** (a
   capability URL) that shows the status/history of that one issue and nothing else. This resolves the
   per-issue-privacy gap directly — access is scoped to exactly one issue by possession of a link, not by an
   account with broader repo visibility — rather than working around it. The reporter is explicitly free to
   share that link (e.g. with a spouse or roommate); that's an accepted, intentional property of the design,
   not a leak.
3. **Email is a secondary, best-effort notification channel, not the only way to track status.** To avoid
   emailing on every minor label/comment change, email fires only on major status transitions (§4.2); the
   permanent link is authoritative for the Reporter-visible progress/history (§4.3).

Staff-side design: repo roles (Read/Triage/Admin), device-flow login through a thin Worker proxy (§2.2), labels
for location/category/priority/status (§2.3), assignee for the responsible technician, comments for resolution
notes, and a board the dashboard renders itself for a Kanban-style view. Staff call `api.github.com` directly with
plain `fetch` (§2.6). This is not repeated below except where reporter-side flows touch it.

---

## 2. Architecture overview

Three separate user-facing surfaces, sharing one GitHub Organization repo as the system of record:

```
┌──────────────────────┐  ┌───────────────────────┐  ┌──────────────────────────┐
│  PUBLIC SUBMISSION     │  │    STATUS PAGE          │  │      STAFF DASHBOARD      │
│  (reporters, no login) │  │  (unguessable link,     │  │  (GitHub login, repo role)│
│                       │  │   no login)             │  │                          │
│  email → OTP →        │  │  issue view             │  │  fetch → api.github      │
│  report form →        │  │  + history              │  │  .com directly (Read/    │
│  submit + recovery    │  │  + add comment          │  │  Triage/Admin)           │
└──────────┬────────────┘  └───────────┬─────────────┘  └──────────────────────────┘
           │                           │
           ▼                           ▼
   ┌──────────────────────────────────────────┐        ┌─────────────────────────┐
   │  Edge functions (Cloudflare Workers)       │◄───────┤  GitHub webhook          │
   │  - OTP request                             │        │  (issues)                │
   │  - OTP verify + submit (creates issue)     │        └─────────────────────────┘
   │  - status lookup (proxies a read-only      │
│    GitHub calls — reporter has no GitHub   │───────▶ creates/reads issues and
   │    credential of their own)                │         posts comments as
   │  - add-comment (token-gated, bot posts)    │         the Bot (a GitHub App
   │  - webhook receiver (major-change filter)  │         installation token)
   │  - reissue link (holder or staff)          │
   │  - (staff) reveal-contact / resend-link     │
   │  - (System admin) allowlist, staff, config │
   └───────────────────┬─────────────────────────┘
                        │
                        ▼
   ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
   │ Workers KV                │  │ Durable Objects (SQLite)  │  │ Resend (email API)        │
   │ - email allowlist         │  │ - OTP hash, expiry, tries │  │ - OTP codes               │
   │ - issue# → email          │  │ - per-email/-token caps   │  │ - confirmation + link     │
   │ - status-token → issue#   │  │ - Deployment email budget │  │ - major-change mail       │
│ - issue# → status-token   │  │ - submission recovery     │  │ - reissued-link mail      │
│ - webhook dedupe IDs      │  │ - mapping lifecycle       │  │                           │
   └───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
```

**Platform choice:** consolidate everything on **Cloudflare Workers, Workers KV and Durable Objects**, and serve
the static SPA from the same Worker as Workers static assets, so the SPA and the Worker share one origin. Pages is
out: Pages Functions can't define a Durable Object class or use the Rate Limiting binding (§2.6).
KV holds write-once or read-mostly data; SQLite-backed Durable Objects hold OTPs, abuse controls and recoverable
submission progress ([ADR 0003](./docs/adr/0003-otp-and-abuse-state-in-durable-objects.md),
[ADR 0005](./docs/adr/0005-recover-submissions-without-retrying-uncertain-creates.md), §4.1, §4.5). Both keep the
whole backend on one platform instead of splitting across providers.

**Deployment model:** one **Deployment** per **Organization**, self-deployed (see [`GLOSSARY.md`](./GLOSSARY.md) and
[ADR 0001](./docs/adr/0001-one-deployment-per-organization.md)). Each Deployment has its own GitHub Organization and
reports repo, Cloudflare account, Resend domain and bot credential; nothing is shared between Deployments, and this is
not a hosted multi-tenant service. Everything per-Deployment (GitHub Organization and repo names, sending address,
branding, label taxonomy, the daily code budget, the help text on the code-sent screen, the Electron shell's target
URL) is configuration, not code. The reference Deployment is a
demonstration/coursework one. Buildings within an Organization are `location:*` labels in the one repo, so staff
separation per building isn't supported; an Organization needing it runs separate Deployments.

**Why a proxy at all:** `api.github.com` allows CORS, so staff operations can run client-side once a token
exists. But GitHub's device-flow endpoints (`/login/device/code`, `/login/oauth/access_token`) don't support
CORS preflight, so a browser can't call them directly. The Worker proxies exactly those endpoints (plus token
refresh, if a GitHub App is used). Device flow needs no `client_secret` and no redirect URI, so the Worker
holds no OAuth secret, and because the SPA and the Worker share an origin the proxy needs no CORS headers.

The classic web flow was rejected: its token exchange requires `client_secret` (PKCE, added July 2025,
doesn't remove that), so it would still need a relay, and in the Electron shell (§2.1) it would run inside an
embedded window where GitHub 2FA and passkeys are unreliable (RFC 8252 §8.12 also says native apps must not
use embedded user agents for authorization).

### 2.1 Delivery format: Electron shell around the hosted SPA

The original brief asks for a desktop application ("asztali alkalmazás"), and a web-only deliverable isn't
acceptable. The design therefore ships **one SPA containing all three surfaces**, hosted on Cloudflare, plus a
thin **Windows-only Electron shell** that opens it.

- **Same build, two ways to run it.** The shell and the plain website serve the identical SPA. The SPA
  contains no shell-specific code, so the shell stays a pure wrapper.
- **Remote-URL shell.** A small `main.js` calls `loadURL` on the hosted SPA. No preload script and no native
  APIs are exposed to the page; Electron's secure defaults stay on (`contextIsolation`, sandbox, no
  `nodeIntegration`), HTTPS only in a packaged build (an unpackaged `npm start` also accepts `http://localhost`, for
  the dev loop). The page's origin is the hosted site's, so the Worker needs no extra CORS
  entry for the shell.
- **Navigation rule.** `target="_blank"` links and `window.open` go to the system browser
  (`setWindowOpenHandler` → `shell.openExternal`); in-window navigation stays in the shell. The SPA renders
  status links with `target="_blank"`. Any `will-navigate` restriction only needs to allow the app's own
  origin, since login (§2.2) happens in the system browser.
- **Status pages stay in the browser.** Reporters reach them through the emailed link or the link on the
  post-submit confirmation page, opened in the system browser. The shell has no status-lookup entry point and
  no local "My reports" list.
- **Packaging.** electron-builder, pinned to an exact version, builds an unsigned per-user NSIS installer (no admin
  rights) plus a portable `.exe`; Windows only, and the SmartScreen click-through is accepted. Forge was the
  alternative: its Squirrel and zip makers needed workarounds under npm 12 and Node 26 and its installer is about
  30% larger. The target URL is the `APP_URL` build-time environment variable, passed as
  `-c.extraMetadata.appUrl`, so one codebase yields one build per Deployment (ADR 0001); per-Deployment `appId` and
  `productName` overrides stop two Deployments' installs from overwriting each other. The shell loads the site root,
  where the SPA offers both entry points. `APP_URL=http://localhost:5173 npm start` is the dev loop
  ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/17), §2.6).
- **Dependency.** The shell needs the hosted site to be live. That adds no new network dependency, since
  GitHub, the Worker, and Resend are all online anyway.

### 2.2 Staff login (device flow)

1. The SPA calls the Worker's device-code endpoint, which forwards to GitHub and returns `user_code`,
   `verification_uri`, `device_code`, and `interval`.
2. The SPA shows the `user_code` and a `target="_blank"` link to `verification_uri`. In the shell that opens
   the system browser, where the staff member is usually already signed in to GitHub; passkeys, 2FA, and
   hardware keys work there.
3. The SPA polls the Worker's token endpoint at the returned interval (honouring `slow_down`) until the staff
   member approves; the device code expires after 900 seconds.
4. The SPA then calls `api.github.com` directly with the token, and uses the same token to authenticate to the
   reveal-contact function (§4.4).

Device flow must be enabled on the GitHub app. Verified end to end through the Worker proxy for both a
GitHub App and an OAuth App (§7 item 13); the role check is the repo `permissions` object.

The staff app is a **GitHub App**, not an OAuth App (§7 item 14,
[ticket](https://github.com/Pergo911/github-issue-tracker/issues/9)): both app types passed the spike, and the
decider is blast radius — an OAuth App's `repo` scope grants each staff token access to every private repo the
member can reach, while a GitHub App's user tokens carry only the permissions the app requests, on the repos it
is installed on. **Token storage:** the SPA persists the 8-hour access token and the refresh token in
`localStorage` — a web-standard API, so Electron's default session keeps them across restarts with no
shell-specific code. The SPA refreshes silently on load and on 401, and falls back to a fresh device flow when
refresh fails. Sign-out clears `localStorage` and points the member at GitHub → Settings → Applications to
revoke the grant.

### 2.3 Label taxonomy: a contract with per-Deployment values

GitHub has no structured fields (§6), so Reports are classified with labels. The system fixes the **contract**; each
Deployment configures the **values** (see [`GLOSSARY.md`](./GLOSSARY.md), "Classification").

**Fixed by the system.** Four dimensions, each a label prefix. Their existence, cardinality and who sets them are
system semantics. A Deployment can't add a fifth dimension or drop one.

| Dimension  | Set by                                                                         | Values per Report                           | Notes                                                                                |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `category` | Reporter on the form; Staff may correct it (a label swap, link-only, no email) | exactly one                                 |                                                                                      |
| `location` | Reporter on the form                                                           | exactly one                                 | Plus an optional free-text "exact place" in the issue body.                          |
| `priority` | Staff only                                                                     | zero or one                                 | No value means untriaged. The values are ordered, so the dashboard can sort by them. |
| `status`   | The system: the bot on creation, the dashboard on transitions                  | exactly one on supported open-Report writes | The dashboard swaps the label in one call; manual edits can violate this (§2.4).     |

Reporters get no urgency control. The form shows a per-Deployment **emergency notice** instead (for example, who
to call for fire, gas or flooding).

**Configured per Deployment.** The values of each dimension, their display names, their colours, their order
and the Status flags. A display name is one string per value, written in the Deployment's single language (§2.5) — never
a per-language map. A colour is an optional six-digit hex per value: it drives the value's label pill (§2.7) and the
colour of the GitHub label the sync creates, and unset it falls back to a fixed neutral grey. The Deployment's configuration is the source of truth; the reports repo's labels are derived from it by a
one-way seed/sync step ([ADR 0002](./docs/adr/0002-taxonomy-declared-in-deployment-configuration.md)). Label names
are `dimension:value`, lowercase English kebab-case, as stable identifiers. The Worker serves the taxonomy to the
form and dashboard from configuration and ignores unrelated labels; obsolete classification uses the display
fallbacks in §2.4 rather than becoming configured values. Changing the taxonomy is a configuration
change plus a sync, done by a System admin. The seed values for the reference Deployment are in Appendix A.

**Status flags.** Status values are per-Deployment, but each can carry flags declared in configuration, so the
system never infers behaviour from a name. Two flags exist and there are no others:

- `initial`: exactly one status has it. The bot applies it at creation and the dashboard on reopen, and entering it
  never emails the Reporter (§4.2).
- `notify`: entering the status while the Report is open emails the Reporter (§4.2). It is opt-in, so a status
  without it is link-only and a forgotten flag fails safe.

**Closed is GitHub's state, never a label.** Closed as `completed` (or with no reason) means fixed; `not_planned`
means rejected and `duplicate` means a duplicate, and both of those count as rejected. The status page shows all
three as "closed" with the reason. Dashboard closing removes the Status label, and dashboard reopening applies
the Initial status. A closed Report ignores any stale Status label. A github.com reopen or a hand-removed label
may leave an open Report without a valid Status: the fallback in §2.4 exposes this, without an automatic repair.

**No Projects v2.** Labels plus open/closed state only. Projects v2 would add GraphQL, an extra token permission for
device-flow login, a second source of truth for status, and `projects_v2_item` events that arrive only on a
GitHub Organization-level webhook, whereas §3.2 uses one repo-level webhook. The dashboard renders its own board from the labels.

**GitHub Organization and repo.** One free GitHub Organization per Deployment, holding one private `reports` repo,
separate from the design repo. The spec pins only the pattern (a GitHub Organization named after the Organization,
repo `reports`); the names are chosen when the Deployment's GitHub Organization is created, by hand.

### 2.4 Staff dashboard

The dashboard is the SPA's staff surface. It calls `api.github.com` directly with the staff member's device-flow
token (§2.2), and it gates its own controls on the repo `permissions` object — but that client-side gating is
presentation only: every Worker endpoint it can reach (reveal-contact, reissue, Allowlist, Staff, configuration)
re-checks the role with the caller's token, so the tiers are enforced server-side
([ticket](https://github.com/Pergo911/github-issue-tracker/issues/14)).

**Three tiers, from the repo `permissions` object.** GitHub's five repo roles collapse to three dashboard roles,
because Write and Maintain add only code access the dashboard never uses (issue actions top out at Triage):

| Dashboard role    | Repo role(s)     | Gets                                                                                     |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Viewer            | Read             | the views and commenting; every action control hidden; never reveal-contact (§4.4)       |
| Maintenance staff | Triage or better | everything on Reports: labels, assignee, close/reopen, comments, reissue, reveal-contact |
| System admin      | Admin            | Maintenance staff plus the Allowlist, Staff and Configuration screens                    |

A Viewer can comment but cannot label, assign or close anyone's Report — the Bot opened them all, so "close your
own" never applies.

**Views.** Three Report views, plus the three Admin screens below. No metrics or insights view in the MVP.

- **Board** — a Kanban view over open Reports, one column per Status in the configured order plus the exceptional
  column below. Cards carry the title, category/location/priority chips, assignee, age and a reporter-comment mark
  when its data has been loaded. Moving a card is the one-swap status PATCH (§2.3): drag-and-drop, with a per-card
  status menu as the accessible equivalent — never
  two Status labels.
- **List** — the filterable table, sorted by the configured priority order, then oldest first.
- **Detail** — one Report: the canonical body envelopes decoded and rendered as plain text (no markdown pipeline,
  §4.1), labels, assignee, and the timeline with Bot-authored canonical Reporter comments distinguished from
  Staff comments (§4.3); a comment box is a Viewer's only write.
- **Allowlist**, **Staff** and **Configuration** — Admin-only (§5, below).

The board and list refresh on navigation and via a manual refresh control; there is no live push (the webhook
reaches the Worker, §3.2, not the SPA).

**Invalid Status is visible, not invented**
([Status views, neutralization and failure paths](https://github.com/Pergo911/github-issue-tracker/issues/18)). An open
Report with no configured Status, multiple Statuses, or an obsolete `status:*` label goes in a **Status needs
correction** Board column and has a warning in List and Detail. It never disappears from the views. Maintenance
staff repair it with the existing Status control, removing stale/conflicting Status labels in the same PATCH.
The Status page says **Awaiting status update**, localized through the catalog. Neither the dashboard's read
projection nor the Worker pretends Initial status was recorded; the Worker does not apply Initial status on reopen.

**Search and filters.** A free-text search box (GitHub's search API — read access suffices) plus filter chips:
Category, Location, Priority, Status, assignee, and "untriaged" (Priority absent), with an open/closed state
toggle. At building-scale volume, filtering happens client-side over already-fetched Reports; the search API is
for the rare cross-history lookup.

**Close and reopen: one PATCH per transition.** The dialog picks a close reason — fixed (`completed`), rejected
(`not_planned`), or duplicate (plus the original Report's number, `duplicate_issue_id`) — and the transition
carries `state`, `state_reason` and the labels in one call: closing drops the Status label in that call, and
reopening applies the `initial` Status in that call (§2.3, §4.2). GitHub never observes an intermediate
two-Status or zero-Status Report, so no stray `labeled` event can double-email.

**Reporter comments are noticed dashboard-only** (§4.3): a "has Reporter comments" filter chip and a "last
Reporter comment" sort. When either is used, fetch all pages of `GET /repos/{owner}/{repo}/issues/comments`
(`per_page=100`, following `Link`), classify by Bot identity plus the canonical envelope (§4.3), and group by the
parent issue. Ignore PR entries and comments outside the fetched Reports. Cache the scan in TanStack Query only,
not KV; no per-Report N+1 fetches. Until the scan completes, show loading rather than treating unscanned Reports
as having no Reporter comments. A card's Reporter-comment mark uses that cache when available; otherwise it is
unknown, not a claim that there are none. Manual refresh rebuilds the scan, including edits/deletions; `since`
is updated-since, not a deletion feed. No unread badges — they would need per-staff read-tracking state, and
GitHub's own notifications already reach assignees and watchers.

**No bulk actions in the MVP.** The REST API the dashboard uses has no bulk issue endpoints, and GraphQL batching
would buy nothing at this volume.

**The Staff screen** (Admin-only, `/staff/members`;
[ADR 0006](./docs/adr/0006-manage-staff-roles-as-repo-collaborators-via-staff-token.md)) manages Staff roles on the
`reports` repo directly in the dashboard while keeping GitHub repository roles as the single source of truth.
Admin-gated Worker endpoints run all collaborator and invitation calls with the acting System admin's own token
(`reports-staff`, which holds Repository `Administration: read & write`, §3.3; no GitHub Organization-level
permissions and no added permissions on `reports-bot`).

- **Scope and roles.** Strictly repository collaborators and pending Staff invitations on `reports` (no GitHub
  Organization membership management; Reporters stay on the Allowlist, §5). Adding Staff is a single-user form taking a GitHub
  username and one of the three dashboard roles (**Viewer** → `pull`, **Maintenance staff** → `triage`,
  **System admin** → `admin`). Existing GitHub Organization members receive access immediately (`204`); external
  GitHub accounts receive an outside-collaborator repository invitation (`201`), managed in a **Pending invitations**
  section (change invited role or cancel). Existing GitHub `Write` and `Maintain` grants display cleanly as
  Maintenance staff and are replaced with `pull`/`triage`/`admin` only when a System admin actively changes the
  member's dashboard role. Adding someone who is already active Staff or already has a pending invitation is rejected
  explicitly rather than overwriting their role.
- **Safety guards (server-enforced).** A System admin cannot change their own role or remove themselves, and cannot
  demote or remove the last active effective System admin (counting every active Staff member whose effective role is
  `admin`, including inherited GitHub Organization Owners, and never counting pending invitations). Inherited-only
  members (`affiliation=all` minus `affiliation=direct`) appear read-only; if a direct downgrade or removal is
  overridden by an overlapping GitHub Organization or team grant, a post-write effective-permission check surfaces an explicit
  warning. Role changes use an inline Edit/Save/Cancel flow, and Remove uses an inline danger confirmation warning
  that access ends immediately and open Reports assigned to them will be unassigned. If `reports-staff` lacks the
  approved `Administration: read & write` permission or the caller's token predates it, the Worker returns a dedicated
  `staff_permission_required` error shown only on the Staff screen without disrupting Reports, Allowlist, or
  Configuration.

**The Configuration screen** (Admin-only) edits every per-Deployment value that is data: the Taxonomy — each
dimension's values, display names, colours and order, and the Status flags (§2.3) — the emergency notice (§2.3), the
"code sent" help text (§4.1), the email sender local part, display name, reply-to and footer (§4.6), the six
template strings, the UI language and timezone (§2.5), the daily code budget (§4.5) and the
Organization/branding display name. No import/export: a
fresh Deployment is configured by hand, once.

**Configuration storage and audit.** One `config` KV key holds the whole configuration as JSON (§5); the form,
the dashboard and every email send read it from there, and only the Admin-gated endpoints write it, validating
the invariants (exactly one `initial` Status, unique and ordered Priority values, non-empty display names) and
recording a last-editor block (`editedBy`, `editedAt`). No fuller audit history: the audience for a longer trail
does not exist at building scale, and config writes are rare enough to cost nothing in the KV budget. The ~60 s
eventual consistency is accepted, as for the Allowlist (§5). A fresh Deployment has no `config` key yet: the public
projection answers `not configured` — the SPA shows its English error screen (§2.5) — until a System admin's first
save through the Configuration screen bootstraps it under the same invariant checks.

**Who reads which part of the configuration** ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/17)).
The SPA boots by fetching an unauthenticated **public projection** of `config`: an allowlist defined once in
`shared/` (§2.6), so a field added later is private by default. It holds the language, the timezone, the
Organization display name, the emergency notice, the code-sent help text and the Taxonomy (values, display names,
colours, order, Status flags). The six template strings, the sender local part, display name, reply-to and footer,
the daily code budget and the last-editor block never leave the Admin-gated endpoint, which returns the full
configuration to the Configuration screen only. The form, the status page and every dashboard role use the public
projection.

Never on the screen — deploy-time values the Worker needs to reach anything at all: its secrets (the Resend key,
both GitHub Apps' credentials, the webhook secret), the GitHub Organization and repo names, the verified Resend
sending subdomain (§3.1), and the hosted URL (the Electron shell's target, §2.1).

**The save is the taxonomy sync**
([ADR 0002](./docs/adr/0002-taxonomy-declared-in-deployment-configuration.md)). On save, the Worker diffs the
configuration against the repo's labels, creates the missing ones via the Bot (§3.3) and corrects the colour of
existing ones (colour only). GitHub labels are never
deleted or renamed (they carry only the kebab-case identifier), so a removed value degrades gracefully: the form
stops offering it, the Worker ignores the label outside the configuration, and a Report still wearing it renders
its raw identifier until Staff relabel it. Status-flag changes (`initial`, `notify`) apply to future events
only; open Reports keep their current Status.

### 2.5 Language and locale: one configured language per Deployment

Every Deployment renders **one language** — all three surfaces and all six emails. There is no per-browser
detection and no per-user toggle: the population is one Organization's Reporters and Staff, and per-user
language would force per-language variants of every configured string (taxonomy display names would grow
from one string per value into per-language maps) plus a per-Reporter email-language preference — new
per-Report state for a need no Deployment has shown.

Two kinds of strings, two homes:

- **Fixed system wording lives in code catalogs**, one per shipped language (`en` and `hu` at launch). The
  configured language selects one; a missing key falls back to English. The catalogs hold the UI chrome —
  the form's labels and length-limit errors, the code-sent screen, the generic OTP response, the status
  page's 404 and closed-Report notice, the comment box, reissue confirmations, the dashboard's screens and
  close-reason words — and the issue-body template's captions (§4.1). The SPA and the Worker import the same
  catalog module from `shared/`, but the Worker reads from it only the body captions the Bot writes into GitHub
  (§4.1) and the close-reason words that fill the Closed template's reason placeholder (§4.6): API
  errors and status data travel as stable codes and structured fields (an error code; a comment's
  `author: "reporter" | "staff"` with the canonical envelope already decoded) and the SPA localizes them.
  Adding a language is a code contribution; a Deployment configures one of the shipped languages and
  cannot invent one.
- **Deployment-authored wording stays in the `config` KV key** (§2.4): the six template strings, the taxonomy
  display names, the emergency notice, the code-sent help text, the sender/reply-to/footer — written by the
  operator in whatever language they choose. The system renders strings; it never validates natural
  language. With one language per Deployment, a display name is one string per value (§2.3).

**Catalog mechanics** ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/17)):

- One TypeScript module per language in `shared/`. `en.ts` defines the flat, dotted `MessageKey` set (`form.title.label`),
  and every other language is a `Partial` of it, so the per-key fallback to English is a plain lookup.
- Strings with typed `{name}` placeholders; dates and numbers come from `Intl`. There is no plural machinery
  (Hungarian doesn't pluralize after numerals); a language that needs it adds function-valued entries then.
- A hand-written translator of about 30 lines, with no i18n library, so the SPA and the Worker behave identically.
  Both catalogs are bundled statically; they are a few kB.
- A test fails if a shipped language lacks a key, so the runtime fallback is only a fail-safe.
- Boot: the SPA fetches the public projection (§2.4) before first render and reads the language from it. Until then
  it shows a neutral loading state, and if the fetch fails, an English error screen.
- **No component carries its own English.** Every visible and every screen-reader string in a shipped component —
  a dialog's close label, a drag-and-drop announcement, an icon's accessible name — comes from the catalog (§2.7).

**Protocol strings never localize.** The comment marker `**Reporter:**` (§4.3) is fixed English forever —
the status-lookup function matches it inside the Bot-authored canonical envelope (§4.3), so a localized marker
would couple classification to configuration and misclassify every comment written before a language change. The status page and
dashboard decode the envelope and render a localized label instead; GitHub keeps the raw marker for Staff.
Label identifiers (`dimension:value`) are likewise language-neutral and never rendered as copy (§2.3).

**Locale.** A `timezone` configuration field (an IANA name; unset → UTC, fail-safe) fixes the clock for the
status-page and dashboard timelines — the six emails carry no timestamps (§4.6). Timestamps render in that
zone using the configured language's conventions. Text already frozen into GitHub (bodies, comments) keeps
its original language across a later language change, like any stale label (§2.4).

**The reference Deployment ships Hungarian** on every surface and in every email, its seed configuration
(Appendix A) authored in Hungarian; docs, code and identifiers stay English, and the `en` catalog is the
fallback skeleton ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/16)).

### 2.6 Codebase shape and stack

([ticket](https://github.com/Pergo911/github-issue-tracker/issues/17)) The product code lives in this repo beside the
design docs, as **two independent packages and no workspace**:

```
SPEC.md, GLOSSARY.md, docs/ …   design only
app/      one Vite project, one wrangler.jsonc = one Deployment unit
  src/client/   the SPA: reporter/ (form, status page), staff/ (dashboard, admin), ui/ (shared components)
  src/worker/   entry, Hono routes, gates (the Durable Object classes), GitHub / Resend / KV adapters
  src/shared/   runtime-neutral: catalogs, config schema and public projection, API contract, GitHub types
shell/    Electron: its own package.json, shares no code with app/
```

`app/` has three tsconfig projects: client (DOM types), worker (Workers types) and shared (neither), so a
cross-import between client and worker, or `shared/` touching an environment global, fails to compile. `shell/` stays
separate so Electron's ~370 MB never enters `app/`'s installs, and because it is built once per Deployment (ADR 0001).

**Hosting and build.** One Worker with static assets on Cloudflare; Pages is out (§2). `assets.not_found_handling` is
`"single-page-application"` and `run_worker_first` is `["/api/*"]`: everything the Worker serves lives under `/api/`,
the webhook and the device-flow proxy included, so `/status/<token>` and `/staff/...` are plain static assets that
never invoke the Worker. Vite with `@cloudflare/vite-plugin` runs the SPA and the Worker in one `vite dev`, with KV,
SQLite Durable Objects and Rate Limiting simulated locally. Strict TypeScript, npm.

**Worker.** Hono: middleware (`requireRole`, per-IP limiting) makes a gated endpoint unable to forget its gate
(§2.4). The Bot's GitHub client is a hand-rolled `fetch` wrapper around the JWT and installation-token code of §3.3,
not Octokit.

**SPA.** React 19 and TypeScript.

- **Routing.** React Router v8 in Data mode with `lazy` route modules, no framework or SSR mode. `staff/` is a
  separate chunk that reporters never download, so `reporter/` never imports from `staff/`. Dashboard view state
  (filters, sort, Board or List, open/closed) lives in URL search params, parsed through a small Zod helper.
- **State.** TanStack Query v5 holds all remote state, GitHub reads and the Worker API alike, with short stale times,
  invalidation on navigation and the manual refresh control (§2.4). There is no global store: the staff token sits in
  one small `localStorage`-backed module (§2.2), and the rest is component or URL state.
- **Label-touching writes.** `PATCH` replaces the whole label set, so another staff member's concurrent Priority
  change would be erased by a PATCH built from cached labels. Every mutation that touches labels GETs the Report
  fresh, swaps only its own label and sends the single PATCH of §2.4. The Board's optimistic UI moves only the card
  and rolls back on failure; the race window is one round trip.
- **Drag and drop.** `@dnd-kit/react`, pinned to an exact version: keyboard lifting and live-region announcements
  built in (localized through the catalog). It is still 0.x, so the per-card status menu stays the primary
  accessible path (§2.4) and a break never blocks status changes. `@hello-pangea/dnd` is the fallback.
- **GitHub from the browser.** Plain `fetch` through one `githubFetch` wrapper that refreshes the token and retries
  once on a 401 (§2.2) and follows the `Link` header. Response types come from `@octokit/types` as `import type`
  only, shared with the Worker's Bot client. There is no Octokit runtime: about 8 calls don't justify its 8.5 to
  43 kB.

**API contract.** Contract-first in `shared/api/`: each endpoint declares method, path, a Zod 4 request schema, the
response type and its error codes. The Worker registers handlers through a helper that takes the schema
(`@hono/standard-validator`), and the SPA calls a typed `callApi`, so neither side can drift. Hono's RPC client is
not used: it would import the Worker's types into `client/` and break the tsconfig boundary. Requests are validated
server-side; responses are typed, not parsed at runtime, since the SPA and the Worker deploy as one build. The same
schemas validate the `config` key and its §2.4 invariants.

**Deploy-time configuration.** One committed `app/wrangler.jsonc`, no `env` blocks (they suit staging and
production in one account, not a Deployment per Cloudflare account). Non-secret values (`GITHUB_ORG`, `GITHUB_REPO`,
`RESEND_FROM_DOMAIN`, `APP_URL`, the App and installation IDs, the bindings) are `vars` holding the reference Deployment's values; whoever
deploys elsewhere edits those lines and creates their own resources. KV namespaces are created by hand and their ids
pasted, since automatic provisioning is still beta. Secrets are Worker secrets listed under `secrets.required`, so a
deploy fails when one is missing; local dev reads a gitignored `.dev.vars`, with a committed `.dev.vars.example`. The
shell's `APP_URL` stays in its own build environment rather than being read out of `wrangler.jsonc`.

Test and lint/format tooling are implementation-planning choices, not design decisions.

### 2.7 Visual language: GitHub's look, taken from Primer

([ticket](https://github.com/Pergo911/github-issue-tracker/issues/17),
[ADR 0004](./docs/adr/0004-primer-is-the-source-of-the-look-not-a-dependency.md),
[`docs/ui-github-look.md`](./docs/ui-github-look.md)) All three surfaces look like GitHub's own interface.

- **Source of the look.** `@primer/primitives`, pinned and imported as CSS variables, in its light and dark themes.
  `data-color-mode="auto"` follows the OS, which the Electron shell inherits; there is no per-user toggle, and
  colour-blind and high-contrast themes are an additive upgrade. Components use theme tokens only, never a
  hard-coded colour.
- **Components.** Tailwind 4 and shadcn/ui on Base UI, copied into `client/ui/`, with shadcn's variable names aliased
  to Primer tokens in one theme file. Radii are 3 / 6 / 12px, text 14px, controls 32px, and the font stack is the
  system one. Icons are `@primer/octicons-react`. The pieces GitHub's library would have supplied that shadcn doesn't
  (issues-list row, state pill, label pill, comment box and timeline, Board, filter bar, pickers) are hand-built to
  the measurements in `docs/ui-github-look.md`.
- **Not `@primer/react`.** It has no localization mechanism and would leak English into a Hungarian Deployment (§2.5).
- **Label pills.** A taxonomy value's colour (§2.3) renders through GitHub's own formula, so light and dark both
  read correctly and the dashboard matches github.com. State pills are green for open, purple for closed as fixed
  and neutral grey for rejected or duplicate.
- **Public surfaces.** The form and status page share the look but not GitHub's identity data: no avatars or logins
  (§4.3), and Reporter and Staff comments are told apart by the localized label (§2.5).
- **Marks.** No GitHub logo or Octocat, and no "GitHub" in the header or product name: the header shows the
  Organization's display name. "GitHub" appears only as a plain fact, on the staff sign-in and the device-code screen,
  which says the code is entered on github.com's own page. Primer's code, tokens and icons are MIT; the look itself
  has no clearance either way, which is an accepted risk for a demonstration Deployment.

---

## 3. Feasibility confirmation

Three sub-questions were researched before committing to this design. Full source lists are in each subsection.

### 3.1 Sending OTP and notification email from a serverless/edge function

**Confirmed feasible.** HTTP-based transactional email APIs work fine from edge runtimes (no raw SMTP socket
needed, which Workers/Edge functions can't easily do anyway).

- **Resend** is the recommended provider: plain HTTPS API with an official Cloudflare Workers integration,
  free tier of 3,000 emails/month (100/day). The shared test sender domain can only deliver to the account
  owner's own inbox — a **verified custom domain is required** to email real reporters, but verification is
  just DNS TXT/CNAME records, no approval queue.
- Alternatives considered: **Mailgun** (generous free/low-volume tier, historically the go-to for side
  projects), **SendGrid** (no real free tier anymore — 60-day trial only), **AWS SES** (3,000/mo free, but
  starts in a sandbox requiring _both_ sender and recipient to be individually verified, plus a manual AWS
  support-ticket to exit sandbox — worse fit here since recipients are a fixed roster we don't want to
  pre-verify one by one).
- **OTP-specific deliverability:** OTP mail is more spam-filter-sensitive than general notifications. SPF/DKIM/
  DMARC are effectively mandatory (Google's 2024+ bulk-sender rules). Decided
  ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/4)): each Deployment sends all app email from
  a **dedicated `mail.` subdomain** of a domain its deployer already controls, isolating the app's sender
  reputation; the deployer verifies the subdomain in the Deployment's own Resend account and adds the records
  manually in the existing zone (no code manages DNS). The reference Deployment reuses the project owner's
  `berautoapp.hu` (zone at Rackhost) and sends from `mail.berautoapp.hu`.
- **OTP storage:** a stored approach (hash, expiry and attempt count in a SQLite-backed Durable Object, one per
  email) is chosen over a fully stateless HMAC/TOTP-style code, which can't be made single-use or
  attempt-limited without adding state back in. KV is the wrong store for it: it has no atomic updates, shows
  writes in other locations only after about a minute, and its free plan allows 1,000 writes a day, which OTP
  traffic would take from the Report mappings. A Durable Object serializes every request for one key, so
  single-use and the guess limit are real guarantees ([ADR 0003](./docs/adr/0003-otp-and-abuse-state-in-durable-objects.md)).
  Durable Objects are on the Workers Free plan (100k requests and 100k row writes a day).
- **Anti-abuse:** per-email and per-token limits are atomic in Durable Objects; per-IP bursts use the native
  **Rate Limiting binding**, which counts per Cloudflare location and is deliberately permissive, so it is
  casual-abuse prevention, not billing-grade precision, which is sufficient here. The numbers are in §4.5.

<details><summary>Sources</summary>

- [Send emails with Resend – Cloudflare Workers docs](https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/)
- [Resend: Send with Cloudflare Workers](https://resend.com/docs/send-with-cloudflare-workers)
- [Resend: 403 error on resend.dev domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [AWS SES: Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [AWS SES sandbox explained – BigMailer](https://www.bigmailer.io/aws-ses-sandbox/)
- [Magic link / OTP deliverability best practices](https://guptadeepak.com/ciam-compass/best-practices/magic-link-deliverability/)
- [SPF/DKIM/DMARC guide](https://johal.in/email-deliverability-spf-dkim-dmarc-guide)
- [Stateless OTP with HMAC and time steps](https://medium.com/@mohanganeshgollapalli/building-a-stateless-otp-system-with-hmac-and-time-steps-11cd3587920c)
- [RFC 4226 (HOTP)](https://tools.ietf.org/html/rfc4226)
- [Rate limiting with Cloudflare KV](https://flaviocopes.com/rate-limiting-cloudflare-kv/)
- [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

</details>

### 3.2 GitHub webhooks driving update-by-email

**Confirmed feasible**, with reliability caveats to design around.

- Event coverage is complete: the `issues` event's `action` field covers `opened`, `edited`, `labeled`,
  `unlabeled`, `assigned`, `unassigned`, `closed`, `reopened`; comments are the separate `issue_comment` event
  (`created`/`edited`/`deleted`). The `issues` event alone covers every case that should trigger an email (§4.2),
  so the receiver subscribes to `issues` only.
- A plain **repository-level webhook** (admin-clickable in repo Settings, no GitHub App registration) is
  sufficient — GitHub Organization-level and App-level webhooks exist but add nothing needed here.
- Every payload includes the full issue object (number, title, body, labels, assignees, state) — so a receiving
  function can always identify _which_ issue changed. It does **not** include any custom "reporter" field —
  GitHub has no such concept — which is why an external mapping is needed (see §3.3's privacy finding).
- Signature verification is a standard, well-supported HMAC-SHA256 check (`X-Hub-Signature-256` header against
  the webhook's shared secret) — trivial in any WebCrypto-capable runtime, including Workers.
- **Reliability caveat to document explicitly:** GitHub does not automatically retry failed webhook deliveries,
  there's no cross-delivery ordering guarantee, and duplicate deliveries are possible. The receiver must ack
  fast, and must be **idempotent** — dedupe by the `X-GitHub-Delivery` ID (a short-TTL KV entry per delivery ID
  is enough, written only for email-worthy events, §4.2) so a redelivered event doesn't double-email a reporter.
  This is a "best-effort" notification
  channel, not a guaranteed one — worth stating plainly rather than implying certainty.

<details><summary>Sources</summary>

- [Webhook events and payloads – GitHub Docs](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Types of webhooks – GitHub Docs](https://docs.github.com/en/webhooks/types-of-webhooks)
- [Validating webhook deliveries – GitHub Docs](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Handling failed webhook deliveries – GitHub Docs](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)
- [Redelivering webhooks – GitHub Docs](https://docs.github.com/en/enterprise-cloud@latest/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)
- [GitHub Issues & Projects – webhook support for project status updates](https://github.blog/changelog/2024-06-27-github-issues-projects-graphql-and-webhook-support-for-project-status-updates-and-more/)
- [Deciding when to build a GitHub App – GitHub Docs](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)

</details>

### 3.3 Creating issues on behalf of reporters who have no GitHub identity

**Confirmed feasible**, via the Bot's GitHub App credential (see the privacy note below).

- **Decision: a GitHub App with installation tokens** (§7 item 4,
  [ticket](https://github.com/Pergo911/github-issue-tracker/issues/9)). Label creation — the one capability that
  could have forced the choice — works under both (`Issues: write` covers `POST /labels` for installation tokens
  and fine-grained PATs alike), so the choice is purely operational, and it goes to the App:
  - The PAT route means a **second GitHub account** to create and maintain forever — its own email, 2FA, GitHub Organization
    membership, offboarding — plus a static secret that expires (one year max) and must be manually rotated, or
    the Deployment silently stops accepting Reports. The "simplicity" was in the code, and the code is written
    once while every Deployment pays the account-and-rotation tax yearly.
  - The App route costs a one-time ~50-line JWT-signing + token-exchange implementation and three Worker
    secrets (App ID, private key, installation ID). Installation tokens are minted on demand, expire after
    one hour, and the private key does not expire.
- **Two separate GitHub Apps per Deployment**, not one app serving both sides: `reports-staff` (device-flow
  login, §2.2) and `reports-bot` (the Bot, installation tokens). Separate branding — the authorize screen shows
  the staff app's name, issue comments show the Bot's avatar; separate suspension surfaces — suspending the Bot
  never logs staff out; and no OAuth/device-flow surface on the automation credential that never needs it. One
  extra registration per Deployment is configuration, not code.
- **Permission matrix:** `reports-bot` keeps **`metadata: read` + `issues: read & write`** (never repository
  `administration`); `reports-staff` has **`metadata: read` + `issues: read & write` + `administration: read & write`**
  so System admins can manage Staff collaborators and invitations through the Worker (§2.4,
  [ADR 0006](./docs/adr/0006-manage-staff-roles-as-repo-collaborators-via-staff-token.md)). Because GitHub intersects
  a GitHub App user token with the caller's own repo role, Viewers and Maintenance staff gain no administrative
  power. Staff user tokens call `api.github.com` client-side for Report views and actions, still gated by the member's
  own repo role — the repo `permissions` object reflects Triage (spike-verified). Bot installation tokens create issues,
  create and swap the taxonomy labels, post `Reporter:`-marked comments, and read issues for the status page. Removing
  a member from the repo or the GitHub Organization drops their role and the role check denies (404 / no `permissions`)
  — offboarding is self-locking.
- **Real-world precedent exists:** [Staticman](https://github.com/eduardoboucas/staticman) uses exactly this
  shape — a bot-account credential turning anonymous public form submissions into GitHub writes (commits/PRs in
  its case) specifically so the visitor never needs a GitHub identity. "Form → bot creates a GitHub issue" is
  also a common no-code Zapier/Make pattern, i.e. not a novel or fragile idea.
- **Privacy finding:** stashing the reporter's email in a "hidden HTML comment in the issue body" is **not
  actually private** — it's only invisible in _rendered_
  Markdown; the raw body (comment included) is returned by the API and visible via raw views to anyone with
  repo Read access. The same is true of a Projects v2 custom field — item visibility still gates on repo Read
  access, so it's equally exposed to every staff member, not just the ones who need contact info. **Decision:
  keep the reporter's email out of GitHub entirely.** Store the issue-number → email mapping only in Workers
  KV, with a temporary copy only in submission recovery (§4.1, §5). This restricts who can see a
  reporter's email — worth calling out because minimizing exposure of personal data by design is a real, not
  just cosmetic, consideration in an EU context (GDPR).
- **Rate limits:** the bot's token gets its own quota bucket (starts at 5,000/hr, scales with GitHub Organization size),
  separate from staff's per-user quotas — irrelevant at building-scale volume. The one real risk is that _all_
  anonymous submissions share this single token/bucket, so abuse (e.g. OTP/submission spam) could in theory
  exhaust it for everyone at once. Mitigate at the OTP/submission layer (§4.5's limits), not here. Status lookup
  is the other public path that spends it (an issue read plus paginated timeline reads), so §4.5 caches it briefly.

<details><summary>Sources</summary>

- [Deciding when to build a GitHub App – GitHub Docs](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- [Differences between GitHub Apps and OAuth apps – GitHub Docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)
- [Rate limits for GitHub Apps – GitHub Docs](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps)
- [Using the API to manage Projects – GitHub Docs](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- [Managing visibility of your projects – GitHub Docs](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-visibility-of-your-projects)
- [staticman/staticman](https://github.com/eduardoboucas/staticman)
- [People who consume a license in an organization – GitHub Docs](https://docs.github.com/en/billing/reference/github-license-users)

</details>

### 3.4 Bottom line

The OTP-gated reporter flow is feasible end to end on a lightweight-serverless design. It is **not**
backend-free — the staff-login proxy already rules that out (§2) — but it doesn't need a "real" server either:
Cloudflare Workers + Workers KV + Durable Objects covers every requirement (OTP issuance/verification, bot-authored
issue creation, webhook-driven notification email, the staff device-flow proxy). The architecture holds **actual
persistent state** (KV and Durable Objects), which is worth naming explicitly rather than calling the design "serverless" in the stronger
sense some readers assume that word means.

---

## 4. Reporter-side flow

### 4.1 Submission (one verified attempt, recoverable without a login)

1. Reporter fills out the report form fully: email, category, location, a title, the description and an optional
   exact place (all fields, before any verification step). The form shows the Deployment's emergency notice
   (§2.3). That is the complete field list — nothing else is collected (field inventory and reasons below).
2. Reporter clicks "send code." The frontend calls the **OTP-request** function with just the email.
   - Function checks the email against the **allowlist** (KV). If not listed, responds with a generic message
     ("if this address is registered, a code has been sent") rather than confirming/denying membership, to
     avoid trivially enumerating valid addresses.
   - If listed: the Worker asks that email's Durable Object (§4.5) to issue a code: a 6-digit OTP from a CSPRNG,
     stored as hash + expiry and sent via Resend. The cooldown and the per-email caps are enforced there.
   - The response is identical whether the address is unlisted, was sent a code, is cooling down or is capped, and
     the per-email Durable Object call and the send run in `waitUntil`, so the listed and unlisted paths return
     alike. The one exception is the Deployment-wide code budget (§4.5): its single global gate is awaited on
     every OTP request, before the Allowlist read, so its 429 never depends on membership and no per-email
     state is touched. The client runs the resend countdown itself.
   - The "code sent" screen shows the Deployment's configured help text for a code that never arrives (check the
     address; whom to contact), because the generic response can't say why.
3. Reporter enters the received code into the same form.
4. Reporter clicks final "submit." The frontend calls **OTP-verify-and-submit** with email + code + all Report
   fields and a stable, unguessable submission-attempt credential, retained in `sessionStorage` before dispatch
   so a lost response can be recovered. Validate the fields before consuming the code.
   - The email's Durable Object reserves/counts the attempt before comparing the hash/expiry. On success it **atomically
     consumes the OTP and persists the pending submission**, including its canonical payload/fingerprint, recovery
     credential hash, independent nonsecret correlation marker and fixed Status token. A code is single-use and
     allows at most 5 wrong guesses (§4.5). OTP failures remain indistinguishable. Replaying the same verified
     attempt resumes it; it does not verify the spent OTP again. Changed payloads cannot reuse its credential.
   - Persist a dispatch fence **before** creating the GitHub issue via the Bot (§3.3). It carries Category,
     Location and Initial status labels (§2.3), the validated Reporter's title, and the fixed body template below.
     The body also carries the independent correlation marker as trusted machine metadata, outside the Reporter
     text. **No Reporter email, recovery credential or Status token is written into GitHub.**
   - Persist the returned issue number immediately. Through the Report gate, write `issue-email:<issue#>`,
     `status-token:<token>` and `issue-token:<issue#>` to KV using the fixed values. The Status token is 16 CSPRNG
     bytes, base64url-encoded (22 characters, 128 bits), never derived from the sequential issue number. These
     KV values remain plaintext: gated staff lookup needs them, and a KV reader already sees the emails.
   - Only after the issue and all three mappings are acknowledged does the attempt complete. Return the
     permanent Status link (`https://<app>/status/<token>`) and attempt the confirmation email (§4.6). Email failure
     is logged but cannot undo completion or invite another create; the on-screen link remains usable. KV
     acknowledgement is not immediate global visibility: its accepted propagation lag still applies.

**Recovery is durable, not exactly-once GitHub creation**
([Status views, neutralization and failure paths](https://github.com/Pergo911/github-issue-tracker/issues/18),
[ADR 0005](./docs/adr/0005-recover-submissions-without-retrying-uncertain-creates.md)):

- While mapping writes are pending, the SPA shows a localized **Still saving your Report** state. A
  credential-gated, rate-limited resume operation lets the same tab recover after refresh without a new OTP.
  Treat the recovery credential as a temporary bearer secret (at least 128 random bits), separate from both
  the public correlation marker and the permanent Status token. It authorizes only that attempt, not new Reports.
- Retry missing mappings for a **known issue** with fixed values and backoff. Persist phases and write progress;
  DO requests can interleave across network awaits. Do not rely on a long `blockConcurrencyWhile` callback.
  Alarms are at-least-once with finite built-in retries; re-arm longer recovery deliberately. Respect KV's
  same-key write limit and never put recovery counters or staging records in KV.
- An interrupted or timed-out issue create is **uncertain**, including a crash after its dispatch fence. Scan
  the repository's issues (`state=all`, paginated) for the exact correlation marker and expected Bot identity.
  Adopt a unique match; zero or multiple matches require manual reconciliation. Search indexing or a negative
  scan cannot prove non-creation. **Never automatically repeat an uncertain create.** GitHub supplies no
  documented durable idempotency key; this design does not promise exactly-once or automatic eventual success.
- An unresolved attempt is retained and blocks another submission for that email until reconciled or explicitly
  discarded. Show a reference and the configured contact instructions when human help is needed, not a blind
  resubmit button. A System admin's operational procedure inspects the retained attempt and GitHub marker,
  associates a verified existing issue or explicitly discards/cancels the attempt and its partial mappings.
  The procedure's tooling is an implementation choice, not a new dashboard screen or a new planning ticket (built as an
  Admin-gated Worker endpoint and a CLI: [runbook](./docs/runbook-submission-recovery.md)).
- The Report gate coordinates finalization, Reissue and Erasure with persisted lifecycle state, including a
  deletion tombstone. Register known-issue recovery there before KV finalization. Delayed work cannot recreate
  a deleted Report's mappings or overwrite a replacement token. Recovery rechecks issue existence and current
  lifecycle state; it is not a blind replay of initial puts.
- Temporarily retain the verified email and submission payload in the Email gate. Remove the payload when
  complete; retain only a replayable completion receipt (credential hash, payload fingerprint, issue number,
  original confirmation result/link and expiry) for **24 hours**, then clean it up. A new attempt must not
  overwrite a still-valid receipt. A receipt never exposes a successor token after Reissue and is cancelled by
  Erasure. Unresolved attempts have no silent expiry: reconciliation/discard and erasure remove their recovery
  data explicitly (§5).

There is no separate "verify now, submit a different Report later" session and no Reporter login. The temporary
recovery credential resumes only the already verified submission; the Status token is the permanent capability
for the resulting Report. Closing the tab may lose recovery access; persisted work continues, and the best-effort
confirmation email or Staff contact is the route back.

**Field inventory and limits** ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/13)). Beyond the
taxonomy picks (§2.3), the form has exactly three free-text fields, trimmed server-side like comments
(§4.3, §4.5):

| Field       | Required | Limit (after trim)        | Purpose                                                                                                                                   |
| ----------- | -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Title       | yes      | 3–80 characters, one line | The Reporter's recognition handle; flows into every Report-specific email subject (§4.6), so internal newlines collapse to spaces at trim |
| Description | yes      | 1–4,000 characters        | The Report's content; also bounds the issue body                                                                                          |
| Exact place | no       | 1–100 characters          | The fine-grained locator under the picked Location                                                                                        |

The title is written by the Reporter, not generated from category and location: fifteen "Heating — Corridor B"
issues would be indistinguishable to Staff in GitHub's issue list, and the title is how the Reporter tells
several Reports apart in their mailbox (§7 item 8). The form collects no identity or contact fields — no name,
no phone: the allowlisted email is the identity, the Allowlist `note` already carries a name/unit for Staff on
the gated screen (§4.4), and every extra PII field is one more thing to keep out of GitHub forever.

**Titles use validation, not an encoding wrapper.** After the existing trim/newline normalization, the initial
allowlist is Unicode letters, combining marks and numbers; ordinary space (`U+0020`); and punctuation
`. , ! ? ( ) ' " - – — ‘ ’ “ ” „ ‚ » « …` (the last five are Hungarian typography, added on the
live evidence below). Reject other characters with a catalog error; do not silently strip/replace them.
Accepted titles are stored unchanged and rendered as plain text in the SPA and emails. They are not fenced.
Backticks, Markdown delimiters, `@`, `#`, angle brackets, colons, slashes, emoji and control characters are outside
this allowlist. The 3–80-character limit remains.

**Live validation** ([ticket #32](https://github.com/Pergo911/github-issue-tracker/issues/32), 2026-11-10,
`reports-sandbox`, the real Bot; the full table is in
[`docs/evidence/title-alphabet-live-check.md`](./docs/evidence/title-alphabet-live-check.md), repeatable with
`npm run check:titles`). 111 candidate titles were created as issue titles, read back raw (REST) and rendered
(GraphQL `titleHTML`), and their timelines were searched for `mentioned` and `cross-referenced` events:

- All 62 titles the validator then allowed (Hungarian letters and accents, digits, every allowed mark, domain-like
  text such as `example.hu` and `www.example.com`, hexadecimal and SHA-like strings of 7 to 40 characters, plain
  numbers, `GH-1`, bare user names, other scripts, combining marks) came back byte for byte, rendered as plain text
  (no tag in `titleHTML`), and raised no timeline event.
- GitHub renders a title far more inertly than a body: `@mentions`, `#` references, URLs, e-mail addresses,
  Markdown emphasis, links, HTML and `&amp;` all stayed plain text even as probes. Only two things change the
  rendering: a backtick pair becomes `<code>` and a `:shortcode:` becomes an emoji, and both are outside the
  allowlist (backtick and colon).
- The Hungarian opening quotation mark `„` was missing from the original allowlist while its closer `”` was
  there. `„ ‚ » « …` all rendered as plain text and were added. `/ & + % ; : = * _ ~ | [ ] { } $ ^ § €` also
  rendered as plain text; they stay out because `:` is not safe and the rest would widen a policy this ticket was
  not asked to widen. Widening it is a product decision, with this evidence in hand.

What this does **not** show: how GitHub's notification e-mails, mobile app or other integrations render a title,
and nothing about GitHub changing its rendering later. `npm run check:titles` exits non-zero if an allowed title
ever misbehaves. The title is still never fenced and never replaced by a generated one.

**The issue body is a fixed template with fenced free text.** Its captions (Category / Location /
Exact place / Description) come from the code catalog for the configured language (§2.5) — the template's
structure stays in code — so a Hungarian Deployment writes Hungarian captions into GitHub, and a written
body keeps its captions across a later language change. The body repeats the category and
location **display names** (the labels carry only the kebab-case identifiers), the exact place when present,
then the description. Wrap each Reporter-authored body field with the dynamic code-fence mechanism of §4.3;
captions and correlation metadata stay outside the fences. The SPA decodes canonical raw envelopes and renders
plain text, not GitHub's HTML or a Markdown pipeline. The safety objective is the same everywhere — no active
Reporter Markdown/HTML, mentions or auto-links — but titles use the separate validated-input policy above.

**No photos in the MVP.** GitHub has no official attachment API (§6): the undocumented `uploads.github.com`
endpoint exists for the web editor, is not documented to accept an installation token, and could break without
notice — and its `user-attachments` URLs are fetchable by anyone with the link, so a photo of someone's home
would leave the private repo's access control for a public CDN. A "paste an image link" field pushes image
hosting onto the Reporter and adds an external-fetch surface to the body. The named upgrade path, if photos
are ever wanted, is a Cloudflare R2 bucket behind the Worker (additive, like the Turnstile path in §4.5) —
never the undocumented endpoint.

### 4.2 Status updates: email on major changes, link for everything else

Emailing on every label tweak or comment would spam reporters for a "check on my broken hallway light" use
case. Instead:

1. GitHub fires the `issues` webhook to the receiver function on every change to a Report (§3.2). The receiver
   subscribes to `issues` only: staff comments are link-only and the bot's own reporter comments never mail, so no
   `issue_comment` event is ever needed — staff notification of reporter comments is dashboard-only, never a
   system email (§4.3, §7 item 15a, [ticket](https://github.com/Pergo911/github-issue-tracker/issues/11)).
2. Receiver verifies the HMAC signature.
3. Receiver **drops** events that can never be emailed, before anything else:
   - `deleted`: the Report gate records the deletion, cancels associated recovery/receipts, and purges
     `issue-email`, `issue-token` and `status-token` (§4.1, §5), then stops. `transferred` is unsupported and ignored.
   - The event's `sender` is the Bot. GitHub fires one `labeled` per label when an issue is created with labels,
     so the bot's own creation-time events (and its reporter comments) would otherwise look like a status change.
   - A `closed` delivery whose `issue` is open, or a `reopened` one whose `issue` is closed: GitHub renders the
     `issue` when it sends the delivery, so the Report changed again in between, and the later delivery says
     what happened (§6, live findings).
   - A status entered while the Report is closed: a stale label, since closed is GitHub's state (§2.3).
   - Entering the `initial` status. The dashboard applies it right after `reopened`, so a reopen sends one
     email, not two.
4. Receiver applies the **major-change filter**, written against Status flags, not label names (§2.3). A **Major
   change** is:
   - **Closed**, with the reason carried: fixed (`completed` or none), rejected (`not_planned`) or duplicate.
   - **Reopened.**
   - **A status entered while the Report is open, when that status has the `notify` flag.**

   Everything else sends **no email**: Staff comments, assignment changes, Priority/Category/Location edits, title
   and body edits, entering a Status without `notify`, and every `unlabeled`. The Status page exposes only its
   public projection (§4.3): Priority remains private, assignment is presence-only, and title/body edits update
   current content rather than promising a revision archive. Staff comments stay link-only on purpose: a Staff
   member who needs something from the Reporter uses reveal-contact (§4.4).

5. For a Major change, receiver checks `X-GitHub-Delivery` against the dedupe KV (skip if already processed) and
   writes the key only now, so ignored events cost no KV writes. It then looks up the issue number in the
   `issue-email` KV mapping and sends a short notification via Resend (§4.6) naming the change and repeating the status
   link (so the email itself doubles as a way back in even if the original confirmation email was lost). With no
   mapping it drops the event and logs it, since GitHub won't retry.

There is no coalescing: each Major change sends its own email naming only its own fact. A dashboard close sends
one email (`closed`, plus an `unlabeled` that never mails), a reopen sends one, and a status change together with a
priority change sends one. Two `notify` statuses added at once (which breaks the one-status invariant) send two.
Deliveries have no ordering guarantee, so emails can arrive out of order; the status link is authoritative.

This makes the status link authoritative for Reporter-visible progress/history, and email a lighter-weight "something
worth your attention happened" nudge — closer to how most real issue trackers separate a notification digest
from the full activity log.

### 4.3 Status page (pull, via the permanent link)

1. Reporter opens `https://<app>/status/<token>`. The frontend calls a **status-lookup** function with the
   token — it cannot call `api.github.com` directly itself, since the reporter has no GitHub credential at all.
2. Function looks up `status-token → issue#` in KV; unknown/invalid token → generic 404 (don't distinguish
   "wrong token" from "replaced token" from "never existed"; the 404 page says only that the link may have been
   replaced and to check the latest email). Rate-limit this endpoint (§4.5) — the token's entropy makes
   brute-forcing impractical, but there's no cost to also throttling guesses. The page also declares
   `Referrer-Policy: no-referrer`, so the token in the URL never leaks to any site a Reporter navigates to from it.
3. Function reads the issue and its paginated timeline via the Bot (§3.3), a **read-only proxy**; the Reporter
   never calls GitHub directly. Timeline responses already contain comments, so no separate comments fetch is
   required. Follow pagination rather than silently truncating history. Construct the explicit public projection
   below, defined alongside the API contract in `shared/`; new GitHub fields are private by default. Cache it for
   30 seconds per token (§4.5), so a refresh loop does not repeatedly spend the Bot's GitHub quota.
4. Frontend renders current details and the allowed progress/comment timeline. The Report's title, body and
   classification are not editable here. Reporter comments are distinguished from Staff comments; commenting
   and Reissue are the only writes this surface offers.

**Status-page field allowlist**
([Status views, neutralization and failure paths](https://github.com/Pergo911/github-issue-tracker/issues/18)):

- Report number, current title, decoded body content (including Exact place), Category and Location; current
  Status or the invalid-Status fallback; open/closed state and close reason; creation/update/close timestamps.
- Assigned/unassigned **only**, never who is assigned.
- Comments: plain text, timestamps and `author: "reporter" | "staff"`. Decode the canonical Reporter envelope
  only after authenticating its Bot authorship; render other comments as plain text, never GitHub HTML.
- History: Status, close/reopen, Category, Location and assignment-presence changes with timestamps, stripped
  of actor identities. Include only these event types; do not forward cross-references or nested source issues.
  It is progress history, not a complete title/body edit-revision archive. Any displayed comment count is derived
  from the visible comments, not a raw GitHub object or a count of filtered events.

Never return Priority, unrelated labels, structured assignee/comment-author/actor identities, GitHub logins,
avatars, profile/issue URLs, machine correlation metadata, or raw GitHub objects. Allow only the fields above;
do not rely on deleting known-sensitive keys from an otherwise unrestricted payload. This removes **structured**
identity data, not names or URLs Staff choose to write in free text; Staff discipline still applies below.

**Neutralizing body/comment text: canonical dynamic fences.** Let `F` be a zero-indented run of
`max(3, longest backtick run in the input + 1)` backticks, without a language/info string. Wrap a body field as
`F + "\n" + text + "\n" + F`; a Reporter comment is `"**Reporter:**\n\n" +` that envelope. The trusted marker is
outside the code block, never localized. No input backtick run can close this fence. Do not replace it with
a fixed triple-backtick wrapper, generic backslash escaping, HTML entities or a Markdown-rendering pipeline.

Decode the **raw API body**, requiring the exact canonical envelope (including re-encoding equality), not
`body_html`/`body_text`; remove only the wrapper's deliberately added newline. Literal entities and embedded
Reporter-marker text remain the submitted text. GitHub renders the fields as code blocks; both SPA surfaces
render the decoded text normally, without a monospace requirement. A noncanonical/Staff-edited body falls back
to plain text, not guessed unescaping or active Markdown.

Reporter attribution requires the expected Deployment Bot's numeric identity, login and `type: Bot` **and** the
canonical Reporter envelope. A Staff-authored lookalike is still Staff. Pin Bot identity from the App during
Deployment setup, never from a claimed marker or untrusted comment. `performed_via_github_app` may be null;
absence is not disqualifying and present conflicting App metadata fails closed. The dashboard uses the same
runtime-neutral classifier/decoder from `shared/`, with expected Bot identity supplied through role-gated Worker
metadata to any Staff role. Reporters receive only the computed attribution, never that identity metadata.

The [live installation-token spike](https://github.com/Pergo911/github-issue-tracker/issues/18#issuecomment-6261841183)
validated raw round-trips, actual fenced rendering, attribution and mention/reference controls for the tested
body/comment corpus. Raw Bot mentions **did** notify. Fenced mention/reference suppression is bounded evidence
from that run, not a guarantee of permanent email non-delivery or suppression of ordinary subscriber notifications.
Titles have the separate input policy in §4.1, validated live in ticket #32.

**Reporter comments** (requirement from the instructor): a reporter can add comments to their own
report from the status page.

1. The status page shows a comment box. Submitting it calls an **add-comment** function with the status token
   and the comment text. As with status lookup, the reporter has no GitHub credential, so the Worker does the
   write.
2. Function resolves `status-token → issue#` in KV (unknown token → the same generic 404), applies the per-token
   and per-IP limits of §4.5 (the page is a public write endpoint, so this matters more than for reads), and
   enforces 1–2,000 characters after trimming. A posted comment evicts the cached view.
3. Function posts via the Bot (§3.3) using the canonical dynamic-fence envelope above and the fixed
   `**Reporter:**` marker (§2.5). The status-lookup function and dashboard authenticate Bot authorship, decode
   the raw envelope and render the localized Reporter label. Embedded markers cannot change attribution.
   **No Reporter contact email is added to the comment**, preserving the §3.3 invariant.
4. The webhook receiver never sees the resulting `issue_comment` event, since it subscribes to `issues` only
   (§4.2). Staff notification is **dashboard-only** (§7 item 15a): no system email is ever sent on a reporter
   comment — no seventh template (§4.6) burning the shared email budget (§4.5), and no `issue_comment`
   subscription. Assignees and repo watchers get GitHub's own notifications for every Bot-posted comment, and the
   dashboard shows reporter comments like any other via the marker.
5. **Commenting stays open on a closed Report, and a comment never reopens it** (§7 item 15b). The status link
   outlives the close (links never expire), so the comment box stays reachable; the status page shows a notice
   there: a closed Report doesn't reopen on a comment, and a recurrence should be filed as a new Report. Reopen
   stays a Staff action (GitHub or the dashboard), so it keeps the `reopened` Major-change email and the
   dashboard's `initial`-status application (§4.2) — the Worker never reopens or applies `initial` on reopen. A
   reporter-side "not fixed" reopen action is the documented upgrade path if staff miss late comments.
6. **Comments are append-only** (§7 item 15d): a reporter cannot edit or delete a comment. "Their own" is not a
   notion the system has — the marker doesn't say who commented, and any link holder can post — so edit/delete
   would need new ownership state and a gated endpoint for nothing asked for. GitHub keeps public edit history
   anyway, and Staff moderate via GitHub directly if abuse happens.

Because the status link is a shareable capability URL (§1), anyone holding it can comment, not just the original
reporter. That follows from the existing link-sharing decision (a spouse or roommate may use it), and the
marker only says "reporter", not who. If the link leaks, anyone holding it can reissue it (below), and the
per-token comment budget (§4.5) bounds the noise until then.

**Reissuing a link.** A status link can be replaced but not simply revoked. Two triggers share one Worker function:

1. **Any holder**: the status page has a "reissue this link" button behind a confirmation ("this ends the old link
   for everyone; a new one is emailed to your address"), capped at 3 per Report per day (§4.5).
2. **Staff** (Triage or better, the same gate as reveal-contact, §4.4): a dashboard action, uncapped, for
   offboarding or a leak reported by phone.

Through the Report gate's lifecycle coordination (§4.1), the function mints a new token, writes
`status-token:<new>`, updates `issue-token:<issue#>`, deletes
`status-token:<old>`, and emails the new link (§4.6) to the Reporter's address in KV. **The new link is never returned to
the caller**, so whoever holds a leaked link can end their own access but can't take over the Report. The old link
behaves like any unknown token (generic 404, step 2). KV is eventually consistent, so the old link can keep
resolving from other locations for up to about a minute. Links never expire, including after the Report closes.

**Comment visibility:** since issue comments become visible to whoever holds the link,
staff need a convention for what's safe to write in a comment. Default for MVP: **treat every comment as
reporter-visible** and rely on staff discipline (don't discuss anything sensitive in-issue). A documented
upgrade path if that proves insufficient: adopt a marker convention (e.g. a comment prefixed `[internal]`) that
the status-lookup function filters out before returning data to the public page. Not needed unless staff
actually run into a case where they want a private back-channel on a specific report.

### 4.4 Staff contact lookup and link resend (gated)

Because the Reporter's durable contact mapping lives in KV, not GitHub, Staff who need contact details (e.g. to
schedule building access) or a lost Status link cannot get either from the issue itself. A small
**reveal-contact** function, gated by checking the caller's repo role (using the staff member's own GitHub token
from device-flow login, §2.2), looks up the email and/or status link from KV and returns it, along with the
Allowlist entry's `note` while the address is still listed. This keeps both lookups auditable/controllable in one
place instead of that data being plastered across every issue view. The same gate covers staff **reissue** (§4.3).
If a Reporter's mailbox is dead (say, after a change of address), Staff reveal the link and hand it over by other
means.

### 4.5 Abuse controls

Where the state lives ([ADR 0003](./docs/adr/0003-otp-and-abuse-state-in-durable-objects.md)): per-email, per-token
and Deployment-wide limits are atomic in SQLite-backed Durable Objects, one per gated key (the SHA-256 of the
normalized email, a Report's issue number, or a single global key). An unlisted address is rejected by the KV Allowlist
read before any object exists, so an attacker can't mint objects. Per-IP bursts use the Rate Limiting binding
(casual-abuse quality, §3.1). KV holds only read-mostly or write-once data.

**Codes** (per-email values live in the email's Durable Object):

| Parameter            | Value                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Code                 | 6 digits from a CSPRNG, rejection-sampled to avoid modulo bias                                       |
| Expiry               | 10 minutes                                                                                           |
| Resend cooldown      | 60 seconds per email                                                                                 |
| Wrong guesses        | 5 per code, then the code is burned and a new one must be requested                                  |
| Codes per email      | 5 per hour and 10 per day                                                                            |
| Codes per Deployment | 40 per day by default, configurable (Resend's free tier is 100 emails a day, shared with other mail) |

A targeted address therefore allows at most 50 guesses a day (10 codes of 5 guesses) against 10⁶ combinations,
under 0.005%. The OTP-request response never depends on the email (§4.1), so the cooldown and per-email caps are
silent and only the per-IP and Deployment-wide limits can answer 429.

**Rate limits:**

| Endpoint          | Per IP (binding) | Per key                                                               |
| ----------------- | ---------------- | --------------------------------------------------------------------- |
| OTP request       | 5/min            | the code caps above                                                   |
| Verify and submit | 10/min           | 5 wrong guesses per code                                              |
| Resume submission | 10/min           | valid unguessable attempt credential; reads/resumes only that attempt |
| Status lookup     | 20/min           | 6/min per token (binding)                                             |
| Add comment       | 6/min            | 3/min per token (binding), 20/day per Report (Durable Object)         |
| Reissue (holder)  | none             | 3/day per Report (Durable Object)                                     |

The per-IP numbers are deliberately generous backstops, since an Organization can share one NAT; the real limits
are per email and per token. Comment text is 1–2,000 characters after trimming. The status-lookup view is cached
for 30 seconds per token in the Workers Cache API (no KV writes) and evicted by add-comment and reissue
(best-effort: the Cache API deletes per data centre, so another edge can serve the stale view out its TTL —
accepted, like KV's eventual consistency), so a refresh loop can't drain the Bot's shared GitHub quota.

**Free-tier budgets are design constraints.** Resend allows 100 emails a day and 3,000 a month. The default
40-code budget plus 40 confirmations nominally leaves 20 sends for Major-change and Reissue mail. This is
headroom, not reserved capacity or a delivery guarantee: bursts, retries and confirmations from a previous day's
codes can still exhaust the quota. No per-send remaining-quota probe is added. Email failures are logged and
best-effort; a failed Major-change email is not replayed merely because its dedupe key already exists, and a
failed confirmation does not fail a stored Report. The Status link remains authoritative. Forty is the default,
not a newly fixed maximum on configuration. KV allows 1,000 writes a day: a healthy Report costs about six
(`issue-email`, `status-token`, `issue-token`, and a dedupe key per Major change), with repair writes additional,
so counters/recovery state/caches never go in KV, and a bulk Allowlist add is capped at 500 per request.

**No CAPTCHA in the MVP.** The daily budget bounds Resend burn. The known cost is that a determined attacker can use
up the day's codes, which blocks code requests until 00:00 UTC; add Cloudflare Turnstile to the OTP request if that
happens in practice.

### 4.6 Email templates: plain text, per-Deployment sender and reply-to

Every email the system sends is **plain text only** — Resend's `text` field, no `html` part
([ticket](https://github.com/Pergo911/github-issue-tracker/issues/10)). The payload is always a few factual lines
plus the Status link. Reporter-controlled titles flow into the templates, never the description. Plain text has
no app-authored HTML interpretation or HTML-escaping step; email clients may still auto-link text. It reads fine
in every client, and there is no HTML part to trip spam penalties. A Deployment
that later wants HTML adds it per template — additive, not architectural.

**Sender.** From is `<local>@<the verified mail. subdomain>` (§3.1). The **local part**, the **display name** and
the **footer** are per-Deployment configuration; the reference Deployment sends as `reports@mail.berautoapp.hu`,
display name the Organization's name. Branding stops there: a From display name and a one-line footer are all
plain text needs.

**Reply-to: a monitored mailbox, never the system.** `reply_to` is a required per-Deployment configuration value,
set on all six templates, pointing at an address the Organization **already monitors** — it can live anywhere (the
apex-domain mailbox at Rackhost, a property manager's Gmail): only the configuration is new, not infrastructure.
The sending subdomain is not a mailbox anyone reads, so an unset reply-to would send a Reporter's reply into the
void. If the value is empty the send proceeds without `reply_to` (fail-safe; never refuse to send) and the footer
drops its reply clause. **Resend Inbound is rejected**: it would mean MX pointed at Resend, `email.received`
webhooks and new storage, with inbound mail counting against the same 100-a-day quota — and Staff↔Reporter contact
is a human channel by design (§4.4), not a system feature.

**Footer**, identical on every email: one configured line carrying a `{reply}` placeholder, e.g. `Automatic message
from <Organization>'s fault-reporting system — {reply}` — the placeholder filled with the configured reply clause
(e.g. `reply to reach the maintenance staff`) only while reply-to is set, and empty otherwise.

**Identifying the Report.** A Reporter can hold several Reports, so every Report-specific email names its Report
in the **subject** — `Report #<n> — "<title, truncated to 50 characters>" — <what happened>` — with the full title and the Status
link in the body: they tell apart in the mailbox list, before anything is opened. The OTP email has no Report yet
and uses a generic subject.

**The six templates — the complete inventory.** No other email type exists — staff notification of reporter
comments is dashboard-only, never a seventh template (§7 item 15a) — so the §4.5 budgets stand unchanged.
Template strings are per-Deployment configuration, authored in the Deployment's one language (§2.5):

1. **OTP code** — the 6-digit code, what it is for, the 10-minute validity, and `if you did not request it, ignore
this email`. No link.
2. **Submission confirmation** — Report number, title, the permanent Status link, and a keep-this-email line
   (`the link is how you follow the report and add comments`). No recap of the submitted fields: the form just
   showed them, and the status page shows them back.
3. **Closed** — the reason from GitHub's `state_reason`, the reason word drawn from the code catalog for the
   configured language (§2.5), phrased for the Reporter: fixed (`completed`, or none),
   rejected (`not_planned`), duplicate (`duplicate`); plus number, title and link. **Never `duplicate of #<x>`** —
   the webhook carries only the reason, and the reference to the original Report lives in a Staff comment
   (link-only, §4.2).
4. **Reopened** — number, title, link.
5. **A `notify` Status entered** — that Status's display name from the taxonomy configuration (§2.3), plus
   number, title and link.
6. **Reissued link** — names the Report, says the old link has ended for everyone, gives the new link; sent only
   to the Reporter's address in KV (§4.3). No attribution of who triggered it: naming the holder would leak who
   holds the link, and "a Staff member" adds nothing the wording needs.

---

## 5. Data model additions (Workers KV and Durable Objects)

**Workers KV** holds only read-mostly or write-once data (ADR 0003):

| Key pattern                  | Value                                  | TTL                         | Purpose                                                                                                                                                                |
| ---------------------------- | -------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowlist:<email>`          | `{note?, addedBy, addedAt}`            | none (System-admin managed) | gates who may request an OTP; the key is the normalized email                                                                                                          |
| `issue-email:<issue#>`       | `<email>`                              | none (life of the issue)    | reporter lookup for notifications + staff contact reveal                                                                                                               |
| `status-token:<token>`       | `<issue#>`                             | none (until reissued)       | resolves a reporter's status link to an issue                                                                                                                          |
| `issue-token:<issue#>`       | `<token>`                              | none (until reissued)       | reverse lookup so staff can resend or reissue a link (§4.3, §4.4)                                                                                                      |
| `webhook-seen:<delivery-id>` | `true`                                 | ~1 day                      | idempotency guard, written only for Major changes (§4.2)                                                                                                               |
| `config`                     | `<the Deployment configuration, JSON>` | none (System-admin edited)  | every per-Deployment value the form, dashboard and email send read (§2.4; the SPA is served only its public projection), including the UI language and timezone (§2.5) |

**Durable Objects** (SQLite-backed) hold atomic gates, submission recovery and lifecycle coordination (§4.1, §4.5):

| Object (named by)                            | State                                                                                                                                                                                                                                     | Purpose                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Email gate (SHA-256 of the normalized email) | code `{hash, expiresAt, wrongGuesses}`, last-sent time, hourly/daily counts; pending submission with temporary email/payload, credential hash, fingerprint, marker, fixed token, dispatch phase/issue number; 24-hour completion receipts | OTPs and caps; atomic consume-and-record; resumable submission |
| Report gate (the issue number)               | daily comment/reissue counts; finalization progress, token generation/lifecycle, associated pending-attempt locator while needed, deletion tombstone                                                                                      | budgets; serialize mapping recovery, Reissue and Erasure       |
| Global gate (one per Deployment)             | codes issued today                                                                                                                                                                                                                        | the Deployment-wide code budget                                |

**Allowlist maintenance.** A System admin (repo Admin role, checked as in §4.4) manages the Allowlist from a screen
in the staff dashboard; Triage staff can't see it. Worker endpoints do the writes: list, add one, add many (a pasted
list, one email per line with an optional note, at most 500 per request, with a per-line error report), edit the
note, and remove. The Worker trims and lowercases addresses (no dot or `+tag` folding, so matching is exact),
validates the syntax, dedupes, and records `addedBy` (GitHub login) and `addedAt`; removal leaves no history. The
`note` is free text of at most 200 characters (for example a name and unit), shown only on that screen and in
reveal-contact, and never written to GitHub, an email or an issue body. Additions and removals take effect within
about a minute (KV propagation, which also caches "not found").

- **Offboarding.** Removing an entry only stops new codes. The leaver's existing Reports, mappings and links stay
  for the life of the Report, including after close, and notifications continue; Staff can reissue a link to cut
  access (§4.3). Already verified submission recovery is not a new code request.
- **Change of address.** Add the new address and remove the old one. Old Reports keep mailing the old address, and
  Staff can hand the link over from reveal-contact (§4.4).
- **Mistyped address.** There is no recovery path: the generic OTP response can't say why a code didn't arrive, so
  the "code sent" screen shows the Deployment's help text (§4.1). A mistyped Allowlist entry is fixed from the screen.

**Retention and erasure.** ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/15))

- **Retention is the life of the Report on GitHub.** The `issue-email`, `status-token` and `issue-token` mappings
  live exactly as long as the Report's issue exists on GitHub: closing changes nothing, there is no time-based
  purge, and links never expire (§4.3). That is the principle, not an accident — it is what keeps commenting open on
  closed Reports (§4.3), a Staff reopen mailing the Reporter (§4.2), and reveal-contact working for follow-ups on
  closed Reports (§4.4).
- **Erasure is deletion of the Report, done by a System admin.** A Reporter asking for their data to be removed is
  erased Report by Report: a System admin (repo Admin) deletes the issue in the GitHub UI — the GitHub Organization
  must enable issue deletion for its repositories, a setup step (§8) — the `deleted` webhook coordinates with
  the Report gate to tombstone the issue, cancel associated recovery/receipts and purge the three mappings (§4.2).
  Remove the Allowlist entry with its `note` from the screen. The Report and comments leave GitHub; nothing
  Reporter-linked stays in KV, and delayed repair cannot recreate the mappings. Clear sensitive recovery payloads,
  credentials/receipts and their locators; inert issue-number counters and a deletion tombstone can remain because
  GitHub never reuses an issue number. A not-yet-linked pending attempt is located by the supplied email/reference
  and explicitly discarded as part of the request, not left outside the erasure procedure.
- **Erasure is per-Report, by design.** There is no `email → issue#s` reverse index — a fourth place each address
  would live, for a problem the reference Deployment doesn't have. A "remove everything about me" request names
  their Reports (each one's confirmation email carries its number), Staff erase each in turn, and a real
  Deployment's operator can list and scan `issue-email:*` in KV offline as the completeness net. A dashboard erase
  button (the Bot calling GitHub's GraphQL `deleteIssue` mutation — there is no REST endpoint for deleting an
  issue — behind a small spike confirming the installation token may call it) and a purge-contact-only variant are additive upgrade paths for a real Deployment.
- **Submission recovery has an explicit lifecycle.** Although the Email gate's name is an email hash, it holds
  the verified plaintext email and Report payload while recovery is pending (§4.1). Drop the payload on completion,
  remove completion receipts after 24 hours, and clear pending/receipt data on explicit discard or Erasure. Never
  silently expire the only record of an unresolved create. The remaining OTP hash expires in 10 minutes and
  counters can go idle. Cleanup is logical deletion: SQLite-backed DO point-in-time recovery can retain historical
  contents for up to 30 days; do not promise immediate disappearance from provider recovery history.
- **Two accepted boundaries sit outside this system.** Resend retains sent email content on its side for about 30
  days — only the six templates ever sent (§4.6), carrying at most a title and the Status link, never the
  description — and it self-expires. Replies to the configured reply-to mailbox land in the Organization's own mail
  system (§4.6), outside this design's visibility and purge levers. Both are recorded limits, not in scope.

---

## 6. Requirement mapping

| Requirement (from the brief)                                       | Mechanism                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registered users submit reports with location, nature, description | Email allowlist + OTP, no GitHub account. Issue created by the bot with labels (`category:*`, `location:*`) + the Reporter's title and a body from the fixed template (§4.1), with an optional exact place.                                                                                               |
| Users track own reports' status/history                            | Permanent unguessable per-issue link is the authoritative status/history view (no login, no listing of other issues); email notifies on major transitions only and always repeats the link. Also directly resolves GitHub's "no per-issue privacy" gap via capability-based access instead of repo roles. |
| Users can comment on their own reports (instructor)                | Comment box on the status page (§4.3). A token-gated Worker function posts the comment as the bot with a `Reporter:` marker; the reporter needs no GitHub account and no email is written to GitHub.                                                                                                      |
| Authorized users review, categorize, prioritize, assign            | Staff with GitHub Triage/Admin roles: labels (`category:*`, `priority:*`) + assignee.                                                                                                                                                                                                                     |
| Repair progress trackable; completed-work info recorded            | Open/closed + `status:*` labels (§2.3; no Projects v2); resolution notes as issue comments. Major transitions are mirrored out via email to the reporter.                                                                                                                                                 |
| Multiple roles with different permissions                          | Reporter is "anyone on the allowlist who completes OTP" (not a GitHub role). Viewer = repo Read; Maintenance staff = repo Triage; System admin = repo Admin (manages Staff roles on `reports`, the Reporter Allowlist, and Deployment configuration from the Staff dashboard; §2.4, ADR 0006). |
| Search / overview by open, in progress, closed                     | GitHub search qualifiers and label filters in the staff dashboard (no Projects v2, §2.3).                                                                                                                                                                                                                 |
| Desktop application (the brief's first sentence)                   | A thin Windows-only Electron shell around the hosted SPA, which also runs as a plain website (§2.1).                                                                                                                                                                                                      |

This gives every reporter both a self-service pull view (the permanent link) _and_ proactive push
notifications on major changes, without granting them the broad repo visibility a GitHub Read role would.

### GitHub limits behind this mapping

- **No per-issue privacy.** Anyone with repo Read sees every issue. This is why reporters never get repo
  access and use capability URLs instead (§1).
- **No structured fields.** Issue Forms (YAML) flatten answers into the markdown body, so there is no
  queryable "location" field. Labels are the only filterable dimension: use them for anything enumerable
  (location, category, priority, status) and keep only free text in the body.
- **No official attachment API.** Image upload goes through an undocumented `uploads.github.com` endpoint
  that could change without notice, and its `user-attachments` URLs are fetchable by anyone with the link.
  **Photos are omitted from the MVP** (§4.1); the upgrade path is a Worker-fronted R2 bucket, never the
  undocumented endpoint.
- **Role tiers require an Organization.** Personal-account repos only grant collaborators full Write access.
  The Read/Triage/Write/Maintain/Admin model exists only for GitHub Organization-owned repos, and free GitHub
  Organizations get all of it at
  no cost, so this is a setup requirement, not a cost blocker.
- **Rate limits** are 5,000 requests/hour per authenticated user, which is ample at building scale. The one
  risk is that all anonymous submissions share the bot token's bucket (§3.3).

### Live contract findings

[Ticket #32](https://github.com/Pergo911/github-issue-tracker/issues/32) ran one contract suite against the fake
and against `reports-sandbox` with the real Bot (`npm run test:contract:live`, see AGENTS.md). Where they differed,
the fake was taught live's behaviour, or the code was changed with a test. What live GitHub does, as measured:

- **Bot credentials.** An installation token is `ghs_` followed by a long JWT-like string (it contains dots), not a
  short opaque one. Its own `permissions` are `{issues: write, metadata: read}`, and the repo's `permissions`
  object shows it **all false**: the rights are in the token, so the role check (§2.4) is for Staff tokens only.
  JWT failures are mostly a bare `401 Bad credentials`; an unknown App id is `404 Integration not found`.
- **Labels.** An unknown label in an issue create or PATCH **is created** (colour `ededed`, no description). An
  issue's labels come back sorted by name. Labels can be created, recoloured, renamed and deleted by the Bot.
- **Identity.** The Bot's issues and comments have `user.type: "Bot"`, login `<slug>[bot]` and one numeric id.
  `performed_via_github_app` is **null on the issue** and the full App on every **comment**, so attribution keys on
  user type, id and login (§4.3), with the App as a conflict check only.
- **Close and reopen.** A single PATCH closes or reopens and swaps the labels; the issue's `state_reason` is
  `completed`, `not_planned`, `duplicate` or `reopened`. A `closed` timeline event carries `null` for the default
  `completed` reason. `duplicate_issue_id` takes the original's database id (not its number) and puts a
  `marked_as_duplicate` event on the original. A bad reason or id is 422.
- **Timeline.** `labeled` and `unlabeled` carry `label: {name, color}`; `assigned` the assignee; `renamed`
  `rename: {from, to}`. A fenced Reporter text raised no `mentioned` event; the same text unfenced did.
- **Webhooks.** A repo webhook's payload has `organization` and no `installation`, and its `issue` has no
  `closed_by`. **GitHub renders a delivery's `issue` when it sends it, not when the event happened**: a `closed`
  followed within a second by a reopen arrives as a `closed` delivery showing an open issue. The receiver therefore
  drops a `closed` for an open issue and a `reopened` for a closed one (`stale-state`, §4.2); the later delivery
  carries the change. Delivery order is not chronological. The fake still renders the issue at event time.
- **Device flow.** An unknown client id is `404 {"error":"Not Found"}` from both endpoints. A wrong or missing
  grant type, and a refresh token GitHub never issued, answer `incorrect_client_credentials` (HTTP 200), not
  `unsupported_grant_type` or `bad_refresh_token`; the Worker treats it as `refresh_rejected`. Polling twice at
  once answers `slow_down` with `interval: 10`. Refresh of a _valid_ token without `client_secret` (decision 13)
  refresh: it needs an approved device code, which only a person can give.
- **Caching and CORS.** `GET` endpoints (`/issues`, `/issues/:n`, `/issues/:n/timeline`, `/issues/comments`, etc.)
  return `Cache-Control: private, max-age=60, s-maxage=60` and `ETag`. `Access-Control-Allow-Headers` permits
  `If-None-Match` (`304 Not Modified` costs 0 rate-limit quota) and **omits `Cache-Control` and `Pragma`**, so
  sending either request header from the SPA fails the browser CORS preflight. `githubFetch` therefore bypasses
  Chromium's disk cache with Fetch's `cache: "no-store"` option and handles `ETag` / `If-None-Match` in memory.
- **Not settled.** Whether a Triage user may set labels in a PATCH (the fake's `triageCanLabel`, default true):
  the sandbox has no Triage account, so it remains the documented assumption until one exists.

---

## 7. Decision register

No open design items remain for this map. Implementation validation and its accepted risks are recorded in the
relevant design sections; they are not claims that the application already exists or that every policy is live-tested.

1. **"Asztali alkalmazás" requirement** — **resolved.** A web-only deliverable isn't acceptable,
   so the design ships one SPA wrapped by a thin Windows-only Electron shell (§2.1). Staff login moved to
   device flow (§2.2), verified end to end by the spike (item 13).
2. **GitHub Organization and label taxonomy** — **resolved.** The taxonomy is a contract with per-Deployment
   values, declared in Deployment configuration (§2.3, [ADR 0002](./docs/adr/0002-taxonomy-declared-in-deployment-configuration.md),
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/2)). The reference Deployment's seed values are
   in Appendix A.
3. **Domain for sending email** — **resolved.** Each Deployment sends from a dedicated `mail.` subdomain of a
   domain its deployer already controls, verified in the Deployment's own Resend account, the SPF/DKIM/DMARC
   records added manually by the deployer in the existing DNS zone (§3.1,
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/4)). The reference Deployment acquires
   nothing: it reuses the project owner's `berautoapp.hu` (zone at Rackhost) and sends from `mail.berautoapp.hu`.
4. **PAT vs GitHub App for the bot** — **resolved.** A GitHub App with installation tokens, on its own
   dedicated app separate from the staff app (§3.3,
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/9)).
5. **OTP parameters** — **resolved.** The OTP and per-key limits live in Durable Objects, not KV, with the numbers
   in §4.5 ([ADR 0003](./docs/adr/0003-otp-and-abuse-state-in-durable-objects.md),
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/6)).
6. **Allowlist provisioning** — **resolved.** System admins maintain the Allowlist from a dashboard screen; entry
   shape, offboarding and change of address are in §5
   ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/5)).
7. **Email content/branding** — **resolved.** All emails are plain text only; the sender local part, display name,
   footer and a required reply-to (a mailbox the Organization already monitors, not Resend Inbound) are
   per-Deployment configuration; every Report-specific subject names the Report (§4.6,
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/10)).
8. **Multiple reports per reporter** — **resolved.** Every Report-specific subject line is
   `Report #<n> — "<title>"`, so several Reports tell apart in the mailbox list before anything is opened (§4.6,
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/10)).
9. **What if a reporter mistypes their email** — **resolved.** An accepted MVP limitation, softened by a
   Deployment-configured help text on the "code sent" screen (§4.1, §5,
   [ticket](https://github.com/Pergo911/github-issue-tracker/issues/5)).
10. **Major-change taxonomy** — **resolved.** A Major change is a close, a reopen, or entering a status with the
    `notify` flag while open; everything else is link-only (§2.3, §4.2,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/8)).
11. **Status token lifecycle** — **resolved.** A 128-bit base64url token that never expires and can be reissued
    (not just revoked) by Staff or any holder, the new link going only to the Reporter's email (§4.1, §4.3,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/7)).
12. **Comment privacy convention** — **out of scope for this effort**
    ([map](https://github.com/Pergo911/github-issue-tracker/issues/1), "Out of scope"): the MVP default (§4.3)
    stands, and a marker convention is designed only if Staff hit a real case where they want to discuss a Report
    without the Reporter seeing it.
13. **Device-flow spike** — **resolved.** Verified live end to end through the Worker proxy, for
    both a GitHub App and an OAuth App, with no `client_secret`: both device-flow endpoints proxied, the token
    accepted by `api.github.com` from the browser, and the role check returning Triage-or-better for a Triage
    staff member. The role check is the repo `permissions` object (it reflects the caller's own level); the
    collaborator endpoint is unusable for Triage staff (403 under a GitHub App token, 404 under an OAuth one).
    Refresh without `client_secret` works for both app types. Non-member denial is assumed (404, no
    `permissions` → deny), not run live. The web-flow fallback is not needed.
    ([ticket](https://github.com/Pergo911/github-issue-tracker/issues/3))
14. **Staff token app type and storage** — **resolved.** Staff login uses a GitHub App (GitHub Organization-owned, installed
    on the reports repo), not an OAuth App: same device-flow UX, smaller blast radius (§2.2). The SPA persists
    the 8-hour access token and the refresh token in `localStorage`, refreshes silently, and sign-out clears
    storage and links to GitHub's revocation page (§2.2,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/9)).
15. **Reporter comment details** — **resolved.** All three parts: (a) staff notification of a reporter comment is
    dashboard-only — no system email, no `issue_comment` subscription; GitHub's own notifications still reach
    assignees and watchers. (b) Commenting stays open on closed Reports and a comment never reopens — reopen is a
    Staff action, so the `reopened` email path stands as designed. (d) Comments are append-only: no reporter edit
    or delete (§4.3, [ticket](https://github.com/Pergo911/github-issue-tracker/issues/11)). The length cap and
    rate-limit values were resolved earlier (§4.5,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/6)).
16. **Deployment model** — **resolved.** One self-deployed Deployment per Organization, not a hosted multi-tenant
    service; the reference Deployment is a demonstration/coursework one (§2, [ADR 0001](./docs/adr/0001-one-deployment-per-organization.md),
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/12)).
17. **Submission form fields and photos** — **resolved.** The form collects exactly the taxonomy picks, a
    Reporter-written title (3–80 characters after trim), a description (1–4,000) and the optional exact place
    (1–100); no identity or contact fields, no photos in the MVP (the undocumented `uploads.github.com` endpoint
    is rejected; a Worker-fronted R2 bucket is the upgrade path). The issue body is a fixed template, and all
    Reporter body/comment text is dynamically fenced; titles use the restricted-input policy (§4.1, §4.3, §6,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/13)).
18. **Staff dashboard scope** — **resolved.** Three dashboard tiers over the repo `permissions` object —
    Viewer (Read; views and comments only), Maintenance staff (Triage or better; all Report actions) and System
    admin (Admin; plus the Allowlist and Configuration screens) — with the Worker re-checking every gated
    endpoint server-side. Views: Board (one column per Status), List and Detail, with free-text search,
    dimension filter chips and an untriaged filter; close and reopen each travel as one PATCH carrying the
    reason and the label swap; reporter comments are noticed by a filter and a sort only; no bulk actions, no
    metrics view. Per-Deployment configuration is data on an Admin screen — one `config` KV key with a
    last-editor block — and its save is the taxonomy sync (§2.4, §5,
    [ADR 0002](./docs/adr/0002-taxonomy-declared-in-deployment-configuration.md),
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/14)).
19. **Data retention and erasure** — **resolved.** Retention is the life of the Report on GitHub: closing changes
    nothing, there is no time-based purge, and links never expire. Erasure is Report deletion by a System admin in
    the GitHub UI (the Organization enables issue deletion), with the `deleted` webhook purging the three mappings
    and the Allowlist entry removed on its screen; erasure is per-Report — no reverse `email → issue#s` index (the
    requester names their Reports; ops can scan KV offline). Pending recovery and receipts are explicitly purged
    under the lifecycle in §4.1 and §5. Resend's ~30-day content retention plus the reply-to
    mailbox's copies are accepted boundaries outside the system (§5,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/15)).
20. **UI and email language** — **resolved.** One configured language per Deployment, chosen from the
    languages the code ships catalogs for (`hu` and `en`; unset or unknown → English, which is also the
    per-key fallback) — no per-browser detection, no per-user toggle. Fixed UI wording lives in code
    catalogs in `shared/`, read by the SPA and the Worker (the Worker reads only the issue-body captions and the email reason words); Deployment-authored wording (the six templates, display
    names, notices, help text) stays configuration written in that one language, so a display name is one
    string per value. The `Reporter:` marker and label identifiers never localize, and the issue-body
    captions come from the catalog. A `timezone` field (IANA name, unset → UTC) fixes timeline rendering;
    the six emails carry no timestamps. The reference Deployment ships Hungarian (§2.5, §4.1, §4.3, §4.6,
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/16)).
21. **Frontend stack and repo layout** — **resolved.** Two independent packages: `app/` (one Vite project, with
    the React 19 SPA, the Hono Worker and the shared module, deployed as one Worker with static assets, never
    Pages) and `shell/` (Electron, packaged unsigned with electron-builder; the target URL is a build-time
    variable). React Router v8, TanStack Query v5, plain `fetch` for GitHub with types-only Octokit packages,
    `@dnd-kit/react` pinned, a contract-first Zod API in `shared/`, and an allowlisted public projection of the
    configuration. Catalogs are typed TypeScript modules with per-key English fallback and the Worker returns codes,
    not text. The UI takes GitHub's look from Primer's tokens and icons on Tailwind 4 and shadcn/ui, never from
    `@primer/react`, which can't be localized; taxonomy values gain an optional colour, and the UI follows the OS's
    light or dark mode (§2.1, §2.3–§2.7, Appendix A,
    [ADR 0004](./docs/adr/0004-primer-is-the-source-of-the-look-not-a-dependency.md),
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/17)).
22. **Status views, neutralization and failure paths** — **resolved.** Explicit Status-page projection and progress
    timeline (§4.3); canonical dynamic fences with Bot-authenticated Reporter attribution (§4.1, §4.3); restricted
    titles, preserving accepted input without silent rewriting; visible invalid-Status fallback, never auto-repair
    (§2.4); durable resumable submissions with manual handling of uncertain creates, no exactly-once claim
    (§4.1, §5, [ADR 0005](./docs/adr/0005-recover-submissions-without-retrying-uncertain-creates.md)); lazy paginated
    repository-comment scans for the dashboard affordances (§2.4); 40-code default with best-effort mail (§4.5).
    The human accepted title-alphabet validation/adjustment during implementation rather than another spike;
    the live evidence proves the tested body/comment properties, not the title policy
    ([Status views, neutralization and failure paths](https://github.com/Pergo911/github-issue-tracker/issues/18)).
    The title policy was then live-tested on REST and GraphQL and its allowlist adjusted (§4.1, ticket #32).
23. **Staff role management in the Admin UI** — **resolved.** System admins manage Staff roles and pending Staff
    invitations on the `reports` repo from a dedicated **Staff** screen (`/staff/members`), keeping GitHub
    repository roles as the single source of truth. Repository `Administration: read & write` is added to
    `reports-staff` only (`reports-bot` stays minimal; no GitHub Organization-level permissions), and Admin-gated
    Worker endpoints execute collaborator/invitation operations using `caller.token`, enforcing self-lockout and
    last-active-System-admin guards server-side, treating inherited-only members read-only with post-write override
    detection, and surfacing missing App permission / stale tokens via `staff_permission_required` (§2.4, §3.3,
    [ADR 0006](./docs/adr/0006-manage-staff-roles-as-repo-collaborators-via-staff-token.md),
    [ticket](https://github.com/Pergo911/github-issue-tracker/issues/40)).

---

## 8. Next steps

**Reference Deployment:** the SPA and Worker are live at
<https://fault-reports.berautoapp.workers.dev>, backed by private `Tarsashaz-demo/reports`.
The Hungarian Appendix A configuration uses `Europe/Budapest` and `reply@mail.berautoapp.hu`;
its save synchronizes the 27 taxonomy labels. The repository's `issues` webhook targets
`/api/github/webhook`. Non-secret resource IDs and the verified Bot account ID/login are pinned in
`app/wrangler.jsonc`. Deployment, live-check, Windows packaging and operator hand-off commands are
in [the deployment runbook](./docs/runbook-deployment.md). Human inbox and Device Flow acceptance
remain [setup ticket #20 Part B](https://github.com/Pergo911/github-issue-tracker/issues/20).

The implementation plan is the sub-issues of [Implementation: reference Deployment
MVP](https://github.com/Pergo911/github-issue-tracker/issues/19), with its verification standard and the
implementation-planning decisions (test and lint tooling, base URLs for the fakes, the `workers.dev` address). The
list below is the order of the design; the issue's tickets are the work queue.

1. Delivery format is decided: Electron shell around the hosted SPA (§2.1). The device-flow spike (§7
   item 13) passed for both app types; no fallback is needed. The wayfinder map is complete: begin implementation
   planning, not another design-ticket round. Verify the restricted title policy during implementation (§4.1);
   the body/comment spike asset stays throwaway and unmerged.
2. Stand up the reference Deployment's GitHub Organization and `reports` repo, enable issue deletion for its
   repositories (the erasure lever, §5).
3. Verify the reference Deployment's sending subdomain with Resend: add the generated SPF/DKIM/DMARC records for
   `mail.berautoapp.hu` in the `berautoapp.hu` zone at Rackhost (§7 item 3).
4. Register the two GitHub Apps (Bot and staff) for the reference Deployment and provision the Bot's
   installation credential (§3.3, §2.2).
5. Scaffold `app/` (§2.6), then implement the edge functions and Durable Object gate classes (§4.5) in
   `app/src/worker/`, with submission as the critical path: OTP request → atomic OTP consume/pending attempt →
   recoverable issue creation and KV finalization → credential-gated resume →
   status-lookup → add-comment → webhook receiver → staff device-flow proxy → reveal-contact/resend-link/reissue →
   Allowlist management.
6. Build the SPA's three surfaces in `app/src/client/`: submission form, status page, staff dashboard, in GitHub's
   look (§2.7).
7. Add the Electron shell in `shell/` (§2.1) and package an unsigned Windows installer with electron-builder.
8. Deploy the Worker with its static assets (§2.6), then enter the taxonomy configuration from the Appendix A
   seed values through the Configuration screen — its save is the label sync (§2.4).

---

## Appendix A. Reference Deployment seed data

Sample data for the demonstration/coursework Deployment, to be written into its taxonomy configuration (§2.3). It is
not part of the design: another Deployment defines its own values. The display names, template strings and
notices are authored in Hungarian, and the reference timezone is `Europe/Budapest` (§2.5); the identifiers
below are the language-neutral kebab-case label names.

- **Category:** `electrical`, `plumbing`, `heating-cooling`, `elevator`, `structural` (walls, roof, floors),
  `doors-windows`, `common-areas` (cleaning, lighting, waste), `safety` (fire, alarms, hazards), `other`.
- **Location** (a fictional four-storey társasház): `basement`, `ground-floor`, `floor-1`, `floor-2`, `floor-3`,
  `stairwell`, `elevator`, `roof`, `courtyard`, `garage`, `outdoor-other`. Floors cover both flats and corridors;
  the optional exact place says which ("flat 12 bathroom", "hallway by the mailboxes").
- **Priority** (ordered, lowest first): `low`, `normal`, `high`, `urgent`.
- **Status:** `new` (the `initial` status), `in-progress` (`notify`), `on-hold` (`notify`; waiting for parts, a
  contractor or access).
- **Colours** (six-digit hex, §2.3): categories `electrical` `fbca04`, `plumbing` `0075ca`, `heating-cooling`
  `d93f0b`, `elevator` `7057ff`, `structural` `8b6f47`, `doors-windows` `a2eeef`, `common-areas` `008672`,
  `safety` `d73a4a`, `other` `cfd3d7`; every location `ededed`; priorities `low` `c2e0c6`, `normal` `fef2c0`,
  `high` `f9a03f`, `urgent` `d73a4a`; statuses `new` `1d76db`, `in-progress` `fbca04`, `on-hold` `cfd3d7`.
- **Emergency notice:** "For fire, gas or flooding, call the emergency number instead of filing a Report."
