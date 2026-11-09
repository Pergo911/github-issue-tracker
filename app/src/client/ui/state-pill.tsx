import { IssueClosedIcon, IssueOpenedIcon, SkipIcon } from "@primer/octicons-react";
import { cn } from "@/lib/utils.ts";

export type PillState = "open" | "fixed" | "rejected";

const look: Record<PillState, string> = {
  open: "bg-state-open-emphasis",
  fixed: "bg-state-done-emphasis",
  rejected: "bg-state-neutral-emphasis",
};

/**
 * A Report's state pill (docs/ui-github-look.md, "Report state colours and icons"): 14px/600, `8px 12px`
 * padding, white text, fully rounded. Open is green, closed as fixed is purple, rejected and duplicate are
 * neutral grey. The wording comes from the caller, from the catalog.
 */
export function StatePill({
  state,
  label,
  className,
}: {
  state: PillState;
  label: string;
  className?: string;
}) {
  const Icon = state === "open" ? IssueOpenedIcon : state === "fixed" ? IssueClosedIcon : SkipIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm leading-none font-semibold text-on-emphasis",
        look[state],
        className,
      )}
      data-state-pill={state}
    >
      <Icon size={16} aria-hidden="true" />
      {label}
    </span>
  );
}
