---
layout: home

hero:
  name: Hibabejelentő
  text: Hibabejelentés és karbantartás-kezelés GitHub Issues alapokon
  tagline: A bejelentők 6 számjegyű e-mail-kóddal adhatnak le hibabejelentést, és privát állapothivatkozáson követhetik a megoldást — GitHub-fiók nélkül. A karbantartók ismerős Kanban táblán, listanézetben és Windows asztali alkalmazásban dolgozhatnak.
  actions:
    - theme: brand
      text: Útmutató megnyitása
      link: /hu/guide/overview
    - theme: alt
      text: Saját üzembe helyezés
      link: /hu/operations/deployment
    - theme: alt
      text: English version
      link: /

features:
  - title: Három elkülönített felület
    details: Nyilvános bejelentő űrlap e-mail-kódos (OTP) védelemmel, állandó egyedi állapotoldal megjegyzésírással, valamint GitHub-bejelentkezéses munkatársi felület Lista, Tábla, Részletek, Bejelentők listája, Munkatársak és Beállítások képernyőkkel.
  - title: Adatvédelem alapértelmezésben
    details: A bejelentők nem kapnak GitHub-fiókot vagy tároló-olvasási jogot. A bejelentők e-mail-címe soha nem kerül be a GitHub-hibajegyekbe, hozzászólásokba vagy címkékbe — kizárólag a Workers KV-ban, szerepkörhöz kötött lekérdezés mögött tárolódik.
  - title: Önálló példány szervezetenként
    details: Minden szervezet saját GitHub-szervezettel, Cloudflare Workers fiókkal és Resend küldő domainnel üzemelteti a rendszerét. A szervezet neve, besorolási rendszere, e-mail-sablonjai, időzónája és felületi nyelve (magyar vagy angol) beállításokból vezérelt.
  - title: Webes és Windows asztali alkalmazás
    details: Egyetlen React SPA a Cloudflare Workersön futtatva, kiegészítve egy vékony Windows Electron keretalkalmazással (felhasználónkénti NSIS telepítővel és hordozható .exe változattal), külön asztali kódbázis nélkül.
---

<div class="home-showcase">
  <div class="home-showcase-header">
    <h2>A munkatársi felület működés közben</h2>
    <p>A világos és sötét megjelenés automatikusan alkalmazkodik. A képernyőképek a Rózsa Társasház referencia példányából készültek.</p>
  </div>
  <AppScreenshot
    name="board-maintenance"
    alt="Munkatársi Kanban tábla nyitott bejelentésekkel, állapot oszlopokkal, kategória, helyszín és prioritás címkékkel"
    caption="A karbantartói Tábla nézet a beállított állapotok szerint oszlopokba rendezi a nyitott bejelentéseket, és külön jelzi a javítandó állapotú elemeket."
    eager
  />
</div>

<div class="home-flow">
  <h2>Egy bejelentés életútja</h2>
  <div class="home-flow-grid">
    <div class="home-flow-step">
      <div class="home-flow-step-num">1</div>
      <h3>Bejelentés regisztráció nélkül</h3>
      <p>A bejelentők listáján szereplő e-mail-címről a bejelentő kiválasztja a kategóriát és a helyszínt, leírja a hibát, majd egyszer használatos 6 számjegyű kóddal jóváhagyja a beküldést. A Bot e-mail-cím mentése nélkül létrehozza a GitHub-bejelentést.</p>
    </div>
    <div class="home-flow-step">
      <div class="home-flow-step-num">2</div>
      <h3>Követés állapothivatkozással</h3>
      <p>Minden bejelentéshez egy kitalálhatatlan, állandó állapothivatkozás készül. A bejelentő ezen nézheti meg az előzményeket és írhat megjegyzést, a jelentős változásokról pedig egyszerű szöveges e-mail-értesítés is érkezik.</p>
    </div>
    <div class="home-flow-step">
      <div class="home-flow-step-num">3</div>
      <h3>Feldolgozás és lezárás</h3>
      <p>A megtekintők, karbantartók és rendszergazdák GitHub Device Flow segítségével lépnek be. A karbantartók prioritást és felelőst rendelnek a hibákhoz, mozgatják őket az állapot oszlopok között, szükség esetén lekérhetik a bejelentő elérhetőségét, végül lezárják a megoldott bejelentéseket.</p>
    </div>
  </div>
</div>
