# The taxonomy is declared in Deployment configuration; the repo's labels are derived

Each Deployment declares its Taxonomy (the values of Category, Location, Priority and Status, with display names, colours, order and Status flags) in its own configuration. The reports repo's labels are created from it by a one-way sync, and the Worker serves the Taxonomy to the form and dashboard from configuration, ignoring labels outside it. A label carries only a name, a colour and a short description, so it can't express a priority order, a Status flag or a per-language display name.

## Considered Options

- **The repo's labels as the source of truth.** Rejected. Adding a value would be a click in GitHub's label UI, but order, flags and translations have nowhere to live, and anyone who can edit labels would change what the form offers.
- **Hybrid: labels define the value set, configuration adds order and flags.** Rejected. Two places to keep consistent, and drift would surface as a form offering a value that has no order or flags.

## Consequences

- Adding or renaming a value is a configuration change plus a sync, done by a System admin, not a label edit on github.com.
- A label edited or deleted by hand on github.com stays that way until the next sync. The form and dashboard are unaffected because they read configuration.
- The sync creates missing labels with the configured colour and corrects the colour of existing ones (colour only, never names), so a colour edited by hand on github.com reverts at the next sync.
- The sync is the Configuration save (SPEC §2.4): the Worker diffs the configuration against the repo's labels and creates or recolours them on every Admin save. Only its packaging as standalone tooling is implementation, out of scope for this design (ADR 0001 leaves Deployment tooling to implementation).
