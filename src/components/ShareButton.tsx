"use client";

import { Check, Share } from "lucide-react";
import { useEffect, useState } from "react";

type ShareState = "idle" | "copied" | "failed";

/**
 * Shares the current page. Phones get the system share sheet; everywhere else
 * the link is copied, since desktop share sheets are rarely what people want.
 */
export function ShareButton({ title }: { title: string }) {
  const [state, setState] = useState<ShareState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2_500);
    return () => clearTimeout(timer);
  }, [state]);

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}`;
    const isTouchScreen = window.matchMedia("(pointer: coarse)").matches;
    if (isTouchScreen && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Closing the share sheet isn't an error. Anything else falls back to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => void share()}
        className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 font-medium hover:bg-surface"
      >
        {state === "copied" ? <Check size={18} aria-hidden="true" /> : <Share size={18} aria-hidden="true" />}
        {state === "copied" ? "Link copied" : "Share"}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Link copied" : ""}
      </span>
      {state === "failed" && (
        <span role="alert" className="absolute top-full left-0 mt-2 w-64 text-sm text-danger">
          Couldn&rsquo;t copy the link. Copy it from the address bar instead.
        </span>
      )}
    </span>
  );
}
