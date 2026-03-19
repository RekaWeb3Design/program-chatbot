# Tisza Program Chatbot

AI chatbot a Tisza Párt 2026-os választási programjához. Split-view webalkalmazás: bal oldalon egy AI chatbot, amely kizárólag a programdokumentum alapján válaszol, jobb oldalon a program teljes szövege PDF-hű formázással, kattintható hivatkozásokkal.

## Tech stack

- Frontend: Vanilla HTML/CSS/JS
- Backend: Cloudflare Pages Functions
- AI: OpenAI GPT-4o mini
- Deploy: Cloudflare Pages

## Struktúra

```
├── public/              # Frontend fájlok (Cloudflare Pages output)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── data/            # Generált adatok (chunks + document HTML)
├── functions/           # Cloudflare Pages Functions
│   └── api/
│       └── chat.js      # OpenAI API proxy
├── scripts/
│   ├── process_doc.js   # Dokumentum feldolgozó script
│   └── source.md        # Nyers program szöveg (markdown)
├── data/                # Generált adatok másolata
├── wrangler.toml
└── package.json
```

## Lokális fejlesztés

### 1. Program szöveg beillesztése

Illeszd be a Tisza Párt programjának teljes szövegét a `scripts/source.md` fájlba markdown formátumban.

### 2. Dokumentum feldolgozása

```bash
npm run process
```

Ez generálja a `data/chunks.json` és `data/document.html` fájlokat, valamint átmásolja őket a `public/data/` mappába.

### 3. Fejlesztői szerver indítása

```bash
npm install
npm run dev
```

Ehhez szükséges az `OPENAI_API_KEY` environment variable beállítása:

```bash
# .dev.vars fájl a projekt gyökerében:
OPENAI_API_KEY=sk-...
```

## Deploy

Lásd a részletes útmutatót: [DEPLOY.md](DEPLOY.md)

Röviden:
1. Push a GitHub repóba
2. Cloudflare Pages → Connect to Git
3. Build command: `npm run process`, Output directory: `public`
4. Environment Variables → `OPENAI_API_KEY` beállítása
5. Deploy

## Dokumentum frissítése

1. Cseréld ki a `scripts/source.md` tartalmát az új szövegre
2. Futtasd: `npm run process`
3. Commitold és pushold a változásokat
4. Cloudflare Pages automatikusan újra deploy-ol
