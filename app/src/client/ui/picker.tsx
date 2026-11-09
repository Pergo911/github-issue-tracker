import { Select } from "@base-ui/react/select";
import { CheckIcon, TriangleDownIcon } from "@primer/octicons-react";

export interface PickerOption {
  value: string;
  label: string;
}

/**
 * A single-choice picker (docs/ui-github-look.md: "assignee and label pickers"): shadcn's Select on Base UI, so the
 * keyboard, the focus handling and the screen-reader roles are the library's, restyled to Primer's measurements
 * (32px control, 6px radius, overlay background and floating shadow). Strings come from the caller.
 */
export function Picker({
  labelledBy,
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
}: {
  /** The id of the element that names the control. */
  labelledBy: string;
  /** The chosen option's value, or `null` for none. */
  value: string | null;
  options: readonly PickerOption[];
  /** What the control shows while nothing is chosen. */
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select.Root
      items={options as PickerOption[]}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && next !== value) onChange(next);
      }}
    >
      <Select.Trigger
        aria-labelledby={labelledBy}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-secondary-border bg-secondary px-3 text-sm text-secondary-foreground hover:bg-secondary-hover disabled:opacity-60 data-[popup-open]:bg-secondary-hover"
      >
        <Select.Value placeholder={placeholder} className="min-w-0 truncate" />
        <Select.Icon className="shrink-0 text-muted-foreground">
          <TriangleDownIcon size={16} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <Select.Popup className="max-h-72 min-w-(--anchor-width) overflow-y-auto rounded-lg border bg-popover py-2 text-sm text-popover-foreground shadow-floating">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-accent"
                >
                  <Select.ItemIndicator>
                    <CheckIcon size={16} aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemText className="col-start-2">{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
