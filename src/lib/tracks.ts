export type Track = {
  trackKey: string;
  artist: string;
  title: string;
  durationSeconds: number | null;
  imageUrl: string | null;
};

export type SimilarTrack = Track & {
  /** Last.fm similarity score from 0 to 1. */
  match: number;
};

/**
 * Lowercases, strips accents and featured-artist notes, and removes punctuation
 * so "Señorita (feat. Camila Cabello)" and "senorita" compare equal.
 * Non-Latin scripts are kept as-is.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[([](feat|ft|with)\b[^)\]]*[)\]]/g, " ")
    .replace(/\b(feat|ft)\b\.?\s.*$/, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Stable identity for a song across Last.fm results, the cache and playlists. */
export function makeTrackKey(artist: string, title: string): string {
  return `${normalizeText(artist)}::${normalizeText(title)}`;
}

export function makeArtistKey(artist: string): string {
  return normalizeText(artist);
}
