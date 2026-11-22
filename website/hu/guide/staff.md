# Munkatársi felület

A **Munkatársi felületen** a megtekintők, karbantartók és rendszergazdák GitHub-fiókjukkal bejelentkezve böngészhetik, besorolhatják és kezelhetik a bejelentéseket.

## Bejelentkezés (GitHub Device Flow)

1. Válassza a kezdőlapon a **Munkatársi bejelentkezés** opciót (vagy nyissa meg a `/staff` útvonalat).
2. Kattintson a **Bejelentkezés GitHubbal** gombra. A rendszer egyszer használatos eszközkódot kér a Worker proxyn keresztül.
3. Kattintson **A GitHub ellenőrző oldalának megnyitása** gombra (a Windows asztali alkalmazásban ez az alapértelmezett böngészőben nyílik meg, ahol a kétlépcsős azonosítás és a passkey problémamentesen működik), írja be a kódot, és hagyja jóvá a hozzáférést.
4. Térjen vissza az alkalmazásba. A szerepköre automatikusan a `reports` tárolón meglévő GitHub-jogosultsága alapján áll be.

A hozzáférési tokenek érvényességük idején automatikusan megújulnak. A kijelentkezés törli a helyi böngészőadatokat; a GitHub-alkalmazás engedélyének teljes visszavonásához nyissa meg a **GitHub → Settings → Applications** oldalt.

## Munkatársi szerepkörök

A GitHub tárolószerepkörök három munkatársi szintre képeződnek le, amelyeket a felület és minden Worker végpont szerveroldalon is ellenőriz:

| Szerepkör | GitHub tároló jogosultság | Jogosultságok |
| --- | --- | --- |
| **Megtekintő** | Read | Lista, Tábla és Részletek megtekintése, hozzászólás írása. Nem módosíthat címkéket, nem jelölhet ki felelőst, nem zárhat le, és nem kérheti le a bejelentő elérhetőségét. |
| **Karbantartó** | Triage, Write vagy Maintain | Teljes körű hibakezelés: kategória, helyszín, prioritás, állapot, felelős, lezárás/újranyitás, hozzászólás, bejelentő elérhetőségének megjelenítése és hivatkozás cseréje. |
| **Rendszergazda** | Admin | A karbantartói jogok mellett a **Bejelentők listája**, a **Munkatársak** és a **Beállítások** képernyők kezelése. |

## Lista és Tábla nézet

A nyitott bejelentések **Lista** és **Tábla** nézetben is kezelhetők, közös szűrőkkel és teljes előzményre kiterjedő kereséssel.

<AppScreenshot
  name="staff-list-admin"
  alt="Munkatársi Lista nézet keresőmezővel, kategória, helyszín, prioritás, állapot és felelős szűrőkkel, nyitott/lezárt váltóval és javítandó állapot figyelmeztetésekkel"
  caption="A Lista nézet a beállított prioritási sorrend, majd a legrégebbi nyitás ideje szerint rendezi a bejelentéseket, és minden besorolási dimenzióra szűrhető."
/>

### Szűrés, keresés és rendezés

- **Keresés a teljes előzményben:** nyitott és lezárt bejelentések között egyaránt keres.
- **Szűrők:** Kategória, Helyszín, Prioritás, Állapot, Felelős, **Nincs besorolva** (prioritás nélküli elemek), illetve **Bejelentői hozzászólással**.
- **Bejelentői hozzászólások ellenőrzése:** a gombbal a felület végignézi a nyitott bejelentéseket, jelvényt jelenít meg a bejelentői hozzászólások számáról, és lehetővé teszi a legutóbbi bejelentői hozzászólás szerinti rendezést.
- **Kézi frissítés:** mivel a GitHub webhook a Workerhez fut be és nem küld élő push értesítést a böngészőnek, friss adatokhoz használja a **Frissítés** gombot.

### Kanban Tábla

A **Tábla** nézet a nyitott bejelentéseket a beállított állapotok sorrendjében mutatja oszloponként:

- **Húzd és ejtsd (drag-and-drop):** egy kártya másik oszlopba húzása egyetlen API-hívással cseréli le az állapotcímkét, így egy bejelentésen soha nem marad két állapotcímke.
- **Akadálymentes állapotmenü:** minden kártyán közvetlen legördülő állapotválasztó is elérhető billentyűzetes használathoz.
- **„Az állapotot javítani kell” oszlop:** ha egy nyitott bejelentésnek nincs állapota, több állapotcímkéje van, vagy már megszüntetett állapotcímkét visel (például kézi GitHub-szerkesztés után), a rendszer nem talál ki helyette állapotot, hanem ebbe a külön oszlopba gyűjti (és a Lista/Részletek nézetben is figyelmeztet), amíg egy karbantartó érvényes állapotot nem választ.

## Részletek nézet

Bármely bejelentésre kattintva megnyílik annak részletes oldala.

<AppScreenshot
  name="detail-maintenance"
  alt="Bejelentés részletes nézete dekódolt leírással, idővonallal, karbantartói és bejelentői hozzászólásokkal, oldalsávi választókkal és elérhetőség gombokkal"
  caption="A Részletek nézet tisztán dekódolva mutatja a bejelentés szövegét, megkülönbözteti a karbantartói és bejelentői hozzászólásokat, az oldalsávban pedig a besorolást és a jogosultsághoz kötött elérhetőség-lekérdezést kínálja."
/>

### Besorolás és felelős (Karbantartó és Rendszergazda)

Az oldalsávból frissíthető:

- **Állapot** — `notify` jelzővel ellátott állapot kiválasztásakor a rendszer e-mailt küld a bejelentőnek.
- **Kategória és Helyszín** — téves besorolás javítása (nem küld e-mailt).
- **Prioritás** — belső sürgősségi besorolás (soha nem jelenik meg az állapotoldalon).
- **Felelős** — karbantartó hozzárendelése (az állapotoldalon csak az látszik, hogy foglalkoznak-e vele, a felhasználónév nem).

### Hozzászólások

A bejelentéshez írt minden hozzászólást **elolvashat a bejelentő** (az állapotoldalon egyszerű szövegként, általános *Karbantartás* felirattal). Minden hozzászólást bejelentő számára láthatónak kell tekinteni, belső megjegyzést vagy személyes adatot ne írjon bele.

### Lezárás és újranyitás

- **Bejelentés lezárása:** három ok választható — **Megoldva**, **Elutasítva**, illetve **Egy másik bejelentés ismétlése** (ilyenkor meg kell adni az eredeti bejelentés számát). A lezárás leveszi a nyitott állapotcímkét, és e-mailben értesíti a bejelentőt az okról.
- **Bejelentés újranyitása:** újranyitja a lezárt bejelentést, visszaállítja a **kezdeti állapotot**, és egyetlen újranyitási e-mailt küld.

### A bejelentő elérhetőségének lekérdezése és hivatkozáscsere

Mivel a bejelentő e-mail-címe nem tárolódik a GitHubon, a karbantartók az oldalsáv **A bejelentő elérhetősége** blokkját használják, ha közvetlenül el kell érniük a bejelentőt (például időpont-egyeztetéshez) vagy át kell adniuk egy elveszett linket:

1. Kattintson az **Elérhetőség megjelenítése** gombra — a Worker újra ellenőrzi a GitHub-jogosultságát, majd a Workers KV-ból betölti a bejelentő e-mail-címét, aktuális állapothivatkozását és a Bejelentők listáján szereplő megjegyzést.
2. Kattintson **Az állapotoldal hivatkozásának cseréje** gombra, ha egy bejelentő szivárgást jelez; a régi hivatkozás megszűnik, az újat pedig e-mailben kapja meg a bejelentő anélkül, hogy a képernyőn megjelenne.

Megtekintők nem látják ezt a panelt, a háttérvégpontok pedig `403 Forbidden` hibával utasítják el őket.
