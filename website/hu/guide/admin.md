# Rendszergazdai feladatok

A `reports` tárolón **Admin** jogosultsággal rendelkező munkatársak három további képernyőt érnek el a Munkatársi felületen: **Bejelentők listája**, **Munkatársak** és **Beállítások**.

## Bejelentők listája (Allowlist)

Kizárólag a **Bejelentők listáján** szereplő e-mail-címek kérhetnek ellenőrző kódot és adhatnak le hibabejelentést.

<AppScreenshot
  name="allowlist-populated"
  alt="Bejelentők listája képernyő egyedi és tömeges címfelvétellel, keresővel és megjegyzésekkel ellátott e-mail-címekkel"
  caption="A rendszergazdák egyesével vagy akár 500 soros tömeges beillesztéssel vehetnek fel címeket, belső megjegyzéssel ellátva."
/>

### Címek kezelése

- **Egy cím felvétele:** adja meg az e-mail-címet és egy opcionális belső megjegyzést (legfeljebb 200 karakter, például név és lakásszám). A megjegyzés csak itt és a munkatársi **Elérhetőség megjelenítése** ablakban látható — soha nem kerül a GitHubba vagy e-mailbe.
- **Több cím felvétele:** egyszerre legfeljebb **500 sor** illeszthető be, soronként egy e-mail-címmel és opcionális, szóközzel, vesszővel vagy tabulátorral elválasztott megjegyzéssel. Mentés után soronkénti összegzés jelzi a felvett és elutasított sorokat (hibás cím, ismétlődés, már szerepel, túl hosszú megjegyzés).
- **Normalizálás:** a rendszer kisbetűsíti és megtisztítja a címeket, pontos egyezéssel (nincs pont- vagy `+tag` összevonás).
- **Életbelépés:** a módosítások a Workers KV-ban tárolódnak, és nagyjából **egy percen belül** válnak érvényessé.

### Kilépő lakók és címcsere

- **Eltávolítás:** megakadályozza, hogy a cím a jövőben új kódot kérhessen. A korábbi bejelentések, állapothivatkozások és értesítések változatlanok maradnak. Egy meglévő bejelentés állapotoldalának elérését az állapothivatkozás cseréjével tudja megszüntetni a Részletek nézetben.
- **E-mail-cím változása:** vegye fel az új címet és távolítsa el a régit. A korábbi bejelentések értesítései a beküldéskori címre mennek tovább; ha a régi postafiók megszűnt, a karbantartók az Elérhetőség megjelenítése funkcióval adhatják át az állapothivatkozást.
- **Adattörlési kérés:** a lista-eltávolítás önmagában nem törli a korábbi bejelentéseket. Teljes adattörléshez kövesse az [Adattörlés (Erasure)](/hu/operations/erasure) eljárást.

## Munkatársak kezelése

A **Munkatársak** képernyőn közvetlenül az alkalmazásból kezelhetők a tároló közreműködői és a függőben lévő **munkatársi meghívók**.

<AppScreenshot
  name="staff-members-populated"
  alt="Munkatársak képernyő új munkatárs felvételével, aktív munkatársak listájával és függőben lévő meghívókkal"
  caption="Aktív munkatársak, örökölt GitHub-szervezeti jogosultságok és függőben lévő meghívók egyetlen áttekintő oldalon."
/>

- **Előfeltétel:** a munkatársi GitHub-alkalmazásnak rendelkeznie kell jóváhagyott tárolószintű **Administration: read and write** jogosultsággal a GitHub-szervezet beállításaiban. A megtekintők és karbantartók ettől nem kapnak admin jogot.
- **Munkatárs hozzáadása:** adjon meg egy GitHub-felhasználónevet (nem e-mail-címet) és válassza ki a szerepkört (**Megtekintő**, **Karbantartó** vagy **Rendszergazda**). A meglévő GitHub-szervezeti tagok azonnal hozzáférést kapnak, a külső fiókok GitHub-meghívót kapnak a **Függőben lévő meghívók** listába.
- **Biztonsági korlátok:**
  - Saját szerepkörét nem módosíthatja, és saját magát nem távolíthatja el.
  - Legalább egy aktív **Rendszergazdának** mindig maradnia kell.
  - A GitHub-szervezeti csapatból vagy alapszintű jogosultságból örökölt szerepkörök *GitHub-szervezetben kezelve* jelölést kapnak; csökkentésük vagy visszavonásuk a github.com-on végezhető el.
