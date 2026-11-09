# Runbook: a submission that needs a person

For a System admin (repo Admin) of a Deployment. Background: [SPEC §4.1](../SPEC.md) (recovery) and §5
(retention), [ADR 0005](./adr/0005-recover-submissions-without-retrying-uncertain-creates.md).

## When this applies

A Reporter's final submit is saved in three steps: the Bot creates the GitHub issue, the Worker records the issue
number, and the Report gate writes the three KV mappings. Almost every interruption heals by itself (the same tab
resumes, an alarm retries with backoff). The one case that cannot is an **uncertain create**: the Worker may or
may not have created the issue (a timeout, a crash after the dispatch fence), and a scan of the repository's issues
found **no** issue, or **several**, carrying the attempt's correlation marker by the Bot. The system never creates
again on its own, because GitHub gives no idempotency key and a second POST could duplicate the Report.

The Reporter sees "Your report needs a person to finish it", a **reference** such as `A1B2-C3D4` and the
Deployment's configured contact text (`codeSentHelp`). Their address is blocked from submitting again until you
resolve or discard the attempt. A Reporter who contacts you gives you that reference.

## The tool

`app/scripts/recovery.ts` (also `npm run recovery -- ...` from `app/`) calls the Admin-gated Worker endpoints
(`/api/admin/recovery/*`) with **your own** GitHub token. You need Admin on the repository.

```
export APP_URL=https://<your deployment>            # or pass --url
export GITHUB_TOKEN=$(gh auth token)                # or pass --token; with neither, the CLI runs `gh auth token`

node scripts/recovery.ts list
node scripts/recovery.ts inspect   --reference A1B2-C3D4      # or --email anna@example.hu
node scripts/recovery.ts associate --reference A1B2-C3D4 --issue 142
node scripts/recovery.ts discard   --reference A1B2-C3D4
```

`list` shows the attempts that need a person (reference, phase, since when); it names no address. `--email` also
finds an attempt that is not yet in the list (still uncertain or being repaired), which `--reference` cannot.

## Procedure

1. **Inspect.** `inspect` prints the address, the title, the category and location, the phase and the exact
   **marker line** (`<!-- fault-report-attempt: ... -->`). It also scans GitHub again and tells you which issues carry
   it now.
2. **Look on GitHub.** Search the repository's issues (open **and** closed) for the marker line, and for the title
   and time. Remember the scan only accepts the exact line from the Bot; a Report whose body was edited by hand does
   not match.
3. Decide:
   - **The Report exists** (one issue is the Reporter's): `associate --issue <number>`. The Worker checks that the
     issue exists, is an issue (not a pull request), was filed by the Bot and is not already linked to another
     Report, then finalizes its mappings (`issue-email`, `status-token`, `issue-token`) and completes the attempt.
     The Reporter's tab, asking again, shows the confirmation page with the Status link. No confirmation email is sent
     in this case, so tell the Reporter their link is on that page (or hand it over from reveal-contact).
   - **Several issues carry the marker**: keep the one that is the Report, close or delete the duplicates on GitHub,
     then `associate` the kept one.
   - **No Report exists**: the Reporter must file it again. `discard` removes the attempt (and any partial mappings
     for its issue), which unblocks their address. Tell them to submit again with a new code.
4. **Confirm.** `list` no longer shows the reference, and `inspect --email ...` answers "no saved report".

## Good to know

- An unresolved attempt has no silent expiry: only `associate`, `discard` or an Erasure removes it, and with it the
  Reporter's email and payload held in the Email gate (SPEC §5). Cleanup is logical: Durable Object point-in-time
  recovery can retain history for up to 30 days.
- `associate` never creates an issue. If the repair of the mappings itself is still failing (KV trouble), it answers
  that finishing is in progress; an alarm keeps retrying with backoff and `inspect` shows the phase.
- Completed submissions leave only a receipt for 24 hours (so a lost response can be replayed), then it is cleaned up.
  A Reissue of the Status link voids the receipt: it never reveals a replaced token.
- Every call is authorized against the repository's `permissions` for your token on each request, and fails closed.
