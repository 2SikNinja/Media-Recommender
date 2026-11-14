# Pickify

Pick a song you like. Pickify shows you 10 similar songs, you choose your favorite, and it uses your picks to suggest the next 10. After a few rounds it builds a 50-song playlist you can open on YouTube Music, in order or shuffled.

## Tech stack

| Layer | Tool |
| --- | --- |
| Frontend and API | Next.js (App Router), TypeScript, Tailwind CSS |
| Song similarity | Last.fm API (`track.getSimilar`) |
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
4. Your pick's similar songs are merged into the pool. Later picks count a little more than earlier ones, and songs you skipped are scored lower.
5. The final playlist is the seed and your picks first, then the best songs left in the pool, up to 50 with at most 3 per artist.

The logic lives in `src/lib/candidatePool.ts`.

## Database setup

1. In the Vercel project, open **Storage → Create Database** and choose **Neon**. Connect it to the project. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you.
2. Pull the variables locally:
   ```bash
   npx vercel link
   npx vercel env pull .env.local
   ```
3. Create the tables:
   ```bash
   npm run db:migrate
   ```
   This applies any files in `db/migrations` that haven't run yet and records them in a `schema_migrations` table, so it's safe to run again. Requires Node 22 or newer.

To change the schema later, add a new numbered file such as `db/migrations/0002_add_column.sql` and run `npm run db:migrate` again. Don't edit a migration that has already been applied.

## Running locally

### App

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev
```

Open http://localhost:3000.

### Resolver

```bash
cd resolver
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt uvicorn
RESOLVER_SECRET=devSecret uvicorn main:app --reload --port 8001
```

Check that YouTube searches work:

```bash
curl -H "x-resolver-secret: devSecret" http://localhost:8001/health/youtube
```

### Tests

```bash
npm test            # run once
npm run testWatch   # rerun on save
```

The tests cover the candidate pool, the Last.fm client (with a mocked API), the migration script and the database schema. The database tests run in an in-memory Postgres, so you don't need a Neon database to run them.

## Deploying

1. **App:** import this repo into Vercel with the default settings.
2. **Resolver:** import the same repo as a second Vercel project and set **Root Directory** to `resolver`. Add a `RESOLVER_SECRET` environment variable, then call `/health/youtube` on the deployed URL to confirm YouTube doesn't block Vercel's servers.
3. In the app project, set `RESOLVER_URL` to the resolver's URL and `RESOLVER_SECRET` to the same secret.

## Theme

Dark "teal pulse" theme, defined in `src/app/globals.css`. Use the Tailwind classes it creates, such as `bg-surface`, `text-accent`, `text-text-secondary` and `border-border`, instead of hex values.
