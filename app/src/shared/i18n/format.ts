import type { Language } from "../config/schema.ts";

/** Each shipped language's conventions. English is British: day before month, 24-hour clock. */
const LOCALES: Record<Language, string> = { en: "en-GB", hu: "hu-HU" };

export interface FormatterSettings {
  language: Language;
  /** An IANA time zone name, from the configuration (SPEC 2.5). */
  timezone: string;
}

/** Dates and numbers come from `Intl`, in the Deployment's language and time zone. */
export function createFormatter({ language, timezone }: FormatterSettings) {
  const locale = LOCALES[language];
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });
  const number = new Intl.NumberFormat(locale);
  return {
    dateTime: (value: Date | string | number) => dateTime.format(new Date(value)),
    date: (value: Date | string | number) => date.format(new Date(value)),
    number: (value: number) => number.format(value),
  };
}

export type Formatter = ReturnType<typeof createFormatter>;
