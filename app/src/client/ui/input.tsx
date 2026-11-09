import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * The text controls, to Primer's measurements (docs/ui-github-look.md): 32px high, 1px control border, 6px
 * radius, 12px padding, 14px text. Native elements, so the browser's own keyboard and autofill work.
 */
const control =
  "w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60 read-only:bg-muted aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn(control, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(control, "min-h-32 resize-y py-1.5 leading-normal", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="select" className={cn(control, "h-8 pr-2", className)} {...props} />;
}
