import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type PartialCatalog, type Translator } from "@shared/i18n/index.ts";

const I18nContext = createContext<Translator | null>(null);

/**
 * Provides the translator for one catalog. Every visible and screen-reader string in a component
 * comes from `useT()`; no component carries its own English (SPEC 2.5).
 */
export function I18nProvider({ catalog, children }: { catalog: PartialCatalog; children: ReactNode }) {
  const t = useMemo(() => createTranslator(catalog), [catalog]);
  return <I18nContext value={t}>{children}</I18nContext>;
}

export function useT(): Translator {
  const t = useContext(I18nContext);
  if (t === null) throw new Error("useT must be used inside an I18nProvider");
  return t;
}
