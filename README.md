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

The website uses `GET /tracks?limit=40` and `GET /tracks/search?query=...&limit=40`. Each result includes `nextCursor`, which the client sends as `before` to continue. The player uses `GET /tracks/by-ids?ids=1,2` to resolve missing queue entries. Deleting a track removes it from affected shared queues.

Run `npm test` for the HTTP API checks. They start an ephemeral loopback server with database fixtures.

## Shared playback

To connect an existing site login to Telegram, create a one-time code from the profile on the site and confirm it in the Mini App. The code expires after five minutes. Linking can merge a separate Telegram-only account with explicit consent. The website account keeps its ID. Favorites are deduplicated and reviews and complaints are moved. Unlinking requires the website password.

The `/playback` API stores a versioned session per user and treats each open page as a playback device. The authenticated event stream sends updates to that user's devices. Devices can control the queue from any connected page. One device holds the audio lease at a time. Handoff pauses the outgoing device before granting the new lease and falls back to expiry when the outgoing device loses its connection.

Apply pending Prisma migrations before serving a new version. The account-link, authentication-session, playback-session and device tables restrict direct reads from browser roles. The catalog uses Supabase Realtime. Playback events use authenticated HTTP streaming through Express. Keep response buffering disabled on any proxy in front of `/playback/events`.

Set `TEST_DATABASE_URL` to a migrated disposable PostgreSQL database before running `npm test` to include all integration tests. The backend GitHub Actions workflow provisions and migrates a PostgreSQL service before running the suite.
