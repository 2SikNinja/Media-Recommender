import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { idSchema, submitPickSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { getSimilarTracks } from "@/lib/lastfm";
import { enforceRateLimit } from "@/lib/rateLimit";
import { submitPick } from "@/lib/sessionService";

/**
 * POST /api/sessions/:sessionId/picks { roundNumber, trackKeys }
 * Returns the next round, or the playlist ID after the last round. Safe to retry.
 */
export async function POST(request: Request, context: RouteContext<"/api/sessions/[sessionId]/picks">) {
  try {
    await enforceRateLimit(getDb(), request, "sessionAction");
    const sessionId = idSchema.parse((await context.params).sessionId);
    const input = submitPickSchema.parse(await readJsonBody(request));
    const state = await submitPick({ db: getDb(), musicSource: { getSimilarTracks } }, sessionId, input);
    return Response.json(state);
  } catch (error) {
    return toErrorResponse(error, "POST /api/sessions/:sessionId/picks");
  }
}
