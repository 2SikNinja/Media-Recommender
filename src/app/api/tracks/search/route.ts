import { toErrorResponse } from "@/lib/apiErrors";
import { searchQuerySchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { searchTracks } from "@/lib/lastfm";
import { enforceRateLimit } from "@/lib/rateLimit";

/** GET /api/tracks/search?q=believe: songs to pick a seed from. */
export async function GET(request: Request) {
  try {
    await enforceRateLimit(getDb(), request, "search");
    const { q } = searchQuerySchema.parse({ q: new URL(request.url).searchParams.get("q") ?? "" });
    const tracks = await searchTracks(q, 10);
    return Response.json(
      { tracks },
      // Search results barely change, so let Vercel's CDN reuse them and spare Last.fm.
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    return toErrorResponse(error, "GET /api/tracks/search");
  }
}
