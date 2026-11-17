import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { addTrackSchema, idSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { addTrack } from "@/lib/playlistService";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * POST /api/playlists/:playlistId/tracks { artist, title }: adds a song to the
 * end of the playlist (or puts it back if it was removed). Returns the updated playlist.
 */
export async function POST(request: Request, context: RouteContext<"/api/playlists/[playlistId]/tracks">) {
  try {
    await enforceRateLimit(getDb(), request, "editPlaylist");
    const playlistId = idSchema.parse((await context.params).playlistId);
    const song = addTrackSchema.parse(await readJsonBody(request));
    return Response.json(await addTrack(getDb(), playlistId, song), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "POST /api/playlists/:playlistId/tracks");
  }
}
