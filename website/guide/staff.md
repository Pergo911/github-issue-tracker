# Staff Dashboard

The **Staff dashboard** is where Viewers, Maintenance staff, and System admins sign in with their GitHub accounts to browse, triage, and resolve Reports.

## Signing in (GitHub Device Flow)

1. Choose **Staff sign-in** from the home page (or open `/staff`).
2. Click **Sign in with GitHub**. The dashboard requests a short one-time **device code** through the Worker proxy.
3. Click **Open GitHub verification page** (in the Windows desktop app, this opens your system browser, where passkeys, 2FA, and existing GitHub sessions work normally), enter the displayed code, and approve access.
4. Return to the dashboard. Your role is determined automatically from your GitHub repository permission on the Deployment's `reports` repository.

Access tokens refresh automatically while valid. Signing out clears local browser storage; to revoke the GitHub App authorization completely, remove it in **GitHub → Settings → Applications**.

## Dashboard roles

GitHub's repository roles map to three dashboard tiers, enforced both in the UI and server-side on every Worker endpoint:

| Dashboard role | GitHub repository role | Permissions |
| --- | --- | --- |
| **Viewer** | Read | View List, Board, and Report Detail; post Staff comments. Cannot change labels, assign, close/reopen, or reveal Reporter contact info. |
| **Maintenance staff** | Triage, Write, or Maintain | Full Report triage: Category, Location, Priority, Status, Assignee, close/reopen, comments, reveal Reporter contact, and Reissue Status links. |
| **System admin** | Admin | Everything Maintenance staff can do, plus the **Allowlist**, **Staff**, and **Configuration** screens. |

## List and Board views

Open Reports can be worked in either **List** or **Board** layout, with shared filters and full-history search.

<AppScreenshot
  name="staff-list-admin"
  alt="Staff List view showing search bar, category/location/priority/status/assignee filters, open/closed toggle, and Report rows with labels and invalid-status warnings"
  caption="The List view displays Reports sorted by configured Priority order and then oldest first, with filters for every Taxonomy dimension and closed Reports."
/>

### Filtering, searching, and sorting

- **Full-history search:** Search across both open and closed Reports from the search bar.
- **Filters:** Narrow by Category, Location, Priority, Status, Assignee, **Untriaged** (no Priority set), or **With reporter comments**.
- **Reporter comment scan:** Click **Check reporter comments** to scan open Reports for Reporter-authored comments, display a comment badge on cards/rows, and enable sorting by most recent Reporter comment.
- **Manual refresh:** Because GitHub webhooks go to the Worker rather than pushing live to the browser, use **Refresh** whenever you want the latest repository state.

### Kanban Board

The **Board** displays open Reports in columns matching the Deployment's configured Status order:

- **Drag and drop** cards between Status columns — each move swaps the Status label atomically in a single API call so a Report never carries two Status labels.
- **Accessible Status menu:** Every card also includes a Status dropdown menu as a keyboard-friendly equivalent to drag-and-drop.
- **Needs Status correction column:** If an open Report has no Status, multiple Status labels, or an obsolete Status label (for example after a manual edit on github.com), the system never invents a fake Status. Instead, it surfaces the Report in a dedicated **Status needs correction** column (and with an inline warning in List and Detail views) until Maintenance staff pick a valid Status.

## Report Detail view

Click any Report to open its **Detail** view.

<AppScreenshot
  name="detail-maintenance"
  alt="Report Detail view showing decoded Report description, chronological timeline with Staff and Reporter comments, sidebar pickers, and Reporter contact controls"
  caption="The Detail view decodes canonical Report text cleanly, distinguishes Staff and Reporter comments, and places triage pickers and gated contact controls in the sidebar."
/>

### Triaging a Report (Maintenance staff & System admins)

From the sidebar you can update:

- **Status** — entering a Status with the `notify` flag emails the Reporter automatically.
- **Category & Location** — correct misclassified Reports (link-only; does not email the Reporter).
- **Priority** — set or clear internal Priority (private to Staff; never shown on the Status page).
- **Assignee** — assign a Staff member (the Status page shows only that someone is assigned, never their username).

### Commenting

Every comment posted on a Report is **visible to whoever holds the Status link** (rendered as plain text with a generic *Maintenance* label on the Status page). Treat all Report comments as Reporter-visible and avoid posting sensitive internal notes or personal data in comments.

### Closing and reopening Reports

- **Close report:** Choose one of three reasons — **Fixed**, **Rejected**, or **Duplicate** (duplicates prompt for the original Report number and post a reference note). Closing removes the open Status label and emails the Reporter with the reason.
- **Reopen report:** Reopens a closed Report, re-applies the Deployment's **Initial status**, and sends a single *Reopened* email to the Reporter.

### Revealing Reporter contact & Reissuing links

Because Reporter email addresses are never stored in GitHub, Maintenance staff use the gated **Reporter contact** panel in the sidebar when they need to reach a Reporter directly (for example, to schedule entry to an apartment) or hand over a lost link:

1. Click **Show contact** — the Worker re-checks your GitHub repository role and fetches the Reporter's email address, current Status link, and Allowlist note (if still listed) from Workers KV.
2. Click **Replace status link** to Reissue the link immediately if a Reporter reports a leak; the old link stops working and the new link is emailed to the Reporter without appearing on screen.

Viewers never see the Reporter contact panel, and the underlying Worker endpoints reject Viewer tokens with `403 Forbidden`.
