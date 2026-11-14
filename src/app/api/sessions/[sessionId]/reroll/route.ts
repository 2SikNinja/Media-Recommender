import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { idSchema, rerollSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { rerollRound } from "@/lib/sessionService";

/** POST /api/sessions/:sessionId/reroll { roundNumber } — "none of these": a fresh 10 for the same round. */
export async function POST(request: Request, context: RouteContext<"/api/sessions/[sessionId]/reroll">) {
  try {
    const sessionId = idSchema.parse((await context.params).sessionId);
    const { roundNumber } = rerollSchema.parse(await readJsonBody(request));
    return Response.json(await rerollRound(getDb(), sessionId, roundNumber));
  } catch (error) {
    return toErrorResponse(error, "POST /api/sessions/:sessionId/reroll");
  }
}
