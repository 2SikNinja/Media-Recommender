import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { createSessionSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { getSimilarTracks } from "@/lib/lastfm";
import { enforceRateLimit } from "@/lib/rateLimit";
import { createSession } from "@/lib/sessionService";

/** POST /api/sessions { artist, title }: starts picking from a seed song and returns round 1. */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(getDb(), request, "createSession");
    const input = createSessionSchema.parse(await readJsonBody(request));
    const state = await createSession({ db: getDb(), musicSource: { getSimilarTracks } }, input);
    return Response.json(state, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "POST /api/sessions");
  }
}
