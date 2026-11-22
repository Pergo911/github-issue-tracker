---
layout: home

hero:
  name: Issue Tracker
  text: Fault reporting and maintenance tracking on GitHub Issues
  tagline: Reporters file faults with a 6-digit email code and follow progress through a private Status link — no GitHub account required. Maintenance staff work from a familiar Kanban board, list, and Windows desktop app.
  actions:
    - theme: brand
      text: Read the guide
      link: /guide/overview
    - theme: alt
      text: Deploy your own
      link: /operations/deployment
    - theme: alt
      text: Magyar verzió
      link: /hu/

features:
  - title: Three focused surfaces
    details: A public Submission form behind an email-OTP gate, a permanent per-Report Status page with comments, and a GitHub-authenticated Staff dashboard with List, Board, Detail, Allowlist, Staff, and Configuration screens.
  - title: Reporter privacy by design
    details: Reporters never receive a GitHub account or repository Read access. Reporter email addresses are never written into GitHub issues, comments, or labels — they stay isolated in Workers KV behind role-gated lookup.
  - title: One Deployment per Organization
    details: Self-deployed on your own GitHub Organization, Cloudflare Workers account, and Resend sending domain. Branding, Taxonomy, Status flags, email templates, timezone, and UI Language (English or Hungarian) live in configuration.
  - title: Web and Windows desktop app
    details: One React SPA hosted on Cloudflare Workers, plus a thin Windows Electron shell packaged as a per-user NSIS installer and portable executable with no shell-specific frontend code.
---

<div class="home-showcase">
  <div class="home-showcase-header">
    <h2>Staff dashboard in action</h2>
    <p>Light and dark themes adapt automatically. Screenshots show the Hungarian reference Deployment (Rózsa Társasház).</p>
  </div>
  <AppScreenshot
    name="board-maintenance"
    alt="Staff Kanban board showing open Reports grouped by Status columns with Category, Location, and Priority labels"
    caption="The Maintenance staff Board view groups open Reports by configured Status columns and highlights any Report whose Status needs correction."
    eager
  />
</div>

<div class="home-flow">
  <h2>How a Report flows</h2>
  <div class="home-flow-grid">
    <div class="home-flow-step">
      <div class="home-flow-step-num">1</div>
      <h3>Submit without a login</h3>
      <p>An allowlisted Reporter picks a Category and Location, describes the fault, and confirms with a single-use 6-digit email code. The Bot opens the GitHub issue without storing the Reporter's email in GitHub.</p>
    </div>
    <div class="home-flow-step">
      <div class="home-flow-step-num">2</div>
      <h3>Track via a Status link</h3>
      <p>Each submission mints an unguessable permanent Status link. The Reporter checks progress, reads Staff updates, and posts Reporter comments there; Major changes also trigger plain-text email notifications.</p>
    </div>
    <div class="home-flow-step">
      <div class="home-flow-step-num">3</div>
      <h3>Triage and resolve</h3>
      <p>Viewers, Maintenance staff, and System admins sign in with GitHub Device Flow. Maintenance staff prioritize, assign, move Reports across Status columns, reveal Reporter contact on demand, and close resolved Reports.</p>
    </div>
  </div>
</div>
