import { Accessibility, KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { CommentIcon, GrabberIcon } from "@primer/octicons-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import type { PublicConfig } from "@shared/config/public.ts";
import type { Translator } from "@shared/i18n/index.ts";
import { useFormatter } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { cn } from "@/lib/utils.ts";
import { LabelPill } from "@/ui/label-pill.tsx";
import { Picker } from "@/ui/picker.tsx";
import { boardColumns, CORRECTION_COLUMN, type BoardColumn } from "./board-model.ts";
import type { ReportRow } from "./model.ts";
import type { ReporterScan } from "./reporter-comments.ts";

type Taxonomy = PublicConfig["taxonomy"];

interface CardData {
  title: string;
  /** The column the card sits in now. */
  column: string;
}
interface ColumnData {
  name: string;
}

function CardBody({
  row,
  now,
  scan,
  control,
}: {
  row: ReportRow;
  now: number;
  /** The scan's result, or `undefined` while the Reporter comments are unknown. */
  scan: ReporterScan | undefined;
  control: ReactNode;
}) {
  const t = useT();
  const format = useFormatter();
  const found = scan?.[row.number];
  const chips = row.pills.filter((pill) => pill.dimension !== "status");
  return (
    <>
      <div className="flex items-start gap-1">
        {control}
        <Link
          to={`/staff/reports/${row.number}`}
          className="min-w-0 text-sm font-medium break-words hover:text-link hover:underline"
          data-report-title=""
        >
          {row.title}
        </Link>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((pill) => (
            <LabelPill key={`${pill.dimension}:${pill.text}`} text={pill.text} color={pill.color} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("reports.row.meta", {
            number: row.number,
            age: format.relativeTime(row.createdAt, now),
          })}
        </span>
        {found ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-0.5 font-medium text-link"
            data-reporter-mark=""
          >
            <CommentIcon size={12} aria-hidden="true" />
            {t("reports.reporter.mark", { count: found.count })}
          </span>
        ) : null}
      </div>
      {row.assignees.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          {t("reports.row.assignedTo", { login: row.assignees.join(", ") })}
        </div>
      ) : null}
    </>
  );
}

const cardClass =
  "flex flex-col gap-2 rounded-md border bg-card p-2 shadow-resting focus-within:ring-1 focus-within:ring-accent-emphasis";

/** What a Viewer sees: the card, with nothing to move it by. */
function StaticCard({
  row,
  now,
  scan,
}: {
  row: ReportRow;
  now: number;
  scan: ReporterScan | undefined;
}) {
  return (
    <li className={cardClass} data-report={row.number}>
      <CardBody row={row} now={now} scan={scan} control={null} />
    </li>
  );
}

/**
 * A card Maintenance staff can move: by the grip (mouse, touch or keyboard, through `@dnd-kit/react`) or by its
 * Status menu, which is the primary accessible path (SPEC 2.4, 2.6). Both call the same `onMove`.
 */
function MovableCard({
  row,
  column,
  now,
  scan,
  taxonomy,
  onMove,
}: {
  row: ReportRow;
  column: string;
  now: number;
  scan: ReporterScan | undefined;
  taxonomy: Taxonomy;
  onMove: (number: number, status: string) => void;
}) {
  const t = useT();
  const menuId = useId();
  const { ref, handleRef, isDragging } = useDraggable<CardData>({
    id: row.number,
    type: "card",
    data: { title: row.title, column },
  });
  return (
    <li
      ref={ref}
      className={cn(cardClass, isDragging && "border-accent-emphasis shadow-floating")}
      data-report={row.number}
    >
      <CardBody
        row={row}
        now={now}
        scan={scan}
        control={
          <button
            ref={handleRef}
            type="button"
            aria-label={t("board.card.grip", { title: row.title })}
            aria-roledescription={t("board.card.roleDescription")}
            className="-ml-1 inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-accent-emphasis active:cursor-grabbing"
            data-grip=""
          >
            <GrabberIcon size={16} aria-hidden="true" />
          </button>
        }
      />
      <span id={menuId} className="sr-only">
        {t("board.card.menu", { title: row.title })}
      </span>
      <Picker
        labelledBy={menuId}
        value={row.status}
        placeholder={t("board.card.choose")}
        options={taxonomy.status.map((value) => ({ value: value.id, label: value.name }))}
        onChange={(status) => onMove(row.number, status)}
      />
    </li>
  );
}

