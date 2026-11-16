import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { idSchema, playlistPositionSchema, trackRemovalSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { setTrackRemoved } from "@/lib/playlistService";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * PATCH /api/playlists/:playlistId/tracks/:position { removed }: takes a song
 * out of the playlist, or puts it back. Returns the updated playlist.
 */
export async function PATCH(request: Request, context: RouteContext<"/api/playlists/[playlistId]/tracks/[position]">) {
  try {
    await enforceRateLimit(getDb(), request, "editPlaylist");
    const params = await context.params;
    const playlistId = idSchema.parse(params.playlistId);
    const position = playlistPositionSchema.parse(params.position);
    const { removed } = trackRemovalSchema.parse(await readJsonBody(request));
    return Response.json(await setTrackRemoved(getDb(), playlistId, position, removed));
  } catch (error) {
    return toErrorResponse(error, "PATCH /api/playlists/:playlistId/tracks/:position");
  }
}
