import type { ComponentProps } from "react";
import { useT } from "@/i18n/context.tsx";
import { Field, describedBy } from "@/ui/field.tsx";
import { Input, Select, Textarea } from "@/ui/input.tsx";

/** The refused fields of the last save, by path (`taxonomy.category.2.id`) and the code to say why. */
export type FieldErrors = Readonly<Record<string, string>>;

/** The message for the field at `path`, in the catalog, or `undefined` when the field is fine. */
export function useFieldError(errors: FieldErrors, path: string): string | undefined {
  const t = useT();
  const code = errors[path];
  return code === undefined ? undefined : t(`config.error.${code}` as "config.error.invalid");
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string | undefined;
  errors: FieldErrors;
  path: string;
}

/** A labelled text input with its hint and the error of the last save. */
export function TextField({
  id,
  label,
  hint,
  errors,
  path,
  ...input
}: FieldProps & Omit<ComponentProps<"input">, "id" | "className">) {
  const error = useFieldError(errors, path);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Input {...describedBy(id, { hint: Boolean(hint), error: Boolean(error) })} {...input} />
    </Field>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  errors,
  path,
  rows = 4,
  ...input
}: FieldProps & Omit<ComponentProps<"textarea">, "id" | "className">) {
  const error = useFieldError(errors, path);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Textarea
        {...describedBy(id, { hint: Boolean(hint), error: Boolean(error) })}
        rows={rows}
        {...input}
      />
    </Field>
  );
}

export function SelectField({
  id,
  label,
  hint,
  errors,
  path,
  ...input
}: FieldProps & Omit<ComponentProps<"select">, "id" | "className">) {
  const error = useFieldError(errors, path);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Select {...describedBy(id, { hint: Boolean(hint), error: Boolean(error) })} {...input} />
    </Field>
  );
}
