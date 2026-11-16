"use client";

import Link from "next/link";
import { useEffect } from "react";

import { reportCrash } from "@/lib/reportCrash";

/** Shown when a page crashes. Reports it, and offers a retry or a fresh start. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportCrash(error);
  }, [error]);

  return (
    <section className="mx-auto max-w-xl pt-16">
      <h1 className="font-display text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-text-secondary">
        This page hit a problem and couldn&rsquo;t finish loading. It&rsquo;s been reported. Try again, or start a new playlist.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link href="/" className="rounded-full border border-border px-5 py-2.5 font-medium hover:bg-surface">
          Start a new playlist
        </Link>
      </div>
    </section>
  );
}
