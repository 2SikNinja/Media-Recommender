import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pickify",
  description: "Start with one song, pick your favorites, and get a 50-song playlist to play on YouTube Music.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="mx-auto flex w-full max-w-5xl items-center px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 rounded-md text-text-primary">
            <Image src="/logo.svg" alt="" width={28} height={28} className="invert" priority />
            <span className="font-display text-xl font-semibold tracking-tight">Pickify</span>
          </Link>
        </header>

        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-16 sm:px-8">{children}</main>

        <footer className="mx-auto w-full max-w-5xl px-5 py-6 text-sm text-text-secondary sm:px-8">
          Song suggestions from{" "}
          <a href="https://www.last.fm" className="underline decoration-border underline-offset-4 hover:text-text-primary">
            Last.fm
          </a>
          . Playback on YouTube.
        </footer>
      </body>
    </html>
  );
}
