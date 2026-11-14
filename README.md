# Pickify

Pick a song you like. Pickify shows you 10 similar songs, you choose your favorite, and it uses your picks to suggest the next 10. After a few rounds it builds a 50-song playlist you can open on YouTube Music, in order or shuffled.

## Tech stack

| Layer | Tool |
| --- | --- |
| Frontend and API | Next.js (App Router), TypeScript, Tailwind CSS |
| Song similarity | Last.fm API (`track.getSimilar`) |
| YouTube matching | Python resolver using `ytmusicapi` (in `/resolver`) |
| Database | Supabase Postgres |
| Hosting | Vercel (two projects: the app and the resolver) |

## Project layout

```
resolver/        Python service that finds a YouTube video for each song
src/app/         Next.js pages and API routes
src/lib/         Shared logic (Last.fm client, candidate pool, resolver client)
src/components/  UI components
public/          Static assets
```

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

## Deploying

1. **App:** import this repo into Vercel with the default settings.
2. **Resolver:** import the same repo as a second Vercel project and set **Root Directory** to `resolver`. Add a `RESOLVER_SECRET` environment variable, then call `/health/youtube` on the deployed URL to confirm YouTube doesn't block Vercel's servers.
3. In the app project, set `RESOLVER_URL` to the resolver's URL and `RESOLVER_SECRET` to the same secret.

## Theme

Dark "teal pulse" theme, defined in `src/app/globals.css`. Use the Tailwind classes it creates, such as `bg-surface`, `text-accent`, `text-text-secondary` and `border-border`, instead of hex values.
