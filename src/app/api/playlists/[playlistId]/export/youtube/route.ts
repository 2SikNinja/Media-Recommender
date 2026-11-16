import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { idSchema, youtubeExportSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { exportPlaylistToYoutube } from "@/lib/playlistService";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getResolver } from "@/lib/resolverClient";

// Matching up to 50 songs on YouTube can take a while the first time.
export const maxDuration = 60;

/**
 * POST /api/playlists/:playlistId/export/youtube { shuffle?: boolean }
 * Returns a YouTube link (and a YouTube Music link when available) with the playlist queued.
 */
export async function POST(request: Request, context: RouteContext<"/api/playlists/[playlistId]/export/youtube">) {
  try {
    await enforceRateLimit(getDb(), request, "youtubeExport");
    const playlistId = idSchema.parse((await context.params).playlistId);
    const { shuffle } = youtubeExportSchema.parse(await readJsonBody(request));
    const result = await exportPlaylistToYoutube({ db: getDb(), resolver: getResolver() }, playlistId, { shuffle });
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error, "POST /api/playlists/:playlistId/export/youtube");
  }
}
