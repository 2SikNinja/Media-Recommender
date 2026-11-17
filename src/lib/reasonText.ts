import type { PlaylistReason } from "./candidatePool";

function joinTitles(titles: string[]): string {
  return titles.length <= 1 ? (titles[0] ?? "") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

/** The short line shown under a playlist song, saying why it's there. Empty when unknown. */
export function reasonText(reason: PlaylistReason | null): string {
  if (!reason) return "";
  if (reason.kind === "seed") return "Your starting song";
  if (reason.kind === "pick") return "You picked this";
  if (reason.kind === "added") return "You added this";
  const titles = reason.to.map((song) => song.title);
  if (titles.length === 0) return "";
  return reason.to.every((song) => song.kind === "pick")
    ? `Because you picked ${joinTitles(titles)}`
    : `Similar to ${joinTitles(titles)}`;
}
