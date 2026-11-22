# Fogalomtár

A Hibabejelentő egységes szakkifejezéseket használ a felületein, beállításaiban és üzemeltetési útmutatóiban. Az alábbi táblázat megadja az angol (`GLOSSARY.md`) és magyar elnevezések pontos jelentését, hogy ne keveredjen össze például a valós **Szervezet** a **GitHub-szervezettel**.

## Példány és szervezet

| Magyar fogalom | Angol megfelelő | Jelentés |
| --- | --- | --- |
| **Példány / Üzembe helyezés** | Deployment | A rendszer egyetlen önállóan futó és konfigurált példánya, amely egyetlen Szervezetet szolgál ki. A példányok között nincs megosztott adat. |
| **Szervezet** | Organization | A valós szervezet, amelyet a példány kiszolgál (pl. társasház, intézmény, vállalat). Soha nem a GitHub-konstrukciót jelenti. |
| **GitHub-szervezet** | GitHub Organization | A GitHub-konstrukció, amely a példány `reports` tárolóját és a munkatársi jogosultságokat tárolja. Mindig teljes nevén írjuk. |
| **Felületi nyelv** | UI Language | Az az egyetlen nyelv (`hu` vagy `en`), amelyen a példány mindhárom felületet és minden rendszerlevelet megjeleníti. Nem böngészőfüggő. |

## Felületek

| Magyar fogalom | Angol megfelelő | Jelentés |
| --- | --- | --- |
| **Bejelentő űrlap** | Submission form | A nyilvános, bejelentkezés nélküli felület, ahol a bejelentő az e-mail-kódos ellenőrzés után leadja a hibabejelentést. |
| **Állapotoldal** | Status page | Az állapothivatkozással megnyitható nyilvános felület: egyetlen bejelentés aktuális állapota, előzményei és megjegyzésíró doboza. |
| **Munkatársi felület** | Staff dashboard | A GitHub-bejelentkezéses munkaterület: Tábla, Lista és Részletek nézetek, valamint a rendszergazdai Bejelentők listája, Munkatársak és Beállítások képernyők. |

## Bejelentések és szereplők

| Magyar fogalom | Angol megfelelő | Jelentés |
| --- | --- | --- |
| **Bejelentés** | Report | Egy bejelentett hiba, amelyet a beküldéstől a lezárásig követ a rendszer. |
| **Beküldési kísérlet** | Submission attempt | Egy igazolt hibabejelentési művelet. Megszakadás után folytatható anélkül, hogy második bejelentés jönne létre. |
| **Bejelentő** | Reporter | A Bejelentők listáján szereplő személy, aki hibát jelent be. Nincs GitHub-fiókja és nem jelentkezik be. |
| **Bot** | Bot | A GitHub-alkalmazás automatizmusa, amely a bejelentők nevében létrehozza a bejelentéseket és közzéteszi a bejelentői megjegyzéseket. Nem munkatárs. |
| **Bejelentői megjegyzés** | Reporter comment | Az állapotoldalról hozzáfűzött megjegyzés, amelyet a Bot tesz közzé bejelentői jelöléssel. Csak hozzáfűzhető, és nem nyit újra lezárt bejelentést. |
| **Bejelentők listája** | Allowlist | A rendszergazdák által karbantartott e-mail-címek listája, amelyek ellenőrző kódot kérhetnek és hibát jelenthetnek be. |
| **Állapothivatkozás** | Status link | Az állandó, kitalálhatatlan, bejelentésenként egyedi URL (`/status/<token>`), amely az állapotoldalt nyitja meg. |
| **Hivatkozáscsere** | Reissue | Egy bejelentés állapothivatkozásának lecserélése újra: a régi mindenkinél megszűnik, az új csak a bejelentő e-mail-címére érkezik meg. |
| **Adattörlés** | Erasure | A bejelentő adattörlési kérésének végrehajtása bejelentésenként: GitHub-hibajegy törlése (a KV-leképezések törlésével), eltávolítás a Bejelentők listájáról és az esetleges elakadt beküldés elvetése. |
| **Jelentős változás** | Major change | Olyan változás, amelyről e-mail-értesítés indul: lezárás, újranyitás, vagy nyitott állapotban `notify` jelzőjű állapotba lépés. |
| **Munkatárs** | Staff | GitHub-fiókkal és tárolószerepkörrel rendelkező személy: **Megtekintő**, **Karbantartó** vagy **Rendszergazda**. |
| **Megtekintő** | Viewer | Tároló `Read` jogú munkatárs: látja a bejelentéseket és hozzászólhat, de nem végezhet hibakezelési műveletet és nem kérheti le a bejelentő elérhetőségét. |
| **Karbantartó** | Maintenance staff | Tároló `Triage` (vagy magasabb) jogú munkatárs: besorolja, kiosztja, kezeli és lezárja a bejelentéseket, lekérheti az elérhetőséget és cserélheti a hivatkozást. |
| **Rendszergazda** | System admin | Tároló `Admin` jogú munkatárs: a karbantartói jogok mellett kezeli a Bejelentők listáját, a Munkatársakat, a Beállításokat, a helyreállítást és az adattörlést. |
| **Munkatársi meghívó** | Staff invitation | Függőben lévő GitHub-tárolómeghívó, amely elfogadás után munkatársi szerepkört ad a `reports` tárolón. |

## Besorolás

| Magyar fogalom | Angol megfelelő | Jelentés |
| --- | --- | --- |
| **Besorolás** | Taxonomy | A példány kategóriái, helyszínei, prioritásai és állapotai. A négy dimenzió rögzített, az értékeket a szervezet határozza meg. |
| **Kategória** | Category | A hiba jellege (bejelentésenként egy); a bejelentő választja, a karbantartó javíthatja. |
| **Helyszín** | Location | Az épület vagy terület érintett része a listából (bejelentésenként egy). |
| **Pontos hely** | Exact place | Opcionális szabad szöveges kiegészítés (pl. szobaszám, emelet) a választott helyszínen belül. |
| **Prioritás** | Priority | A karbantartók opcionális belső sürgősségi besorolása (üresen: nincs besorolva). A bejelentők nem látják. |
| **Állapot** | Status | Nyitott bejelentés feldolgozási szakasza (nyitottnál egy; hiányzó vagy ütköző állapotot a felület javításra jelöl). Lezárt bejelentésnek nincs állapota. |
| **Kezdeti állapot** | Initial status | Az egyetlen `initial` jelzőjű állapot, amellyel az új és újranyitott bejelentések indulnak. Belépése nem küld e-mailt. |
| **Állapotjelző** | Status flag | A konfigurációban egy állapothoz rendelt tulajdonság (`initial` vagy `notify`), így a rendszer sosem az állapot nevéből következtet. |
| **Lezárt** | Closed | A bejelentés végállapota: *megoldva*, *elutasítva* vagy *ismétlődő*. |
| **Vészhelyzeti tájékoztató** | Emergency notice | A bejelentő űrlapon megjelenő, szervezet által megadott figyelmeztetés, hogy vészhelyzetben kit kell hívni hibabejelentés helyett. |
