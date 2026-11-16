import { findPlaylistSummary, findSeedCover } from "@/lib/playlistSummary";
import { renderShareImage, shareImageSize } from "@/lib/shareImage";

export const alt = "A Pickify playlist";
export const size = shareImageSize;
export const contentType = "image/png";

/** The link preview for a shared playlist: the seed song's record and the playlist's name. */
export default async function Image({ params }: { params: Promise<{ playlistId: string }> }) {
  const summary = await findPlaylistSummary((await params).playlistId);
  if (!summary) {
    return renderShareImage({ title: "Start with one song.", subtitle: "Pick your favorites and get a 50-song playlist." });
  }
  return renderShareImage({
    title: summary.title,
    subtitle: `${summary.trackCount} songs, made with Pickify`,
    coverUrl: await findSeedCover(summary),
    artist: summary.seedArtist,
  });
}

