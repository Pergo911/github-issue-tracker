# Elakadt bejelentés helyreállítása

Ez a műveleti útmutató **Rendszergazdáknak** (GitHub tároló Admin) szól, ha egy megszakadt beküldés emberi egyeztetést igényel.

## Mikor van erre szükség?

A bejelentés végleges mentése három lépésben történik:

1. A **Bot** létrehozza a GitHub-hibajegyet.
2. A Worker rögzíti a visszakapott sorszámot az e-mail Durable Objectben.
3. A Report gate megírja a három KV-leképezést (`issue-email`, `status-token`, `issue-token`).

A legtöbb átmeneti hiba magától meggyógyul — a bejelentő böngészőlapja folytatja a beküldést, a Durable Object időzítők pedig exponenciális várakozással újrapróbálják a hiányzó KV-írásokat.

Az egyetlen eset, amely nem javítható automatikusan, a **bizonytalan létrehozás** (*uncertain create*): időtúllépés vagy leállás történt a létrehozási határ után, és a tároló hibajegyeinek (`state=all`) átvizsgálása **nulla** vagy **több** olyan hibajegyet talált, amely a Bot által írt korrelációs jelölőt tartalmazza. Mivel a GitHub nem kínál tartós idempotencia-kulcsot hibajegy-létrehozáshoz, a rendszer **soha nem próbálja újra automatikusan a bizonytalan létrehozást**, hogy elkerülje a dupla bejelentéseket.

Ilyenkor:

- A bejelentő a *„A bejelentés befejezéséhez ember segítsége kell”* üzenetet, egy rövid **azonosítót** (például `A1B2-C3D4`) és a beállított kapcsolattartási szöveget látja.
- Az e-mail-címről mindaddig nem adható le új bejelentés, amíg egy rendszergazda össze nem kapcsolja vagy el nem veti a félbemaradt kísérletet.

## A helyreállító CLI eszköz

Az `app/` mappából futtassa az `npm run recovery` parancsot (`app/scripts/recovery.ts`). Minden hívás Admin jogosultsághoz kötött Worker végpontot (`/api/admin/recovery/*`) hív a **saját** GitHub-tokenjével, és jogosultság hiányában zártan elutasítja a kérést.

```powershell
$env:APP_URL = "https://<sajat-peldany>"        # vagy --url kapcsoló
$env:GITHUB_TOKEN = (gh auth token)             # vagy --token; hiányában a `gh auth token` fut

npm run recovery -- list
npm run recovery -- inspect   --reference A1B2-C3D4          # vagy --email anna@example.hu
npm run recovery -- associate --reference A1B2-C3D4 --issue 142
npm run recovery -- discard   --reference A1B2-C3D4
```

- A `list` kilistázza a segítségre váró kísérleteket (azonosító, fázis, időpont) e-mail-cím kiírása nélkül.
- Az `--email` paraméter olyan kísérleteket is megtalál, amelyek még javítás alatt állnak és még nincsenek a `list` eredményében.

## Lépésről lépésre eljárás

1. **Vizsgálat (`inspect`):**
   Futtassa az `inspect --reference <AZONOSÍTÓ>` (vagy `--email <CÍM>`) parancsot. Jegyezze fel az e-mail-címet, a bejelentés címét, kategóriáját, helyszínét, fázisát és a pontos korrelációs jelölősort (`<!-- fault-report-attempt: ... -->`). A parancs újra átvizsgálja a GitHubot és kiírja az esetleges egyezéseket.
2. **Ellenőrzés a GitHubon:**
   Keressen rá a `reports` tárolóban (**nyitott és lezárt** hibajegyek között is) a jelölősorra, a címre és az időpontra. Az automatikus vizsgálat csak a Bot által írt pontos jelölősort fogadja el; kézzel szerkesztett törzs nem ad automatikus egyezést.
3. **Döntés és lezárás:**
   - **Pontosan egy megfelelő hibajegy létezik:** futtassa az `associate --reference <AZONOSÍTÓ> --issue <SZÁM>` parancsot.
     A Worker ellenőrzi, hogy a hibajegy létezik, nem pull request, a Bot hozta létre, és nincs még más bejelentéshez kötve, majd befejezi a három KV-leképezést.
     ::: info A bejelentő értesítése manuálisan
     Az `associate` nem küld visszaigazoló e-mailt. Ha a bejelentő lapja még nyitva van, frissítéskor megjelenik az állapothivatkozás; ellenkező esetben kérje le a hivatkozást a Részletek nézetben és juttassa el a bejelentőnek.
     :::
   - **Több hibajegy viseli a jelölőt:** válassza ki a megtartandó hibajegyet, zárja le vagy törölje a többit a GitHubon, majd futtassa az `associate` parancsot a megtartott sorszámra.
   - **Nem jött létre hibajegy:** futtassa a `discard --reference <AZONOSÍTÓ>` parancsot. Ez eltávolítja a félbemaradt kísérletet és az esetleges részleges leképezéseket, felszabadítva a bejelentő e-mail-címét új beküldéshez.
4. **Ellenőrzés:**
   A `list` már nem mutatja az azonosítót, az `inspect --email <CÍM>` pedig azt válaszolja, hogy nincs mentett bejelentés.

## Életciklus-megjegyzések

- A megoldatlan kísérletek **nem járnak le némán** — csak az `associate`, a `discard` vagy az [Adattörlés (Erasure)](/hu/operations/erasure) távolítja el a megőrzött e-mail-címet és tartalmat.
- A sikeresen befejezett beküldések **24 óráig** őriznek meg egy visszajátszható nyugtát (amely hivatkozáscsere vagy törlés esetén azonnal érvényét veszti).
- A Durable Object takarítása logikai törlés; a Cloudflare SQLite időpont-visszaállítási (point-in-time recovery) naplója legfeljebb 30 napig őrizhet korábbi állapotot.
