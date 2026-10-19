# Recover submissions without retrying uncertain GitHub creates

OTP consumption, GitHub creation and the three KV mappings cannot form one distributed transaction. Persist
the verified Submission attempt in the Email gate before dispatch, then coordinate known-issue mapping repair,
Reissue and Erasure through the Report gate. This trades temporary recovery data and explicit reconciliation
for avoiding accepted-but-untrackable Reports; SPEC §4.1 and §5 define the current workflow and retention.

## Considered options

- **Accept and log orphans.** Rejected: a Report can exist with neither contact mapping nor a usable Status link.
- **Retry the create after a timeout.** Rejected: GitHub has no documented durable create-issue idempotency key.
  A timeout or negative search cannot establish that the issue was not created. Persist a dispatch fence, adopt
  an exact unique Bot-authored correlation-marker match, or leave the attempt for manual reconciliation.
- **Delete the issue as rollback.** Rejected as the default strategy: deletion cannot undo observed notifications,
  and the existing installation token's deletion capability was not verified. Preserve and reconcile instead.
- **Stage recovery in KV.** Rejected: it adds recovery writes to a constrained, eventually consistent store;
  atomic OTP consumption and pending-attempt persistence belong in the existing Durable Object.

## Consequences

- Recovery is not exactly-once GitHub creation or guaranteed automatic completion. An unresolved attempt needs
  explicit reconciliation/discard rather than another automatic POST.
- The recovery credential is a temporary bearer secret, distinct from the public correlation marker and the
  permanent Status link. It does not create a Reporter login or authorize another Report.
- Pending recovery temporarily retains email/content; completion, discard and Erasure need explicit cleanup.
  A hash-derived object name is not a no-PII guarantee, and logical deletion does not bypass provider PITR.
- Persisted phases and lifecycle coordination, not a network-spanning in-memory lock, keep delayed repairs from
  overwriting a Reissued link or restoring erased mappings. KV consistency and provider outages still apply.

Decision: [Status views, neutralization and failure paths](https://github.com/Pergo911/github-issue-tracker/issues/18).
