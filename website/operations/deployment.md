# Deploy a Copy

Each **Organization** runs its own self-deployed **Deployment**. The React SPA and Hono Cloudflare Worker deploy together as a single Worker with static assets; the optional Windows desktop app points at that same HTTPS origin.

## Prerequisites

- **Node 24+** and **npm**
- **GitHub CLI** (`gh`), authenticated as a user with **Admin** access on the Deployment's `reports` repository (including issue deletion and webhook management)
- **Cloudflare account** with Workers, Workers KV, and SQLite-backed Durable Objects enabled
- **Resend account** with a domain you control (using a dedicated `mail.<your-domain>` sending subdomain)
- **Docker** *(optional, only needed if running `npm run test:visual` locally)*

## 1. Account and service setup

### GitHub Organization & repositories

1. Create a **GitHub Organization** and two private repositories: `reports` (live data) and `reports-sandbox` (optional, for running live contract checks).
2. Enable **Settings → Member privileges → Issue deletion** on the GitHub Organization (required for the [Erasure Procedure](/operations/erasure)).
3. Assign Staff members repository roles on `reports`:
   - **Read** → Viewer
   - **Triage** → Maintenance staff
   - **Admin** → System admin
   - **Never** grant Reporters GitHub repository access.

### Two GitHub Apps

Register two GitHub Apps restricted to this GitHub Organization, with **no GitHub Organization-level permissions** and **each App's own webhook disabled**:

| App | Repository permissions | Device Flow | Credentials to save |
| --- | --- | --- | --- |
| **Staff App** (`reports-staff`) | **Metadata: read**, **Issues: read and write**, **Administration: read and write** | **Enabled** (with expiring user authorization tokens) | Client ID (no callback URL or client secret needed) |
| **Bot App** (`reports-bot`) | **Metadata: read**, **Issues: read and write** (*never* Administration) | Disabled | App ID, private key (`.pem`), Installation ID |

Install both Apps on `reports` (and `reports-sandbox` if created). Note the Bot's **Installation ID** from its installation settings URL.

::: info Upgrading an existing Staff App
If you add **Administration: read and write** to an existing Staff App later, approve the updated permission in the GitHub Organization's App installation settings. Already-signed-in System admins may need to sign out and sign in again before the Staff screen loads.
:::

### Cloudflare & Resend

1. Log in to Wrangler from `app/`:
   ```powershell
   npx wrangler login
   ```
2. In **Resend**, add and verify a dedicated `mail.<your-domain>` sending subdomain (EU Ireland region recommended for European Organizations), configure the DKIM, SPF, MX, and DMARC DNS records, and create:
   - A **sending-only API key** restricted to that domain (uploaded as a Worker secret).
   - *(Optional)* A separate full-access key kept only on the operator's machine for live acceptance checks.
3. Choose an existing monitored mailbox for `Reply-To`.

### Store secrets outside the repository

Save deployment secrets in a private operator-only folder outside git (scripts default to `%USERPROFILE%\.config\github-issue-tracker-deployment`, overridable via `REPORTS_DEPLOYMENT_DIR`):

- `bot-private-key.pem` — the downloaded Bot App private key (PKCS#1 and PKCS#8 are both accepted).
- `secrets.env` — `RESEND_API_KEY=<sending-key>` (and optionally `RESEND_LIVE_CHECK_KEY=<full-access-key>`, which is never uploaded to Cloudflare).

## 2. Configure and deploy the Worker & SPA

Run the following PowerShell commands from `app/`:

```powershell
npm ci
npx wrangler kv namespace create KV
```

Update `app/wrangler.jsonc` with your Deployment's non-secret values:

- Worker `name` and the new `KV` namespace `id`
- `GITHUB_ORG`, `GITHUB_REPO` (`reports`), `RESEND_FROM_DOMAIN`, `APP_URL` (`https://<worker-name>.<subdomain>.workers.dev`)
- `BOT_APP_ID`, `BOT_INSTALLATION_ID`, and `STAFF_APP_CLIENT_ID`

Pin the Bot's numeric GitHub user identity (this is its **user ID**, not the App ID):

```powershell
gh api 'users/<bot-app-slug>[bot]' --jq '{id,login,type}'
```

Set `BOT_USER_ID` and `BOT_LOGIN` in `app/wrangler.jsonc` (`type` must be `Bot`).

Then upload the three required Worker secrets (`BOT_APP_PRIVATE_KEY`, `RESEND_API_KEY`, `GITHUB_WEBHOOK_SECRET`), build, deploy, and register the repository webhook:

```powershell
$env:APP_URL = 'https://<worker-name>.<subdomain>.workers.dev'
$env:GITHUB_ORG = '<github-organization>'
$env:GITHUB_REPO = 'reports'
$env:GITHUB_REPOSITORY = "$env:GITHUB_ORG/$env:GITHUB_REPO"
$env:REPLY_TO = '<monitored-mailbox>'

# Generates webhook-secret.txt in the private folder and pipes all three secrets to Wrangler
npm run deploy:reference -- secrets

npm run typecheck
npm run build
npx wrangler deploy

# Creates or updates the repository webhook pointing at <APP_URL>/api/github/webhook
npm run deploy:reference -- webhook
gh api "repos/$env:GITHUB_REPOSITORY/hooks" --jq '.[] | {id,events,active,last_response}'
```

Confirm that the webhook ping's `last_response.code` is `202`.

## 3. Initial Deployment Configuration

Sign in through Device Flow as a repo Admin at `https://<your-deployment>/staff/configuration` and save your Organization's name, Emergency notice, Taxonomy, email sender/templates, UI Language (`en` or `hu`), timezone, and daily code budget.

Saving Configuration synchronizes all Taxonomy labels into the `reports` repository automatically. Public pages display a "not configured" notice until this first save succeeds (allow about one minute for KV propagation).

::: warning Demo seed shortcut
To seed the Hungarian reference Taxonomy (Appendix A) automatically on a fresh demo copy, you can run `npm run deploy:reference -- configure`. This **replaces the entire saved configuration** — never run it on an already-customized Deployment.
:::

## 4. Verify live & package the desktop app

1. **Automated live acceptance check** *(optional, requires `RESEND_LIVE_CHECK_KEY`)*:
   ```powershell
   npm run check:live -- --screenshots
   ```
   This exercises Allowlist add → OTP → Report submit → Status page → Reporter comment → Close + email → Reissue → Erasure cleanup using `delivered+live@resend.dev`. After an interrupted run, clean up with `npm run check:live -- --cleanup`.
2. **Manual human-inbox verification:** File and close one test Report using a real allowlisted inbox, confirm email delivery and wording, then erase the test Report and remove the test address.
3. **Package the Windows desktop app:** Follow [Windows Desktop App](/guide/desktop-app) from `shell/` with your live `APP_URL`, `APP_ID`, and `PRODUCT_NAME`.
