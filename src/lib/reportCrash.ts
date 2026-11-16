/**
 * Tells the server a page crashed, so it can send an alert. Best effort: a
 * failure here must never make things worse for the person who hit the crash.
 */
export function reportCrash(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const digest =
    error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.slice(0, 500), digest, path: window.location.pathname.slice(0, 300) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing else to do.
  }
}
