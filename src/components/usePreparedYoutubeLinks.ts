"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { exportToYoutube, type YoutubeExport } from "@/lib/apiClient";

/** After an edit, wait this long for more edits before preparing new links. */
const editSettleMs = 1_200;

/**
 * Prepares the YouTube links for a playlist in the background, so the play
 * buttons can be plain links that open straight away (and hand off to the
 * YouTube Music app on phones). `tracksKey` identifies the songs in the
 * playlist; when it changes, the links are prepared again once edits settle.
 *
 * `ready` is set once links for the current songs are in. `getLinks` returns
 * them, waiting for the request already in flight rather than starting another.
 */
export function usePreparedYoutubeLinks(playlistId: string, tracksKey: string | null) {
  const [prepared, setPrepared] = useState<{ key: string; links: YoutubeExport } | null>(null);
  const requestRef = useRef<{ key: string; promise: Promise<YoutubeExport> } | null>(null);
  const hasPreparedRef = useRef(false);

  const request = useCallback(
    (key: string): Promise<YoutubeExport> => {
      if (requestRef.current?.key === key) return requestRef.current.promise;
      const promise = exportToYoutube(playlistId);
      requestRef.current = { key, promise };
      promise.then(
        (links) => {
          // Ignore answers for songs the playlist no longer has.
          if (requestRef.current?.key === key) setPrepared({ key, links });
        },
        () => {
          // Let the next tap try again. The tap that's waiting shows the error.
          if (requestRef.current?.key === key) requestRef.current = null;
        },
      );
      return promise;
    },
    [playlistId],
  );

  useEffect(() => {
    if (tracksKey === null) return;
    // Right away when the page opens; after edits, once they settle.
    const delay = hasPreparedRef.current ? editSettleMs : 0;
    hasPreparedRef.current = true;
    const timer = setTimeout(() => void request(tracksKey).catch(() => {}), delay);
    return () => clearTimeout(timer);
  }, [tracksKey, request]);

  const ready = tracksKey !== null && prepared?.key === tracksKey ? prepared.links : null;

  const getLinks = useCallback((): Promise<YoutubeExport> => {
    if (tracksKey === null) return Promise.reject(new Error("The playlist hasn't loaded yet."));
    if (prepared?.key === tracksKey) return Promise.resolve(prepared.links);
    return request(tracksKey);
  }, [prepared, request, tracksKey]);

  return { ready, getLinks };
}
