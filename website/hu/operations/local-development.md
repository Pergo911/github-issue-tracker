# Helyi fejlesztés

A Hibabejelentő helyi fejlesztéséhez és kipróbálásához nincs szükség GitHub-szervezetre, Resend API-kulcsra vagy Cloudflare fiókra. Az `app/` mappában indított `npm run dev` egy teljes **helyi világot** indít — állapotmegőrző, memóriában futó hamisított `api.github.com`, GitHub Device Flow és `api.resend.com` kiszolgálókkal — közvetlenül a helyi Workerhez és SPA-hoz kötve.

## Előfeltételek

- **Node 24+** (a tároló az `app/.node-version` fájlban Node 26-ot használ)
- **npm**
- **Docker** *(kizárólag a vizuális regressziós `npm run test:visual` futtatásához kell)*

## A helyi világ indítása

Az `app/` mappából:

```powershell
npm ci
npm run seed
npm run dev
```

Az `npm run seed` feltölti a referencia konfigurációt a helyi Wrangler KV-ba (`.wrangler/state`). Az `npm run dev` elindítja a SPA-t, a Workert és a helyi hamis szolgáltatásokat az `5173`-as (vagy a következő szabad) porton (`PORT=<szám>` rögzítheti).

Egy második terminálban töltse fel a minta munkatársakat, címkéket és bejelentéseket a futó helyi világba:

```powershell
cd app
npm run world -- seed
npm run world -- summary
```

### Hasznos `npm run world` parancsok

A helyi hamis szolgáltatások a memóriában tárolják az állapotot, ezért az `npm run dev` újraindítása alaphelyzetbe állítja őket. Futás közben az `npm run world -- <módszer>` paranccsal vizsgálhatók és vezérelhetők:

| Parancs | Feladata |
| --- | --- |
| `npm run world -- seed` | Feltölti a címkéket, szerepkörönként egy-egy minta munkatársat (tokennel) és minta bejelentéseket. |
| `npm run world -- summary` | Kilistázza az aktuális tárolókat, bejelentéseket, felhasználókat, tokeneket és leveleket. |
| `npm run world -- latestMailTo <email>` | Kiolvassa az adott címre küldött legutóbbi levelet (pl. a 6 számjegyű OTP kódhoz). |
| `npm run world -- outbox` | Megjeleníti a hamis Resend szerver kimenő levelesládáját. |
| `npm run world -- deviceCodes` | Kilistázza a függőben lévő GitHub Device Flow kódokat. |
| `npm run world -- approveDeviceCode <KÓD> <login>` | Jóváhagy egy függőben lévő Device Flow bejelentkezést egy minta munkatársnak. |
| `npm run world -- reset` | Törli a memóriabeli hamis GitHub és Resend állapotot. |

A lemezen lévő helyi Wrangler KV és Durable Object állapot alaphelyzetbe állításához futtassa az `npm run reset` parancsot (utána ismét `npm run seed`).

## A Windows asztali keretalkalmazás helyi futtatása

Miközben az `app/` fut a `http://localhost:5173` címen, egy új terminálban a `shell/` mappából:

```powershell
cd shell
npm ci
$env:APP_URL = "http://localhost:5173"
npm start
```

A nem csomagolt `npm start` engedélyezi a `http://localhost` címeket; a csomagolt kiadás csak HTTPS-t fogad el.

## Ellenőrző parancsok

Az `app/` mappából futtathatók:

| Parancs | Mit futtat |
| --- | --- |
| `npm run verify -- --fast` | Típusellenőrzés, ESLint, Prettier, egységtesztek, Worker tesztek és eszköztesztek (böngésző és Docker nélkül). |
| `npm run test:unit` | Vitest Node-ban (`shared/`, kliens logika, hamis szerverek, lint szabályok, fordítási katalógus teljessége). |
| `npm run test:worker` | Vitest a helyi Cloudflare Workers futtatókörnyezetben (KV, Durable Objects, sebességkorlátok). |
| `npm run test:e2e` | Playwright végponttól végpontig tesztek, axe akadálymentességi ellenőrzés és pszeudo-nyelvi vizsgálat. |
| `npm run screenshots` | Képernyőképek készítése minden deklarált képernyőről világos és sötét módban, 1280px és 375px szélességben. |
| `npm run test:visual` | Vizuális összehasonlítás az `app/e2e/reference/*.png` képekkel Playwright Docker konténerben. |
| `npm run verify` | Teljes ellenőrzési csomag (minden a fentiek közül). |

::: tip Párhuzamos munkafák (worktree-k)
Sem az `app/`, sem a `shell/` nem használ rögzített portot vagy közös globális állapotot. Az `npm run verify` gépszintű zárolással sorba állítja a párhuzamos futásokat, így nem zavarják egymás tesztjeit.
:::