function Column({
  column,
  name,
  children,
  droppable,
}: {
  column: BoardColumn;
  name: string;
  children: ReactNode;
  droppable: boolean;
}) {
  const t = useT();
  const { ref, isDropTarget } = useDroppable<ColumnData>({
    id: column.id,
    type: "column",
    accept: "card",
    disabled: !droppable,
    data: { name },
  });
  return (
    <section
      ref={ref}
      aria-label={name}
      data-column={column.id}
      className={cn(
        "flex w-56 shrink-0 flex-col gap-2 rounded-md border bg-muted p-2",
        isDropTarget && "border-accent-emphasis ring-1 ring-accent-emphasis",
      )}
    >
      <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
        {name}
        <span
          className="rounded-full bg-neutral-muted px-1.5 py-0.5 text-xs font-semibold"
          aria-label={t("board.column.count", { count: column.rows.length })}
        >
          {column.rows.length}
        </span>
      </h2>
      {children}
    </section>
  );
}

/** The live-region announcements, from the catalog (SPEC 2.6). */
function announcements(t: Translator) {
  type Ev = { operation: { source: unknown; target: unknown }; canceled?: boolean };
  const title = (ev: Ev) => (ev.operation.source as { data?: CardData } | null)?.data?.title ?? "";
  const columnOf = (value: unknown) => (value as { data?: ColumnData } | null)?.data?.name ?? "";
  return {
    dragstart: (ev: Ev) => t("board.drag.start", { title: title(ev) }),
    dragover: (ev: Ev) =>
      ev.operation.target
        ? t("board.drag.over", { title: title(ev), column: columnOf(ev.operation.target) })
        : undefined,
    dragend: (ev: Ev) =>
      ev.canceled
        ? t("board.drag.cancel", { title: title(ev) })
        : ev.operation.target
          ? t("board.drag.drop", { title: title(ev), column: columnOf(ev.operation.target) })
          : t("board.drag.nowhere", { title: title(ev) }),
  };
}

/**
 * The Board (SPEC 2.4): a Kanban view over the open Reports, one column per configured Status in order plus the
 * correction column. Maintenance staff move cards; a Viewer sees the same Board with nothing to move by. The
 * correction column is a place Reports leave, never one they are dropped on: the Status is the thing being set.
 */
export function Board({
  rows,
  taxonomy,
  now,
  scan,
  canMove,
  onMove,
}: {
  rows: readonly ReportRow[];
  taxonomy: Taxonomy;
  now: number;
  scan: ReporterScan | undefined;
  canMove: boolean;
  onMove: (number: number, status: string) => void;
}) {
  const t = useT();
  const columns = boardColumns(rows, taxonomy);
  const nameOf = (id: string) =>
    id === CORRECTION_COLUMN
      ? t("board.column.correction")
      : (taxonomy.status.find((value) => value.id === id)?.name ?? id);

  return (
    <DragDropProvider
      // One arrow press carries the card about one column (a column is 14rem plus the 12px gap).
      sensors={[PointerSensor, KeyboardSensor.configure({ offset: { x: 236, y: 40 } })]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== Accessibility),
        Accessibility.configure({
          announcements: announcements(t) as never,
          screenReaderInstructions: { draggable: t("board.drag.instructions") },
        }),
      ]}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source, target } = event.operation;
        if (!source || !target || target.id === CORRECTION_COLUMN) return;
        if ((source.data as CardData).column === target.id) return;
        onMove(Number(source.id), String(target.id));
      }}
    >
      <div className="relative flex items-start gap-3 overflow-x-auto pb-2" data-board="">
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            name={nameOf(column.id)}
            droppable={canMove && column.id !== CORRECTION_COLUMN}
          >
            {column.rows.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">{t("board.column.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {column.rows.map((row) =>
                  canMove ? (
                    <MovableCard
                      key={row.number}
                      row={row}
                      column={column.id}
                      now={now}
                      scan={scan}
                      taxonomy={taxonomy}
                      onMove={onMove}
                    />
                  ) : (
                    <StaticCard key={row.number} row={row} now={now} scan={scan} />
                  ),
                )}
              </ul>
            )}
          </Column>
        ))}
      </div>
    </DragDropProvider>
  );
}
