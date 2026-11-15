"use client";

import { LoaderCircle, Shuffle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ApiClientError, errorMessage, getSession, rerollRound, submitPick, type SessionState } from "@/lib/apiClient";

import { RoundProgress } from "./RoundProgress";
import { TrackCard } from "./TrackCard";

type PendingAction = "pick" | "reroll" | null;

export function RoundPicker() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ round: number; trackKeys: string[] } | null>(null);
  const [pendingRequest, setPendingRequest] = useState<PendingAction>(null);
  // Moving to the playlist runs in a transition, so the busy state ends when the
  // playlist shows instead of coming back stuck if you press Back.
  const [isNavigating, startNavigation] = useTransition();
  const pending: PendingAction = pendingRequest ?? (isNavigating ? "pick" : null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getSession(sessionId)
      .then((state) => {
        if (!isCurrent) return;
        if (state.status === "complete" && state.playlistId) {
          router.replace(`/playlist/${state.playlistId}`);
          return;
        }
        setSession(state);
      })
      .catch((error: unknown) => {
        if (isCurrent) setLoadError(errorMessage(error));
      });
    return () => {
      isCurrent = false;
    };
  }, [sessionId, router]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl pt-16">
        <h1 className="font-display text-3xl font-semibold">This session can&rsquo;t be opened</h1>
        <p className="mt-3 text-text-secondary">{loadError}</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent hover:bg-accent-hover">
          Start a new playlist
        </Link>
      </div>
    );
  }

  if (!session || session.currentRound === null) {
    return <RoundSkeleton />;
  }

  const roundNumber = session.currentRound;
  const selectedKeys = selection?.round === roundNumber ? selection.trackKeys : [];
  const isLastRound = roundNumber >= session.totalRounds;
  const pickCount = session.picks.length;

  function applyState(next: SessionState) {
    if (next.status === "complete" && next.playlistId) {
      const playlistId = next.playlistId;
      startNavigation(() => {
        setPendingRequest(null);
        router.push(`/playlist/${playlistId}`);
      });
      return;
    }
    setSession(next);
    setPendingRequest(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runAction(action: Exclude<PendingAction, null>, call: () => Promise<SessionState>) {
    setPendingRequest(action);
    setActionError(null);
    try {
      applyState(await call());
    } catch (error) {
      setPendingRequest(null);
      setActionError(errorMessage(error));
      // Someone else (another tab, a retry) moved the session on. Catch up.
      if (error instanceof ApiClientError && error.code === "conflict") {
        getSession(sessionId).then(applyState, () => {});
      }
    }
  }

  function toggle(trackKey: string) {
    setActionError(null);
    setSelection({
      round: roundNumber,
      trackKeys: selectedKeys.includes(trackKey)
        ? selectedKeys.filter((key) => key !== trackKey)
        : [...selectedKeys, trackKey],
    });
  }

  function confirmPicks() {
    if (selectedKeys.length === 0) {
      setActionError("Pick at least one song.");
      return;
    }
    void runAction("pick", () => submitPick(sessionId, roundNumber, selectedKeys));
  }

  return (
    <section className="mx-auto w-full max-w-3xl pt-6 sm:pt-10">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-text-secondary">
          Round {roundNumber} of {session.totalRounds}
        </p>
        <Link href="/" className="text-sm text-text-secondary underline-offset-4 hover:text-text-primary hover:underline">
          Start over
        </Link>
      </div>
      <div className="mt-2">
        <RoundProgress currentRound={roundNumber} totalRounds={session.totalRounds} />
      </div>

      <h1 id="round-heading" className="mt-8 font-display text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
        Pick the ones you&rsquo;d play next
      </h1>
      <p className="mt-3 text-text-secondary">
        {pickCount > 0 ? (
          <>Chosen with the {pickCount === 1 ? "song" : `${pickCount} songs`} you&rsquo;ve picked so far in mind.</>
        ) : (
          <>
            Songs like <span className="text-text-primary">{session.seed.title}</span> by {session.seed.artist}.
          </>
        )}{" "}
        Pick as many as you like.
      </p>

      <div role="group" aria-labelledby="round-heading" className="mt-8 grid gap-2 sm:grid-cols-2">
        {session.candidates.map((track) => (
          <TrackCard
            key={track.trackKey}
            track={track}
            selected={selectedKeys.includes(track.trackKey)}
            onToggle={() => toggle(track.trackKey)}
            disabled={pending !== null}
          />
        ))}
      </div>

      <div className="sticky bottom-0 -mx-5 mt-6 border-t border-border bg-background/95 px-5 py-4 backdrop-blur sm:mx-0 sm:rounded-b-xl sm:px-0">
        {actionError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {actionError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void runAction("reroll", () => rerollRound(sessionId, roundNumber))}
            disabled={pending !== null}
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2.5 text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-50 sm:px-4"
          >
            {pending === "reroll" ? (
              <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <Shuffle size={18} aria-hidden="true" />
            )}
            None of these
          </button>
          <button
            type="button"
            onClick={confirmPicks}
            disabled={pending !== null}
            aria-busy={pending === "pick"}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-70 sm:max-w-60"
          >
            {pending === "pick" && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}
            {pending === "pick" ? (isLastRound ? "Building your playlist…" : "Finding more songs…") : isLastRound ? "Build my playlist" : "Next round"}
            {pending !== "pick" && selectedKeys.length > 0 && (
              <span className="rounded-full bg-on-accent/15 px-2 py-0.5 text-sm tabular-nums" aria-label={`${selectedKeys.length} picked`}>
                {selectedKeys.length}
              </span>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

export function RoundSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading your round" className="mx-auto w-full max-w-3xl pt-6 sm:pt-10">
      <div className="h-4 w-28 rounded bg-surface" />
      <div className="mt-3 h-1.5 rounded-full bg-surface" />
      <div className="mt-8 h-12 w-3/4 rounded-lg bg-surface" />
      <div className="mt-8 grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="h-[78px] animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    </section>
  );
}
