# Issue Tracker

Fault-reporting and maintenance-tracking system (*Hibabejelentő és karbantartás-kezelő rendszer*) for a building, institution, or organization, using a private GitHub Organization repository as its backend.

## Surfaces

- **Submission form** — public, no-login fault reporting behind an Allowlist and email-OTP gate.
- **Status page** — permanent, unguessable per-Report Status link showing progress, history, and a Reporter comment box.
- **Staff dashboard** — GitHub device-flow sign-in (Viewer, Maintenance staff, System admin) with List, Board, Detail, Allowlist, and Configuration views.

## Repository layout

| Path | Contents |
| --- | --- |
| [`app/`](./app) | React 19 SPA, Cloudflare Worker (KV, Durable Objects, Resend), and local fake GitHub/Resend world |
| [`shell/`](./shell) | Windows Electron desktop wrapper around the hosted SPA |
| [`website/`](./website) | Bilingual (EN + HU) VitePress documentation site deployed to GitHub Pages |
| [`docs/`](./docs) | Architecture Decision Records ([`docs/adr/`](./docs/adr)), UI conventions, and operational runbooks |

## Local development

Requires Node 24+ and npm.

```powershell
# 1. Start the SPA, Worker, and local fake GitHub/Resend world
cd app
npm ci
npm run seed
npm run dev

# 2. (Optional) Seed sample Staff users and Reports into the running local world
npm run world -- seed
```

To run the Windows desktop shell against the local dev server (in a second terminal):

```powershell
cd shell
npm ci
$env:APP_URL = "http://localhost:5173"; npm start
```

Run `npm run verify` in `app/` or `shell/` for the full verification suite.

## Documentation

- **Documentation site (EN + HU):** <https://pergo911.github.io/github-issue-tracker/> (source in [`website/`](./website))
- [`SPEC.md`](./SPEC.md) — system design and source of truth
- [`GLOSSARY.md`](./GLOSSARY.md) — domain terminology
- [`docs/runbook-deployment.md`](./docs/runbook-deployment.md) — deploying an Organization's copy (reference Deployment: <https://fault-reports.berautoapp.workers.dev>)
- [`shell/README.md`](./shell/README.md) — building and verifying the Windows desktop shell
