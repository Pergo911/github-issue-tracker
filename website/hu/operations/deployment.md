# Üzembe helyezés

Minden **Szervezet** saját, önálló **példányt** (*Deployment*) üzemeltet. A React SPA és a Hono Cloudflare Worker egyetlen Worker egységként (statikus erőforrásokkal) kerül kihelyezésre; a Windows asztali alkalmazás ugyanezt a HTTPS címet nyitja meg.

## Előfeltételek

- **Node 24+** és **npm**
- **GitHub CLI** (`gh`), bejelentkezve olyan fiókkal, amely **Admin** jogosultsággal rendelkezik a `reports` tárolón (beleértve a hibajegyek törlését és a webhookok kezelését)
- **Cloudflare fiók** Workers, Workers KV és SQLite alapú Durable Objects hozzáféréssel
- **Resend fiók** saját domainnel (dedikált `mail.<sajat-domain>` küldő aldomainhez)
- **Docker** *(nem kötelező, csak a helyi `npm run test:visual` futtatásához szükséges)*

## 1. Fiókok és szolgáltatások előkészítése

### GitHub-szervezet és tárolók

1. Hozzon létre egy **GitHub-szervezetet** és benne két privát tárolót: `reports` (éles adatok) és `reports-sandbox` (opcionális, élő szerződéstesztekhez).
2. A GitHub-szervezetben kapcsolja be a **Settings → Member privileges → Issue deletion** opciót (az [Adattörlés (Erasure)](/hu/operations/erasure) eljáráshoz szükséges).
3. Ossza ki a munkatársak tárolószerepköreit a `reports` tárolón:
   - **Read** → Megtekintő
   - **Triage** → Karbantartó
   - **Admin** → Rendszergazda
   - **Soha** ne adjon GitHub-tárolóhozzáférést a bejelentőknek.

### Két GitHub-alkalmazás regisztrálása

Hozzon létre két GitHub-alkalmazást (*GitHub App*) a GitHub-szervezetre korlátozva, **GitHub-szervezeti szintű jogosultságok nélkül** és **kikapcsolt alkalmazás-webhookkal**:

| Alkalmazás | Tárolószintű jogosultságok | Device Flow | Feljegyzendő adatok |
| --- | --- | --- | --- |
| **Munkatársi App** (`reports-staff`) | **Metadata: read**, **Issues: read and write**, **Administration: read and write** | **Engedélyezve** (lejáró felhasználói tokenekkel) | Client ID (callback URL és client secret nem szükséges) |
| **Bot App** (`reports-bot`) | **Metadata: read**, **Issues: read and write** (*soha* ne kapjon Administration jogot) | Kikapcsolva | App ID, privát kulcs (`.pem`), Installation ID |

Telepítse mindkét alkalmazást kizárólag a `reports` (és ha van, a `reports-sandbox`) tárolóra. Jegyezze fel a Bot **Installation ID** értékét a telepítési beállítások URL-jéből.

::: info Meglévő Munkatársi App frissítése
Ha utólag adja hozzá az **Administration: read and write** jogosultságot egy meglévő Munkatársi alkalmazáshoz, hagyja jóvá a frissítést a GitHub-szervezet alkalmazástelepítési beállításaiban. A már bejelentkezett rendszergazdáknak újra be kell jelentkezniük a Munkatársak képernyő megnyitása előtt.
:::

### Cloudflare és Resend

1. Jelentkezzen be a Wranglerbe az `app/` mappából:
   ```powershell
   npx wrangler login
   ```
2. A **Resend** felületén adjon hozzá és hitelesítsen egy dedikált `mail.<sajat-domain>` aldomaint (európai szervezeteknek az EU – Írország régió ajánlott), vegye fel a DKIM, SPF, MX és DMARC DNS-rekordokat, majd hozzon létre:
   - egy erre a domainre korlátozott **csak küldésre jogosult API-kulcsot** (Worker secretként töltődik fel);
   - *(opcionális)* egy külön teljes hozzáférésű kulcsot kizárólag az üzemeltető gépére az élő elfogadási ellenőrzéshez.
3. Válasszon ki egy már figyelt postafiókot válaszcímnek (`Reply-To`).

### Titkok tárolása a tárolón kívül

Mentse a titkokat a git tárolón kívüli, csak az üzemeltető által olvasható mappába (a szkriptek alapértelmezetten a `%USERPROFILE%\.config\github-issue-tracker-deployment` mappát használják, amely a `REPORTS_DEPLOYMENT_DIR` változóval módosítható):

