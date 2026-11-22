# Submission Recovery

This procedure is for a **System admin** (GitHub repository Admin) when an interrupted submission needs human reconciliation.

## When this applies

A Reporter's final submission completes in three steps:

1. The **Bot** creates the GitHub issue.
2. The Worker records the returned issue number in the Email Durable Object.
3. The Report gate writes the three KV mappings (`issue-email`, `status-token`, `issue-token`).

Nearly every transient failure heals automatically — the Reporter's browser tab resumes the attempt, and Durable Object alarms retry missing KV mappings with backoff.

The one situation that cannot heal automatically is an **uncertain create**: a timeout or crash occurred after the dispatch fence, and scanning the repository's issues (`state=all`) found **zero** issues — or **multiple** issues — carrying the attempt's correlation marker authored by the Bot. Because GitHub provides no durable idempotency key for issue creation, the system **never retries an uncertain create automatically**, preventing duplicate Reports.

When this happens:

- The Reporter sees *"Your report needs a person to finish it"*, a short **reference** (for example `A1B2-C3D4`), and the Deployment's configured contact text.
- The Reporter's email address stays blocked from starting a new submission until a System admin reconciles or discards the retained attempt.

## The recovery CLI

From `app/`, use `npm run recovery` (which wraps `app/scripts/recovery.ts`). Every command calls Admin-gated Worker endpoints (`/api/admin/recovery/*`) authenticated with **your own** GitHub token and fails closed if your token lacks repository Admin permission.

```powershell
$env:APP_URL = "https://<your-deployment>"      # or pass --url
$env:GITHUB_TOKEN = (gh auth token)             # or pass --token; defaults to `gh auth token`

npm run recovery -- list
npm run recovery -- inspect   --reference A1B2-C3D4          # or --email anna@example.hu
npm run recovery -- associate --reference A1B2-C3D4 --issue 142
npm run recovery -- discard   --reference A1B2-C3D4
```

- `list` shows unresolved attempts awaiting human help (reference, phase, timestamp) without printing email addresses.
- `--email` can also inspect attempts that are still being repaired and not yet listed by `list`.

## Step-by-step procedure

1. **Inspect the retained attempt:**
   Run `inspect --reference <REF>` (or `--email <ADDRESS>`). Note the Reporter's email, Report title, Category, Location, current phase, and the exact correlation marker line (`<!-- fault-report-attempt: ... -->`). The command also re-scans GitHub and reports any matching issues.
2. **Verify on GitHub:**
   Search the `reports` repository (both **open and closed** issues) for the marker line, title, and timestamp. Note that automated matching checks only the exact Bot-authored marker line; an issue whose body was manually edited will not match automatically.
3. **Resolve the attempt:**
   - **Exactly one matching issue exists:** Run `associate --reference <REF> --issue <NUMBER>`.
     The Worker verifies that the issue exists, is an issue (not a pull request), was created by the Bot, and is not already linked to another Report. It then finalizes the three KV mappings and completes the attempt.
     ::: info Notify the Reporter manually
     `associate` does not send a confirmation email. If the Reporter's tab is still open it will show the Status link on refresh; otherwise reveal the Status link on the Report Detail screen and share it with the Reporter.
     :::
   - **Multiple issues carry the marker:** Choose the issue to keep, close or delete the duplicates on GitHub, and then `associate` the kept issue.
   - **No issue was created:** Run `discard --reference <REF>`. This deletes the retained attempt and any partial mappings, unblocking the Reporter's email address so they can submit again with a fresh code.
4. **Confirm completion:**
   Re-run `list` (the reference should be gone) and `inspect --email <ADDRESS>` (should report no saved submission).

## Lifecycle notes

- Unresolved attempts **never silently expire** — only `associate`, `discard`, or an [Erasure](/operations/erasure) removes the retained email and payload.
- Completed attempts retain only a replayable completion receipt for **24 hours** (voided immediately on Reissue or Erasure).
- Durable Object cleanup is logical deletion; Cloudflare's SQLite point-in-time recovery may retain historical snapshots for up to 30 days.
