import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RouterProvider } from "react-router/dom";
import { ApiError } from "@/api/call-api.ts";
import { ConfigProvider } from "@/config/context.tsx";
import { publicConfigQuery } from "@/config/queries.ts";
import { I18nProvider } from "@/i18n/context.tsx";
import { selectCatalog } from "@/i18n/select-catalog.ts";
import { FetchFailedScreen, LoadingScreen, NotConfiguredScreen } from "./boot-screens.tsx";
import { router } from "./router.tsx";

/**
 * The boot sequence (SPEC 2.5): the public configuration is requested before the first render
 * (main.tsx), then this shows a neutral loading state and one of three outcomes: the English
 * "not configured" screen, the English "could not load" screen with a retry, or the app in the
 * configured language.
 */
export function Boot() {
  const query = useQuery(publicConfigQuery);
  const [search] = useState(() => window.location.search);
  const language = query.data?.language;
  const catalog = useMemo(
    () => selectCatalog({ language, search, pseudoEnabled: __PSEUDO_LANGUAGE__ }),
    [language, search],
  );

  let content;
  if (query.data) {
    content = (
      <ConfigProvider config={query.data}>
        <RouterProvider router={router} />
      </ConfigProvider>
    );
  } else if (query.isError) {
    content =
      query.error instanceof ApiError && query.error.code === "not_configured" ? (
        <NotConfiguredScreen />
      ) : (
        <FetchFailedScreen onRetry={() => void query.refetch()} />
      );
  } else {
    content = <LoadingScreen />;
  }

  return <I18nProvider catalog={catalog}>{content}</I18nProvider>;
}
