/**
 * Lets the page player and song previews stay out of each other's way without
 * depending on each other: when the page player starts playing, previews stop.
 */

const pagePlayerStarted = "pickify-page-player-started";

export function announcePagePlayerStarted(): void {
  window.dispatchEvent(new Event(pagePlayerStarted));
}

export function onPagePlayerStarted(listener: () => void): () => void {
  window.addEventListener(pagePlayerStarted, listener);
  return () => window.removeEventListener(pagePlayerStarted, listener);
}
