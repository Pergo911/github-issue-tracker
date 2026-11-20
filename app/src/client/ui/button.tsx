import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils.ts";

/**
 * shadcn's Button on Base UI, restyled to Primer's measurements (docs/ui-github-look.md): 32px controls,
 * 14px/500 text, 12px padding, 6px radius. Theme tokens only. A copied shadcn component must be restyled
 * this way and must not carry its own English.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-sm font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "border-secondary-border bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        ghost: "text-foreground hover:bg-accent",
        destructive: "bg-destructive text-on-emphasis hover:bg-destructive/90",
        link: "text-link hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-3 text-xs",
        lg: "h-10 px-4",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
