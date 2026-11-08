import { createBrowserRouter, useRouteError } from "react-router";
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
      { path: "report", lazy: () => import("../reporter/submission-placeholder.tsx") },
      { path: "staff/*", lazy: () => import("../staff/sign-in-placeholder.tsx") },
      { path: "*", Component: NotFound },
    ],
  },
]);
