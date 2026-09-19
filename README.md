# Petalcards

Make, save and study flashcards without an account. Petalcards 2.1 opens directly into your collection and stores decks, cards, themes and study progress in IndexedDB on your device. It works offline after its first successful online visit and can be installed as a desktop or mobile web app.

## What works offline

- Create and edit decks and cards, including **bold**, *italic*, `code`, images and image descriptions.
- Paste spreadsheet rows or import CSV/TSV with a preview; use **Save + add another** for quick entry.
- Organise decks in folders, add tags, mark favourites, and search both questions and answers. Large decks show 20 cards per page.
- Move cards between decks with their review history, or copy them with fresh progress.
- Study due, difficult, favourite or all cards. Choose a session length, shuffle, or show answers first.
- Use Previous/Next, arrow keys, touch swipes or the jump menu. Space flips; 1–4 rate a revealed answer. Moving between cards never changes their review schedules.
- Resume one unfinished session after reopening, including its order, position, ratings and revealed side. Each card can be rated once per session; start a new session to rate again.
- Review today's activity, the next seven days of scheduled reviews and cards needing practice. Mastery means the share of cards with a review interval of at least 21 days.
- Adjust card text size, enable focus view and choose any of six themes. Reduced-motion settings are respected.
- Undo deletions or restore decks and cards from the recycle bin. Emptying the bin is permanent.
- Export decks as CSV or JSON, and download a JSON backup with images, tags, folders, favourites and study progress.

Backup reminders appear after five initial changes, twenty changes since an export, or a week with unexported changes. Settings shows the last export time; **Later** postpones reminders for a day. The browser cannot confirm whether you kept the downloaded file.

There are no email, password, registration, sign-in or account-management screens or endpoints. New cards do not depend on Render uptime, cookies or a server database. The Node server serves the app files and can read an existing version 1 database to recover an already-authorized library.

## Preview

Download [the interactive preview](docs/Petalcards_Preview.html) and open it in a browser to try creating, studying and downloading cards. It uses a separate preview collection. Installation belongs to the deployed HTTPS app. Regenerate it with `npm run preview:build` after UI changes.

[Collection screenshot](docs/preview.png) · [Study screenshot](docs/preview-study.png) · [Phone screenshot](docs/preview-mobile.png)

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm start
```

Open `http://localhost:3000`. Use `PORT=3100 npm start` if port 3000 is busy. The starter deck opens immediately.

## Update the existing Render app

1. Merge the `feat/study-and-library-improvements` branch into the branch your Render service deploys, or select this branch in the service settings for testing.
2. Keep the existing Node web service. The build command can be `npm ci --omit=dev`; the start command is `npm start`.
3. Deploy the latest commit in Render. Merging on GitHub alone only updates the service if its auto-deploy is enabled.
4. Open the HTTPS service URL or your custom domain, then refresh. `/api/health` should show `"version":"2.1.0"` and `"storage":"device"`.
5. Wait for **Ready for offline use**. Disconnect and reopen the app to confirm it loads from its cached files.

**Seeing the old login page means the old build or assets are still being served.** Verify the deployed branch and commit, then hard-refresh once. This version has no login form. HTML, scripts and the service worker use revalidation headers to avoid mixing old and new assets.

All files under `public/` can also run on a static HTTPS host at its domain root. Static hosting does not provide the optional legacy recovery endpoint. Keep the Node service while recovering older server-saved cards.

## Install on a PC

Visit the app online in Chrome or Edge, then use **Install app** or the browser's address-bar install icon. Installation opens Petalcards in its own window with an app icon. This is a PWA; it does not require a separate executable installer. On supported Safari versions, use **File → Add to Dock**.

Installation requires HTTPS (or localhost for development) and a supported browser. If a browser cannot show an in-page installation prompt, the button opens instructions. Wait for **Ready for offline use** before disconnecting. An initial visit without internet cannot download the app. A failed cache download is reported in the status bar rather than claiming offline readiness.

When an updated app is cached, an **Update available** button appears. Save any open edits before applying it. Installing an update does not clear IndexedDB.

## Saving and backups

Cards are saved automatically after each successful edit. A save is confirmed only after the IndexedDB transaction commits. Storage failures keep the editor open and display an error; there is no temporary in-memory fallback that pretends to save.

Device storage belongs to the browser profile and domain. It is not cloud sync. The Render URL, `petalcards.space`, `www.petalcards.space`, different browsers and different devices each have separate storage. To move cards, use **Download backup**, open the destination, and choose **Import**. Imports add copies of decks and preserve their review progress without replacing existing work. They accept current backups and older Petalcards JSON deck exports. CSV/TSV imports support Front/Back (or Question/Answer), optional Hint and Tags columns, quoted commas and multiline answers. Without a header, the column order is front, back, hint, tags. CSV is a text-only format; use JSON to keep images and review progress.

Backups contain active decks. Restore items from the recycle bin before exporting if you want to keep them. The unfinished session and reading settings stay on the original device. Imports add decks without overwriting your local profile or theme. Existing version 2.0 device libraries are upgraded in place.

Clearing site data, removing a browser profile, private browsing or browser storage eviction can remove device data. Settings includes **Keep storage on device** to request persistence; the browser decides whether to grant it. Keep downloaded backups of important cards even if persistence is granted.

## Recovering cards from version 1

Keep the old SQLite file at `PETALCARDS_DB_PATH` (or `DATA_DIR/petalcards.sqlite`, default `./data/petalcards.sqlite`). No migration modifies or deletes that database.

On an online visit, the app tries a read-only recovery endpoint. A still-valid session or guest cookie authorizes copying only that session's old decks into device storage, including review progress. Each library is copied once, atomically; later visits do not duplicate it. This background step never blocks opening or editing local cards.

If the old cookie expired, the domain changed, or the server's SQLite file was lost, automatic recovery is unavailable. Previously downloaded JSON exports can be imported. Keep any server database backups: they are not made public and are not erased by this update. This app does not add a bypass for accessing old private libraries without their existing session.

## Checks

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

The browser checks exercise real IndexedDB and service-worker caching: first-run access, offline reload, offline editing and study, restart persistence, backup/import, independent browsers, multi-tab writes, storage failure handling, installation metadata and phone layout. They also cover the v1 IndexedDB upgrade, bulk imports, images, search and filters, undo/restore, move/copy, study modes and navigation, saved sessions, reading settings, backup revisions and the portable preview. Generate the documentation screenshots from isolated demo data with `node scripts/capture-preview.mjs`.

GitHub Actions runs the server checks and browser flow before building the Docker image. Runtime hosting has no third-party package dependencies. Playwright is a development-only dependency.

## Docker

```sh
docker compose up --build -d
```

For the included Caddy HTTPS setup, set `DOMAIN` in `.env`, point the domain at the server and run:

```sh
docker compose -f compose.yaml -f compose.production.yaml up --build -d
```

The existing `/data` volume is retained only for optional legacy recovery. New device-saved cards are backed up using the app's download controls.
