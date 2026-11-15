import type { Metadata } from "next";
import { Suspense } from "react";

import { PlaylistSkeleton, PlaylistView } from "@/components/PlaylistView";

export const metadata: Metadata = {
  title: "Your playlist | Pickify",
};

export default function PlaylistPage() {
  return (
    <Suspense fallback={<PlaylistSkeleton />}>
      <PlaylistView />
    </Suspense>
  );
}
