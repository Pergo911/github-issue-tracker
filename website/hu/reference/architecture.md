# Architektúra és adatvédelem

A Hibabejelentő egy statikus React 19 SPA-t, egy **Cloudflare Workers** alapú Hono háttérszolgáltatást, egy privát **GitHub-szervezeti** tárolót (mint adattárat) és a **Resend** e-mail-szolgáltatását fogja össze.

## Rendszeráttekintés

```text
┌─────────────────────────┐  ┌─────────────────────────┐  ┌───────────────────────────┐
│  BEJELENTŐ ŰRLAP        │  │      ÁLLAPOTOLDAL       │  │     MUNKATÁRSI FELÜLET    │
│  (bejelentkezés nélkül) │  │  (kitalálhatatlan link, │  │   (GitHub Device Flow)    │
│                         │  │   bejelentkezés nélkül) │  │                           │
│  E-mail → 6 jegyű OTP → │  │  Csak olvasható állapot │  │  Közvetlen api.github.com │
│  Beküldés + folytatás   │  │  + idővonal + megjegyzés│  │  + jogosultságos Worker   │
└────────────┬────────────┘  └────────────┬────────────┘  └─────────────┬─────────────┘
             │                            │                             │
             ▼                            ▼                             ▼
      ┌─────────────────────────────────────────────────────────────────────────┐
      │         Cloudflare Worker (közös origin a statikus SPA-val)             │
      │  • OTP kérés és ellenőrzés+beküldés (hibajegy létrehozása Bot App-pal)  │
      │  • Állapot lekérdezés (30 mp gyorsítótár) és bejelentői megjegyzés      │
      │  • GitHub Device Flow proxy (client_secret nélkül)                      │
      │  • GitHub `issues` webhook fogadó (jelentős változások és adattörlés)   │
      │  • Szerepkörhöz kötött végpontok (elérhetőség, hivatkozáscsere,         │
      │    Bejelentők listája, Munkatársak, Beállítások, helyreállítás)         │
      └───────────────┬──────────────────────────┬──────────────────────────────┘
                      │                          │
                      ▼                          ▼
        ┌──────────────────────────┐   ┌──────────────────────────┐
        │   Workers KV             │   │  Durable Objects (SQLite)│
        │  • allowlist:<email>     │   │  • Email gate (OTP-k,    │
        │  • issue-email:<n>       │   │    korlátok, folytatás)  │
        │  • status-token:<token>  │   │  • Report gate (kvóták,  │
        │  • issue-token:<n>       │   │    csere/törlés zár)     │
        │  • webhook-seen:<id>     │   │  • Global gate (napi     │
        │  • config                │   │    kódkeret)             │
        └──────────────────────────┘   └──────────────────────────┘
```

### Miért Cloudflare Workers + KV + Durable Objects?

- **Egy origin, egy telepítés:** a Workers Static Assets ugyanarról az originről szolgálja ki a React SPA-t, mint a Worker API-t, így nincs szükség extra CORS-beállításokra a Device Flow proxyhoz vagy a bejelentői kérésekhez.
- **Megfelelő tár minden terhelésre:** a Workers KV a főleg olvasott vagy egyszer írt leképezéseket tárolja; az SQLite alapú Durable Objects atomi, erősen konzisztens állapotot ad az OTP-ellenőrzéshez, visszaélés elleni korlátokhoz, beküldés-helyreállításhoz és a hivatkozáscsere/adattörlés sorosításához.
- **Közvetlen munkatársi hívások:** a Device Flow proxyval megszerzett lejáró GitHub App felhasználói tokennel a Munkatársi felület közvetlenül az `api.github.com`-ot hívja, szigorúan a telepített `reports` tárolóra korlátozott jogosultsággal.

## Biztonsági és adatvédelmi invariánsok

Ezeket az elveket a Worker, a megosztott kódolók és az automatikus tesztek közösen kényszerítik ki:

