import Link from "next/link";

/** Shown for any address that doesn't match a page, in the app's own theme. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl pt-16">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">This page doesn&rsquo;t exist</h1>
      <p className="mt-3 text-text-secondary">
        The link may be mistyped, or the page may have moved. Playlists and sessions have their own links, which start
        with /playlist/ or /session/.
      </p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent hover:bg-accent-hover">
        Start a new playlist
      </Link>
    </div>
  );
}
