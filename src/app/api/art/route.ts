import { getAlbumArtUrl, isAllowedArtUrl } from "@/lib/albumArt";
import { toErrorResponse } from "@/lib/apiErrors";
import { trackQuerySchema } from "@/lib/apiSchemas";
import { getDb } from "@/lib/db";
import { findAlbumArt } from "@/lib/deezer";

const foundCacheControl = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000";
const missingCacheControl = "public, max-age=3600, s-maxage=86400";

/**
 * GET /api/art?artist=Cher&title=Believe: redirects to the album cover, or 404
 * when there isn't one. Used directly as an <img src>, and cached by the CDN.
 */
export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { artist, title } = trackQuerySchema.parse({
      artist: searchParams.get("artist") ?? "",
      title: searchParams.get("title") ?? "",
    });

    const imageUrl = await getAlbumArtUrl(getDb(), (a, t) => findAlbumArt(a, t), artist, title);
    if (!isAllowedArtUrl(imageUrl)) {
      return new Response(null, { status: 404, headers: { "Cache-Control": missingCacheControl } });
    }
    return new Response(null, { status: 302, headers: { Location: imageUrl, "Cache-Control": foundCacheControl } });
  } catch (error) {
    return toErrorResponse(error, "GET /api/art");
  }
}
