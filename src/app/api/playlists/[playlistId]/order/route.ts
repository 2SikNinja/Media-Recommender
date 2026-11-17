import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { idSchema, reorderSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { reorderTracks } from "@/lib/playlistService";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * PUT /api/playlists/:playlistId/order { positions }: puts the playing songs in
 * this order. Lists every song that isn't removed, by position. Returns the updated playlist.
 */
export async function PUT(request: Request, context: RouteContext<"/api/playlists/[playlistId]/order">) {
  try {
    await enforceRateLimit(getDb(), request, "editPlaylist");
    const playlistId = idSchema.parse((await context.params).playlistId);
    const { positions } = reorderSchema.parse(await readJsonBody(request));
    return Response.json(await reorderTracks(getDb(), playlistId, positions));
  } catch (error) {
    return toErrorResponse(error, "PUT /api/playlists/:playlistId/order");
  }
}
