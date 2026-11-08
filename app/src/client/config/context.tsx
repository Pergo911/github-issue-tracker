import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { PublicConfig } from "@shared/config/public.ts";
import { createFormatter, type Formatter } from "@shared/i18n/index.ts";

interface ConfigContextValue {
  config: PublicConfig;
  format: Formatter;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

/** Everything below this provider can rely on the Deployment's public configuration being loaded. */
export function ConfigProvider({
  config,
  children,
}: {
  config: PublicConfig;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      config,
      format: createFormatter({ language: config.language, timezone: config.timezone }),
    }),
    [config],
  );
  useEffect(() => {
    document.documentElement.lang = config.language;
  }, [config.language]);
  return <ConfigContext value={value}>{children}</ConfigContext>;
}

function useConfigContext(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (value === null) throw new Error("useConfig must be used inside a ConfigProvider");
  return value;
}

/** The public projection of the configuration (SPEC 2.4). */
export function usePublicConfig(): PublicConfig {
  return useConfigContext().config;
}

/** Dates and numbers in the Deployment's language and time zone. */
export function useFormatter(): Formatter {
  return useConfigContext().format;
}
