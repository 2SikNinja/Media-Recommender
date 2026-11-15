import type { Metadata } from "next";
import { Suspense } from "react";

import { RoundPicker, RoundSkeleton } from "@/components/RoundPicker";

export const metadata: Metadata = {
  title: "Pick your songs | Pickify",
};

export default function SessionPage() {
  return (
    <Suspense fallback={<RoundSkeleton />}>
      <RoundPicker />
    </Suspense>
  );
}
