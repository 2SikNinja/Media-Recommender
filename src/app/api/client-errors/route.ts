import { reportProblem } from "@/lib/alerts";
import { readJsonBody, toErrorResponse } from "@/lib/apiErrors";
import { clientErrorSchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * POST /api/client-errors { message, digest?, path }
 * A page crashed in someone's browser. Sends an alert (repeats are muted) and
 * returns 204. Limited to a few per minute per client.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(getDb(), request, "clientErrors");
    const { message, digest, path } = clientErrorSchema.parse(await readJsonBody(request));
    // Group by the page's route shape, not its IDs, so one bug is one alert.
    const route = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
    reportProblem({
      key: `client:${route}:${digest ?? message.slice(0, 120)}`,
      title: "A page crashed in someone's browser",
      detail: digest ? `${message}\n(server log digest ${digest})` : message,
      where: route,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error, "POST /api/client-errors");
  }
}
