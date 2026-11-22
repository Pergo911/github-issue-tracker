# Áttekintés

A **Hibabejelentő** (*Hibabejelentő és karbantartás-kezelő rendszer*) társasházak, intézmények és szervezetek számára készült hibabejelentő és karbantartás-kezelő rendszer. Adattárként egy privát **GitHub-szervezet** tárolóját használja, a bejelentői oldalt **Cloudflare Workers** (Workers KV és SQLite alapú Durable Objects) szolgálja ki, az e-mail-küldést a **Resend** végzi, a webes felület pedig opcionálisan **Windows Electron asztali alkalmazásként** is futtatható.

## Miért ilyen az architektúra?

A karbantartók és rendszergazdák szűk, ismert kör, akik kényelmesen tudnak valós GitHub-fiókkal bejelentkezni. Ezzel szemben egy társasház lakóitól vagy egy intézmény tagjaitól nem várható el, hogy egy kiégett folyosói lámpa miatt GitHub-fiókot regisztráljanak, tárolómeghívót fogadjanak el, vagy lássák mások bejelentéseit.

A rendszer ezt négy alappillérrel oldja meg:

1. **Nincs bejelentői fiók vagy jelszó.** A bejelentők a rendszergazda által karbantartott **Bejelentők listájával** (*Allowlist*) és egy egyszer használatos, 6 számjegyű e-mail-kóddal (OTP) igazolják jogosultságukat.
2. **Egyedi hozzáférés állapothivatkozással.** Mivel a GitHub Issues nem támogat hibajegyenkénti olvasási jogot, a bejelentők egyáltalán nem kapnak GitHub-hozzáférést. Minden leadott **Bejelentés** egy kitalálhatatlan, állandó **állapothivatkozást** (*Status link*) kap, amely kizárólag arra az egy bejelentésre szól.
3. **E-mail csak jelentős változáskor.** Egyszerű szöveges értesítő e-mail csak fontos eseményeknél indul (lezárás, újranyitás, vagy `notify` jelzőjű állapotba lépés). A teljes előzmény hiteles forrása az állapotoldal.
4. **Önálló példány minden szervezethez.** Minden szervezet a saját GitHub-szervezetében, saját Cloudflare fiókjában és saját Resend küldő domainjén futtatja a rendszerét. A példányok semmit nem osztanak meg egymással.

## A három felület

| Felület | Kinek szól | Hitelesítés | Feladata |
| --- | --- | --- | --- |
| **Bejelentő űrlap** | Bejelentők | Bejelentők listája + 6 számjegyű e-mail-kód | Kategória, helyszín, cím, leírás és opcionális pontos hely bekérése, majd bejelentés létrehozása a Bot segítségével. |
| **Állapotoldal** | Bárki, aki birtokolja a bejelentés állapothivatkozását | Kitalálhatatlan 128 bites token az URL-ben | Megjeleníti a bejelentés állapotát, szűrt előzményeit és megjegyzéseit; új bejelentői megjegyzés írása és a hivatkozás cseréje. |
| **Munkatársi felület** | Megtekintők, Karbantartók, Rendszergazdák | GitHub Device Flow (szerveroldali szerepkör-ellenőrzéssel) | Lista, Kanban Tábla és Részletek nézetek, valamint rendszergazdai Bejelentők listája, Munkatársak és Beállítások képernyők. |

## Szerepkörök áttekintése

| Szerepkör | GitHub tároló jogosultság | Jogosultságok |
| --- | --- | --- |
| **Bejelentő** | Nincs (e-mail-cím a Bejelentők listáján) | Bejelentés beküldése, saját bejelentés követése az állapotoldalon, bejelentői megjegyzés írása, hivatkozás cseréje. |
| **Megtekintő** | Read | Lista, Tábla és Részletek megtekintése, munkatársi hozzászólás írása. Nem módosíthat címkéket, nem zárhat le, és nem láthatja a bejelentő elérhetőségét. |
| **Karbantartó** | Triage (vagy Write / Maintain) | Minden, amit a Megtekintő, továbbá kategória, helyszín, prioritás, állapot és felelős módosítása, lezárás/újranyitás, bejelentő elérhetőségének lekérdezése és állapothivatkozás cseréje. |
| **Rendszergazda** | Admin | Minden, amit a Karbantartó, továbbá a Bejelentők listája, a Munkatársak és a Beállítások kezelése, valamint elakadt bejelentések helyreállítása és adattörlés. |

## Referencia példány

Élő magyar nyelvű bemutató példány érhető el a [fault-reports.berautoapp.workers.dev](https://fault-reports.berautoapp.workers.dev) címen (`Tarsashaz-demo/reports` tárolóval). Minden példány egyetlen **felületi nyelvet** (`hu` vagy `en`) használ mindhárom felületen és minden rendszerlevélben.

## Merre tovább?

- **Hibát szeretne bejelenteni vagy követni?** Olvassa el a [Bejelentők és állapotoldal](/hu/guide/reporters) útmutatót.
- **Karbantartóként kezeli a bejelentéseket?** Nézze meg a [Munkatársi felület](/hu/guide/staff) leírását.
- **Rendszergazdaként üzemelteti a rendszert?** Lásd: [Rendszergazdai feladatok](/hu/guide/admin) és [Üzembe helyezés](/hu/operations/deployment).
- **Windows asztali alkalmazást készítene?** Lásd: [Windows asztali alkalmazás](/hu/guide/desktop-app).
