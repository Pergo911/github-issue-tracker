# Architecture & Privacy

Issue Tracker combines a static React 19 SPA, a Hono backend on **Cloudflare Workers**, a private **GitHub Organization** repository as the system of record, and **Resend** for plain-text transactional email.

## System overview

```text
┌─────────────────────────┐  ┌─────────────────────────┐  ┌───────────────────────────┐
│  PUBLIC SUBMISSION FORM │  │      STATUS PAGE        │  │      STAFF DASHBOARD      │
│  (Reporters, no login)  │  │  (unguessable link,     │  │  (GitHub Device Flow)     │
│                         │  │   no login)             │  │                           │
│  Email → 6-digit OTP →  │  │  Read-only status view  │  │  Calls api.github.com     │
│  Submit + recovery      │  │  + timeline + comments  │  │  directly + gated Worker  │
└────────────┬────────────┘  └────────────┬────────────┘  └─────────────┬─────────────┘
             │                            │                             │
             ▼                            ▼                             ▼
      ┌─────────────────────────────────────────────────────────────────────────┐
      │              Cloudflare Worker (same origin as static SPA)              │
      │  • OTP request & verify-and-submit (creates GitHub issue via Bot App)   │
      │  • Status lookup (30s cached read-only proxy) & Reporter add-comment    │
      │  • GitHub Device Flow proxy (no client_secret)                          │
      │  • GitHub `issues` webhook receiver (Major-change filter & Erasure)     │
      │  • Role-gated endpoints (reveal-contact, Reissue, Allowlist, Staff,     │
      │    Configuration, Submission recovery)                                  │
      └───────────────┬──────────────────────────┬──────────────────────────────┘
                      │                          │
                      ▼                          ▼
        ┌──────────────────────────┐   ┌──────────────────────────┐
        │   Workers KV             │   │  Durable Objects (SQLite)│
        │  • allowlist:<email>     │   │  • Email gate (OTPs,     │
        │  • issue-email:<n>       │   │    caps, recovery)       │
        │  • status-token:<token>  │   │  • Report gate (budgets, │
        │  • issue-token:<n>       │   │    Reissue/Erasure sync) │
        │  • webhook-seen:<id>     │   │  • Global gate (daily    │
        │  • config                │   │    code budget)          │
        └──────────────────────────┘   └──────────────────────────┘
```

### Why Cloudflare Workers + KV + Durable Objects?

- **One origin, one deploy:** Workers Static Assets serve the React SPA from the same origin as the Worker API, eliminating CORS complexity for Device Flow proxying and Reporter API calls.
- **Right storage for each workload:** Workers KV stores read-mostly or write-once mappings; SQLite-backed Durable Objects provide strongly consistent, atomic state for OTP verification, abuse caps, submission recovery, and Reissue/Erasure serialization.
- **Direct Staff reads/writes:** Once signed in through the Worker's Device Flow proxy, the Staff dashboard calls `api.github.com` directly using the Staff member's own expiring GitHub App user token (scoped strictly to the installed `reports` repository).

## Security & privacy invariants

These invariants are enforced across the Worker, shared codecs, and automated test suites:

1. **No Reporter email is ever written to GitHub.** Issue titles, issue bodies, comments, and labels never contain a Reporter's email address or Allowlist note. Completed contact mappings stay in Workers KV behind server-side role verification (`Triage` or `Admin`).
2. **Reporters have no GitHub identity.** The **Bot** (a GitHub App installation token without `Administration` permission) creates Reports and posts Reporter comments on their behalf.
3. **Strict public projection on the Status page.** The status-lookup endpoint builds an explicit allowlisted response object. Internal Priority, Staff usernames, avatars, GitHub URLs, unrelated labels, and machine correlation metadata are never forwarded to the Status page. Pages set `Referrer-Policy: no-referrer` so the Status token never leaks via outbound links.
4. **Canonical dynamic code fences for Reporter text.** Reporter descriptions, Exact place values, and comments are stored in GitHub wrapped in dynamic backtick fences (`max(3, longest_backtick_run + 1)` backticks) so Reporter-supplied Markdown, HTML, `@mentions`, or `#references` cannot execute or close the fence. Both SPA surfaces decode the canonical envelope and render plain text — never raw GitHub HTML.
5. **Validated Report titles.** Titles are restricted to 3–80 characters using an explicit character allowlist (letters, numbers, ordinary spaces, and safe punctuation including Hungarian quotes), rejecting backticks, colons, `@`, `#`, and HTML delimiters without silent character replacement.
6. **Bot-authenticated attribution.** A comment is attributed to *Reporter* only when authored by the Deployment's pinned Bot identity (`BOT_USER_ID`, `BOT_LOGIN`, `type: Bot`) **and** carrying a valid canonical Reporter envelope. A Staff comment copying the `**Reporter:**` text is still displayed as Staff.
7. **Server-side role enforcement.** Every gated Worker endpoint checks the caller's GitHub token against the `reports` repository's `permissions` object on each request and fails closed if GitHub is unreachable.

## Classification contract

Reports are classified exclusively with GitHub labels across **four fixed dimensions** plus GitHub's native open/closed state (no GitHub Projects v2 dependency):

| Dimension | Label prefix | Set by | Cardinality | Visibility |
| --- | --- | --- | --- | --- |
| Category | `category:<id>` | Reporter (Staff may correct) | Exactly 1 | Public + Staff |
| Location | `location:<id>` | Reporter (Staff may correct) | Exactly 1 | Public + Staff |
| Priority | `priority:<id>` | Staff only | 0 or 1 | Staff only |
| Status | `status:<id>` | Bot on create, Dashboard on transition | 1 when open (0 when closed) | Public + Staff |

Two Status flags govern automation without ever parsing Status names:
- **`initial`** — exactly one Status; applied on creation and reopen; entering it never sends email.
- **`notify`** — opt-in; entering this Status while open triggers a plain-text email notification.

## Rate limits & free-tier budgets

| Endpoint | Per-IP limit | Per-key limit |
| --- | --- | --- |
| OTP request | 5 / min | 60s cooldown, 5 / hr, 10 / day per email; configurable Deployment daily cap (default 40 / day) |
| Verify & submit | 10 / min | 5 wrong guesses per 6-digit code (10 min expiry) |
| Resume submission | 10 / min | Valid 128-bit attempt recovery credential |
| Status lookup | 20 / min | 6 / min per token (30s Workers Cache API TTL) |
| Add Reporter comment | 6 / min | 3 / min per token; 20 / day per Report |
| Reissue (holder) | — | 3 / day per Report (uncapped for Maintenance staff / Admin) |

The default 40-code daily budget is sized for Resend's 100-emails/day free tier (leaving headroom for confirmations, Major-change alerts, and Reissues). All email sends are best-effort; the Status link remains authoritative.
