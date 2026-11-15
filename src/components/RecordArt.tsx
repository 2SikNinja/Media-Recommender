/* eslint-disable @next/next/no-img-element -- Last.fm art comes from many CDNs; a plain img avoids configuring each one. */

/** Center-label colors. Muted so the teal accent stays the only bright color on the page. */
const labelColors = ["#2a6f68", "#6b4f8a", "#8a5a3c", "#3f5f8a", "#7a3f52", "#5a6b3a", "#2f6b8a", "#8a7a3c"];

function hashText(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash;
}

function initialsOf(artist: string): string {
  const words = artist
    .replace(/^the\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [words[0] ?? "?"];
  return letters.map((word) => Array.from(word)[0]?.toUpperCase() ?? "").join("");
}

type RecordArtProps = {
  artist: string;
  imageUrl: string | null;
  size?: number;
  spinning?: boolean;
};

/**
 * A small vinyl record: grooved rings with a colored center label showing the
 * artist's initials, or the album art as the label when Last.fm has it.
 */
export function RecordArt({ artist, imageUrl, size = 56, spinning = false }: RecordArtProps) {
  const labelColor = labelColors[hashText(artist.toLowerCase()) % labelColors.length];
  const labelSize = Math.round(size * 0.58);

  return (
    <div
      aria-hidden="true"
      className={`relative shrink-0 rounded-full ${spinning ? "animate-[spin_2.4s_linear_infinite]" : ""}`}
      style={{
        width: size,
        height: size,
        background:
          "repeating-radial-gradient(circle at center, #131519 0 1.5px, #22262d 1.5px 3px), #131519",
        boxShadow: "inset 0 0 0 1px #2a2e35",
      }}
    >
      <div
        className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full font-display font-semibold text-white/90"
        style={{ width: labelSize, height: labelSize, background: labelColor, fontSize: Math.max(11, Math.round(labelSize * 0.36)) }}
      >
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(artist)}
      </div>
    </div>
  );
}
