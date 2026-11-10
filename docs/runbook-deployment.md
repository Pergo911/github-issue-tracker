# Deploy an Organization's copy

One Deployment serves one Organization. The SPA and Worker deploy together to Cloudflare Workers;
the Windows app opens that same HTTPS origin. See [SPEC §2](../SPEC.md#2-architecture-overview).

## Reference Deployment

- Site: <https://fault-reports.berautoapp.workers.dev>
- Reports: private `Tarsashaz-demo/reports`; `reports-sandbox` is reserved for contract checks.
- Language/timezone: Hungarian, `Europe/Budapest`; reply-to: `reply@mail.berautoapp.hu`.
- Windows artifacts: the draft **Reference Deployment MVP** release in `Pergo911/github-issue-tracker`.
- Setup record: [#20](https://github.com/Pergo911/github-issue-tracker/issues/20).

## 1. Human setup

1. Create a GitHub Organization and private `reports` and `reports-sandbox` repositories. Enable
   **Settings → Member privileges → Issue deletion**. Give Staff repo Read (Viewer), Triage
   (Maintenance staff), or Admin (System admin). Reporters receive no GitHub access.
2. Register two GitHub Apps, restricted to this GitHub Organization, with **Metadata: read** and
   **Issues: read and write**, no other permissions. Disable each App's webhook.
   - Staff App: enable Device Flow and expiring user authorization tokens. Record its Client ID.
     No callback or client secret is needed.
   - Bot App: leave Device Flow disabled. Generate and download a private key. Record its App ID.
     Install both on the two repositories only; record the Bot installation ID from the settings URL.
3. Create a Cloudflare account, choose its `workers.dev` subdomain, and run `npx wrangler login`
   from `app/`, approving the browser prompt.
4. In Resend, add and verify a dedicated `mail.<your-domain>` sending subdomain in the EU (Ireland)
   region. Add Resend's DKIM, SPF and MX records at your DNS host; add an appropriate DMARC record.
   Create a sending-only key restricted to that domain and a separate Full-access live-check key.
   Choose an existing monitored mailbox for reply-to.
5. Save secrets **outside the repository**. The scripts default to
   `%USERPROFILE%\.config\github-issue-tracker-deployment`; `REPORTS_DEPLOYMENT_DIR` overrides it.
   Restrict the folder's Windows ACL to the operator. Store:
   - `bot-private-key.pem`: exactly the downloaded PEM (PKCS#1 and PKCS#8 are both accepted).
   - `secrets.env`: `RESEND_API_KEY=<sending-key>` and `RESEND_LIVE_CHECK_KEY=<full-access-key>`.
     Never paste secrets into an issue, command argument, screenshot or chat. The full-access key stays
     on the operator machine and is **not** uploaded to Cloudflare.

## 2. Worker and SPA

Commands below are PowerShell, from `app/`. Install Node 24+ and npm, GitHub CLI, and Docker if
running the full verification suite. Authenticate `gh` as an operator with Admin on `reports` and
permission to delete issues and manage repository webhooks.

```powershell
npm ci
npm run setup
npx wrangler kv namespace create KV
```

Edit `wrangler.jsonc`: choose a globally appropriate Worker name; paste the KV namespace ID;
set `GITHUB_ORG`, `GITHUB_REPO`, `RESEND_FROM_DOMAIN`, `APP_URL`, `BOT_APP_ID`,
`BOT_INSTALLATION_ID`, and `STAFF_APP_CLIENT_ID`. The live URL is
`https://<worker-name>.<subdomain>.workers.dev`. Keep the real service base URLs. Do not add `env`
blocks: another Organization uses its own account and configuration.

Fetch and pin the Bot's account identity (this is a user ID, **not** the App ID):

```powershell
gh api 'users/<bot-app-slug>[bot]' --jq '{id,login,type}'
```

Set `BOT_USER_ID` and `BOT_LOGIN` to that result; `type` must be `Bot`. Commit these non-secret
configuration values. The pinned identity is used to attribute Reporter text, never a display-name
guess. The local fake world overrides it and uses its own Bot.

```powershell
# These overrides are also used by the deployment and live-check scripts below.
$env:APP_URL = 'https://<worker-name>.<subdomain>.workers.dev'
$env:GITHUB_ORG = '<github-organization>'
$env:GITHUB_REPO = 'reports'
$env:GITHUB_REPOSITORY = "$env:GITHUB_ORG/$env:GITHUB_REPO"
$env:REPLY_TO = '<monitored-mailbox>'

# Generates webhook-secret.txt in the private folder, then pipes all three secrets to Wrangler.
npm run deploy:reference -- secrets
npm run typecheck
npm run verify
npm run build
npx wrangler deploy

# Creates or updates ONLY the webhook whose URL matches this Deployment; issues events, JSON.
npm run deploy:reference -- webhook
gh api "repos/$env:GITHUB_REPOSITORY/hooks" --jq '.[] | {id,events,active,last_response}'
```

The webhook URL is `<APP_URL>/api/github/webhook`. Its ping's `last_response.code` must be 202.
The secret is generated once and reused on reruns. To rotate it, replace the private file and run
both `secrets` and `webhook` again. `secrets.required` in Wrangler names the three required secrets.

### Initial configuration

For a Hungarian demonstration copy with the Appendix A taxonomy:

```powershell
npm run deploy:reference -- configure
```

**This replaces the entire saved configuration**, including wording and taxonomy. It is an initial
setup command, not an upgrade command. It authenticates with `GITHUB_TOKEN` or `gh auth token`,
uses Appendix A with `REPLY_TO`, and saves through the Admin endpoint; saving synchronizes the
27 classification labels. Another Organization should instead use the Configuration screen to
enter its own branding, taxonomy, notices, email wording, timezone and budget. Sign in through
Device Flow as a repo Admin, then open `/staff/configuration`. A fresh public site says it is not
configured until this first save succeeds. KV propagation can take about a minute.

## 3. Live acceptance and screenshots

```powershell
npm run check:live -- --screenshots
```

The script uses real GitHub, Worker and Resend APIs. It adds only `delivered+live@resend.dev`,
waits for KV propagation, reads the OTP through Resend, submits one distinctly titled Report,
reads its Status link, adds a Reporter comment, closes with the operator's token, and retrieves
the Closed email. It reissues the link, verifies old=404 and new=working, deletes **its own**
issue using GraphQL `deleteIssue`, waits for the erasure webhook (contact and link return 404),
and removes its Allowlist entry. An already-listed test address is refused rather than overwritten.
Each run consumes one code request and four emails; provider email logs and short-lived abuse/dedupe
records remain, but no test Report, contact mapping or Allowlist entry should remain.

The script keeps a private `live-check.json` journal in the secrets folder, never in git. On
failure its `finally` block attempts cleanup. After interruption:

```powershell
npm run check:live -- --cleanup
```

If submission's outcome is uncertain, inspect the retained attempt with the
[submission recovery runbook](./runbook-submission-recovery.md) before doing anything else. Do not
resubmit an uncertain create. A cleanup failure retains the journal; fix access/webhook delivery
and retry cleanup. Notifications are best-effort: inspect GitHub webhook deliveries if the Closed
email is absent. GitHub does not automatically retry failed deliveries.

Screenshots go to `app/.screenshots/live/`: home, form, the temporary Report's Status page, and
Staff List, Board, Detail, Allowlist and Configuration, at 1280/375 px in light/dark. The browser
is temporary; the operator token is seeded into the SPA's normal `staff.tokens` storage only for
these captures. No device-flow approval is automated and no browser storage state is saved.
Open every image and check Hungarian wording, layout, clipping and theme against
[the UI conventions](./ui-github-look.md). Capability URLs, OTPs and credentials are not logged.

## 4. Windows build and draft release

From `shell/`, keeping `APP_URL` set to the live HTTPS origin:

```powershell
npm ci
# Give another Deployment a stable, distinct identity, so installs do not overwrite one another.
$env:APP_ID = 'your.organization.faultreports'
$env:PRODUCT_NAME = 'YourReports'
npm run build
node scripts/install-live.ts
```

`install-live.ts` silently installs the live build into a private work directory, launches the
installed packaged app (no certificate bypass), captures light/dark home screenshots under
`shell/.screenshots/live-installed/`, and uninstalls. It refuses to replace an existing installation.
Open both images. For the reference Deployment use the default identity: leave `APP_ID` and
`PRODUCT_NAME` unset. Upload the installer, portable executable, and screenshots to a draft release:

```powershell
gh release create reference-mvp-0.1.0 --repo Pergo911/github-issue-tracker --draft --title 'Reference Deployment MVP' --notes 'Windows app for https://fault-reports.berautoapp.workers.dev. Unsigned; see the deployment runbook.'
gh release upload reference-mvp-0.1.0 --repo Pergo911/github-issue-tracker 'dist/Hibabejelento-Setup-0.1.0.exe' 'dist/Hibabejelento-0.1.0-portable.exe'
```

Finally ask the operator to complete [setup ticket #20 Part B](https://github.com/Pergo911/github-issue-tracker/issues/20):
install (SmartScreen: More info → Run anyway), approve Device Flow, verify the System admin role,
file/close a Report with their own email, check inbox/spam and Hungarian wording, then erase their
Report and remove their Allowlist entry. Scripted delivery to Resend's test address does not prove
delivery to a human inbox.
