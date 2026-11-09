import type { ReactNode } from "react";

/** The ids a control needs to point at its hint and its error message. */
export function fieldIds(id: string) {
  return { control: id, hint: `${id}-hint`, error: `${id}-error` };
}

/** What a control sets so its hint and error are read with it, and so it reports a problem. */
export function describedBy(id: string, options: { hint?: boolean; error?: boolean }) {
  const ids = fieldIds(id);
  const parts = [options.hint ? ids.hint : null, options.error ? ids.error : null].filter(Boolean);
  return {
    id,
    ...(parts.length > 0 ? { "aria-describedby": parts.join(" ") } : {}),
    ...(options.error ? { "aria-invalid": true as const } : {}),
  };
}

/** A label, the control, an optional hint, an optional character counter and the field's error message. */
export function Field({
  id,
  label,
  hint,
  error,
  counter,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  counter?: string | undefined;
  children: ReactNode;
}) {
  const ids = fieldIds(id);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={ids.control} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      <div className="flex items-start justify-between gap-3 text-xs">
        <div className="flex flex-col gap-1">
          {hint ? (
            <p id={ids.hint} className="text-muted-foreground">
              {hint}
            </p>
          ) : null}
          {error ? (
            <p id={ids.error} className="font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
        {counter ? <span className="shrink-0 text-muted-foreground">{counter}</span> : null}
      </div>
    </div>
  );
}
