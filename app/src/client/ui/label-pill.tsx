import { cn } from "@/lib/utils.ts";
import { labelColorVars } from "./label-color.ts";

/**
 * A label pill in GitHub's own formula (docs/ui-github-look.md): the colour is the value's configured hex, and
 * the readable text, border and dark-mode tint are worked out in CSS (`.label-pill` in theme.css) from the
 * channel variables set here. An unset colour is the fixed neutral grey.
 */
export function LabelPill({
  text,
  color,
  className,
}: {
  text: string;
  color: string | null;
  className?: string;
}) {
  return (
    <span className={cn("label-pill", className)} style={labelColorVars(color)} data-label-pill="">
      {text}
    </span>
  );
}
