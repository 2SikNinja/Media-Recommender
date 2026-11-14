import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import { LastfmError } from "./lastfm";

export type ApiErrorCode =
  | "invalidRequest"
  | "notFound"
  | "conflict"
  | "noSuggestions"
  | "upstreamUnavailable"
  | "internalError";

const statusByCode: Record<ApiErrorCode, number> = {
  invalidRequest: 400,
  notFound: 404,
  conflict: 409,
  noSuggestions: 422,
  upstreamUnavailable: 503,
  internalError: 500,
};

/** An error that is safe to show to the user, with a stable code for the frontend. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

function errorResponse(code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: statusByCode[code] });
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
    return errorResponse(error.code, error.message);
  }
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const field = firstIssue?.path.join(".") || "request";
    return errorResponse("invalidRequest", `Invalid ${field}: ${firstIssue?.message ?? "check the request"}`);
  }
  if (error instanceof LastfmError) {
    console.error(`[${context}] Last.fm error`, { code: error.lastfmCode, status: error.httpStatus, message: error.message });
    return errorResponse("upstreamUnavailable", "The music service isn't responding right now. Try again in a moment.");
  }
  console.error(`[${context}] unexpected error`, error);
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
