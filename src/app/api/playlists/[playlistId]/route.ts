import { toErrorResponse } from "@/lib/apiErrors";
import { idSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { getPlaylist } from "@/lib/playlistService";

/** GET /api/playlists/:playlistId — the 50 songs in order. */
export async function GET(_request: Request, context: RouteContext<"/api/playlists/[playlistId]">) {
  try {
    const playlistId = idSchema.parse((await context.params).playlistId);
    return Response.json(await getPlaylist(getDb(), playlistId));
  } catch (error) {
    return toErrorResponse(error, "GET /api/playlists/:playlistId");
  }
}
