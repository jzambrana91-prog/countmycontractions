# Count My Contractions

A free, privacy-first contraction timer and a set of plain-language labor guides. The log stays in the browser. There is no account, no database, and no analytics.

The live tool is the home page. Frequency is measured from the start of one contraction to the start of the next. Duration, rest, last-hour averages, and a 5-1-1 / 4-1-1 / 3-1-1 pattern check are included. The pattern banner is a timing observation and a prompt to contact a provider. It is not a diagnosis.

## Stack

- [Astro](https://astro.build) static site (`output` stays the default static build)
- One plain JavaScript module for the timer math (`src/lib/contractions.js`)
- Node's built-in test runner
- A service worker and web app manifest in `public/`
- No UI framework, no web fonts, no backend

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm test
npm run dev
```

The dev server prints a local URL. Open it on a phone-sized window for the timer.

Production build and a local preview of that build:

```bash
npm run build
npm run preview
```

`npm run build` writes the static site to `dist/`. `npm test` runs the timing tests with `TZ=UTC`.

The service worker is registered only in production builds, so `npm run dev` does not cache pages. Use `npm run preview` if you want to check offline behavior: load the site once, then switch the browser to offline and reload.

## Deploy on Vercel

The site is static. Vercel can host it on the free Hobby plan by importing this GitHub repository. No environment variables are required.

When you import the repo, use these settings if Vercel does not fill them in automatically:

| Setting | Value |
| --- | --- |
| Framework preset | Astro |
| Root directory | `./` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js version | 22.x |

Leave the production branch as `main` after this project is merged. Do not add a server adapter. There is no `vercel.json` because the defaults above are enough.

After the first deployment, Vercel gives you a `*.vercel.app` URL. Check the timer, one guide, and `/privacy` on a phone before you point a domain at it.

### Custom domain later

1. In the Vercel project, open **Settings → Domains**.
2. Add `countmycontractions.com` and `www.countmycontractions.com`.
3. At the domain registrar, create the DNS records Vercel shows. As of this writing those are usually an **A** record for the apex (`countmycontractions.com`) pointing at `76.76.21.21`, and a **CNAME** for `www` pointing at `cname.vercel-dns.com`. Use the values in the Vercel dashboard if they differ.
4. Set `countmycontractions.com` as the primary domain and redirect `www` to it. Canonical tags, the sitemap, and Open Graph URLs already use `https://countmycontractions.com`.

HTTPS is issued by Vercel once DNS is correct. No extra SSL step is required.

## Timer behavior worth knowing

- **Duration** is the length of one contraction.
- **Apart / frequency** is start to start.
- **Rest** is from the end of one contraction to the start of the next.
- Comparisons use the nearest second, the same rounding as the on-screen length.
- A selected rule matches when the current streak of completed contractions meets the interval and the one-minute length, the streak spans at least an hour, and the pattern is still underway.
- Last-hour averages include contractions that started in the past 60 minutes. The frequency average can use the gap from the contraction just before that hour.
- Edits and deletes recalculate the pattern. Undo restores the previous log, including a clear.
- Screen Wake Lock is requested only while a contraction is in progress, and only in browsers that support it.

## Placeholders to fill in before AdSense

No advertising code is loaded. Dashed boxes marked **Advertisement** reserve space away from the start/stop button.

Before you apply to Google AdSense:

- Create the mailbox `hello@countmycontractions.com` (or replace that address in `src/data/site.js`, then rebuild). The contact page, footer, privacy policy, and terms all use it.
- Put the publisher's legal name, and a mailing address if you want one, on `/about` and `/contact`. Those sentences are marked **Owner placeholder**.
- Have a lawyer review `/terms`, `/privacy`, and `/medical-disclaimer`. Add the governing law on the terms page.
- Update `/privacy` on the day you add AdSense, including cookies and personalized ads, and add the `ads.txt` file Google gives you.
- Confirm the medical pages still match the public guidance you want to stand behind. Linked sources are ACOG's patient FAQ "How to Tell When Labor Begins" and the NHS page "Signs that labour has begun."

## Project map

- `src/pages/index.astro` — the timer
- `src/lib/contractions.js` — duration, frequency, averages, rule check, undo
- `test/contractions.test.js` — unit tests, including edits and deletes
- `src/pages/*.astro` — guides and trust pages
- `public/downloads/contraction-log.pdf` — the downloadable blank log
- `public/sw.js`, `public/manifest.webmanifest` — offline use and home-screen install
- `public/sitemap.xml`, `public/robots.txt` — search files

Regenerate icons, `og.png`, and the PDF with `python3 scripts/generate_assets.py` after `python3 -m pip install pillow`. The generated files are already committed, so a normal Vercel build does not need Pillow.
