import { describeError, reportProblem } from "@/lib/alerts";
import { cleanupOldData, isAuthorizedCron } from "@/lib/cleanup";
import { getDb } from "@/lib/db";

/**
 * GET /api/cron/cleanup
 * Run once a day by Vercel Cron (see vercel.json). Deletes abandoned sessions
 * and old rate-limit counters, and returns how many rows went.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: { code: "unauthorized", message: "Not allowed." } }, { status: 401 });
  }
  try {
    const result = await cleanupOldData(getDb());
    console.info("[cron:cleanup]", result);
    return Response.json(result);
  } catch (error) {
    console.error("[cron:cleanup] failed", error);
    reportProblem({ key: "cron:cleanup", title: "The daily cleanup failed", detail: describeError(error), where: "GET /api/cron/cleanup" });
    return Response.json({ error: { code: "internal", message: "Cleanup failed." } }, { status: 500 });
  }
}
