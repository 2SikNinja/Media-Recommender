import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeMusicSource } from "@/test/fakeMusicSource";
import { createTestDb } from "@/test/pgliteDb";

import type { Db } from "./dbTypes";
import { exportPlaylistToYoutube, getPlaylist } from "./playlistService";
import { ResolverError, type ResolvedTrack, type Resolver } from "./resolverClient";
import { createSession, submitPick } from "./sessionService";

let db: Db & { close: () => Promise<void> };
let playlistId: string;

/** Every video ID must be 11 characters. */
function fakeVideoId(title: string): string {
  return title.replace(/[^A-Za-z0-9]/g, "").padEnd(11, "x").slice(0, 11);
}

/** Resolves every song except those whose title is listed in `unresolvable`. */
function createFakeResolver(unresolvable: Set<string> = new Set()) {
  return vi.fn<Resolver>(async (queries) =>
    queries.map(
      (query): ResolvedTrack => ({
        artist: query.artist,
        title: query.title,
        videoId: unresolvable.has(query.title) ? null : fakeVideoId(query.title),
        source: unresolvable.has(query.title) ? null : "ytmusicSongs",
        confidence: unresolvable.has(query.title) ? 0 : 1,
        error: null,
      }),
    ),
  );
}

/** YouTube's redirect for watch_videos, or none when `listId` is null. */
function fakeYoutubeFetch(listId: string | null) {
  return vi.fn<typeof fetch>(async () =>
    listId
      ? new Response(null, { status: 303, headers: { location: `https://www.youtube.com/watch?v=abc&list=${listId}` } })
      : new Response("consent page", { status: 200 }),
  );
}

beforeEach(async () => {
  db = await createTestDb();
  const musicSource = createFakeMusicSource().musicSource;
  let state = await createSession({ db, musicSource }, { artist: "Seed Artist", title: "Seed Song" });
  while (state.status === "picking") {
    state = await submitPick({ db, musicSource }, state.sessionId, {
      roundNumber: state.currentRound as number,
      trackKeys: [state.candidates[0].trackKey],
    });
  }
  playlistId = state.playlistId as string;
});

afterEach(async () => {
  await db.close();
});

describe("getPlaylist", () => {
  it("returns the 50 songs in order", async () => {
    const playlist = await getPlaylist(db, playlistId);
    expect(playlist.tracks).toHaveLength(50);
    expect(playlist.tracks.map((track) => track.position)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(playlist.title).toBe("Inspired by Seed Song");
  });

  it("returns notFound for an unknown playlist", async () => {
    await expect(getPlaylist(db, crypto.randomUUID())).rejects.toMatchObject({ code: "notFound" });
  });
});

describe("exportPlaylistToYoutube", () => {
  it("queues matched songs in playlist order and lists the ones it couldn't match", async () => {
    const playlist = await getPlaylist(db, playlistId);
    const missingTitle = playlist.tracks[3].title;
    const resolver = createFakeResolver(new Set([missingTitle]));

    const result = await exportPlaylistToYoutube(
      { db, resolver, fetchImpl: fakeYoutubeFetch("TLGGabc123") },
      playlistId,
      { shuffle: false },
    );

    expect(result.trackCount).toBe(49);
    expect(result.unresolvedTracks).toEqual([{ position: 4, artist: playlist.tracks[3].artist, title: missingTitle }]);
    const videoIds = new URL(result.youtubeUrl).searchParams.get("video_ids")?.split(",");
    expect(videoIds?.[0]).toBe(fakeVideoId(playlist.tracks[0].title));
    expect(videoIds).toHaveLength(49);
    expect(result.youtubeMusicUrl).toBe(`https://music.youtube.com/watch?v=${videoIds?.[0]}&list=TLGGabc123`);
  });

  it("saves matches so the next export doesn't call the resolver for them", async () => {
    const resolver = createFakeResolver();
    await exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId, { shuffle: false });
    await exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId, { shuffle: true });

    expect(resolver).toHaveBeenCalledTimes(1);
    const cached = await db.query("select 1 from track_cache where youtube_video_id is not null");
    expect(cached).toHaveLength(50);
  });

  it("shuffles the queue when asked", async () => {
    const resolver = createFakeResolver();
    const inOrder = await exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId, {
      shuffle: false,
    });
    const shuffledResult = await exportPlaylistToYoutube(
      { db, resolver, fetchImpl: fakeYoutubeFetch(null), random: () => 0 },
      playlistId,
      { shuffle: true },
    );

    const orderedIds = new URL(inOrder.youtubeUrl).searchParams.get("video_ids")?.split(",") ?? [];
    const shuffledIds = new URL(shuffledResult.youtubeUrl).searchParams.get("video_ids")?.split(",") ?? [];
    expect(shuffledIds).not.toEqual(orderedIds);
    expect([...shuffledIds].sort()).toEqual([...orderedIds].sort());
    expect(shuffledResult.youtubeMusicUrl).toBeNull();
  });

  it("fails clearly when the resolver is down and nothing is cached", async () => {
    const resolver = vi.fn<Resolver>(async () => {
      throw new ResolverError("down");
    });
    await expect(
      exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId, { shuffle: false }),
    ).rejects.toMatchObject({ code: "upstreamUnavailable" });
  });
});
