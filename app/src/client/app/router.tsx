import { createBrowserRouter, redirect, useRouteError } from "react-router";
import { FetchFailedScreen, LoadingScreen } from "./boot-screens.tsx";
import { AppLayout } from "./layout.tsx";
import { Home } from "./home.tsx";
import { NotFound } from "./not-found.tsx";

/** A route that failed to load, usually a chunk that could not be fetched: offer a reload. */
function RouteError() {
  useRouteError();
  return <FetchFailedScreen onRetry={() => window.location.reload()} />;
}

/**
 * React Router in Data mode, created once outside the React tree. Route modules are lazy: `reporter/`
 * and `staff/` are separate chunks, and a reporter never downloads `staff/`. A lazy module exports `Component`.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppLayout,
    HydrateFallback: LoadingScreen,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: Home },
      { path: "report", lazy: () => import("../reporter/submission-form.tsx") },
      {
        // Everything under /staff is the `staff/` chunk, loaded only when a member goes there (SPEC 2.6).
        path: "staff",
        lazy: () => import("../staff/layout.tsx"),
        children: [
          { index: true, loader: () => redirect("/staff/reports") },
          { path: "reports", lazy: () => import("../staff/reports/list-page.tsx") },
          { path: "allowlist", lazy: () => import("../staff/allowlist/allowlist-page.tsx") },
          {
            path: "configuration",
            lazy: () => import("../staff/configuration/configuration-page.tsx"),
          },
          { path: "*", Component: NotFound },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
]);
