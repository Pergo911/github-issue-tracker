import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "@primer/octicons-react";
import { useState } from "react";
import type { Dimension } from "@shared/config/schema.ts";
import { DIMENSIONS } from "@shared/config/schema.ts";
import { useT } from "@/i18n/context.tsx";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { LabelPill } from "@/ui/label-pill.tsx";
import { TextField, useFieldError, type FieldErrors } from "./fields.tsx";
import {
  addValue,
  moveValue,
  removeValue,
  setInitialStatus,
  slugify,
  type Draft,
  type DraftValue,
} from "./model.ts";

const HEX = /^[0-9a-f]{6}$/i;

function ValueCard({
  dimension,
  index,
  count,
  value,
  errors,
  onChange,
  onMove,
  onInitial,
  onRemove,
}: {
  dimension: Dimension;
  index: number;
  count: number;
  value: DraftValue;
  errors: FieldErrors;
  onChange: (patch: Partial<DraftValue>) => void;
  onMove: (direction: -1 | 1) => void;
  onInitial: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const base = `${dimension}-${value.key}`;
  const path = `taxonomy.${dimension}.${index}`;
  const heading = t(`config.value.heading.${dimension}`, { number: index + 1 });
  const isStatus = dimension === "status";
  const blocked = value.initial
    ? t("config.value.removeInitial")
    : count === 1
      ? t("config.value.removeLast")
      : null;
  const pillText = value.name.trim() || value.id || t("config.value.preview");

  const askRemove = () => {
    // A value that exists only in this draft has no Reports wearing it: it simply goes.
    if (value.saved) setConfirming(true);
    else onRemove();
  };

  return (
    <li
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-taxonomy-value={`${dimension}:${value.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{heading}</h4>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t("config.value.moveUp")}: ${heading}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t("config.value.moveDown")}: ${heading}`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t("config.value.remove")}: ${heading}`}
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={askRemove}
          >
            <TrashIcon size={16} />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          id={`${base}-name`}
          label={t("config.value.name")}
          errors={errors}
          path={`${path}.name`}
          value={value.name}
          onChange={(event) => {
            const name = event.target.value;
            // The identifier follows the name until it is saved or typed by hand.
            const follows = !value.saved && value.id === slugify(value.name);
            onChange(follows ? { name, id: slugify(name) } : { name });
          }}
        />
        <TextField
          id={`${base}-id`}
          label={t("config.value.id")}
          hint={value.saved ? t("config.value.id.fixed") : t("config.value.id.hint")}
          errors={errors}
          path={`${path}.id`}
          value={value.id}
          readOnly={value.saved}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange({ id: event.target.value })}
        />
        <div className="flex flex-col gap-1.5">
          <TextField
            id={`${base}-color`}
            label={t("config.value.color")}
            hint={t("config.value.color.hint")}
            errors={errors}
            path={`${path}.color`}
            value={value.color}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange({ color: event.target.value.replace(/^#/, "") })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{t("config.value.preview")}</span>
        <LabelPill text={pillText} color={HEX.test(value.color) ? value.color : null} />
      </div>
      {isStatus ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="initial-status"
              checked={value.initial}
              onChange={onInitial}
              className="size-4"
            />
            {t("config.value.status.initial")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.notify}
              onChange={(event) => onChange({ notify: event.target.checked })}
              className="size-4"
            />
            {t("config.value.status.notify")}
          </label>
        </div>
      ) : null}
      {confirming ? (
        <Alert variant="attention" role="alert">
          <p>{t("config.value.removeWarning", { name: value.name || value.id })}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
              {t("config.value.removeConfirm")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              {t("config.value.removeCancel")}
            </Button>
          </div>
        </Alert>
      ) : null}
    </li>
  );
}

function DimensionSection({
  dimension,
  draft,
  errors,
  update,
}: {
  dimension: Dimension;
  draft: Draft;
  errors: FieldErrors;
  update: (change: (draft: Draft) => void) => void;
}) {
  const t = useT();
  const list = draft.taxonomy[dimension];
  const listError = useFieldError(errors, `taxonomy.${dimension}`);
  const hint =
    dimension === "priority"
      ? t("config.dimension.priority.hint")
      : dimension === "status"
        ? t("config.dimension.status.hint")
        : null;
  const set = (next: DraftValue[]) =>
    update((target) => {
      target.taxonomy[dimension] = next;
    });

  return (
    <section aria-labelledby={`dimension-${dimension}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={`dimension-${dimension}`} className="text-base font-semibold">
          {t(`config.dimension.${dimension}`)}
        </h3>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        {listError ? <p className="text-sm font-medium text-danger">{listError}</p> : null}
      </div>
      <ul className="flex flex-col gap-3">
        {list.map((value, index) => (
          <ValueCard
            key={value.key}
            dimension={dimension}
            index={index}
            count={list.length}
            value={value}
            errors={errors}
            onChange={(patch) =>
              set(list.map((item) => (item === value ? { ...item, ...patch } : item)))
            }
            onMove={(direction) => set(moveValue(list, index, direction))}
            onInitial={() => set(setInitialStatus(list, value.key))}
            onRemove={() => set(removeValue(list, value.key))}
          />
        ))}
      </ul>
      <div>
        <Button type="button" variant="secondary" onClick={() => set(addValue(list))}>
          {t("config.value.add")}
        </Button>
      </div>
    </section>
  );
}

/**
 * The Taxonomy editor (SPEC 2.3, 2.4): for each of the four dimensions, add values, edit display names, recolour
 * with a live label-pill preview (GitHub's own formula, in the current theme), reorder, and remove. An identifier
 * is fixed once saved. Exactly one Status is initial, and the UI will not let that change.
 */
export function TaxonomyEditor({
  draft,
  errors,
  update,
}: {
  draft: Draft;
  errors: FieldErrors;
  update: (change: (draft: Draft) => void) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">{t("config.taxonomy.intro")}</p>
      {DIMENSIONS.map((dimension) => (
        <DimensionSection
          key={dimension}
          dimension={dimension}
          draft={draft}
          errors={errors}
          update={update}
        />
      ))}
    </div>
  );
}
