import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import { describeError, reportProblem } from "./alerts";
import { DeezerError } from "./deezer";
import { LastfmError } from "./lastfm";

export type ApiErrorCode =
  | "invalidRequest"
  | "notFound"
  | "conflict"
  | "noSuggestions"
  | "rateLimited"
  | "upstreamUnavailable"
  | "internalError";

const statusByCode: Record<ApiErrorCode, number> = {
  invalidRequest: 400,
  notFound: 404,
  conflict: 409,
  noSuggestions: 422,
  rateLimited: 429,
  upstreamUnavailable: 503,
  internalError: 500,
};

/** An error that is safe to show to the user, with a stable code for the frontend. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** For rateLimited: when the client can try again, sent as Retry-After. */
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, message: string, options: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function errorResponse(code: ApiErrorCode, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status: statusByCode[code], headers });
}

/**
 * Turns any thrown error into a JSON response. Known errors keep their message;
 * anything unexpected is logged and returned as a generic 500 so internal
 * details never reach the browser.
 *
 * Next.js signals things like "this route is dynamic" by throwing its own
 * errors, so those are rethrown first instead of being turned into a 500.
 */
export function toErrorResponse(error: unknown, context: string): Response {
  unstable_rethrow(error);
  if (error instanceof ApiError) {
    const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
    return errorResponse(error.code, error.message, headers);
  }
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const field = firstIssue?.path.join(".") || "request";
    return errorResponse("invalidRequest", `Invalid ${field}: ${firstIssue?.message ?? "check the request"}`);
  }
  if (error instanceof LastfmError) {
    console.error(`[${context}] Last.fm error`, { code: error.lastfmCode, status: error.httpStatus, message: error.message });
    // Only outages: no response, server errors, rate limits, or Last.fm's own
    // "service offline / temporarily unavailable / rate limit" codes. A song
    // Last.fm doesn't know is the user's search, not a problem to alert on.
    const isOutage =
      error.httpStatus === null ||
      error.httpStatus >= 500 ||
      error.httpStatus === 429 ||
      [8, 11, 16, 29].includes(error.lastfmCode ?? -1);
    if (isOutage) {
      reportProblem({
        key: `lastfm:${error.httpStatus ?? "network"}:${error.lastfmCode ?? ""}`,
        title: "Last.fm isn't responding",
        detail: error.message,
        where: context,
      });
    }
    return errorResponse("upstreamUnavailable", "The music service isn't responding right now. Try again in a moment.");
  }
  if (error instanceof DeezerError) {
    console.error(`[${context}] Deezer error`, error.message);
    return errorResponse("upstreamUnavailable", "Covers and previews aren't available right now.");
  }
  console.error(`[${context}] unexpected error`, error);
  reportProblem({
    key: `unexpected:${context}:${error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)}`,
    title: "Unexpected server error",
    detail: describeError(error),
    where: context,
  });
  return errorResponse("internalError", "Something went wrong on our end. Try again.");
}

/** Reads a JSON body, treating a missing or malformed body as a 400. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("invalidRequest", "The request body must be valid JSON.");
  }
}
