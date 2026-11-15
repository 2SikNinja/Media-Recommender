/** YouTube's watch_videos link stops accepting IDs past roughly this many. */
export const maxVideosPerLink = 50;
const temporaryPlaylistLookupTimeoutMs = 5_000;

/**
 * A link that opens the videos as a queue. YouTube turns it into a temporary
 * playlist (list=TLGG...) on its side. This is undocumented, so treat it as
 * best effort.
 */
export function buildWatchVideosUrl(videoIds: string[]): string {
  const url = new URL("https://www.youtube.com/watch_videos");
  url.searchParams.set("video_ids", videoIds.slice(0, maxVideosPerLink).join(","));
  return url.toString();
}

/** Fisher-Yates shuffle that returns a new array. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/** Pulls the temporary playlist ID out of the URL YouTube redirects watch_videos to. */
export function extractTemporaryPlaylistId(redirectUrl: string): string | null {
  try {
    const listId = new URL(redirectUrl, "https://www.youtube.com").searchParams.get("list");
    return listId && /^TL[A-Za-z0-9_-]+$/.test(listId) ? listId : null;
  } catch {
    return null;
  }
}

export function buildYoutubeMusicUrl(firstVideoId: string, playlistId: string): string {
  const url = new URL("https://music.youtube.com/watch");
  url.searchParams.set("v", firstVideoId);
  url.searchParams.set("list", playlistId);
  return url.toString();
}

/**
 * Asks YouTube to create the temporary playlist and returns its ID, or null if
 * YouTube doesn't redirect as expected (for example it serves a consent page to
 * servers). Callers fall back to the plain watch_videos link.
 */
export async function fetchTemporaryPlaylistId(
  watchVideosUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(watchVideosUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(temporaryPlaylistLookupTimeoutMs),
      cache: "no-store",
    });
    const location = response.headers.get("location");
    return location ? extractTemporaryPlaylistId(location) : null;
  } catch {
    return null;
  }
}
