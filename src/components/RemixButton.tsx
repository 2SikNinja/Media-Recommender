"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorMessage, remixPlaylist } from "@/lib/apiClient";

/**
 * Starts fresh rounds from this playlist's seed songs, with the same number of
 * rounds and playlist length, so someone with a shared link can make their own.
 */
export function RemixButton({ playlistId }: { playlistId: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remix() {
    setStarting(true);
    setError(null);
    try {
      const session = await remixPlaylist(playlistId);
      router.push(`/session/${session.sessionId}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setStarting(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => void remix()}
        disabled={starting}
        title="Pick your own songs, starting from the same seeds"
        className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 font-medium hover:bg-surface disabled:opacity-70"
      >
        {starting ? (
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles size={18} aria-hidden="true" />
        )}
        {starting ? "Starting…" : "Make my own"}
      </button>
      {error && (
        <span role="alert" className="absolute top-full left-0 mt-2 w-64 text-sm text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
