# Windows asztali alkalmazás

A Hibabejelentőhöz tartozik egy opcionális, vékony **Windows Electron keretalkalmazás** (`shell/`), amely egyetlen natív ablakban nyitja meg a szervezet üzembe helyezett HTTPS weboldalát. Nem oszt meg kódot az `app/` csomaggal, és a webes SPA sem tartalmaz asztali specifikus kódot — a böngészőben és az asztali alkalmazásban pontosan ugyanazok a képernyők jelennek meg.

## Hogyan működik a keretalkalmazás?

- **Egyetlen originre zárva:** betölti a beállított `APP_URL` címet, és az ablakon belüli navigációt ezen az originen tartja.
- **Külső hivatkozások a rendszer böngészőjében:** minden `target="_blank"` hivatkozás és `window.open` hívás a Windows alapértelmezett böngészőjében nyílik meg második ablak helyett. Ennek köszönhetően:
  - a visszaigazoló képernyőn kapott **állapothivatkozás** a böngészőben nyílik meg, ahol könyvjelzőzhető;
  - a **GitHub Device Flow** jóváhagyás a böngészőben zajlik, ahol a passkey, a kétlépcsős azonosítás és a meglévő GitHub-munkamenet megbízhatóan működik.
- **Szigorított biztonsági alapbeállítások:** a `contextIsolation` és a `sandbox` bekapcsolva marad, a `nodeIntegration` tiltott, **nincs preload szkript**, és minden böngészőengedély-kérés elutasításra kerül.
- **Hálózati hibaoldal:** ha a kiszolgáló nem érhető el, üres ablak helyett egyszerű hibaoldal jelenik meg.
- **Csomagolt változatban csak HTTPS:** a kiadott `.exe` fájlok kizárólag `https://` címeket fogadnak el. Helyi fejlesztéshez a nem csomagolt `npm start` engedélyezi a `http://localhost`, `http://127.0.0.1` és `http://[::1]` címeket is.

## Telepítés Windowsra

Minden példányhoz két, aláíratlan futtatható fájl készül a `shell/dist/` mappában:

- **`<ProductName>-Setup-<verzió>.exe`** — egykattintásos, **felhasználónkénti NSIS telepítő** (rendszergazdai jogosultság és telepítővarázsló nélkül).
- **`<ProductName>-<verzió>-portable.exe`** — telepítés nélkül futtatható, hordozható változat.

::: warning Windows SmartScreen figyelmeztetés
Mivel az alapértelmezett kiadások nincsenek kódtanúsítvánnyal aláírva, a Windows Defender SmartScreen az első indításkor figyelmeztetést mutathat. Kattintson a **További információ**, majd a **Futtatás mindenképpen** gombra.
:::

## Csomagolás saját példányhoz

Minden szervezet saját telepítőt épít a saját `APP_URL` címével (ez beépül a csomagolt `package.json` `extraMetadata.appUrl` mezőjébe). Futtassa PowerShellből a `shell/` mappában (Node 24+ és npm szükséges):

```powershell
cd shell
npm ci

$env:APP_URL = "https://<sajat-worker>.<sajat-aldomain>.workers.dev"
$env:APP_ID = "hu.pelda.hibabejelento"
$env:PRODUCT_NAME = "PeldaHibabejelento"

npm run build
```

### Build változók

| Változó | Kötelező | Alapértelmezett | Jelentése |
| --- | --- | --- | --- |
| `APP_URL` | Igen | — | A célpéldány HTTPS címe, amelyet az alkalmazás megnyit. |
| `APP_ID` | Nem | `app.faultreports.shell` | Windows alkalmazás- és eltávolítási azonosító. Frissítések között tartsa változatlanul, különböző szervezeteknél pedig adjon meg eltérőt, hogy ne írják felül egymást. |
| `PRODUCT_NAME` | Nem | `Hibabejelento` | Telepítési mappa, Start menü parancsikon és fájlnév-előtag. Ékezet nélküli (ASCII) név ajánlott. |

Az első fordítás letölti az Electron és NSIS eszközöket a GitHubról és ~120 MB-ot tömörít, ezért néhány percet igénybe vehet.

## Ellenőrzés

A `shell/` mappából futtatható:

| Parancs | Mit ellenőriz |
| --- | --- |
| `npm run verify` | Típusellenőrzés, Prettier formázás, egységtesztek (URL-szabályok, navigációs házirend, biztonságos beállítások, build konfiguráció) és Electron Playwright tesztek az `app/` fejlesztői szervere ellen. |
| `npm run test:installer` | *(Csak Windows, lassabb)* Felépíti a telepítőt, csendesen telepíti egy ideiglenes mappába, elindítja helyi HTTPS proxyn keresztül, képernyőképeket készít, majd eltávolítja. |
