# OTP and abuse-control state lives in Durable Objects, not KV

The OTP record, wrong-guess counts, per-email caps, the Deployment-wide email budget and the per-Report comment and reissue budgets live in SQLite-backed Durable Objects, one per gated key (the SHA-256 of the normalized email, a Report's issue number, or a single global key). Workers KV has no atomic updates and shows writes in other locations only after about a minute, so single-use codes and attempt limits would be best-effort there, and OTP traffic would compete with the Report mappings for the free plan's 1,000 KV writes a day.

## Considered Options

- **KV only.** Rejected. A parallel burst of guesses can each read `attempts = 0` before any counter lands, a code can be redeemed twice, and one flood against listed addresses can exhaust the daily KV write quota that submissions need.
- **KV plus the Rate Limiting binding, no Durable Object.** Rejected. The binding's windows are 10 or 60 seconds, counted per Cloudflare location and deliberately permissive, so it can express neither "5 codes an hour, 10 a day" nor a hard 5-guess limit.

## Consequences

- KV keeps only read-mostly or write-once data: the Allowlist, `issue-email`, `status-token`, `issue-token`, `webhook-seen` and `config`.
- Per-IP and per-token bursts still use the Rate Limiting binding, and are casual-abuse quality by design.
- Objects are named by a hash of the address, never the raw email, and an unlisted address is rejected by the KV Allowlist read before any object exists, so an attacker can't mint objects.
- Each Deployment's Worker configuration gains one Durable Object binding and migration per gate class (email, Report, global).
