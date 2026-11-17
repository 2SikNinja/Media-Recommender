import { toErrorResponse } from "@/lib/apiErrors";
import { idSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { getSimilarTracks } from "@/lib/lastfm";
import { enforceRateLimit } from "@/lib/rateLimit";
import { remixPlaylist } from "@/lib/sessionService";

/**
 * POST /api/playlists/:playlistId/remix
 * Starts a new session with this playlist's seed songs, rounds and length, and
 * returns its round 1. Limited like starting any other session.
 */
export async function POST(request: Request, context: RouteContext<"/api/playlists/[playlistId]/remix">) {
  try {
    await enforceRateLimit(getDb(), request, "createSession");
    const playlistId = idSchema.parse((await context.params).playlistId);
    const state = await remixPlaylist({ db: getDb(), musicSource: { getSimilarTracks } }, playlistId);
    return Response.json(state, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "POST /api/playlists/:playlistId/remix");
  }
}
