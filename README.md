# music-streaming-server

Express API for the website and Telegram Mini App. PostgreSQL stores users, tracks and favorites. Supabase Storage serves uploaded audio, cover art and avatars.

## Run locally

Use Node.js 22 or newer. Copy `.env.example` to `.env` and fill in the database URLs, a private JWT signing secret and Supabase server credentials. Use a development database for local migration runs.

```powershell
npm ci
npx prisma generate
npx prisma migrate deploy
npm start
```

- `DATABASE_URL` is the application connection. `DIRECT_URL` is the direct PostgreSQL connection used for migrations.
- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are required on the backend. Existing `tracks` and `images` buckets need public reads for playback and cover art. Storage writes use the server key.
- `TELEGRAM_BOT_TOKEN` enables Telegram login and bot polling. Music upload is available in private chat to Telegram-linked administrators or Telegram IDs in the comma-separated `TELEGRAM_UPLOAD_USER_IDS` list.
- `CORS_ORIGINS` adds exact frontend origins as a comma-separated list. The production UNDERLAB origin and the default local Vite origins are already allowed.
- Set `TRUST_PROXY_HOPS` only when the number of trusted reverse-proxy hops is known. The credential attempt limiter uses the client IP resolved by Express.

## Catalog and audio

Apply the Prisma migration before enabling Realtime in the frontend. On Supabase it publishes the public track catalog and keeps account, favorite, complaint and review tables behind the API. It also adds four foreign-key indexes.

`GET /tracks/:id/stream` serves bundled legacy tracks with HTTP Range and redirects new tracks to Supabase Storage. The bot and administrator upload routes share file validation and metadata extraction.

Run `npm test` for the HTTP API checks. They start an ephemeral loopback server with database fixtures.
