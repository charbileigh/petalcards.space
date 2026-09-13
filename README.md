# Petalcards

A complete, self-hosted flashcard app. Petalcards has native email/password accounts, private decks, spaced review, downloadable CSV/JSON files, a pink light theme, and five dark themes.

It is a dynamic server application—not a static site and not a PWA. The app, API, authentication, and database all run on infrastructure you control.

## What is included

- Native registration, sign in, sign out, profile editing, password changes, and account deletion
- A separate private library for every account
- Deck and card creation, editing, deletion, and search
- A tested flashcard flow: open a deck, flip a card, rate it, and advance
- Lightweight spaced-review scheduling and progress statistics
- CSV and JSON downloads for every deck
- Pink light mode plus purple, blue, green, berry, and grey dark modes
- SQLite persistence with no external database account or API keys
- Docker Compose for local use and Caddy for automatic production HTTPS
- No analytics, ads, service worker, web manifest, or third-party sign-in

## Fastest local start

You need Docker with the Compose plugin.

```bash
git clone https://github.com/charbileigh/petalcards.space.git
cd petalcards.space
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3000>, create your account, and open the included **Welcome to Petalcards** deck. It contains three working cards so you can test the study flow immediately.

To stop the app:

```bash
docker compose down
```

Your database remains in the `petalcards_data` Docker volume.

## Run without Docker

Petalcards has no npm dependencies. Install Node.js 24 or newer, then run:

```bash
npm start
```

The app starts on <http://localhost:3000>. Its database is saved at `data/petalcards.sqlite`.

Useful development commands:

```bash
npm run dev
npm run check
npm test
```

## Put it on `petalcards.space`

The included production Compose file adds Caddy as a reverse proxy and automatically obtains/renews an HTTPS certificate.

1. Use a Linux server with a public IPv4 address and Docker installed.
2. Point the domain's `A` record to that server. Remove the old hosting record first. Add an `AAAA` record only if the server has working public IPv6.
3. Allow inbound TCP ports `80` and `443` (and optionally UDP `443`) in the server firewall.
4. Copy the repository to the server and create the environment file:

   ```bash
   cp .env.example .env
   ```

5. Confirm these production values in `.env`:

   ```dotenv
   DOMAIN=petalcards.space
   APP_ORIGIN=https://petalcards.space
   TRUST_PROXY=1
   COOKIE_SECURE=true
   ALLOW_REGISTRATION=true
   ```

6. Start the production stack:

   ```bash
   docker compose -f compose.yaml -f compose.production.yaml up -d --build
   ```

7. Visit `https://petalcards.space` and create your account. If this is a private installation, change `ALLOW_REGISTRATION=false` afterward and run the same production command again.

Check status and logs with:

```bash
docker compose -f compose.yaml -f compose.production.yaml ps
docker compose -f compose.yaml -f compose.production.yaml logs -f petalcards
```

## Data and backups

All user, deck, card, session, theme, and review data is in `/data/petalcards.sqlite` inside the persistent Docker volume. SQLite also uses `-wal` and `-shm` files while the app is running, so stop the app before copying the data directory.

```bash
docker compose -f compose.yaml -f compose.production.yaml stop petalcards
docker compose -f compose.yaml -f compose.production.yaml cp petalcards:/data ./petalcards-data-backup
docker compose -f compose.yaml -f compose.production.yaml start petalcards
```

Keep the backup directory somewhere separate from the server. To restore, stop the service and copy the backed-up files into `/data` before restarting it.

## Updating

```bash
git pull
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

Database migrations run automatically and preserve existing data.

## Security notes

- Passwords are salted and hashed with scrypt; plaintext passwords are never stored.
- Session tokens are random, stored only as hashes, sent in HttpOnly/SameSite cookies, and expire after 30 days.
- Mutating requests are protected with same-origin checks and authentication endpoints are rate-limited.
- Each database query checks deck/card ownership. Automated tests verify account isolation.
- Keep HTTPS enabled in production and back up the SQLite volume regularly.

## Project layout

```text
public/                 Browser UI and themes
src/server.mjs          HTTP server and JSON API
src/database.mjs        SQLite schema and data access
src/security.mjs        Password, session, cookie, and export helpers
test/app.test.mjs       End-to-end API and study-flow tests
compose.yaml            App container and persistent volume
compose.production.yaml HTTPS reverse proxy
Caddyfile               Domain and TLS configuration
```

## License

MIT
