# Runbook: erase a Reporter's data

For a System admin (repo Admin) of a Deployment. Background: [SPEC §5](../SPEC.md) (retention and erasure) and §4.2
(the `deleted` webhook), [ADR 0005](./adr/0005-recover-submissions-without-retrying-uncertain-creates.md).

## When this applies

A Reporter asks for their data to be removed. Erasure is **per Report**: there is no index from an address to its
Reports, on purpose. Ask the Reporter for the numbers of their Reports (each confirmation email carries its number
in the subject and body) and repeat steps 1 and 3 for each.

Before you start, the GitHub Organization must allow issue deletion for its repositories (a setup step, SPEC §8),
and the repository's webhook must be delivering `issues` events to `https://<deployment>/api/github/webhook`.

## Procedure

1. **Delete the issue on GitHub.** Open the Report's issue, then Delete issue (repo Admin only). The Report and
   its comments leave GitHub. GitHub sends the `deleted` webhook, and the Worker then, through that Report's gate:
   records a deletion marker (GitHub never reuses an issue number, so the marker stays and is inert), cancels the
   Report's pending recovery and its 24-hour completion receipt, and purges `issue-email:<n>`, `issue-token:<n>` and
   `status-token:<token>`. Afterwards the Status link answers 404, and a delayed repair or a Reissue for that issue
   is refused. No email is sent for a deletion.
2. **Remove the Allowlist entry** (and its note) on the Allowlist screen, so the address cannot file again unless you
   decide it may.
3. **Discard any not-yet-linked attempt.** A submission that was interrupted before it had an issue is not covered by
   step 1. Find it by the Reporter's address and discard it with the operator procedure in
   [runbook-submission-recovery.md](./runbook-submission-recovery.md):

   ```
   node scripts/recovery.ts inspect --email anna@example.hu
   node scripts/recovery.ts discard --email anna@example.hu     # or --reference A1B2-C3D4
   ```

4. **Optionally, scan offline as a completeness net.** List the `issue-email:*` keys in the Deployment's KV
   namespace and look for the address among the values. A hit means a Report whose `deleted` webhook never arrived
   (GitHub does not retry a failed delivery): delete that issue's mappings by redelivering the webhook from the
   repository's Settings, Webhooks, Recent Deliveries, or by deleting the three keys by hand.

## Check

- `https://<deployment>/status/<token>` answers the generic "not found" page.
- `issue-email:<n>`, `issue-token:<n>` and the `status-token:` entry for the Report are gone from KV.

## What stays, and what is outside this system

- The deletion marker and the per-issue counters of the Report's gate: no Reporter data, only the issue number.
- Durable Object point-in-time recovery can retain earlier contents for up to 30 days; cleanup here is logical
  deletion.
- Resend keeps the sent emails for about 30 days (title and Status link only), and replies to the reply-to mailbox
  live in the Organization's own mail system. Both are recorded limits (SPEC §5).
