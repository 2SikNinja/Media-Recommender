import type { MusicSource } from "@/lib/trackCache";
import { makeTrackKey, type SimilarTrack, type Track } from "@/lib/tracks";

function makeTrack(artist: string, title: string): Track {
  return { trackKey: makeTrackKey(artist, title), artist, title, durationSeconds: 200, imageUrl: null };
}

/**
 * Pretend Last.fm. Every song has `similarCount` similar songs drawn from a
 * shared catalog, so different picks overlap the way real listening data does.
 * Counts calls so tests can check caching.
 */
export function createFakeMusicSource({ similarCount = 30, catalogSize = 400, artistCount = 40 } = {}) {
  const catalog = Array.from({ length: catalogSize }, (_, index) =>
    makeTrack(`Artist ${index % artistCount}`, `Song ${index}`),
  );
  const calls = { getTrackInfo: 0, getSimilarTracks: 0 };
  const noSimilarSongs = new Set<string>();

  function seedNumber(text: string): number {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 100_003;
    return hash;
  }

  const musicSource: MusicSource = {
    async getTrackInfo(artist, title) {
      calls.getTrackInfo += 1;
      return makeTrack(artist, title);
    },
    async getSimilarTracks(artist, title) {
      calls.getSimilarTracks += 1;
      if (noSimilarSongs.has(makeTrackKey(artist, title))) return [];
      const start = seedNumber(`${artist}|${title}`) % catalogSize;
      const similar: SimilarTrack[] = [];
      for (let offset = 0; offset < similarCount; offset += 1) {
        const track = catalog[(start + offset * 7) % catalogSize];
        similar.push({ ...track, match: 1 - offset / (similarCount + 1) });
      }
      return similar;
    },
  };

  return { musicSource, calls, noSimilarSongs };
}
