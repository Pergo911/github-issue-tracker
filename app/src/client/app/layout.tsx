import { Link, Outlet } from "react-router";
import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";

/**
 * The frame every page shares: a skip link and the header, which shows the Organization's display name
 * and nothing of GitHub's identity (SPEC 2.7). Light or dark follows the OS through Primer's tokens.
 */
export function AppLayout() {
  const t = useT();
  const { displayName } = usePublicConfig();
  return (
    <>
      <a
        href="#main"
        className="sr-only bg-background p-3 text-link focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-md focus:border"
      >
        {t("a11y.skipToContent")}
      </a>
      <header className="border-b bg-muted">
        <div className="mx-auto flex max-w-page items-center px-4 py-4 md:px-6">
          <Link
            to="/"
            aria-label={t("header.homeLink", { organization: displayName })}
            className="text-base font-semibold hover:text-link"
          >
            {displayName}
          </Link>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-page px-4 py-6 outline-none md:px-6 md:py-8">
        <Outlet />
      </main>
    </>
  );
}
