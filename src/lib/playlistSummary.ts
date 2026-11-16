import "server-only";

import { getAlbumArtUrl } from "./albumArt";
import { ApiError } from "./apiErrors";
import { idSchema } from "./apiSchemas";
import { getDb } from "./db";
import { findAlbumArt } from "./deezer";
import { getPlaylist } from "./playlistService";

export type PlaylistSummary = {
  title: string;
  trackCount: number;
  seedArtist: string;
  seedTitle: string;
};

/** What a link preview needs to know about a playlist, or null when there's no such playlist. */
export async function findPlaylistSummary(playlistId: string): Promise<PlaylistSummary | null> {
  const parsedId = idSchema.safeParse(playlistId);
  if (!parsedId.success) return null;
  try {
    const playlist = await getPlaylist(getDb(), parsedId.data);
    const seed = [...playlist.tracks, ...playlist.removedTracks].sort((a, b) => a.position - b.position)[0];
    return {
      title: playlist.title,
      trackCount: playlist.tracks.length,
      seedArtist: seed?.artist ?? "",
      seedTitle: seed?.title ?? "",
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === "notFound") return null;
    throw error;
  }
}

/** The seed song's cover, or null. A failed lookup just means no cover in the preview. */
export async function findSeedCover(summary: PlaylistSummary): Promise<string | null> {
  if (!summary.seedArtist || !summary.seedTitle) return null;
  try {
    return await getAlbumArtUrl(getDb(), (artist, title) => findAlbumArt(artist, title), summary.seedArtist, summary.seedTitle);
  } catch {
    return null;
  }
}

export function describePlaylist(summary: PlaylistSummary): string {
  const songs = `${summary.trackCount}-song playlist`;
  return summary.seedTitle
    ? `A ${songs} inspired by ${summary.seedTitle} by ${summary.seedArtist}. Made with Pickify.`
    : `A ${songs} made with Pickify.`;
}
