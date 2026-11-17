import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeMusicSource } from "@/test/fakeMusicSource";
import { createTestDb } from "@/test/pgliteDb";

import type { Db } from "./dbTypes";
import { addTrack, exportPlaylistToYoutube, getPlaylist, reorderTracks, setTrackRemoved } from "./playlistService";
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
  let state = await createSession({ db, musicSource }, { seeds: [{ artist: "Seed Artist", title: "Seed Song" }] });
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

describe("setTrackRemoved", () => {
  it("takes a song out and puts it back in its original place", async () => {
    const before = await getPlaylist(db, playlistId);
    const removedTrack = before.tracks[4];

    const afterRemove = await setTrackRemoved(db, playlistId, removedTrack.position, true);
    expect(afterRemove.tracks).toHaveLength(49);
    expect(afterRemove.tracks.map((track) => track.trackKey)).not.toContain(removedTrack.trackKey);
    expect(afterRemove.removedTracks).toEqual([removedTrack]);

    const afterRestore = await setTrackRemoved(db, playlistId, removedTrack.position, false);
    expect(afterRestore.tracks).toEqual(before.tracks);
    expect(afterRestore.removedTracks).toEqual([]);
  });

  it("is harmless to repeat", async () => {
    await setTrackRemoved(db, playlistId, 3, true);
    const again = await setTrackRemoved(db, playlistId, 3, true);
    expect(again.tracks).toHaveLength(49);
    expect(again.removedTracks).toHaveLength(1);
    await expect(setTrackRemoved(db, playlistId, 7, false)).resolves.toMatchObject({ removedTracks: [{ position: 3 }] });
  });

  it("won't remove the last song", async () => {
    for (let position = 1; position < 50; position += 1) {
      await setTrackRemoved(db, playlistId, position, true);
    }
    await expect(setTrackRemoved(db, playlistId, 50, true)).rejects.toMatchObject({ code: "conflict" });
    expect((await getPlaylist(db, playlistId)).tracks).toHaveLength(1);
  });

  it("returns notFound for an unknown playlist or position", async () => {
    await expect(setTrackRemoved(db, crypto.randomUUID(), 1, true)).rejects.toMatchObject({ code: "notFound" });
    await expect(setTrackRemoved(db, playlistId, 51, true)).rejects.toMatchObject({ code: "notFound" });
  });

  it("leaves removed songs out of the YouTube queue", async () => {
    const playlist = await getPlaylist(db, playlistId);
    await setTrackRemoved(db, playlistId, 2, true);
    const resolver = createFakeResolver();
    const result = await exportPlaylistToYoutube(
      { db, resolver, fetchImpl: fakeYoutubeFetch(null) },
      playlistId,
    );
    expect(result.trackCount).toBe(49);
    expect(result.inOrder.youtubeUrl).not.toContain(fakeVideoId(playlist.tracks[1].title));
    expect(result.shuffled.youtubeUrl).not.toContain(fakeVideoId(playlist.tracks[1].title));
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
    );

    expect(result.trackCount).toBe(49);
    expect(result.unresolvedTracks).toEqual([{ position: 4, artist: playlist.tracks[3].artist, title: missingTitle }]);
    const videoIds = new URL(result.inOrder.youtubeUrl).searchParams.get("video_ids")?.split(",");
    expect(videoIds?.[0]).toBe(fakeVideoId(playlist.tracks[0].title));
    expect(videoIds).toHaveLength(49);
    expect(result.inOrder.youtubeMusicUrl).toBe(`https://music.youtube.com/watch?v=${videoIds?.[0]}&list=TLGGabc123`);
    expect(result.queue.map((item) => item.videoId)).toEqual(videoIds);
    expect(result.queue.map((item) => item.position)).not.toContain(4);
    expect(result.queue[0]).toEqual({ position: 1, videoId: fakeVideoId(playlist.tracks[0].title) });
  });

  it("saves matches so the next export doesn't call the resolver for them", async () => {
    const resolver = createFakeResolver();
    await exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId);
    await exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId);

    expect(resolver).toHaveBeenCalledTimes(1);
    const cached = await db.query("select 1 from track_cache where youtube_video_id is not null");
    expect(cached).toHaveLength(50);
  });

  it("builds an in-order and a shuffled queue from the same matches in one call", async () => {
    const resolver = createFakeResolver();
    const result = await exportPlaylistToYoutube(
      { db, resolver, fetchImpl: fakeYoutubeFetch("TLGGboth"), random: () => 0 },
      playlistId,
    );

    const orderedIds = new URL(result.inOrder.youtubeUrl).searchParams.get("video_ids")?.split(",") ?? [];
    const shuffledIds = new URL(result.shuffled.youtubeUrl).searchParams.get("video_ids")?.split(",") ?? [];
    expect(shuffledIds).not.toEqual(orderedIds);
    expect([...shuffledIds].sort()).toEqual([...orderedIds].sort());
    expect(result.shuffled.youtubeMusicUrl).toBe(`https://music.youtube.com/watch?v=${shuffledIds[0]}&list=TLGGboth`);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("falls back to YouTube links when YouTube Music doesn't hand back a queue", async () => {
    const result = await exportPlaylistToYoutube({ db, resolver: createFakeResolver(), fetchImpl: fakeYoutubeFetch(null) }, playlistId);
    expect(result.inOrder.youtubeMusicUrl).toBeNull();
    expect(result.shuffled.youtubeMusicUrl).toBeNull();
    expect(result.inOrder.youtubeUrl).toContain("watch_videos");
  });

  it("fails clearly when the resolver is down and nothing is cached", async () => {
    const resolver = vi.fn<Resolver>(async () => {
      throw new ResolverError("down");
    });
    await expect(
      exportPlaylistToYoutube({ db, resolver, fetchImpl: fakeYoutubeFetch(null) }, playlistId),
    ).rejects.toMatchObject({ code: "upstreamUnavailable" });
  });
});

