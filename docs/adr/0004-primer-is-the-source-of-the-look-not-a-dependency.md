# Primer is the source of the UI's look, not a runtime dependency

The UI on all three surfaces looks like GitHub's own interface. We take the look from Primer's design tokens (`@primer/primitives`, imported as CSS variables), its icons (`@primer/octicons-react`) and measured layout conventions ([`docs/ui-github-look.md`](../ui-github-look.md)), and build the components with Tailwind 4 and shadcn/ui on Base UI. `@primer/react` is not used: it has no localization mechanism, and the reference Deployment must be Hungarian on every surface, screen-reader text included (SPEC §2.5).

## Considered Options

- **`@primer/react` (GitHub's own components).** Rejected. Of the ~28 components the app needs, 14 can show hard-coded English, 8 of them on normal paths, and none of those strings has a prop to change it: SelectPanel's visible Cancel and Save buttons, Dialog's close button, Banner's dismiss, Token's remove, the UnderlineNav and DataTable labels, the filter-list live-region announcements. Keeping one language would mean patching about 15 literals on every release (Primer ships minors weekly) or avoiding the components that matter most. It also has no list row, comment box, board, filter bar or toast, so those are hand-built either way, its CSS is unlayered and fights Tailwind utilities, and it adds about 145 kB gzip.
- **Primer React for the components that are clean, our own for the rest.** Rejected. Two component systems, with portal, focus-trap and layering conflicts between Primer's overlays and Base UI's.
- **Tailwind and shadcn with a neutral theme of our own.** Rejected: the product owner asked for GitHub's look, and Primer's tokens give it for free.

## Consequences

- Fidelity of the hand-built pieces (list row, state pill, comment box, board, filter bar, pickers) is maintained by hand against the measurements in `docs/ui-github-look.md`.
- Components use theme tokens only, never a hard-coded colour, so light and dark both hold. Every visible or screen-reader string in a component comes from the catalog (SPEC §2.5); a copied shadcn component's built-in English text (a close button's `sr-only` label, say) is replaced when it is copied in.
- Primer's code, tokens and icons are MIT. The look itself (trade dress) has no clearance either way and is an accepted risk. GitHub's marks are never used (SPEC §2.7).
- Revisit if `@primer/react` gains a localization mechanism.
