import { toErrorResponse } from "@/lib/apiErrors";
import { idSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getSessionState } from "@/lib/sessionService";

/** GET /api/sessions/:sessionId: current round, picks so far, and the playlist ID once complete. */
export async function GET(request: Request, context: RouteContext<"/api/sessions/[sessionId]">) {
  try {
    await enforceRateLimit(getDb(), request, "read");
    const sessionId = idSchema.parse((await context.params).sessionId);
    return Response.json(await getSessionState(getDb(), sessionId));
  } catch (error) {
    return toErrorResponse(error, "GET /api/sessions/:sessionId");
  }
}
