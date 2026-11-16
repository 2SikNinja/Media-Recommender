import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PlaylistSkeleton, PlaylistView } from "@/components/PlaylistView";
import { describePlaylist, findPlaylistSummary } from "@/lib/playlistSummary";

/** The playlist's name and description, so shared links show them. */
export async function generateMetadata({ params }: PageProps<"/playlist/[playlistId]">): Promise<Metadata> {
  const summary = await findPlaylistSummary((await params).playlistId).catch(() => null);
  if (!summary) return { title: "Playlist | Pickify" };
  const description = describePlaylist(summary);
  return {
    title: `${summary.title} | Pickify`,
    description,
    openGraph: { title: summary.title, description, siteName: "Pickify", type: "music.playlist" },
    twitter: { card: "summary_large_image", title: summary.title, description },
  };
}

async function Connection() {
  await connection();
  return null;
}

/**
 * The metadata above reads the playlist at request time. This tells Next.js
 * that's intended, while the rest of the page still prerenders as a static shell.
 */
function RequestTimeMarker() {
  return (
    <Suspense>
      <Connection />
    </Suspense>
  );
}

export default function PlaylistPage() {
  return (
    <>
      <Suspense fallback={<PlaylistSkeleton />}>
        <PlaylistView />
      </Suspense>
      <RequestTimeMarker />
    </>
  );
}
