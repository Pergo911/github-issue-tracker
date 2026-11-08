import type { PartialCatalog } from "./translate.ts";

/** The Hungarian catalog, a Partial of `en`. A test fails if it lacks a key, so the fallback is a fail-safe. */
export const hu = {
  "boot.loading": "Betöltés…",
  "boot.notConfigured.title": "A szolgáltatás még nincs beállítva",
  "boot.notConfigured.description":
    "A szolgáltatás üzemeltetői még nem fejezték be a beállítását. Kérjük, próbálja meg később.",
  "boot.fetchFailed.title": "A szolgáltatást nem sikerült betölteni",
  "boot.fetchFailed.description": "Ellenőrizze az internetkapcsolatot, majd próbálja újra.",
  "boot.retry": "Újrapróbálom",
  "a11y.skipToContent": "Ugrás a fő tartalomra",
  "header.homeLink": "{organization}: kezdőlap",
  "home.heading": "Hibabejelentés",
  "home.intro": "Jelentsen be egy hibát, vagy jelentkezzen be a bejelentések kezeléséhez.",
  "home.submission.title": "Hiba bejelentése",
  "home.submission.description":
    "Írja le a hibát. Olyan e-mail-címre van szükség, amely szerepel a bejelentők listáján.",
  "home.staff.title": "Munkatársi bejelentkezés",
  "home.staff.description": "Karbantartóknak és adminisztrátoroknak.",
  "placeholder.comingSoon": "Ez az oldal hamarosan elkészül.",
  "nav.backToHome": "Vissza a kezdőlapra",
  "notFound.title": "Az oldal nem található",
  "notFound.description": "Ezen a címen nincs semmi.",
} as const satisfies PartialCatalog;
