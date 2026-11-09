import { AlertIcon } from "@primer/octicons-react";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

/** A flash banner in Primer's style: an icon and text in a bordered, tinted box. */
const alertVariants = cva("flex items-start gap-2 rounded-md border p-4 text-sm", {
  variants: {
    variant: {
      danger: "border-danger bg-danger-muted",
      attention: "border-attention bg-attention-muted",
      neutral: "border-border bg-muted",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Alert({
  variant,
  role,
  title,
  children,
}: VariantProps<typeof alertVariants> & {
  role?: "alert" | "status";
  title?: string;
  children?: ReactNode;
}) {
  const color = variant === "danger" ? "text-danger" : "text-attention";
  return (
    <div role={role} className={alertVariants({ variant })}>
      {variant === "danger" || variant === "attention" ? (
        <AlertIcon size={16} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
      ) : null}
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
