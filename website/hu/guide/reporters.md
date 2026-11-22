# Bejelentők és állapotoldal

A bejelentőknek nincs szükségük GitHub-fiókra, jelszóra vagy bejelentkezésre. Minden művelet két nyilvános felületen zajlik: a **bejelentő űrlapon** és a bejelentéshez tartozó **állapotoldalon**.

## Hiba bejelentése

1. Nyissa meg a szervezet kezdőlapját, és válassza a **Hiba bejelentése** lehetőséget.
2. Ellenőrizze a **Vészhelyzeti tájékoztatót** (ha be van állítva) — például tűz, gázszivárgás vagy vízbetörés esetén ne űrlapot töltsön ki, hanem hívja a megadott segélyhívó számot.
3. Töltse ki az összes mezőt a kód kérése előtt:
   - **E-mail-cím** — szerepelnie kell a szervezet Bejelentők listáján.
   - **Kategória** — a hiba jellege a szervezet besorolási listájából.
   - **Helyszín** — az épület vagy terület érintett része a listából.
   - **Cím** — rövid, egysoros összefoglaló, **3–80 karakter**. Betűk, számok, szóközök és alapvető írásjelek (köztük a magyar idézőjelek) engedélyezettek; a visszaaposztróf (`` ` ``), kettőspont, `@`, `#` és HTML-jelek tiltottak.
   - **Leírás** — a hiba részletes leírása, **1–4000 karakter**.
   - **Pontos hely** *(nem kötelező)* — például szobaszám, emelet vagy pontos szerelvény, legfeljebb **100 karakter**.
4. Kattintson a **Kód küldése** gombra. A rendszer egyszer használatos, **6 számjegyű kódot** küld, amely **10 percig** érvényes.
5. Írja be a kapott kódot, majd kattintson a **Bejelentés beküldése** gombra.

<AppScreenshot
  name="submission-filled"
  alt="Kitöltött hibabejelentő űrlap vészhelyzeti tájékoztatóval, e-mail-címmel, kategóriával, helyszínnel, címmel, leírással és pontos hellyel"
  caption="A bejelentő űrlap a vészhelyzeti tájékoztatóval a mezők fölött."
/>

::: info Miért nem mondja meg a felület, hogy szerepel-e a cím a listán?
Annak érdekében, hogy kívülállók ne tudják kipróbálni, mely lakók e-mail-címe szerepel a rendszerben, a felület mindig ugyanazt a visszajelzést mutatja kódkérés után. Ha nem érkezik meg a levél, nézze meg a levélszemét mappát, és keresse a képernyőn megjelenő súgóban megadott kapcsolattartót.
:::

### Kódkérési korlátok és megszakadt beküldés

- A kód **10 percig** érvényes, és legfeljebb **5 hibás próbálkozást** enged meg, utána érvényét veszti.
- Új kódot **60 másodperces várakozási idő** után kérhet (e-mail-címenként óránként legfeljebb 5, naponta legfeljebb 10 kód).
- **Automatikus folytatás duplikáció nélkül:** Ha a mentés közben megszakad a kapcsolat vagy frissíti a böngészőlapot, a rendszer ideiglenes helyreállítási azonosítóval automatikusan folytatja ugyanazt a beküldést új kód és dupla bejelentés létrehozása nélkül.
- Ha a rendszer nem tudja biztosan megerősíteni, hogy a bejelentés elmentődött-e a GitHubon, megjelenít egy rövid azonosítót (például `A1B2-C3D4`), és megkéri, hogy újraküldés helyett vegye fel a kapcsolatot az üzemeltetővel. Lásd: [Elakadt bejelentés helyreállítása](/hu/operations/submission-recovery).

## A bejelentés követése az állapotoldalon

Sikeres beküldés után a visszaigazoló képernyő megjeleníti az állandó **állapothivatkozást**, amelyet a rendszer e-mailben is elküld:

```text
https://<sajat-peldany>/status/<kitalalhatatlan-token>
```

Őrizze meg ezt a hivatkozást — ez az egyetlen módja a bejelentés követésének és a megjegyzések írásának. A hivatkozások soha nem járnak le (lezárás után sem), és nyugodtan megoszthatók például családtaggal vagy munkatárssal, aki szintén követni szeretné a hibát.

<AppScreenshot
  name="status-open-in-progress"
  alt="Nyilvános állapotoldal a bejelentés címével, állapotával, előzményeivel, megjegyzéseivel, megjegyzés mezővel és hivatkozás cseréje gombbal"
  caption="Az állapotoldal megjeleníti a bejelentés részleteit, a szűrt előzményeket, a karbantartói és bejelentői megjegyzéseket, a megjegyzésíró mezőt és a hivatkozáscsere lehetőséget."
/>

### Mi látszik az állapotoldalon?

- **Látható:** a bejelentés sorszáma, címe, leírása, pontos helye, kategóriája, helyszíne, aktuális állapota (vagy javításra váró jelzés), nyitott/lezárt státusza a lezárás okával (*megoldva*, *elutasítva*, *ismétlődő*), hogy foglalkozik-e vele a karbantartás (név nélkül), valamint az előzmények és megjegyzések idővonala.
- **Rejtett:** a belső prioritás, a munkatársak GitHub-felhasználóneve és profilképe, a belső GitHub-linkek és az egyéb címkék soha nem kerülnek ki az állapotoldalra.

### Bejelentői megjegyzés írása

Az állapotoldal alján új megjegyzést fűzhet a bejelentéshez (1–2000 karakter):

- A megjegyzést a **Bot** teszi közzé az Ön nevében **Bejelentő** jelöléssel. Az e-mail-címe itt sem kerül be a GitHubba.
- A megjegyzések **csak hozzáfűzhetők** (utólag nem szerkeszthetők és nem törölhetők az állapotoldalról), és korlátozott ütemben küldhetők (percenként legfeljebb 3, naponta legfeljebb 20 bejelentésenként).
- **Lezárt bejelentésre írt megjegyzés nem nyitja újra a bejelentést.** Ha egy korábban megoldott hiba visszatért, adjon le új bejelentést vagy lépjen kapcsolatba a karbantartással.

### Az állapothivatkozás cseréje

Ha a hivatkozást tévedésből megosztotta, vagy illetéktelen kézbe került, kattintson az oldal alján az **Új hivatkozás kérése** gombra és erősítse meg:

- A régi hivatkozás mindenkinél megszűnik (a KV-frissülés után, nagyjából egy percen belül általános „Ez a hivatkozás nem működik” oldalt ad).
- Az új hivatkozás **kizárólag a bejelentő e-mail-címére** érkezik meg — a képernyőn nem jelenik meg, így illetéktelen birtokos nem tudja átvenni a bejelentést.
- Hivatkozás birtokosként naponta legfeljebb **3 csere** kérhető bejelentésenként; karbantartók korlát nélkül cserélhetik.

## Mikor érkezik e-mail-értesítés?

Minden rendszerlevél **egyszerű szöveges** formátumban, a szervezet hitelesített küldő aldomainjéről, figyelt válaszcímmel (`Reply-To`) érkezik. A rendszer kizárólag hat esetben küld e-mailt:

1. **Ellenőrző kód (OTP)** a hibabejelentéshez.
2. **Bejelentés beérkezett** visszaigazolás a sorszámmal és az állapothivatkozással.
3. **Bejelentés lezárva** a lezárás okával (*megoldva*, *elutasítva* vagy *ismétlődő*).
4. **Bejelentés újranyitva**, ha a karbantartás újranyit egy lezárt hibát.
5. **Értesítéssel járó állapotba lépés** (`notify` jelzőjű állapot), amikor a nyitott bejelentés ilyen állapotba kerül.
6. **Állapothivatkozás újra kiadva** csere esetén.

Kisebb változások — például munkatársi hozzászólás, prioritás-, kategória- vagy helyszínmódosítás, felelős kijelölése — nem küldenek e-mailt; a teljes idővonal az állapothivatkozáson látható.
