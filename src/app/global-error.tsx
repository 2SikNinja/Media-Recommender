"use client";

import { useEffect } from "react";

import { reportCrash } from "@/lib/reportCrash";

/**
 * Shown when the outer layout itself crashes. It replaces the whole page, so it
 * brings its own html, body and inline styles in the app's colors.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportCrash(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#0e0f12", color: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
        <title>Something went wrong | Pickify</title>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "96px 20px" }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#9aa1ad", lineHeight: 1.5 }}>Pickify hit a problem loading. It&rsquo;s been reported.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 16, border: 0, borderRadius: 999, padding: "10px 20px", background: "#2dd4bf", color: "#0e0f12", fontSize: 16, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