- `bot-private-key.pem` — a letöltött Bot App privát kulcs (PKCS#1 és PKCS#8 formátum egyaránt elfogadott).
- `secrets.env` — `RESEND_API_KEY=<kuldo-kulcs>` (és opcionálisan `RESEND_LIVE_CHECK_KEY=<teljes-kulcs>`, amely soha nem kerül fel a Cloudflare-re).

## 2. A Worker és a SPA beállítása és telepítése

Futtassa az alábbi PowerShell-parancsokat az `app/` mappából:

```powershell
npm ci
npx wrangler kv namespace create KV
```

Frissítse az `app/wrangler.jsonc` fájlban a nem titkos értékeket:

- Worker `name` és az új `KV` névtér `id` azonosítója
- `GITHUB_ORG`, `GITHUB_REPO` (`reports`), `RESEND_FROM_DOMAIN`, `APP_URL` (`https://<worker-nev>.<aldomain>.workers.dev`)
- `BOT_APP_ID`, `BOT_INSTALLATION_ID` és `STAFF_APP_CLIENT_ID`

Rögzítse a Bot numerikus GitHub-felhasználói azonosítóját (ez a **user ID**, nem az App ID):

```powershell
gh api 'users/<bot-app-slug>[bot]' --jq '{id,login,type}'
```

Állítsa be a kapott `BOT_USER_ID` és `BOT_LOGIN` értékeket az `app/wrangler.jsonc` fájlban (`type` értéke kötelezően `Bot`).

Ezután töltse fel a három kötelező Worker titkot (`BOT_APP_PRIVATE_KEY`, `RESEND_API_KEY`, `GITHUB_WEBHOOK_SECRET`), fordítsa le, telepítse a Workert, és regisztrálja a tároló webhookját:

```powershell
$env:APP_URL = 'https://<worker-nev>.<aldomain>.workers.dev'
$env:GITHUB_ORG = '<github-szervezet>'
$env:GITHUB_REPO = 'reports'
$env:GITHUB_REPOSITORY = "$env:GITHUB_ORG/$env:GITHUB_REPO"
$env:REPLY_TO = '<figyelt-postafiok>'

# Létrehozza a webhook-secret.txt fájlt a privát mappában és feltölti mindhárom titkot a Wranglernek
npm run deploy:reference -- secrets

npm run typecheck
npm run build
npx wrangler deploy

# Létrehozza vagy frissíti a tároló webhookját az <APP_URL>/api/github/webhook címre
npm run deploy:reference -- webhook
gh api "repos/$env:GITHUB_REPOSITORY/hooks" --jq '.[] | {id,events,active,last_response}'
```

Ellenőrizze, hogy a webhook ping válaszának `last_response.code` értéke `202`.

## 3. Kezdeti beállítások megadása

Jelentkezzen be Device Flow-val tároló Admin fiókkal a `https://<sajat-peldany>/staff/configuration` oldalon, és mentse el a szervezet nevét, vészhelyzeti tájékoztatóját, besorolási rendszerét, e-mail-beállításait, felületi nyelvét (`hu` vagy `en`), időzónáját és napi kódkeretét.

A mentés automatikusan szinkronizálja a besorolási címkéket a `reports` tárolóba. Az első sikeres mentésig a nyilvános felület „még nincs beállítva” üzenetet jelenít meg (a KV-frissülés kb. egy percet vehet igénybe).

::: warning Demó előtöltés
Friss magyar bemutató példányon az `npm run deploy:reference -- configure` paranccsal előtölthető az Appendix A szerinti mintabesoro­lás. Ez **felülírja a teljes elmentett konfigurációt** — már testreszabott éles példányon ne futtassa!
:::

## 4. Élő ellenőrzés és Windows csomagolás

1. **Automatikus élő elfogadási teszt** *(opcionális, `RESEND_LIVE_CHECK_KEY` szükséges)*:
   ```powershell
   npm run check:live -- --screenshots
   ```
   A szkript végigpróbálja a Bejelentők listájára vételt, a kódkérést, a bejelentés leadását, az állapotoldalt, a bejelentői megjegyzést, a lezárást és levelet, a hivatkozáscserét, majd a teljes takarítást a `delivered+live@resend.dev` címmel. Megszakított futás után az `npm run check:live -- --cleanup` takarít ki.
2. **Valós postafiókos próba:** adjon le és zárjon le egy próba bejelentést saját engedélyezett e-mail-címmel, ellenőrizze a kézbesítést és a magyar szövegezést, majd törölje a próba bejelentést és távolítsa el a próba címet.
3. **Windows asztali alkalmazás csomagolása:** kövesse a [Windows asztali alkalmazás](/hu/guide/desktop-app) leírást a `shell/` mappából a saját `APP_URL`, `APP_ID` és `PRODUCT_NAME` értékeivel.
