import Image from "next/image";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Image src="/logo.svg" alt="" width={72} height={72} className="invert" priority />
      <h1 className="text-4xl font-semibold tracking-tight">Pickify</h1>
      <p className="max-w-md text-text-secondary">
        Start from one song, pick your favorite out of 10 suggestions each round, and get a
        50-song playlist you can play on YouTube Music.
      </p>
      <span className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent">
        Coming soon
      </span>
    </main>
  );
}
