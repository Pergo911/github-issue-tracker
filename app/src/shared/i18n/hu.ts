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
  "api.error.not_configured": "A szolgáltatás még nincs beállítva.",
  "api.error.invalid_request":
    "Néhány adatot nem fogadtunk el. Ellenőrizze őket, majd próbálja újra.",
  "api.error.not_found": "Ez nem található.",
  "api.error.rate_limited": "Túl sok próbálkozás. Kérjük, várjon egy kicsit, majd próbálja újra.",
  "api.error.internal_error": "Hiba történt a szolgáltatás oldalán. Kérjük, próbálja meg később.",
  "api.error.unauthorized": "Nincs bejelentkezve. Jelentkezzen be GitHubbal, majd próbálja újra.",
  "api.error.forbidden": "A GitHub-fiókjának nincs hozzáférése ehhez.",
  "api.error.upstream_unavailable":
    "A hozzáférés ellenőrzéséhez nem sikerült elérni a GitHubot. Kérjük, próbálja meg később.",
  "api.error.network_error": "A szolgáltatás nem érhető el. Ellenőrizze az internetkapcsolatot.",
  "api.error.invalid_response":
    "A szolgáltatás váratlan választ adott. Kérjük, próbálja meg később.",
} as const satisfies PartialCatalog;
