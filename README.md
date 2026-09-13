# Petalcards

Petalcards is a hosted flashcard study app for creating, saving, reviewing, and exporting personal decks. It uses a real server-side database and Sign in with ChatGPT, rather than browser-only storage.

## Features

- Pink light theme by default
- Purple, blue, green, berry, and grey dark themes
- Private, account-owned decks and cards
- Create, edit, search, and delete cards
- Flip-card study sessions with saved recall ratings
- CSV and JSON deck downloads
- Responsive desktop and mobile layouts
- Accessible keyboard controls in study mode

## Stack

- Next.js-compatible Vinext application
- TypeScript and React
- Cloudflare Workers runtime
- Cloudflare D1 with Drizzle migrations
- Platform-managed Sign in with ChatGPT

## Local development

Install the locked dependencies and start the development server:

```bash
pnpm install
pnpm run dev
```

Generate a new migration after changing `db/schema.ts`:

```bash
pnpm run db:generate
```

Create a production build:

```bash
pnpm run build
```

The hosted environment applies the committed migrations and supplies the `DB` binding declared in `.openai/hosting.json`.

## Hosting and domain

The app is configured for dynamic hosting with ChatGPT Sites. Once deployed, `petalcards.space` can be connected from the Site's custom-domain settings using the DNS records provided there.