describe("addTrack", () => {
  it("adds a song to the end, and it stays there", async () => {
    const before = await getPlaylist(db, playlistId);
    const after = await addTrack(db, playlistId, { artist: "New Artist", title: "New Song" });

    expect(after.tracks).toHaveLength(before.tracks.length + 1);
    expect(after.tracks.at(-1)).toMatchObject({
      artist: "New Artist",
      title: "New Song",
      position: 51,
      reason: { kind: "added" },
    });
    expect(after.tracks.slice(0, -1)).toEqual(before.tracks);
    expect(await getPlaylist(db, playlistId)).toEqual(after);
  });

  it("refuses a song that's already playing", async () => {
    const { tracks } = await getPlaylist(db, playlistId);
    await expect(addTrack(db, playlistId, { artist: tracks[3].artist, title: tracks[3].title })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("puts a removed song back at the end instead of adding it twice", async () => {
    const { tracks } = await getPlaylist(db, playlistId);
    await setTrackRemoved(db, playlistId, tracks[2].position, true);

    const after = await addTrack(db, playlistId, { artist: tracks[2].artist, title: tracks[2].title });

    expect(after.removedTracks).toEqual([]);
    expect(after.tracks.at(-1)?.position).toBe(tracks[2].position);
    expect(after.tracks).toHaveLength(tracks.length);
  });

  it("says when the playlist doesn't exist", async () => {
    await expect(
      addTrack(db, "00000000-0000-4000-8000-000000000000", { artist: "A", title: "B" }),
    ).rejects.toMatchObject({ code: "notFound" });
  });
});

describe("reorderTracks", () => {
  it("saves a new order and keeps it", async () => {
    const { tracks } = await getPlaylist(db, playlistId);
    const positions = tracks.map((track) => track.position);
    const moved = [positions[5], ...positions.filter((position) => position !== positions[5])];

    const after = await reorderTracks(db, playlistId, moved);

    expect(after.tracks.map((track) => track.position)).toEqual(moved);
    expect((await getPlaylist(db, playlistId)).tracks.map((track) => track.position)).toEqual(moved);
  });

  it("refuses a list that doesn't match the playing songs", async () => {
    const { tracks } = await getPlaylist(db, playlistId);
    const positions = tracks.map((track) => track.position);
    await expect(reorderTracks(db, playlistId, positions.slice(1))).rejects.toMatchObject({ code: "conflict" });
    await expect(reorderTracks(db, playlistId, [positions[0], ...positions.slice(0, -1)])).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("can reverse the whole playlist", async () => {
    const { tracks } = await getPlaylist(db, playlistId);
    const reversed = tracks.map((track) => track.position).reverse();
    await reorderTracks(db, playlistId, reversed);
    const { tracks: after } = await getPlaylist(db, playlistId);
    expect(after.map((track) => track.position)).toEqual(reversed);
  });
});
