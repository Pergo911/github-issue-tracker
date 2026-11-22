# Erasure Procedure

This runbook explains how a **System admin** (GitHub repository Admin) processes a Reporter's request to remove their data.

## Design principles

- **Per-Report by design:** There is intentionally no reverse index from an email address to all of its Reports. Ask the Reporter for the numbers of the Reports they want erased (every confirmation email includes the Report number in both its subject and body) and repeat the issue-deletion step for each Report.
- **Prerequisites:**
  - The GitHub Organization must have **Issue deletion** enabled under **Settings → Member privileges**.
  - The repository webhook must be active and delivering `issues` events to `https://<your-deployment>/api/github/webhook`.

## Procedure

### 1. Delete each Report's issue on GitHub

Open the Report's issue on github.com and click **Delete issue** (requires repository Admin).

When the issue is deleted:
- The Report and all of its comments are removed from GitHub.
- GitHub sends an `issues` webhook with `action: "deleted"` to the Worker.
- Through the Report's Durable Object gate, the Worker:
  1. Records an inert deletion tombstone (GitHub never reuses issue numbers, so delayed retries or Reissues for that issue number are permanently refused).
  2. Cancels any pending mapping recovery and any 24-hour completion receipt.
  3. Purges `issue-email:<n>`, `issue-token:<n>`, and `status-token:<token>` from Workers KV.
- No email is sent for a deletion.

### 2. Remove the Allowlist entry

Open **Allowlist** in the Staff dashboard and remove the Reporter's email address (which also removes its private note), preventing future code requests unless you re-add the address later.

### 3. Discard any unlinked pending Submission attempt

If the Reporter had an interrupted submission that never received a GitHub issue number, step 1 will not reach it. Check by email address and discard it using the [recovery CLI](/operations/submission-recovery):

```powershell
cd app
npm run recovery -- inspect --email anna@example.hu
npm run recovery -- discard --email anna@example.hu
```

### 4. Optional completeness check in Workers KV

Because GitHub does not automatically retry failed webhook deliveries, an operator can optionally list `issue-email:*` keys in the Deployment's KV namespace offline and search the values for the Reporter's address.

If any key remains:
- Redeliver the `deleted` webhook from the repository's **Settings → Webhooks → Recent Deliveries**, or
- Delete the three KV keys (`issue-email:<n>`, `issue-token:<n>`, `status-token:<token>`) directly.

## Verification checklist

- Visiting `https://<your-deployment>/status/<old-token>` returns the generic "link does not work" page (`404`).
- `issue-email:<n>`, `issue-token:<n>`, and `status-token:<token>` are absent from Workers KV.
- The address is removed from the Allowlist and `recovery inspect --email <address>` reports no retained submission.

## Retained metadata and external boundaries

- **Inert gate state:** The Report gate keeps only the issue number's deletion tombstone and counters — no Reporter email, title, description, or token.
- **Provider recovery snapshots:** Cleanup in SQLite-backed Durable Objects is logical deletion; Cloudflare point-in-time recovery can retain historical state for up to 30 days.
- **Resend logs:** Resend retains sent plain-text emails (which contain at most the Report title and Status link, never the description) for approximately 30 days before automatic expiration.
- **Organization reply-to mailbox:** Any email replies the Reporter sent to the Organization's monitored `Reply-To` inbox live in the Organization's own mail system and must be handled there if requested.
