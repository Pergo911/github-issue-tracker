# System Administration

Staff members with the **Admin** role on the `reports` repository get three additional screens in the Staff dashboard: **Allowlist**, **Staff**, and **Configuration**.

## Allowlist

Only email addresses on the **Allowlist** can receive verification codes and submit Reports.

<AppScreenshot
  name="allowlist-populated"
  alt="Allowlist screen showing single add form, bulk add textarea, search box, and list of allowed email addresses with notes"
  caption="System admins can add individual addresses, paste up to 500 addresses in bulk, attach private notes, and remove entries."
/>

### Managing entries

- **Add one:** Enter an email address and an optional private note (up to 200 characters, such as name and apartment/unit number). Notes appear only on the Allowlist screen and in Staff **Show contact** — they are never written to GitHub or sent in emails.
- **Bulk add:** Paste up to **500 lines** at once, one address per line, optionally followed by a note separated by a space, comma, or tab. After submission, a per-line result summary reports how many entries were added and lists any rejected lines (invalid syntax, duplicate, already listed, or note too long).
- **Normalization:** Addresses are trimmed and lowercased with exact matching (no dot or `+tag` folding).
- **Propagation:** Changes live in Workers KV and take effect globally within about **one minute**.

### Offboarding and address changes

- **Removing an entry** stops future code requests from that address. Existing Reports, Status links, and Major-change notifications continue unaffected. To cut access to an existing Report's Status page, Reissue its Status link from the Report Detail view.
- **Changing an address:** Add the new address and remove the old one. Older Reports keep emailing the address recorded when they were filed; Staff can reveal and share the Status link manually if the old mailbox is closed.
- **Data removal requests:** Removing an Allowlist entry alone does not delete Reports. Follow the [Erasure Procedure](/operations/erasure) for full per-Report data removal.

## Staff management

The **Staff** screen manages repository collaborators and pending **Staff invitations** directly from the dashboard without leaving the app.

<AppScreenshot
  name="staff-members-populated"
  alt="Staff management screen showing add member form, active staff list with roles and badges, and pending invitations"
  caption="Active Staff members, inherited GitHub Organization roles, and pending repository invitations in one view."
/>

- **Prerequisite:** The Staff GitHub App must have repository **Administration: read and write** permission approved in the GitHub Organization's App installation settings. Viewers and Maintenance staff gain no admin rights from this permission.
- **Adding Staff:** Enter a GitHub username (not an email address) and pick **Viewer**, **Maintenance staff**, or **System admin**. Existing GitHub Organization members get immediate access; outside collaborators receive a GitHub repository invitation that appears under **Pending invitations** until accepted.
- **Safety guards:**
  - You cannot demote or remove yourself.
  - At least one active **System admin** must always remain.
  - Members whose role is inherited from a GitHub Organization team or base permission are marked as managed in the GitHub Organization; reduce or revoke those roles on github.com.
- **Removing Staff:** Revokes repository access immediately and unassigns the person from open Reports while leaving their broader GitHub Organization membership untouched.

## Deployment Configuration

Every per-Deployment setting lives in Workers KV under the `config` key and is edited from the five tabs on the **Configuration** screen.

<AppScreenshot
  name="config-organization"
  alt="Configuration screen showing Organization tab with display name, emergency notice, and code-sent help text"
  caption="The Organization tab configures the header display name, the Emergency notice shown on the Submission form, and the help text shown after requesting a code."
/>

### Configuration tabs

1. **Organization**
   - **Organization name:** Displayed in every page header.
   - **Emergency notice:** Shown prominently above the Submission form (e.g., emergency phone numbers for fire, gas, or flooding). May be left empty.
   - **Help text after sending a code:** Shown to Reporters who do not receive an OTP email (since the generic response cannot confirm whether their email is allowlisted).
2. **Taxonomy**
   - Manage values in the four fixed dimensions: **Categories**, **Locations**, **Priorities** (ordered lowest to highest for dashboard sorting), and **Statuses** (ordered as Kanban Board columns).
   - Each value has an immutable lowercase kebab-case **ID** (becoming a GitHub label like `category:plumbing`), a **display name** in the Deployment's UI Language, and an optional 6-digit hex **colour**.
   - **Status flags:** Exactly one Status must be marked **Initial status** (applied to new and reopened Reports; never sends email on entry). Any Status may opt in to **Notify** (entering it while open emails the Reporter).
   - **One-way label sync:** Saving Configuration automatically creates missing GitHub labels and updates label colours in the `reports` repository. Labels are never deleted or renamed automatically; removing a value from Configuration leaves historical issues with the raw label ID until Staff relabel them.
3. **Email sender**
   - **Sender local part** (before `@`; the verified sending domain is pinned in `wrangler.jsonc`), **Sender name**, monitored **Reply-To** address, **Reply clause**, and shared **Footer** line (using `{reply}`).
4. **Email templates**
   - Plain-text subject and body templates for all **six** system emails: OTP code, Submission confirmation, Closed, Reopened, `notify` Status entered, and Reissued link.
5. **Language & limits**
   - **UI Language:** Single language (`en` or `hu`) for all three surfaces and system captions. Author Taxonomy names, notices, and email templates in this same language.
   - **Timezone:** Valid IANA timezone (e.g., `Europe/Budapest`) used for formatted timestamps.
   - **Daily code budget:** Maximum verification codes the Deployment may send per UTC day (defaults to `40` to stay safely inside Resend's 100-emails/day free tier).

::: tip First-time setup
A freshly deployed Worker shows a "not configured yet" screen on public routes until a System admin signs in at `/staff/configuration` and saves the initial configuration (or runs the reference seed script).
:::
