import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { idSchema, rerollSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { getSimilarTracks } from "@/lib/lastfm";
import { enforceRateLimit } from "@/lib/rateLimit";
import { rerollRound } from "@/lib/sessionService";

/**
 * POST /api/sessions/:sessionId/reroll { roundNumber, dislikedKeys? }
 * "None of these": a fresh 10 for the same round.
 */
export async function POST(request: Request, context: RouteContext<"/api/sessions/[sessionId]/reroll">) {
  try {
    await enforceRateLimit(getDb(), request, "sessionAction");
    const sessionId = idSchema.parse((await context.params).sessionId);
    const input = rerollSchema.parse(await readJsonBody(request));
    return Response.json(await rerollRound({ db: getDb(), musicSource: { getSimilarTracks } }, sessionId, input));
  } catch (error) {
    return toErrorResponse(error, "POST /api/sessions/:sessionId/reroll");
  }
}
