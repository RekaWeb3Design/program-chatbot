# Deploy útmutató – Tisza Program Chatbot

## Előfeltételek

- GitHub account (a repóhoz)
- Cloudflare account (ingyenes plan elég)
- OpenAI API key ([platform.openai.com](https://platform.openai.com))

## 1. lépés – Cloudflare account

1. Regisztrálj a [cloudflare.com](https://cloudflare.com) oldalon, ha még nincs accountod
2. Lépj be a Cloudflare Dashboard-ra

## 2. lépés – Cloudflare Pages projekt létrehozása

1. A Dashboard-on navigálj: **Workers & Pages** → **Create**
2. Válaszd a **Pages** fület
3. Kattints: **Connect to Git**
4. Válaszd ki a **tisza-program-chatbot** GitHub repót
5. Engedélyezd a Cloudflare hozzáférését a repóhoz

## 3. lépés – Build beállítások

A Cloudflare Pages build konfigurációs oldalán:

| Beállítás | Érték |
|-----------|-------|
| **Production branch** | `main` |
| **Build command** | `npm run process` |
| **Build output directory** | `public` |
| **Root directory** | `/` (hagyj üresen) |
| **Node.js version** | `18` (vagy újabb) |

## 4. lépés – Environment Variables (titkos kulcsok)

Ez a legfontosabb lépés!

1. Még a build beállítások oldalán, görgess le az **Environment variables** szekcióhoz
2. Kattints: **Add variable**
3. Állítsd be:
   - **Variable name:** `OPENAI_API_KEY`
   - **Value:** a te OpenAI API kulcsod (pl. `sk-...`)
4. Fontos: válaszd az **Encrypt** opciót, hogy a kulcs titkosítva legyen

Alternatíva Wrangler CLI-vel:
```bash
npx wrangler secret put OPENAI_API_KEY
# Paste your key when prompted
```

## 5. lépés – Deploy

1. Kattints a **Save and Deploy** gombra
2. Várd meg amíg a build lefut (1-2 perc)
3. A deploy sikeres, ha zöld pipát látsz
4. A Cloudflare automatikusan ad egy URL-t: `https://tisza-chatbot.pages.dev` (vagy hasonló)

## 6. lépés – Egyedi domain (opcionális)

1. A Pages projekt beállításaiban: **Custom domains**
2. Add hozzá a saját domained (pl. `chatbot.tiszapart.hu`)
3. Kövesd a DNS beállítási útmutatót

## Automatikus deploy

Minden push a `main` branch-re automatikusan triggerel egy új deploy-t. Nincs szükség manuális lépésekre.

## Hibaelhárítás

### "OPENAI_API_KEY nincs beállítva" hiba
- Ellenőrizd, hogy az Environment Variables-ban be van-e állítva a kulcs
- A **Production** és **Preview** környezetben is be kell állítani

### Build hiba
- Ellenőrizd, hogy a `scripts/source.md` tartalmaz-e valós szöveget
- A `npm run process` helyileg lefut-e hiba nélkül

### 502 / API hiba
- Ellenőrizd az OpenAI API key érvényességét
- Ellenőrizd, hogy van-e kredit az OpenAI accountodon
- A Cloudflare Pages Functions logjaiban láthatsz részletes hibákat: **Functions** → **Logs**
