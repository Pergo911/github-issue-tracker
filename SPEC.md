# Spec — Issue Tracker

**Status:** living document, patched/appended as decisions are made. Start date 2026-09-20.
**Precedence:** this doc is the source of truth for the design; [`CLAUDE.md`](./CLAUDE.md) only summarizes it, so update this doc first.

The system uses a GitHub Organization repo as its backend (GitHub Issues for reports; org roles for staff).
Two problems shape the design: **reporters shouldn't need a GitHub account**, and **"entirely serverless"
breaks down once OAuth and email are involved**. Both are addressed below, each backed by a dedicated
feasibility check (§3).

---

## 1. Problem statement

Staff and admins (a small, known, technical-enough group) authenticate as real GitHub identities via org
membership. That's a bad fit for reporters (building residents/tenants), who shouldn't need to understand
GitHub accounts, OAuth consent screens, or org invitations just to report a broken light.

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
   permanent link is the authoritative place to see full history at any time.

Staff-side design: GitHub org roles (Read/Triage/Admin), device-flow login through a thin Worker proxy (§2.2), labels
for location/category/priority/status, assignee for the responsible technician, comments for resolution
notes, and an optional Projects v2 board for a Kanban-style view. Staff call `api.github.com` directly with
`octokit.js`. This is not repeated below except where reporter-side flows touch it.

---

## 2. Architecture overview

Three separate user-facing surfaces, sharing one GitHub Organization repo as the system of record:

```
┌──────────────────────┐  ┌───────────────────────┐  ┌──────────────────────────┐
│  PUBLIC SUBMISSION     │  │    STATUS PAGE          │  │      STAFF DASHBOARD      │
│  (reporters, no login) │  │  (unguessable link,     │  │  (GitHub login, org role) │
│                       │  │   no login)             │  │                          │
│  email → OTP →        │  │  issue view             │  │  octokit.js → api.github │
│  report form →        │  │  + history              │  │  .com directly (Read/    │
│  one-shot submit      │  │  + add comment          │  │  Triage/Admin)           │
└──────────┬────────────┘  └───────────┬─────────────┘  └──────────────────────────┘
           │                           │
           ▼                           ▼
   ┌──────────────────────────────────────────┐        ┌─────────────────────────┐
   │  Edge functions (Cloudflare Workers)       │◄───────┤  GitHub webhook          │
   │  - OTP request                             │        │  (issues, issue_comment) │
   │  - OTP verify + submit (creates issue)     │        └─────────────────────────┘
   │  - status lookup (proxies a read-only      │
   │    GitHub call — reporter has no GitHub    │───────▶ creates/reads issues and
   │    credential of their own)                │         posts comments as
   │  - add-comment (token-gated, bot posts)    │         bot/service account
   │  - webhook receiver (major-change filter)  │         (PAT or GitHub App)
   │  - (staff) reveal-contact / resend-link     │
   └───────────────────┬─────────────────────────┘
                        │
                        ▼
   ┌─────────────────────────┐        ┌─────────────────────┐
   │ Workers KV                │        │  Resend (email API)  │
   │ - email allowlist         │        │  - OTP codes          │
   │ - OTP hash+expiry         │───────▶│  - major-change mail  │
   │ - issue# → email           │        └─────────────────────┘
   │ - status-token → issue#    │
   │ - webhook dedupe IDs       │
   └─────────────────────────┘
```

**Platform choice:** consolidate everything on **Cloudflare Workers + Workers KV**, and serve the static SPA
from the same platform (Workers static assets or Pages) so the SPA and the Worker share one origin. Adding KV
keeps the whole backend on one platform instead of splitting across providers.

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
  `nodeIntegration`), HTTPS only. The page's origin is the hosted site's, so the Worker needs no extra CORS
  entry for the shell.
- **Navigation rule.** `target="_blank"` links and `window.open` go to the system browser
  (`setWindowOpenHandler` → `shell.openExternal`); in-window navigation stays in the shell. The SPA renders
  status links with `target="_blank"`. Any `will-navigate` restriction only needs to allow the app's own
  origin, since login (§2.2) happens in the system browser.
