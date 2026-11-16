# Pickify

Pick a song you like. Pickify shows you 10 similar songs, you pick as many as you like, and it uses your picks to suggest the next 10. After a few rounds it builds a 50-song playlist you can open on YouTube Music, in order or shuffled.

## Tech stack

| Layer | Tool |
| --- | --- |
| Frontend and API | Next.js (App Router), TypeScript, Tailwind CSS |
| Song similarity | Last.fm API (`track.getSimilar`) |
| Album art | Deezer API (public, no key) |
| YouTube matching | Python resolver using `ytmusicapi` (in `/resolver`) |
| Database | Neon Postgres |
| Hosting | Vercel (two projects: the app and the resolver) |

## Project layout

```
resolver/             Python service that finds a YouTube video for each song
src/app/              Next.js pages and API routes
src/lib/              Shared logic (Last.fm client, candidate pool, database client)
src/components/       UI components
db/migrations/        Database schema (applied with npm run db:migrate)
scripts/              Dev scripts
public/               Static assets
```

## How recommendations work

1. Last.fm's `track.getSimilar` returns songs similar to the seed, each with a similarity score from 0 to 1.
2. Those songs go into a **candidate pool**. When a song shows up as similar to more than one of your picks, its scores add up, so it rises to the top.
3. Each round shows the 10 highest-scoring songs you haven't seen yet, with at most 2 per artist.
4. The similar songs for each song you picked are merged into the pool. Later picks count a little more than earlier ones, and songs you skipped are scored lower.
5. The final playlist is the seed and your picks first, then the best songs left in the pool, up to 50 with at most 3 per artist.

The logic lives in `src/lib/candidatePool.ts`.

## API

All endpoints return JSON. Errors look like `{ "error": { "code": "conflict", "message": "..." } }`, where `message` is safe to show to users. Codes: `invalidRequest` (400), `notFound` (404), `conflict` (409), `noSuggestions` (422), `upstreamUnavailable` (503), `internalError` (500).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/tracks/search?q=believe` | | `{ tracks }`: up to 10 songs to pick a seed from |
| `POST` | `/api/sessions` | `{ artist, title }` | Session state with round 1 (201) |
| `GET` | `/api/sessions/:sessionId` | | Session state |
| `POST` | `/api/sessions/:sessionId/picks` | `{ roundNumber, trackKeys }` (1 to 10 songs) | Session state with the next round, or `status: "complete"` and a `playlistId` after the last round |
| `POST` | `/api/sessions/:sessionId/reroll` | `{ roundNumber }` | Session state with 10 new songs for the same round ("none of these") |
| `GET` | `/api/art?artist=&title=` | | Redirects to the album cover (302), or 404 when there isn't one. Used directly as an image source |
| `GET` | `/api/playlists/:playlistId` | | `{ playlistId, title, tracks }` with 50 songs in order |
| `POST` | `/api/playlists/:playlistId/export/youtube` | `{ shuffle?: boolean }` | `{ youtubeUrl, youtubeMusicUrl, trackCount, unresolvedTracks }` |

**Session state** has the shape `{ sessionId, status, seed, currentRound, totalRounds, candidates, picks, playlistId }`. `candidates` holds the songs for the current round, and each song is `{ trackKey, artist, title, durationSeconds, imageUrl }`.

Notes:

- **Picks are safe to retry.** Sending the same songs again, in any order, returns the current state. Different songs for a round that's already done return `409 conflict`.
- **Every picked song counts.** Each one adds its similar songs to the pool, and all picks go at the front of the playlist, right after the seed, in the order they were shown.
- **Rerolled songs never come back**, in later rounds or in the playlist.
- **Sessions can end early.** If Last.fm runs out of new suggestions, the session finishes before round 5 instead of showing an empty round.
- **Album covers are cached** in `track_cache`, including songs with no cover (retried after 30 days), and the CDN caches the redirects for 30 days.
- **The export only sends songs to the resolver that aren't cached yet**, and it saves new matches for 30 days. `youtubeMusicUrl` is `null` when YouTube doesn't hand back a temporary playlist ID. In that case, use `youtubeUrl`.

## Database

Neon Postgres project `pickify` with two branches:

| Branch | Used by |
| --- | --- |
| `main` | Production deployments |
| `dev` | Preview deployments and local development |

The `dev` branch has its own password, so local work and pull request previews never touch production data. The connection strings are already set in Vercel. Production and preview values are write-only Secrets, and the development values come down with `vercel env pull`.

**Migrations** live in `db/migrations` and run with `npm run db:migrate`. The command applies any files that haven't run yet, in order, and records them in a `schema_migrations` table, so it's safe to run again. Requires Node 22 or newer.

- **Locally**, `npm run db:migrate` updates the `dev` branch.
- **On Vercel**, the build command is `npm run db:migrate && npm run build`, so every deployment migrates its own database first. If a migration fails, the build fails and nothing ships.

To change the schema, add a new numbered file such as `db/migrations/0002_add_column.sql`, run `npm run db:migrate` locally, and open a PR. Don't edit a migration that has already been applied.

## Running locally

Local development uses the Neon `dev` branch, a copy of the database with its own password, so nothing you do locally touches production data.

### App

```bash
npm install
npx vercel link                # once, pick the pickify project
npx vercel env pull .env.local # dev database URL, local resolver URL and secret
npm run dev
```

Open http://localhost:3000.

Production secrets are stored in Vercel as write-only Secrets and are never pulled. If `LASTFM_API_KEY` is missing from `.env.local` after pulling, put it in `.env.development.local` instead. Next.js reads that file too, and `vercel env pull` never overwrites it.

### Resolver

The app calls the resolver at `RESOLVER_URL`, which is `http://localhost:8001` locally. Start it with the same `RESOLVER_SECRET` that's in your `.env.local`:

```bash
cd resolver
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt uvicorn
```

Then, in PowerShell:

```powershell
$env:RESOLVER_SECRET = "<RESOLVER_SECRET from .env.local>"
uvicorn main:app --reload --port 8001
```

or in macOS/Linux shells:

```bash
RESOLVER_SECRET="<RESOLVER_SECRET from .env.local>" uvicorn main:app --reload --port 8001
```

Check that YouTube searches work:

```bash
curl -H "x-resolver-secret: <secret>" http://localhost:8001/health/youtube
```

You only need the resolver running to test the YouTube export. Search, sessions and playlists work without it.

### Tests

```bash
npm test            # run once
npm run testWatch   # rerun on save
```

The tests cover the candidate pool, the Last.fm client (with a mocked API), the migration script and the database schema. The database tests run in an in-memory Postgres, so you don't need a Neon database to run them.

## Deploying

Pushing to `master` deploys both Vercel projects:

| Project | Root directory | URL |
| --- | --- | --- |
| `pickify` | repo root | https://pickify.ppeternnguyen.com |
| `pickify-resolver` | `resolver` | Called only by the app, with `RESOLVER_SECRET` |

Pull requests get preview deployments of the app that use the `dev` database. To check that the deployed resolver can still reach YouTube, call `/health/youtube` on it with the `x-resolver-secret` header.

## Theme

Dark "teal pulse" theme, defined in `src/app/globals.css`. Use the Tailwind classes it creates, such as `bg-surface`, `text-accent`, `text-text-secondary` and `border-border`, instead of hex values.
