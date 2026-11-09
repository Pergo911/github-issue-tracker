import {
  CommentIcon,
  IssueClosedIcon,
  IssueReopenedIcon,
  PersonIcon,
  SkipIcon,
  TagIcon,
} from "@primer/octicons-react";
import type { ReactNode } from "react";
import type { PublicConfig } from "@shared/config/public.ts";
import type { StatusTimelineItem } from "@shared/status/view.ts";
import { useFormatter, usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";

type Taxonomy = PublicConfig["taxonomy"];

function nameOf(taxonomy: Taxonomy, dimension: "status" | "category" | "location", id: string) {
  return taxonomy[dimension].find((value) => value.id === id)?.name ?? id;
}

/** The round badge on the timeline's line (docs/ui-github-look.md): 32px, 2px canvas border, muted fill. */
function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-background bg-muted text-muted-foreground">
      {children}
    </span>
  );
}

function EventRow({ item }: { item: Exclude<StatusTimelineItem, { kind: "comment" }> }) {
  const t = useT();
  const format = useFormatter();
  const { taxonomy } = usePublicConfig();
  let icon: ReactNode = <TagIcon size={16} aria-hidden="true" />;
  let text: string;
  switch (item.kind) {
    case "status":
      text = t("status.event.status", { status: nameOf(taxonomy, "status", item.id) });
      break;
    case "category":
      text = t("status.event.category", { category: nameOf(taxonomy, "category", item.id) });
      break;
    case "location":
      text = t("status.event.location", { location: nameOf(taxonomy, "location", item.id) });
      break;
    case "closed":
      icon =
        item.reason === "fixed" ? (
          <IssueClosedIcon size={16} aria-hidden="true" />
        ) : (
          <SkipIcon size={16} aria-hidden="true" />
        );
      text = t(`status.event.closed.${item.reason}`);
      break;
    case "reopened":
      icon = <IssueReopenedIcon size={16} aria-hidden="true" />;
      text = t("status.event.reopened");
      break;
    case "assigned":
      icon = <PersonIcon size={16} aria-hidden="true" />;
      text = t("status.event.assigned");
      break;
    case "unassigned":
      icon = <PersonIcon size={16} aria-hidden="true" />;
      text = t("status.event.unassigned");
      break;
  }
  return (
    <li className="relative flex items-center gap-3 py-4" data-timeline-item={item.kind}>
      <Badge>{icon}</Badge>
      <p className="min-w-0 text-sm break-words">
        {text} <span className="text-muted-foreground">· {format.dateTime(item.at)}</span>
      </p>
    </li>
  );
}

function CommentRow({ item }: { item: Extract<StatusTimelineItem, { kind: "comment" }> }) {
  const t = useT();
  const format = useFormatter();
  const label =
    item.author === "reporter" ? t("status.comment.reporter") : t("status.comment.staff");
  return (
    <li className="relative flex gap-3 py-4" data-timeline-item="comment" data-author={item.author}>
      <Badge>
        <CommentIcon size={16} aria-hidden="true" />
      </Badge>
      <div className="min-w-0 flex-1 rounded-md border">
        <div className="flex flex-wrap items-baseline gap-x-2 rounded-t-md border-b border-border-subtle bg-muted py-1 pr-1 pl-4 text-sm text-muted-foreground">
          <h3 className="font-semibold text-foreground">{label}</h3>
          <span>· {format.dateTime(item.at)}</span>
        </div>
        <p className="m-4 text-sm break-words whitespace-pre-wrap">{item.text}</p>
      </div>
    </li>
  );
}

/**
 * The progress history and the comments, in one chronological timeline (docs/ui-github-look.md, "Comment box
 * and timeline"): a 2px line, round badges, the localized Reporter or Staff label and never an avatar or a login
 * (SPEC 4.3). Timestamps are in the Deployment's time zone.
 */
export function StatusTimeline({ items }: { items: readonly StatusTimelineItem[] }) {
  return (
    <ol className="relative flex flex-col before:absolute before:top-0 before:bottom-0 before:left-4 before:w-0.5 before:bg-border-subtle">
      {items.map((item, index) =>
        item.kind === "comment" ? (
          <CommentRow key={index} item={item} />
        ) : (
          <EventRow key={index} item={item} />
        ),
      )}
    </ol>
  );
}
