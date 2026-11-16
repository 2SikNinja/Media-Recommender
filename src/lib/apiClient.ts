import type { Playlist, YoutubeExport, YoutubeQueue } from "./playlistService";
import type { SessionState } from "./sessionService";
import type { Track } from "./tracks";

export type { Playlist, SessionState, Track, YoutubeExport, YoutubeQueue };

/** An API error with a message that's safe to show as-is. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

const networkErrorMessage = "Couldn't reach Pickify. Check your connection and try again.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError("network", networkErrorMessage, 0);
  }

  const body = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const apiError = body && "error" in body ? body.error : undefined;
    throw new ApiClientError(
      apiError?.code ?? "unknown",
      apiError?.message ?? "Something went wrong on our end. Try again.",
      response.status,
    );
  }
  return body as T;
}

export function searchTracks(query: string, signal?: AbortSignal): Promise<{ tracks: Track[] }> {
  return request(`/api/tracks/search?q=${encodeURIComponent(query)}`, { signal });
}

export function createSession(seed: { artist: string; title: string }): Promise<SessionState> {
  return request("/api/sessions", { method: "POST", body: JSON.stringify(seed) });
}

export function getSession(sessionId: string): Promise<SessionState> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function submitPick(
  sessionId: string,
  roundNumber: number,
  trackKeys: string[],
  dislikedKeys: string[] = [],
): Promise<SessionState> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/picks`, {
    method: "POST",
    body: JSON.stringify({ roundNumber, trackKeys, dislikedKeys }),
  });
}

export function rerollRound(sessionId: string, roundNumber: number, dislikedKeys: string[] = []): Promise<SessionState> {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/reroll`, {
    method: "POST",
    body: JSON.stringify({ roundNumber, dislikedKeys }),
  });
}

export function getPlaylist(playlistId: string): Promise<Playlist> {
  return request(`/api/playlists/${encodeURIComponent(playlistId)}`);
}

export function setTrackRemoved(playlistId: string, position: number, removed: boolean): Promise<Playlist> {
  return request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/${position}`, {
    method: "PATCH",
    body: JSON.stringify({ removed }),
  });
}

/** The playlist's YouTube links, in order and shuffled. */
export function exportToYoutube(playlistId: string): Promise<YoutubeExport> {
  return request(`/api/playlists/${encodeURIComponent(playlistId)}/export/youtube`, { method: "POST" });
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Something went wrong. Try again.";
}
