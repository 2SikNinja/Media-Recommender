import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BrowserContext, Page, Route } from "@playwright/test";

import type { Playlist, YoutubeExport } from "../../src/lib/playlistService";
import type { SessionState } from "../../src/lib/sessionService";
import type { Track } from "../../src/lib/tracks";

/** Made-up songs, so the tests never depend on real data. Covers 404 and show the initials. */
function song(index: number): Track {
  const artist = `Artist ${String.fromCharCode(65 + (index % 26))}`;
  const title = `Song ${index}`;
  return { trackKey: `${artist.toLowerCase()}::${title.toLowerCase()}`, artist, title, durationSeconds: 200, imageUrl: null };
}

export const seedSong: Track = {
  trackKey: "seed artist::seed song",
  artist: "Seed Artist",
  title: "Seed Song",
  durationSeconds: 200,
  imageUrl: null,
};

export const sessionId = "11111111-1111-4111-8111-111111111111";
export const playlistId = "22222222-2222-4222-8222-222222222222";

/** One second of silence, so previews can play. */
function silentWav(): Buffer {
  const sampleRate = 8000;
  const data = Buffer.alloc(sampleRate);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data.fill(128)]);
}

const fakeYoutube = readFileSync(join(__dirname, "fakeYoutube.js"), "utf8");

export type RecordedCall = { method: string; path: string; body: unknown };

/**
 * A fake Pickify API that lives in the browser: sessions advance a round per
 * pick, and the finished playlist can be edited. Every request is recorded.
 */
export class MockApi {
  round = 1;
  totalRounds = 3;
  playlistSize = 25;
  rerolls = 0;
  calls: RecordedCall[] = [];
  playlist: Playlist = {
    playlistId,
    sessionId,
    title: "Inspired by Seed Song",
    createdAt: "2026-11-15T20:00:00.000Z",
    tracks: [seedSong, ...Array.from({ length: 24 }, (_, index) => song(index + 1))].map((track, index) => ({
      position: index + 1,
      trackKey: track.trackKey,
      artist: track.artist,
      title: track.title,
      youtubeVideoId: null,
    })),
    removedTracks: [],
  };

  candidates(): Track[] {
    const offset = (this.round - 1) * 10 + this.rerolls * 30;
    return Array.from({ length: 10 }, (_, index) => song(100 + offset + index));
  }

  sessionState(): SessionState {
    const complete = this.round > this.totalRounds;
    return {
      sessionId,
      status: complete ? "complete" : "picking",
      seed: seedSong,
      seeds: [seedSong],
      playlistSize: this.playlistSize,
      currentRound: complete ? null : this.round,
      totalRounds: this.totalRounds,
      candidates: complete ? [] : this.candidates(),
      picks: [],
      playlistId: complete ? playlistId : null,
    };
  }

  youtubeExport(): YoutubeExport {
    const queueUrl = { youtubeUrl: "https://www.youtube.com/watch_videos?video_ids=a", youtubeMusicUrl: null };
    return {
      queue: this.playlist.tracks.map((track, index) => ({ position: track.position, videoId: `video${String(index).padStart(6, "0")}` })),
      inOrder: queueUrl,
      shuffled: queueUrl,
      trackCount: this.playlist.tracks.length,
      unresolvedTracks: [],
    };
  }

  async install(context: BrowserContext | Page) {
    await context.route("https://www.youtube.com/iframe_api", (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: fakeYoutube }),
    );
    await context.route("**/api/**", (route) => this.handle(route));
  }

  private json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    this.calls.push({ method, path, body });

    if (path === "/api/art") return route.fulfill({ status: 404, body: "" });
    if (path === "/api/preview") return route.fulfill({ status: 200, contentType: "audio/wav", body: silentWav() });
    if (path === "/api/client-errors") return route.fulfill({ status: 204, body: "" });
    if (path === "/api/tracks/search") {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      return this.json(route, { tracks: query.length >= 2 ? [seedSong, song(1), song(2)] : [] });
    }
    if (path === "/api/sessions" && method === "POST") {
      const options = body as { rounds?: number; playlistSize?: number };
      this.round = 1;
      this.rerolls = 0;
      this.totalRounds = options.rounds ?? 5;
      this.playlistSize = options.playlistSize ?? 50;
      return this.json(route, this.sessionState(), 201);
    }
    if (path === `/api/sessions/${sessionId}/picks`) {
      this.round += 1;
      return this.json(route, this.sessionState());
    }
    if (path === `/api/sessions/${sessionId}/reroll`) {
      this.rerolls += 1;
      return this.json(route, this.sessionState());
    }
    if (path === `/api/sessions/${sessionId}`) return this.json(route, this.sessionState());
    if (path === `/api/playlists/${playlistId}/export/youtube`) return this.json(route, this.youtubeExport());
    if (path === `/api/playlists/${playlistId}` && method === "GET") return this.json(route, this.playlist);

    const removal = path.match(new RegExp(`^/api/playlists/${playlistId}/tracks/(\\d+)$`));
    if (removal && method === "PATCH") {
      const position = Number(removal[1]);
      const { removed } = body as { removed: boolean };
      const all = [...this.playlist.tracks, ...this.playlist.removedTracks].sort((a, b) => a.position - b.position);
      const removedPositions = new Set(this.playlist.removedTracks.map((track) => track.position));
      if (removed) removedPositions.add(position);
      else removedPositions.delete(position);
      this.playlist = {
        ...this.playlist,
        tracks: all.filter((track) => !removedPositions.has(track.position)),
        removedTracks: all.filter((track) => removedPositions.has(track.position)),
      };
      return this.json(route, this.playlist);
    }

    return this.json(route, { error: { code: "notFound", message: `No mock for ${method} ${path}` } }, 404);
  }
}
