# Adattörlés (Erasure)

Ez a leírás bemutatja, hogyan hajtja végre egy **Rendszergazda** (GitHub tároló Admin) a bejelentő adattörlési kérését.

## Alapelvek

- **Bejelentésenkénti törlés tervezetten:** a rendszerben szándékosan nincs `e-mail → összes bejelentés` fordított index. Kérje el a bejelentőtől a törlendő bejelentések sorszámát (minden visszaigazoló e-mail tárgyában és törzsében szerepel a sorszám), és ismételje meg az 1. lépést minden érintett bejelentésre.
- **Előfeltételek:**
  - A GitHub-szervezetben engedélyezve kell lennie a hibajegyek törlésének (**Settings → Member privileges → Issue deletion**).
  - A tároló webhookjának aktívan kell küldenie az `issues` eseményeket a `https://<sajat-peldany>/api/github/webhook` címre.

## Eljárás

### 1. A bejelentés hibajegyének törlése a GitHubon

Nyissa meg a bejelentést a github.com-on, majd kattintson a **Delete issue** gombra (tároló Admin jogosultság szükséges).

A törlés hatására:
- A bejelentés és minden hozzászólása eltűnik a GitHubról.
- A GitHub elküldi az `issues` (`action: "deleted"`) webhookot a Workernek.
- A Report gate Durable Objecten keresztül a Worker:
  1. rögzít egy üres törlési jelölést (a GitHub soha nem használ újra sorszámot, így késői javítás vagy hivatkozáscsere véglegesen elutasításra kerül);
  2. törli az esetleges függőben lévő helyreállítást és 24 órás nyugtát;
  3. törli az `issue-email:<n>`, `issue-token:<n>` és `status-token:<token>` kulcsokat a Workers KV-ból.
- A törlésről nem megy ki e-mail.

### 2. Eltávolítás a Bejelentők listájáról

A Munkatársi felület **Bejelentők listája** képernyőjén távolítsa el a bejelentő e-mail-címét (ezzel a belső megjegyzés is törlődik), így a cím nem kérhet új kódot, hacsak később újra fel nem veszik.

### 3. Még nem összekapcsolt, félbemaradt beküldés elvetése

Ha a bejelentőnek volt olyan megszakadt beküldése, amelyhez még nem készült GitHub-hibajegy, az 1. lépés azt nem érinti. Ellenőrizze e-mail-cím alapján és vesse el a [helyreállító CLI-vel](/hu/operations/submission-recovery):

```powershell
cd app
npm run recovery -- inspect --email anna@example.hu
npm run recovery -- discard --email anna@example.hu
```

### 4. Opcionális teljességi ellenőrzés a Workers KV-ban

Mivel a GitHub nem próbálja újra automatikusan a sikertelen webhook-kézbesítéseket, az üzemeltető opcionálisan kilistázhatja offline az `issue-email:*` kulcsokat a KV névtérben, és rákereshet a bejelentő e-mail-címére.

Ha maradt bejegyzés:
- küldje újra a `deleted` webhookot a tároló **Settings → Webhooks → Recent Deliveries** oldaláról, vagy
- törölje közvetlenül a három KV-kulcsot (`issue-email:<n>`, `issue-token:<n>`, `status-token:<token>`).

## Ellenőrzőlista

- A `https://<sajat-peldany>/status/<régi-token>` megnyitása az általános „Ez a hivatkozás nem működik” (`404`) oldalt adja vissza.
- Az `issue-email:<n>`, `issue-token:<n>` és `status-token:<token>` kulcsok eltűntek a Workers KV-ból.
- A cím lekerült a Bejelentők listájáról, és a `recovery inspect --email <cím>` nem mutat megőrzött beküldést.

## Megmaradó metaadatok és külső határok

- **Személyes adat nélküli záróállapot:** a Report gate csak a sorszám törlési jelölését és számlálóit őrzi meg — e-mail-címet, leírást vagy tokent nem.
- **Szolgáltatói pillanatképek:** az SQLite alapú Durable Objects takarítása logikai törlés; a Cloudflare point-in-time recovery legfeljebb 30 napig őrizhet történeti állapotot.
- **Resend naplók:** a Resend körülbelül 30 napig őrzi meg az elküldött egyszerű szöveges leveleket (amelyek legfeljebb a címet és az állapothivatkozást tartalmazzák, a leírást soha), utána automatikusan lejárnak.
- **Szervezeti válaszcím-postafiók:** ha a bejelentő válaszolt a szervezet figyelt `Reply-To` címére, azok a levelek a szervezet saját levelezőrendszerében vannak, és kérés esetén ott kezelendők.
