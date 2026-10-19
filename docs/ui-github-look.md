# GitHub's look: tokens and conventions for the UI

The decision and its reasons are in [SPEC §2.7](../SPEC.md) and [ADR 0004](./adr/0004-primer-is-the-source-of-the-look-not-a-dependency.md). This file holds what the hand-built pieces follow. The tokens themselves come from the pinned `@primer/primitives` package, never from the hex values below, which are for orientation only (read from `@primer/primitives` 11.10 and from github.com's published CSS, not from computed styles).

## Setup

- Install `@primer/primitives` and import `dist/css/primitives.css` (size, spacing, radius, typography, motion) plus `dist/css/functional/themes/light.css` and `dark.css`. The themes are not part of `primitives.css`.
- The variables exist only under Primer's theme selectors, so `index.html` puts these on `<html>`: `data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"`. `auto` follows `prefers-color-scheme`, which Electron follows from the OS. No toggle. The colour-blind, tritanopia, dimmed and high-contrast theme files exist in the same folder and are an additive upgrade.
- Not used: `@primer/react`, `@primer/css` (maintenance mode), `@primer/tailwind-config` (it replaces Tailwind's palette and clashes with shadcn's names).
- Icons: `@primer/octicons-react` (MIT). Icons take their accessible name from the consumer, so pass it from the catalog. Never import `MarkGithubIcon` or `LogoGithubIcon`.
- Fonts: system stack only. github.com's app UI loads no Mona Sans; use the stack without it: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"`; monospace `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`.

## shadcn variables aliased to Primer tokens

One theme file defines shadcn's variables on `:root` as aliases and keeps the standard `@theme inline { --color-background: var(--background); … }`. There is no `.dark` block: Primer's variables flip with the theme attributes.

| shadcn variable | Primer token |
| --- | --- |
| background / foreground | `bgColor-default` / `fgColor-default` |
| card, card-foreground | `bgColor-default`, `fgColor-default` |
| popover | `overlay-bgColor` |
| primary / primary-foreground | `button-primary-bgColor-rest` / `button-primary-fgColor-rest` |
| secondary | `button-default-bgColor-rest` / `button-default-fgColor-rest` |
| muted / muted-foreground | `bgColor-muted` / `fgColor-muted` |
| accent (hover surface) | `control-transparent-bgColor-hover` |
| destructive | `bgColor-danger-emphasis` |
| border / input | `borderColor-default` / `control-borderColor-rest` |
| ring | `focus-outlineColor` |
| radius | `borderRadius-medium` |

Links and focus use `fgColor-accent`, not shadcn's `accent` (which is a hover surface). shadcn derives `radius-sm/md/lg` from the base; override them to Primer's 3 / 6 / 12px. Tokens shadcn has no name for (issue-state colours, shadows, the label-pill variables) are added to the same theme file.

## Orientation values

| Role | Light | Dark |
| --- | --- | --- |
| canvas `bgColor-default` | `#ffffff` | `#0d1117` |
| subtle `bgColor-muted` | `#f6f8fa` | `#151b23` |
| border `borderColor-default` | `#d1d9e0` | `#3d444d` |
| text `fgColor-default` / muted | `#1f2328` / `#59636e` | `#f0f6fc` / `#9198a1` |
| link and accent | `#0969da` | `#4493f8` |
| success (open) fg / emphasis | `#1a7f37` / `#1f883d` | `#3fb950` / `#238636` |
| danger fg / emphasis | `#d1242f` / `#cf222e` | `#f85149` / `#da3633` |
| attention fg | `#9a6700` | `#d29922` |
| done (purple) fg / emphasis | `#8250df` / `#8250df` | `#ab7df8` / `#8957e5` |
| neutral emphasis | `#59636e` | `#656c76` |
| button default bg / hover | `#f6f8fa` / `#eff2f5` | `#212830` / `#262c36` |
| button primary (green) rest | `#1f883d` | `#238636` |
| overlay bg / backdrop | `#ffffff` / `#c8d1da66` | `#010409` / `#21283066` |

Shadows (light): resting-small `0 1px 1px #1f23280a, 0 1px 2px #1f232808`; floating-small `0 0 0 1px #d1d9e040, 0 6px 12px -3px #25292e0a, 0 6px 18px #25292e1f`. Row hover is `bgColor-muted`; selected is `bgColor-accent-muted` plus a 1px ring in `borderColor-accent-emphasis`.

## Report state colours and icons

| State | Icon (Octicons) | Colour |
| --- | --- | --- |
| open | `IssueOpenedIcon` | green: `fgColor-open` for the icon, `bgColor-open-emphasis` for the pill |
| closed, fixed (`completed` or none) | `IssueClosedIcon` | purple: `fgColor-done`, pill `bgColor-done-emphasis` |
| closed, rejected (`not_planned`) or duplicate | `SkipIcon` | neutral grey: `fgColor-muted`, pill `bgColor-neutral-emphasis` |

This follows GitHub, which uses `done` purple for completed issues and neutral grey for not-planned ones. Duplicates share the grey look (§2.3 counts them as rejected); the pill's text names the reason from the catalog. The red `closed` token is for pull requests and is not used.

## Type, spacing, shape

- Body 14px, weight 400, line-height 1.5, bold 600. Small text 12px; title small 16px/600, medium 20px/600; issue title 32px at wide widths (26px on narrow), weight 400, line-height 1.25, with the `#<number>` in the muted colour.
- Spacing steps 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64px; stack gaps 8 / 16 / 24. Controls are 32px high by default (28 small, 40 large); buttons are 14px/500 with `0 12px` padding.
- Radius 3px small, 6px default, 12px for overlays and dialogs, full for pills. Borders 1px.
- Focus: `outline: 2px solid var(--focus-outlineColor); outline-offset: -2px`. Links have no underline until hover; in running text they stay underlined.
- Breakpoints 320 / 544 / 768 / 1012 / 1280 / 1400px.

## Label pills from one hex colour

GitHub's own formula. A small helper sets `--label-r/g/b` (0 to 255), `--label-h` (degrees) and `--label-s`, `--label-l` (plain 0 to 100 numbers) inline from the value's hex colour; the rest is CSS.

```css
.label {
  --perceived-lightness: calc((var(--label-r) * .2126 + var(--label-g) * .7152 + var(--label-b) * .0722) / 255);
  --lightness-switch: max(0, min(calc(1 / (var(--lightness-threshold) - var(--perceived-lightness))), 1));
  border: 1px solid transparent; border-radius: 2em; padding: 0 8px; font-size: 12px; font-weight: 500;
}
/* light mode */
.label {
  --lightness-threshold: .453; --border-threshold: .96;
  --border-alpha: max(0, min(calc((var(--perceived-lightness) - var(--border-threshold)) * 100), 1));
  background: rgb(var(--label-r), var(--label-g), var(--label-b));
  color: hsl(0deg, 0%, calc(var(--lightness-switch) * 100%));
  border-color: hsl(var(--label-h) calc(var(--label-s) * 1%) calc((var(--label-l) - 25) * 1%) / var(--border-alpha));
}
/* dark mode */
.label {
  --lightness-threshold: .6; --background-alpha: .18; --border-alpha: .3;
  --lighten-by: calc((var(--lightness-threshold) - var(--perceived-lightness)) * 100 * var(--lightness-switch));
  background: rgb(var(--label-r) var(--label-g) var(--label-b) / var(--background-alpha));
  color: hsl(var(--label-h) calc(var(--label-s) * 1%) calc((var(--label-l) + var(--lighten-by)) * 1%));
  border-color: hsl(var(--label-h) calc(var(--label-s) * 1%) calc((var(--label-l) + var(--lighten-by)) * 1%) / var(--border-alpha));
}
```

Scope the light and dark blocks with the same attribute and `prefers-color-scheme` selectors Primer's theme files use. An unset colour is the fixed neutral grey.

## Layout conventions for the hand-built pieces

**Issues-list row.** A grid: selection, status icon, title, metadata, actions; minimum height 32px, 4px gap, 8px top padding on the title. Title 16px/500 in the default text colour, accent plus underline on hover. Status icon 16px. Second line 12px muted: `#<number> · opened <age>`. Row hover `bgColor-muted`, 1px `borderColor-muted` between rows. The list sits in a box with a 1px `borderColor-default` border and 6px radius; its header is `bgColor-muted` with 16px padding.

**Report page.** Header: the title, then the state pill (14px/600, `8px 12px` padding, white text, fully rounded, colours above), then a meta row (12px muted, 12px vertical padding, 1px muted bottom border). Below, content and a 256px sidebar side by side with an 8px gap; each sidebar section has a 12px muted title.

**Comment box and timeline.** The box has a 1px `borderColor-default` border and 6px radius. Its header is `4px 4px 4px 16px` padding, 14px muted text, `bgColor-muted` background and a 1px `borderColor-muted` bottom border; the body has a 16px margin. The timeline item has 16px vertical padding and a 2px vertical line in `borderColor-muted`; its badge is a 32px circle with a 2px `bgColor-default` border, a `bgColor-muted` fill and a muted icon. On the public status page the header shows the localized Reporter or Staff label, never an avatar or login (SPEC §4.3).

**Board.** Padding `8px 16px`. A column has a 1px `borderColor-default` border, 6px radius, 8px padding and 8px gap (its background was not verified; start with `bgColor-muted`). The column header is the title plus a count pill (12px/600, `2px 6px` padding, 20px radius, `bgColor-neutral-muted`). A card has 8px padding, `overlay-bgColor` background, a 1px border, 6px radius, the resting-small shadow and `cursor: grab`; focus or selection adds a 1px accent ring. The drop marker is a 4px-high accent bar with 6px radius; the dragged ghost is half opacity with a medium shadow.

## What GitHub's own library would have given, and what we build

| Piece | How we build it |
| --- | --- |
| Buttons, inputs, selects, menus, dialogs, popovers, tabs, tables | shadcn components on Base UI, restyled with the aliased tokens, strings from the catalog |
| Issues-list row, state pill, label pill, comment box, timeline, filter bar, assignee and label pickers, toasts | hand-built in `client/ui/` to the measurements above |
| Kanban board | hand-built with `@dnd-kit/react`; the per-card status menu is the primary accessible path |
| Icons | Octicons, accessible names from the catalog |

## Not copied

GitHub's logo, the Octocat and the name "GitHub" as a brand (SPEC §2.7). "GitHub" appears only as a plain fact on the staff sign-in and device-code screens.