- **Eltávolítás:** azonnal megszünteti a tárolóhozzáférést és leveszi a személyt a nyitott bejelentések felelősei közül, miközben a tágabb GitHub-szervezeti tagságát nem érinti.

## Beállítások (Configuration)

Minden példányszintű beállítás a Workers KV `config` kulcsában tárolódik, és a **Beállítások** képernyő öt fülén szerkeszthető.

<AppScreenshot
  name="config-organization"
  alt="Beállítások képernyő Szervezet fül a szervezet nevével, vészhelyzeti tájékoztatóval és kódküldés utáni súgóval"
  caption="A Szervezet fülön adható meg a fejlécben látható szervezetnév, a vészhelyzeti tájékoztató és a kódkérés utáni súgószöveg."
/>

### A beállítások öt füle

1. **Szervezet**
   - **A szervezet neve:** minden oldal fejlécében megjelenik.
   - **Vészhelyzeti tájékoztató:** kiemelve jelenik meg a bejelentő űrlap fölött (pl. tűz, gázszivárgás vagy vízbetörés esetén hívandó telefonszám). Üresen hagyható.
   - **Súgó a kód elküldése után:** azoknak szól, akik nem kapnak kódot (mivel a rendszer nem árulja el, hogy szerepel-e a címük a listán).
2. **Besorolás (Taxonomy)**
   - A négy rögzített dimenzió értékei: **Kategóriák**, **Helyszínek**, **Prioritások** (legalacsonyabbtól a legmagasabbig rendezve) és **Állapotok** (a Kanban Tábla oszlopsorrendjében).
   - Minden érték egy mentés után nem változtatható kisbetűs kebab-case **azonosítót** (pl. `category:plumbing`), a felületi nyelv szerinti **megjelenített nevet** és opcionális 6 számjegyű hex **színt** kap.
   - **Állapotjelzők:** pontosan egy állapot a **Kezdeti állapot** (ezt kapják az új és újranyitott bejelentések; belépése nem küld e-mailt). Bármely állapotnál bekapcsolható az **E-mail a bejelentőnek** (`notify`) jelző.
   - **Egyirányú címkeszinkron:** mentéskor a rendszer automatikusan létrehozza a hiányzó GitHub-címkéket és frissíti a színeiket a `reports` tárolóban. Címkét soha nem töröl és nem nevez át; eltávolított érték esetén a korábbi bejelentéseken a nyers azonosító jelenik meg átcímkézésig.
3. **E-mail-feladó**
   - Feladó címe a `@` előtt (a hitelesített domain a `wrangler.jsonc`-ben rögzített), feladó neve, figyelt **válaszcím** (`Reply-To`), válaszmondat és közös lábléc (`{reply}` helyőrzővel).
4. **E-mail-sablonok**
   - Egyszerű szöveges tárgy- és üzenetsablon mind a **hat** rendszerlevélhez: Ellenőrző kód, Bejelentés beérkezett, Lezárva, Újranyitva, Értesítéssel járó állapotba lépett, Állapothivatkozás újra kiadva.
5. **Nyelv és korlátok**
   - **Nyelv:** egyetlen felületi nyelv (`hu` vagy `en`) a teljes alkalmazáshoz és a rendszerszövegekhez. A besorolási neveket és sablonokat is ezen a nyelven írja meg.
   - **Időzóna:** érvényes IANA-időzóna (pl. `Europe/Budapest`) a dátumok formázásához.
   - **Napi kódkeret:** naponta (UTC szerint) legfeljebb hány ellenőrző kódot küldhet a példány (alapértelmezetten `40`, a Resend napi 100 leveles ingyenes keretéhez igazítva).

::: tip Első beállítás
Frissen telepített példányon a nyilvános felületek „A szolgáltatás még nincs beállítva” üzenetet mutatnak, amíg egy rendszergazda be nem jelentkezik a `/staff/configuration` oldalon és el nem menti a kezdeti beállításokat.
:::
