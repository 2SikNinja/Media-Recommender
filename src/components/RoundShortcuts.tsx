"use client";

import { useEffect, useEffectEvent } from "react";

import type { Track } from "@/lib/apiClient";

type RoundShortcutsProps = {
  candidates: Track[];
  /** While a request is running, shortcuts do nothing. */
  disabled: boolean;
  onPick: (track: Track) => void;
  onPreview: (track: Track) => void;
  onNextRound: () => void;
};

/** "Digit3" or "Numpad3" to the index of the card it picks: 1 to 9, then 0 for the tenth. */
export function cardIndexForKey(code: string): number | null {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1];
  if (digit === undefined) return null;
  return digit === "0" ? 9 : Number(digit) - 1;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * Keyboard shortcuts for a round: 1 to 0 pick the cards in order, Shift plus a
 * number plays that card's preview, and Enter goes to the next round. They stay
 * out of the way while typing, with Ctrl/Cmd/Alt held (browser shortcuts), and
 * Enter still presses a focused button or link. Shows a hint on devices with a
 * keyboard and mouse.
 */
export function RoundShortcuts({ candidates, disabled, onPick, onPreview, onNextRound }: RoundShortcutsProps) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey || event.repeat || isTypingTarget(event.target)) return;

    const index = cardIndexForKey(event.code);
    if (index !== null) {
      const track = candidates[index];
      if (!track) return;
      event.preventDefault();
      if (event.shiftKey) onPreview(track);
      else onPick(track);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      if (event.target instanceof HTMLElement && event.target.closest("button, a")) return;
      event.preventDefault();
      onNextRound();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <p className="mt-4 hidden text-sm text-text-secondary [@media(hover:hover)_and_(pointer:fine)]:block">
      Keyboard: <Key>1</Key> to <Key>0</Key> pick, <Key>Shift</Key> + number plays a preview, <Key>Enter</Key> goes to
      the next round.
    </p>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-xs text-text-primary">
      {children}
    </kbd>
  );
}
