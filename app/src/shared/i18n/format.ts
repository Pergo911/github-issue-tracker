import type { Language } from "../config/schema.ts";

/** Each shipped language's conventions. English is British: day before month, 24-hour clock. */
const LOCALES: Record<Language, string> = { en: "en-GB", hu: "hu-HU" };

export interface FormatterSettings {
  language: Language;
  /** An IANA time zone name, from the configuration (SPEC 2.5). */
  timezone: string;
}

const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

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
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return {
    dateTime: (value: Date | string | number) => dateTime.format(new Date(value)),
    date: (value: Date | string | number) => date.format(new Date(value)),
    number: (value: number) => number.format(value),
    /** How long before `now` a moment was ("3 days ago"): the largest whole unit; never in the future. */
    relativeTime: (value: Date | string | number, now: number = Date.now()) => {
      const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
      if (seconds < 60) return relative.format(0, "second");
      for (const [unit, size] of RELATIVE_UNITS) {
        if (seconds >= size * 1.0) return relative.format(-Math.floor(seconds / size), unit);
      }
      return relative.format(0, "second");
    },
  };
}

export type Formatter = ReturnType<typeof createFormatter>;
