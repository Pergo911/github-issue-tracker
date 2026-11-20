import { IssueOpenedIcon, KeyIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";

function EntryPoint({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex h-full items-start gap-3 rounded-md border bg-card p-4 hover:bg-muted"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex flex-col gap-1">
        <span className="text-base font-semibold text-link">{title}</span>
        <span className="text-muted-foreground">{description}</span>
      </span>
    </Link>
  );
}

/** The home page: the two entry points, in the configured language (SPEC 2.1, 2.5). */
export function Home() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(displayName);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t("home.heading")}</h1>
        <p className="text-muted-foreground">{t("home.intro")}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        <li>
          <EntryPoint
            to="/report"
            icon={<IssueOpenedIcon size={24} className="text-state-open" aria-hidden="true" />}
            title={t("home.submission.title")}
            description={t("home.submission.description")}
          />
        </li>
        <li>
          <EntryPoint
            to="/staff"
            icon={<KeyIcon size={24} className="text-muted-foreground" aria-hidden="true" />}
            title={t("home.staff.title")}
            description={t("home.staff.description")}
          />
        </li>
      </ul>
    </div>
  );
}