1. **Bejelentő e-mail-címe soha nem íródik a GitHubba.** Sem a hibajegy címe, sem a leírása, sem a hozzászólások, sem a címkék nem tartalmazhatják a bejelentő e-mail-címét vagy a Bejelentők listáján szereplő megjegyzést. A leképezések kizárólag a Workers KV-ban maradnak, szerveroldali szerepkör-ellenőrzés (`Triage` vagy `Admin`) mögött.
2. **A bejelentőknek nincs GitHub-identitásuk.** A **Bot** (Adminisztráció jogosultság nélküli GitHub App telepítési token) hozza létre a bejelentéseket és teszi közzé a bejelentői megjegyzéseket.
3. **Szigorú engedélyezőlistás nézet az állapotoldalon.** Az állapot-lekérdező végpont csak a kifejezetten engedélyezett mezőket adja vissza. A belső prioritás, munkatársi felhasználónevek, profilképek, GitHub URL-ek, idegen címkék és gépi korrelációs metaadatok soha nem jutnak ki. Az oldal `Referrer-Policy: no-referrer` fejléccel védi a token kiszivárgását.
4. **Kanonikus dinamikus kódkeretek a bejelentői szövegekre.** A bejelentői leírás, a pontos hely és a megjegyzések dinamikus hosszúságú visszaaposztróf-keretben (`max(3, leghosszabb_sorozat + 1)` darab `` ` ``) tárolódnak a GitHubon, így a felhasználói Markdown, HTML, `@említés` vagy `#hivatkozás` nem fut le és nem tudja bezárni a keretet. A felületek a nyers keretet dekódolják és egyszerű szövegként jelenítik meg.
5. **Validált bejelentéscímek.** A cím 3–80 karakter hosszú lehet, és kizárólag engedélyezett karaktereket (betűk, számok, szóköz és biztonságos írásjelek, köztük magyar idézőjelek) fogad el; a visszaaposztrófot, kettőspontot, `@`, `#` és HTML-jeleket néma cserélgetés nélkül elutasítja.
6. **Bot-hitelesített szerző-megkülönböztetés.** Egy hozzászólás kizárólag akkor jelenik meg *Bejelentő* jelöléssel, ha a példány rögzített Bot identitása (`BOT_USER_ID`, `BOT_LOGIN`, `type: Bot`) írta **és** érvényes kanonikus bejelentői keretet visel. Ha egy munkatárs kézzel beírja a `**Reporter:**` szöveget, az akkor is munkatársi hozzászólás marad.
7. **Szerveroldali jogosultság-ellenőrzés.** Minden védett Worker végpont minden kérésnél a hívó GitHub-tokenjével ellenőrzi a `reports` tároló `permissions` mezőjét, és elérhetetlenség esetén zártan elutasít.

## Besorolási szerződés (Taxonomy)

A bejelentések besorolása kizárólag GitHub-címkékkel (négy rögzített dimenzióban) és a GitHub nyitott/lezárt állapotával történik (GitHub Projects v2 függőség nélkül):

| Dimenzió | Címke-előtag | Ki állítja be | Számosság | Láthatóság |
| --- | --- | --- | --- | --- |
| Kategória | `category:<id>` | Bejelentő (Karbantartó javíthatja) | Pontosan 1 | Nyilvános + Munkatársi |
| Helyszín | `location:<id>` | Bejelentő (Karbantartó javíthatja) | Pontosan 1 | Nyilvános + Munkatársi |
| Prioritás | `priority:<id>` | Csak Munkatárs | 0 vagy 1 | Csak Munkatársi |
| Állapot | `status:<id>` | Bot létrehozáskor, Felület váltáskor | Nyitottnál 1 (lezártnál 0) | Nyilvános + Munkatársi |

Két állapotjelző irányítja az automatizmust a címke szövegétől függetlenül:
- **`initial`** — pontosan egy állapot; új és újranyitott bejelentéseknél alkalmazódik, belépése soha nem küld e-mailt.
- **`notify`** — választható; ha nyitott bejelentés ebbe az állapotba lép, egyszerű szöveges értesítő e-mail megy a bejelentőnek.

## Sebességkorlátok és ingyenes keretek

| Végpont | IP-alapú korlát | Kulcsalapú korlát |
| --- | --- | --- |
| OTP kérés | 5 / perc | 60 mp várakozás, 5 / óra, 10 / nap e-mailenként; állítható napi példánykeret (alapértelmezés: 40 / nap) |
| Ellenőrzés és beküldés | 10 / perc | 5 hibás próbálkozás / 6 jegyű kód (10 perces érvényesség) |
| Beküldés folytatása | 10 / perc | Érvényes 128 bites helyreállítási azonosító |
| Állapot lekérdezés | 20 / perc | 6 / perc tokenenként (30 mp Workers Cache API TTL) |
| Bejelentői megjegyzés | 6 / perc | 3 / perc tokenenként; 20 / nap bejelentésenként |
| Hivatkozáscsere (birtokos) | — | 3 / nap bejelentésenként (Karbantartónak / Rendszergazdának korlátlan) |

Az alapértelmezett napi 40 kódos keret a Resend napi 100 leveles ingyenes keretéhez igazodik (helyet hagyva a visszaigazolásoknak, jelentős változási értesítőknek és hivatkozáscseréknek). Az e-mail-küldés legjobb törekvésű; a hiteles forrás mindig az állapothivatkozás.
