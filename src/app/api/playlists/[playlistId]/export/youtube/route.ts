import { toErrorResponse } from "@/lib/apiErrors";
import { idSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { exportPlaylistToYoutube } from "@/lib/playlistService";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getResolver } from "@/lib/resolverClient";

// Matching up to 50 songs on YouTube can take a while the first time.
export const maxDuration = 60;

/**
 * POST /api/playlists/:playlistId/export/youtube
 * Returns YouTube links (and YouTube Music links when available) with the
 * playlist queued, in order and shuffled. The playlist page calls this as soon
 * as it opens, so the play buttons are ready before anyone taps them.
 */
export async function POST(request: Request, context: RouteContext<"/api/playlists/[playlistId]/export/youtube">) {
  try {
    await enforceRateLimit(getDb(), request, "youtubeExport");
    const playlistId = idSchema.parse((await context.params).playlistId);
    const result = await exportPlaylistToYoutube({ db: getDb(), resolver: getResolver() }, playlistId);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error, "POST /api/playlists/:playlistId/export/youtube");
  }
}
