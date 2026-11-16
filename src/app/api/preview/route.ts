import { toErrorResponse } from "@/lib/apiErrors";
import { trackQuerySchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { findPreviewUrl, previewCacheSeconds } from "@/lib/deezer";
import { enforceRateLimit } from "@/lib/rateLimit";

const missingCacheControl = "public, max-age=3600, s-maxage=86400";

/**
 * GET /api/preview?artist=Cher&title=Believe: redirects to Deezer's 30-second
 * preview clip, or 404 when there isn't one. Used directly as an <audio src>.
 * Preview URLs are signed and expire, so they're cached only until shortly
 * before then, and never saved to the database.
 */
export async function GET(request: Request) {
  try {
    await enforceRateLimit(getDb(), request, "media");
    const searchParams = new URL(request.url).searchParams;
    const { artist, title } = trackQuerySchema.parse({
      artist: searchParams.get("artist") ?? "",
      title: searchParams.get("title") ?? "",
    });

    const previewUrl = await findPreviewUrl(artist, title);
    if (!previewUrl) {
      return new Response(null, { status: 404, headers: { "Cache-Control": missingCacheControl } });
    }
    const cacheSeconds = previewCacheSeconds(previewUrl);
    const cacheControl = cacheSeconds > 0 ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` : "no-store";
    return new Response(null, { status: 302, headers: { Location: previewUrl, "Cache-Control": cacheControl } });
  } catch (error) {
    return toErrorResponse(error, "GET /api/preview");
  }
}
