import { useId, useState } from "react";
import type { CloseReason } from "@shared/status/view.ts";
import { useT } from "@/i18n/context.tsx";
import { ConfirmDialog } from "@/ui/dialog.tsx";
import { Input } from "@/ui/input.tsx";
import type { CloseChoice } from "./mutations.ts";

const REASONS: readonly CloseReason[] = ["fixed", "rejected", "duplicate"];

/**
 * The close dialog (SPEC 2.4): fixed, rejected, or a duplicate of an original Report whose number is asked for.
 * The caller makes the one PATCH; the dialog only collects the choice.
 */
export function CloseDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (choice: CloseChoice) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<CloseReason>("fixed");
  const [original, setOriginal] = useState("");
  const [invalid, setInvalid] = useState(false);
  const name = useId();
  const originalId = useId();

  function confirm() {
    if (reason !== "duplicate") {
      onConfirm({ reason });
      return;
    }
    const duplicateOf = Number(original.trim());
    if (!Number.isInteger(duplicateOf) || duplicateOf < 1) {
      setInvalid(true);
      return;
    }
    onConfirm({ reason, duplicateOf });
  }

  return (
    <ConfirmDialog
      open={open}
      title={t("detail.close.title")}
      description={t("detail.close.description")}
      confirmLabel={busy ? t("detail.close.closing") : t("detail.close.confirm")}
      cancelLabel={t("detail.close.cancel")}
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0" disabled={busy}>
        <legend className="mb-1 text-sm font-semibold">{t("detail.close.reason")}</legend>
        {REASONS.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
                setInvalid(false);
              }}
              className="accent-accent-emphasis"
            />
            {t(`detail.close.reason.${value}`)}
          </label>
        ))}
        {reason === "duplicate" ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <label htmlFor={originalId} className="text-sm font-semibold">
              {t("detail.close.original")}
            </label>
            <Input
              id={originalId}
              inputMode="numeric"
              value={original}
              onChange={(event) => {
                setOriginal(event.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${originalId}-error` : undefined}
            />
            {invalid ? (
              <p id={`${originalId}-error`} className="text-xs font-medium text-danger">
                {t("detail.close.originalInvalid")}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </ConfirmDialog>
  );
}
