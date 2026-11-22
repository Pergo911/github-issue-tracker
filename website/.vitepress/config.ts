import { defineConfig } from "vitepress";

const REPO_URL = "https://github.com/Pergo911/github-issue-tracker";

export default defineConfig({
  base: "/github-issue-tracker/",
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/github-issue-tracker/logo.svg" }],
    ["meta", { name: "theme-color", content: "#1f883d" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [{ icon: "github", link: REPO_URL }],
    search: {
      provider: "local",
      options: {
        locales: {
          hu: {
            translations: {
              button: {
                buttonText: "Keresés",
                buttonAriaLabel: "Keresés a dokumentációban",
              },
              modal: {
                displayDetails: "Részletek megjelenítése",
                resetButtonTitle: "Keresés törlése",
                backButtonTitle: "Bezárás",
                noResultsText: "Nincs találat erre:",
                footer: {
                  selectText: "kiválasztás",
                  selectKeyAriaLabel: "Enter",
                  navigateText: "navigáció",
                  navigateUpKeyAriaLabel: "Fel nyíl",
                  navigateDownKeyAriaLabel: "Le nyíl",
                  closeText: "bezárás",
                  closeKeyAriaLabel: "Escape",
                },
              },
            },
          },
        },
      },
    },
  },

  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "Issue Tracker",
      description:
        "Fault-reporting and maintenance-tracking system backed by a private GitHub Organization repository, Cloudflare Workers, and a Windows desktop app.",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/guide/overview", activeMatch: "/guide/" },
          { text: "Operations", link: "/operations/deployment", activeMatch: "/operations/" },
          { text: "Reference", link: "/reference/architecture", activeMatch: "/reference/" },
          {
            text: "Reference demo",
            link: "https://fault-reports.berautoapp.workers.dev",
          },
        ],
        sidebar: [
          {
            text: "Guide",
            items: [
              { text: "Overview", link: "/guide/overview" },
              { text: "Reporters & Status Page", link: "/guide/reporters" },
              { text: "Staff Dashboard", link: "/guide/staff" },
              { text: "System Administration", link: "/guide/admin" },
              { text: "Windows Desktop App", link: "/guide/desktop-app" },
            ],
          },
          {
            text: "Self-Hosting & Operations",
            items: [
              { text: "Deploy a Copy", link: "/operations/deployment" },
              { text: "Local Development", link: "/operations/local-development" },
              { text: "Submission Recovery", link: "/operations/submission-recovery" },
              { text: "Erasure Procedure", link: "/operations/erasure" },
            ],
          },
          {
            text: "Reference",
            items: [
              { text: "Architecture & Privacy", link: "/reference/architecture" },
              { text: "Glossary", link: "/reference/glossary" },
            ],
          },
        ],
        editLink: {
          pattern: `${REPO_URL}/edit/main/website/:path`,
          text: "Edit this page on GitHub",
        },
        footer: {
          message: "One self-deployed copy per Organization — backed by GitHub Issues and Cloudflare Workers.",
          copyright: "Issue Tracker Documentation",
        },
      },
    },

    hu: {
      label: "Magyar",
      lang: "hu-HU",
      link: "/hu/",
      title: "Hibabejelentő",
      description:
        "Hibabejelentő és karbantartás-kezelő rendszer privát GitHub-szervezeti tárolóra, Cloudflare Workersre és Windows asztali alkalmazásra építve.",
      themeConfig: {
        nav: [
          { text: "Útmutató", link: "/hu/guide/overview", activeMatch: "/hu/guide/" },
          { text: "Üzemeltetés", link: "/hu/operations/deployment", activeMatch: "/hu/operations/" },
          { text: "Referencia", link: "/hu/reference/architecture", activeMatch: "/hu/reference/" },
          {
            text: "Referencia demó",
            link: "https://fault-reports.berautoapp.workers.dev",
          },
        ],
        sidebar: [
          {
            text: "Útmutató",
            items: [
              { text: "Áttekintés", link: "/hu/guide/overview" },
              { text: "Bejelentők és állapotoldal", link: "/hu/guide/reporters" },
              { text: "Munkatársi felület", link: "/hu/guide/staff" },
              { text: "Rendszergazdai feladatok", link: "/hu/guide/admin" },
              { text: "Windows asztali alkalmazás", link: "/hu/guide/desktop-app" },
            ],
          },
          {
            text: "Üzemeltetés és fejlesztés",
            items: [
              { text: "Üzembe helyezés", link: "/hu/operations/deployment" },
              { text: "Helyi fejlesztés", link: "/hu/operations/local-development" },
              { text: "Elakadt bejelentés helyreállítása", link: "/hu/operations/submission-recovery" },
              { text: "Adattörlés (Erasure)", link: "/hu/operations/erasure" },
            ],
          },
          {
            text: "Referencia",
            items: [
              { text: "Architektúra és adatvédelem", link: "/hu/reference/architecture" },
              { text: "Fogalomtár", link: "/hu/reference/glossary" },
            ],
          },
        ],
        outlineTitle: "Ezen az oldalon",
        lastUpdatedText: "Utoljára frissítve",
        returnToTopLabel: "Vissza a tetejére",
        sidebarMenuLabel: "Menü",
        darkModeSwitchLabel: "Megjelenés",
        lightModeSwitchTitle: "Váltás világos módra",
        darkModeSwitchTitle: "Váltás sötét módra",
        langMenuLabel: "Nyelv váltása",
        docFooter: {
          prev: "Előző oldal",
          next: "Következő oldal",
        },
        editLink: {
          pattern: `${REPO_URL}/edit/main/website/:path`,
          text: "Oldal szerkesztése a GitHubon",
        },
        footer: {
          message:
            "Önállóan üzembe helyezhető példány minden szervezethez — GitHub Issues és Cloudflare Workers alapokon.",
          copyright: "Hibabejelentő dokumentáció",
        },
      },
    },
  },
});