- **Status pages stay in the browser.** Reporters reach them through the emailed link or the link on the
  post-submit confirmation page, opened in the system browser. The shell has no status-lookup entry point and
  no local "My reports" list.
- **Packaging.** An unsigned Windows build from electron-builder or Electron Forge; Windows only, and the
  SmartScreen click-through is accepted. `npm start` remains the dev loop.
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

Device flow must be enabled on the GitHub app. This flow has not yet been verified end to end (§7 item 13).

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
  DMARC are effectively mandatory (Google's 2024+ bulk-sender rules). Recommendation: use a **dedicated
  subdomain** (e.g. `mail.<project-domain>`) for all app email, isolating its sender reputation.
- **OTP storage:** a stored approach (hash + expiry in Workers KV, keyed by email) is recommended over a fully
  stateless HMAC/TOTP-style code. A stateless code is workable and needs zero storage, but can't be made
  single-use without adding state back in anyway — and KV is needed regardless for the issue#→email mapping
  (§3.3), so the marginal cost of using it for OTPs too is ~zero while buying true single-use semantics.
- **Anti-abuse:** per-email cooldown (~60s) before allowing a resend, plus a per-IP/global throttle, enforced
  server-side. Cloudflare Workers KV counters or the native **Rate Limiting binding** both work; this is casual-
  abuse prevention, not billing-grade precision, which is sufficient here.

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
  (`created`/`edited`/`deleted`). Two webhook subscriptions cover every case that should trigger an email.
- A plain **repository-level webhook** (admin-clickable in repo Settings, no GitHub App registration) is
  sufficient — org-level and App-level webhooks exist but add nothing needed here.
- Every payload includes the full issue object (number, title, body, labels, assignees, state) — so a receiving
  function can always identify _which_ issue changed. It does **not** include any custom "reporter" field —
  GitHub has no such concept — which is why an external mapping is needed (see §3.3's privacy finding, which
  supersedes the originally-considered "hidden marker in the issue body" idea).
- Signature verification is a standard, well-supported HMAC-SHA256 check (`X-Hub-Signature-256` header against
  the webhook's shared secret) — trivial in any WebCrypto-capable runtime, including Workers.
- **Reliability caveat to document explicitly:** GitHub does not automatically retry failed webhook deliveries,
  there's no cross-delivery ordering guarantee, and duplicate deliveries are possible. The receiver must ack
  fast, and must be **idempotent** — dedupe by the `X-GitHub-Delivery` ID (a short-TTL KV entry per delivery ID
  is enough) so a redelivered event doesn't double-email a reporter. This is a "best-effort" notification
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

**Confirmed feasible**, via a dedicated service-account credential — and this research changed a design
decision (see privacy note below).

- Two viable auth options for the bot that creates issues:
  - A **fine-grained PAT** (scoped to `Issues: write` only) on a dedicated machine-user account added as an org
    member. Simple: one static secret in the Worker's environment. Org membership seats are free on GitHub's
    Free org tier (seat billing only applies on paid Team/Enterprise tiers), so this costs nothing at this
    scale. Downside: a long-lived static secret needing manual rotation.
  - A **GitHub App** installed on the org/repo with `Issues: read & write` only, authenticating via a signed
    JWT exchanged for short-lived installation tokens. Never consumes a seat on any plan, isn't tied to a human
    account, and is what GitHub's own docs recommend for "automation acting independently of a user." More
    setup (JWT signing + token exchange) than a static PAT.
  - **Recommendation:** start with a fine-grained PAT for simplicity given the project's scope; the GitHub
    App is the upgrade path if the static secret's rotation burden or its tie to a human account becomes a
    problem.
- **Real-world precedent exists:** [Staticman](https://github.com/eduardoboucas/staticman) uses exactly this
  shape — a bot-account credential turning anonymous public form submissions into GitHub writes (commits/PRs in
  its case) specifically so the visitor never needs a GitHub identity. "Form → bot creates a GitHub issue" is
  also a common no-code Zapier/Make pattern, i.e. not a novel or fragile idea.
- **Privacy finding that changes the design:** the previously-assumed "hidden HTML comment in the issue body"
  trick for stashing the reporter's email is **not actually private** — it's only invisible in _rendered_
  Markdown; the raw body (comment included) is returned by the API and visible via raw views to anyone with
  repo Read access. The same is true of a Projects v2 custom field — item visibility still gates on repo Read
  access, so it's equally exposed to every staff member, not just the ones who need contact info. **Decision:
  keep the reporter's email out of GitHub entirely.** Store the issue-number → email mapping only in Workers
  KV (the same store already needed for OTPs). This is the only option that actually restricts who can see a
  reporter's email — worth calling out because minimizing exposure of personal data by design is a real, not
  just cosmetic, consideration in an EU context (GDPR).
- **Rate limits:** the bot's token gets its own quota bucket (starts at 5,000/hr, scales with org size),
  separate from staff's per-user quotas — irrelevant at building-scale volume. The one real risk is that _all_
  anonymous submissions share this single token/bucket, so abuse (e.g. OTP/submission spam) could in theory
  exhaust it for everyone at once. Mitigate at the OTP/submission layer (§3.1's rate limiting), not here.

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
Cloudflare Workers + Workers KV covers every requirement (OTP issuance/verification, bot-authored issue
creation, webhook-driven notification email, the staff device-flow proxy). The architecture holds **actual persistent
state** (KV), which is worth naming explicitly rather than calling the design "serverless" in the stronger
sense some readers assume that word means.

---

## 4. Reporter-side flow (revised: adds a permanent status link)

### 4.1 Submission (single-shot, no session)

1. Reporter fills out the report form fully: email, location, category, description (all fields, before any
   verification step).
2. Reporter clicks "send code." The frontend calls the **OTP-request** function with just the email.
   - Function checks the email against the **allowlist** (KV). If not listed, responds with a generic message
     ("if this address is registered, a code has been sent") rather than confirming/denying membership, to
     avoid trivially enumerating valid addresses.
   - If listed: generate a 6-digit OTP, store `hash(otp)` + short expiry (e.g. 10 min) in KV keyed by email,
     send it via Resend. Per-email cooldown (~60s) blocks rapid resends.
3. Reporter enters the received code into the same form.
4. Reporter clicks final "submit." The frontend calls a single **OTP-verify-and-submit** function with
   email + code + all report fields together, in one request.
   - Function checks the code against KV (constant-time compare against the stored hash, checks expiry),
     and deletes the KV entry on success (single-use).
   - On success: creates the GitHub issue via the bot credential (§3.3), with labels for category/location and
     the initial `status:open`. **No email address is written into GitHub anywhere** — not the body, not a
     custom field.
   - Generates a **status token** (a high-entropy random string — UUIDv4 or 128+ bits of base62 — not derived
     from the issue number, which is guessable/sequential). Writes both `issue# → email` and
     `status-token → issue#` into KV.
   - Returns a confirmation to the reporter that includes the **permanent status link**
     (`https://<app>/status/<token>`), and immediately sends a confirmation email containing the same link —
     the link must survive the reporter closing the tab without saving/bookmarking it, so email is the durable
     delivery mechanism for it, not just the on-screen confirmation.

There is intentionally no separate "verify, then get a token, then submit later" phase for the OTP itself —
collapsing verify and submit into one call avoids needing to issue or store any session artifact for the
browser to hold. The status token is a different kind of token: a long-lived capability credential for reading
one issue, not a short-lived auth session.

### 4.2 Status updates: email on major changes, link for everything else

Emailing on every label tweak or comment would spam reporters for a "check on my broken hallway light" use
case. Instead:

1. GitHub fires the `issues` or `issue_comment` webhook to the receiver function on any relevant change
   (labeled, assigned, commented, closed, reopened, etc. — see §3.2).
2. Receiver verifies the HMAC signature and checks `X-GitHub-Delivery` against the dedupe KV (skip if already
   processed).
3. Receiver applies a **major-change filter** before deciding to email. Proposed default (adjust once the
   label taxonomy is finalized — see §7):
   - **Email-worthy:** issue closed, issue reopened, a `status:*` label added (e.g. `status:in-progress`,
     `status:resolved`) — transitions the reporter would actually want pushed to them.
   - **Link-only, no email:** staff comments, assignment changes, category/priority/location label edits, any other
     `edited` action. Still fully visible on the status page (§4.3) any time the reporter checks it.
   - **Ignored entirely:** `issue_comment` events for comments the bot itself posted on a reporter's behalf
     (§4.3, "Reporter comments"); the reporter already knows what they wrote, so there is nothing to email.
4. For email-worthy changes, receiver looks up the issue number in the `issue-email` KV mapping and sends a
   short notification via Resend naming the change and repeating the permanent status link (so the email
   itself doubles as a way back in even if the original confirmation email was lost).

This makes the status link the single source of truth for full history, and email a lighter-weight "something
worth your attention happened" nudge — closer to how most real issue trackers separate a notification digest
from the full activity log.

### 4.3 Status page (pull, via the permanent link)

1. Reporter opens `https://<app>/status/<token>`. The frontend calls a **status-lookup** function with the
   token — it cannot call `api.github.com` directly itself, since the reporter has no GitHub credential at all.
2. Function looks up `status-token → issue#` in KV; unknown/invalid token → generic 404 (don't distinguish
   "wrong token" from "revoked token" from "never existed"). Rate-limit this endpoint the same way as OTP
   requests (§3.1) — the token's entropy makes brute-forcing impractical, but there's no cost to also
   throttling guesses.
3. Function reads the issue (title, labels/status, assignee-or-not, comments, open/closed) via the bot/service
   credential (§3.3) — a **read-only proxy**, not a direct client-side GitHub call — and returns a sanitized
   view to the frontend. "Sanitized" mainly means: the reporter's own email was never stored in GitHub in the
   first place (§3.3), so there's nothing to scrub on that front.
4. Frontend renders the status/history view: current status, category/location, timeline of
   labels/comments/assignment. The report itself (title, body, labels) is not editable from this page; the
   only write the reporter has is adding comments (below). Comments the reporter posted are visually
   distinguished from staff comments.

**Reporter comments** (requirement from the instructor, 2026-10-06): a reporter can add comments to their own
report from the status page.

1. The status page shows a comment box. Submitting it calls an **add-comment** function with the status token
   and the comment text. As with status lookup, the reporter has no GitHub credential, so the Worker does the
   write.
2. Function resolves `status-token → issue#` in KV (unknown token → the same generic 404), applies a rate
   limit per token and per IP (the page is a public write endpoint, so this matters more than for reads), and
   enforces a length cap and non-empty text.
3. Function posts the comment to the issue via the bot credential (§3.3), with the text prefixed by a fixed
   marker (e.g. `**Reporter:**`), since the comment's GitHub author is the bot. The status-lookup function
   uses that marker to tell reporter comments from staff comments when building the timeline, and the staff
   dashboard shows the same marker. The text is posted as plain text with `@mentions` and markdown/HTML
   neutralized, so a reporter can't ping arbitrary GitHub users or inject content. **No email address is
   written into the comment**, preserving the §3.3 invariant.
4. The webhook receiver ignores the resulting `issue_comment` event (§4.2). Staff see the comment in the
   dashboard and on GitHub like any other; whether they are actively notified is open (§7 item 15).

Because the status link is a shareable capability URL (§1), anyone holding it can comment, not just the original
reporter. That follows from the existing link-sharing decision (a spouse or roommate may use it), and the
marker only says "reporter", not who. If the link leaks, the existing token revocation question (§7 item 11)
becomes more important.

**New consideration this feature introduces:** since issue comments become visible to whoever holds the link,
staff need a convention for what's safe to write in a comment. Default for MVP: **treat every comment as
reporter-visible** and rely on staff discipline (don't discuss anything sensitive in-issue). A documented
upgrade path if that proves insufficient: adopt a marker convention (e.g. a comment prefixed `[internal]`) that
the status-lookup function filters out before returning data to the public page. Not needed unless staff
actually run into a case where they want a private back-channel on a specific report.

### 4.4 Staff contact lookup and link resend (gated)

Because the reporter's email lives only in KV, staff who need to contact a reporter directly (e.g. to schedule
building access), or who need to resend a lost status link, can't get either from the issue itself. A small
**reveal-contact** function, gated by checking the caller's GitHub org role (using the staff member's own GitHub token
from device-flow login, §2.2), looks up the email and/or status link from KV and returns it. This keeps both lookups auditable/
controllable in one place instead of that data being plastered across every issue view.

---

## 5. Data model additions (Workers KV)

| Key pattern                  | Value                                        | TTL                         | Purpose                                                   |
| ---------------------------- | -------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| `allowlist:<email>`          | `true` / metadata (e.g. resident name, unit) | none (admin-managed)        | gates who may request an OTP                              |
| `otp:<email>`                | `{hash, expiresAt}`                          | ~10 min                     | pending OTP verification, single-use (deleted on success) |
| `issue-email:<issue#>`       | `<email>`                                    | none (life of the issue)    | reporter lookup for notifications + staff contact reveal  |
| `status-token:<token>`       | `<issue#>`                                   | none (permanent, by design) | resolves a reporter's status link to an issue             |
| `issue-token:<issue#>`       | `<token>`                                    | none (permanent, by design) | reverse lookup so staff can resend a lost link (§4.4)     |
| `webhook-seen:<delivery-id>` | `true`                                       | ~1 day                      | idempotency guard against duplicate webhook deliveries    |

Allowlist maintenance for MVP: manual edits via the Cloudflare dashboard (small, low-churn resident list). A
staff-facing admin UI for managing it is a plausible future enhancement, not required for the MVP.

---

## 6. Requirement mapping

| Requirement (from the brief)                                       | Mechanism                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registered users submit reports with location, nature, description | Email allowlist + OTP, no GitHub account. Issue created by the bot with labels (`location:*`, `type:*`) + free-text body.                                                                                                                                                                                 |
| Users track own reports' status/history                            | Permanent unguessable per-issue link is the authoritative status/history view (no login, no listing of other issues); email notifies on major transitions only and always repeats the link. Also directly resolves GitHub's "no per-issue privacy" gap via capability-based access instead of repo roles. |
| Users can comment on their own reports (instructor, 2026-10-06)    | Comment box on the status page (§4.3). A token-gated Worker function posts the comment as the bot with a `Reporter:` marker; the reporter needs no GitHub account and no email is written to GitHub.                                                                                                     |
| Authorized users review, categorize, prioritize, assign            | Staff with GitHub Triage/Admin roles: labels (`category:*`, `priority:*`) + assignee.                                                                                                                                                                                                                     |
| Repair progress trackable; completed-work info recorded            | Open/closed + `status:*` labels (or a Projects v2 board with a single-select "Status" field); resolution notes as issue comments. Major transitions are mirrored out via email to the reporter.                                                                                                           |
| Multiple roles with different permissions                          | Reporter is "anyone on the allowlist who completes OTP" (not a GitHub role). Maintenance staff = org Triage; system admin = org Admin (can manage members; onboarding is an org invite, automatable via the membership API).                                                                              |
| Search / overview by open, in progress, closed                     | GitHub search qualifiers and label filters in the staff dashboard; optionally Projects board columns.                                                                                                                                                                                                     |
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
  that could change without notice. Omit photos, or offer a "paste an image link" fallback.
- **Role tiers require an Organization.** Personal-account repos only grant collaborators full Write access.
  The Read/Triage/Write/Maintain/Admin model exists only for org-owned repos, and free orgs get all of it at
  no cost, so this is a setup requirement, not a cost blocker.
- **Rate limits** are 5,000 requests/hour per authenticated user, which is ample at building scale. The one
  risk is that all anonymous submissions share the bot token's bucket (§3.3).

---

## 7. Open items / decisions still needed

1. **"Asztali alkalmazás" requirement** — **resolved (2026-10-05).** A web-only deliverable isn't acceptable,
   so the design ships one SPA wrapped by a thin Windows-only Electron shell (§2.1). Staff login moved to
   device flow (§2.2), pending the spike in item 13.
2. **GitHub Organization and label taxonomy** — the org isn't created yet, and the category/priority/location/
   status label values are undefined (the major-change taxonomy in item 10 depends on them).
3. **Domain for sending email** — need a real domain to verify with Resend (SPF/DKIM/DMARC on a dedicated
   subdomain). Does the project already have one, or does this need to be acquired?
4. **PAT vs GitHub App for the bot** — leaning PAT for simplicity; confirm before implementation.
5. **OTP parameters** — code length (6 digits assumed), expiry window (10 min assumed), resend cooldown
   (60s assumed) — fine as defaults, but confirm before implementation.
6. **Allowlist provisioning** — who is the "admin" that maintains the resident email list, and how (manual KV
   edit vs a lightweight admin screen)?
7. **Email content/branding** — plain text vs HTML templates for OTP and update emails; whether to expose a
   reply-to address staff monitor for reporters who reply to an update email.
8. **Multiple reports per reporter** — no blocker identified, just confirm the email template disambiguates
   which issue number/report an update is about (already assumed above).
9. **What if a reporter mistypes their email** — no recovery path exists (OTP just won't arrive); acceptable
   for MVP, note as a known limitation rather than solving it now.
10. **Major-change taxonomy** — pin down exactly which webhook actions/labels count as "major" for email
    purposes (§4.2) once the label taxonomy itself is finalized.
11. **Status token lifecycle** — confirm token format/entropy (UUIDv4 assumed) and decide whether links should
    ever be revocable/rotatable, e.g. if a reporter shares one somewhere unintended and wants it invalidated.
12. **Comment privacy convention** — only needed if staff actually hit a case where they want to discuss a
    report without the reporter seeing it (§4.3); not worth designing pre-emptively.
13. **Device-flow spike** — verify end to end that GitHub device flow works through the Worker proxy: device
    flow enabled on the app, both endpoints proxied, and the resulting token accepted by `api.github.com` and
    by the reveal-contact role check. GitHub's own docs disagree on whether device flow suits desktop apps,
    and no live round trip has been run. Fallback: the web flow, with a relay Worker doing the
    `client_secret` exchange, run in the shell's window (§2).
14. **Staff token app type and storage** — OAuth App (long-lived tokens) vs GitHub App (fine-grained, 8-hour
    tokens that refresh without a secret under device flow); decide together with item 4. Also decide whether
    the SPA keeps the token in memory (re-login on every launch) or persists it (Electron's default session
    keeps localStorage across restarts).
15. **Reporter comment details** (§4.3) — decide: (a) whether staff are notified of a new reporter comment
    (email to a monitored address, or dashboard-only; GitHub's own notifications still reach assignees and
    watchers); (b) whether commenting stays open on closed issues (and whether a reporter comment on a closed
    issue should reopen it); (c) the length cap and rate-limit values; (d) whether reporters may edit or
    delete their own comments (assumed no for MVP).

---

## 8. Next steps

1. Delivery format is decided: Electron shell around the hosted SPA (§2.1). Still to do: the device-flow
   spike (§7 item 13).
2. Stand up the GitHub Organization and pin down the label taxonomy.
3. Acquire/confirm a domain and verify it with Resend.
4. Decide PAT vs GitHub App and provision the bot credential.
5. Implement the edge functions, with submission as the critical path: OTP request → OTP verify-and-submit
   (issue creation) → status-lookup → add-comment → webhook receiver → staff device-flow proxy → reveal-contact/resend-link.
6. Build the static frontend's three surfaces: submission form, status page, staff dashboard.
7. Add the Electron shell (§2.1) and package an unsigned Windows build.
