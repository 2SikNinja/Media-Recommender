import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/** The size social sites expect for link previews. */
export const shareImageSize = { width: 1200, height: 630 };

const colors = {
  background: "#0e0f12",
  groove: "#22262d",
  vinyl: "#131519",
  textPrimary: "#f4f5f7",
  textSecondary: "#9aa1ad",
  label: "#2a6f68",
  surface: "#181b20",
};

const coverTimeoutMs = 3_000;

type Assets = { display: ArrayBuffer; body: ArrayBuffer; logoSrc: string };
let assetsPromise: Promise<Assets> | null = null;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}

/** Fonts and logo, read once per server instance. */
function loadAssets(): Promise<Assets> {
  assetsPromise ??= Promise.all([
    readFile(join(process.cwd(), "assets/fonts/bricolage-grotesque-latin-600-normal.woff")),
    readFile(join(process.cwd(), "assets/fonts/geist-sans-latin-400-normal.woff")),
    readFile(join(process.cwd(), "public/logo.svg"), "base64"),
  ]).then(([display, body, logo]) => ({
    display: toArrayBuffer(display),
    body: toArrayBuffer(body),
    logoSrc: `data:image/svg+xml;base64,${logo}`,
  }));
  return assetsPromise;
}

/** Deezer covers come in several sizes; the 250px one looks soft this large. */
function largerCover(url: string): string {
  return url.replace(/\/250x250-/, "/500x500-");
}

/**
 * Downloads the cover up front, so a slow or missing image gives a plain label
 * instead of failing the whole preview image.
 */
async function loadCover(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(largerCover(url), { signal: AbortSignal.timeout(coverTimeoutMs) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const data = Buffer.from(await response.arrayBuffer()).toString("base64");
    return `data:${type};base64,${data}`;
  } catch {
    return null;
  }
}

function initialsOf(artist: string): string {
  const words = artist.replace(/^the\s+/i, "").split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

type ShareImageOptions = {
  title: string;
  subtitle: string;
  /** The cover for the record's label, if there is one. */
  coverUrl?: string | null;
  /** Initials for the label when there's no cover. Without it, the label shows the logo. */
  artist?: string;
};

/**
 * The link preview: a large record with the seed song's cover on the right,
 * bleeding off the edge, and the title on the left.
 */
export async function renderShareImage({ title, subtitle, coverUrl = null, artist }: ShareImageOptions): Promise<ImageResponse> {
  const [assets, cover] = await Promise.all([loadAssets(), loadCover(coverUrl)]);
  const discSize = 560;
  const labelSize = 340;
  const rings = [0.96, 0.9, 0.84, 0.78, 0.72, 0.66];
  // With neither a cover nor an artist, the label carries the logo instead.
  const showsLogo = !cover && !artist;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: colors.background,
          fontFamily: "Geist",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -110,
            top: (shareImageSize.height - discSize) / 2,
            width: discSize,
            height: discSize,
            borderRadius: discSize,
            background: colors.vinyl,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 0 2px ${colors.groove}`,
          }}
        >
          {rings.map((ring) => (
            <div
              key={ring}
              style={{
                position: "absolute",
                width: discSize * ring,
                height: discSize * ring,
                borderRadius: discSize,
                border: `2px solid ${colors.groove}`,
              }}
            />
          ))}
          <div
            style={{
              width: labelSize,
              height: labelSize,
              borderRadius: labelSize,
              overflow: "hidden",
              background: showsLogo ? colors.surface : colors.label,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              color: "rgba(255,255,255,0.9)",
              fontFamily: "Bricolage",
              fontSize: 110,
            }}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- Rendered to an image by next/og, not shown in a page.
              <img src={cover} alt="" width={labelSize} height={labelSize} style={{ objectFit: "cover" }} />
            ) : artist ? (
              initialsOf(artist)
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- Rendered to an image by next/og.
              <img src={assets.logoSrc} alt="" width={150} height={150} />
            )}
            {!showsLogo && (
              <div
                style={{
                  position: "absolute",
                  width: 22,
                  height: 22,
                  borderRadius: 22,
                  background: colors.background,
                  left: (labelSize - 22) / 2,
                  top: (labelSize - 22) / 2,
                }}
              />
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 0 64px 72px",
            width: 640,
            height: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Rendered to an image by next/og. */}
            <img src={assets.logoSrc} alt="" width={52} height={52} />
            <div style={{ fontFamily: "Bricolage", fontSize: 36, color: colors.textPrimary }}>Pickify</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                fontFamily: "Bricolage",
                fontSize: title.length > 40 ? 60 : 72,
                lineHeight: 1.05,
                letterSpacing: -1.5,
                color: colors.textPrimary,
                lineClamp: 3,
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 30, color: colors.textSecondary }}>{subtitle}</div>
          </div>
        </div>
      </div>
    ),
    {
      ...shareImageSize,
      fonts: [
        { name: "Bricolage", data: assets.display, weight: 600, style: "normal" },
        { name: "Geist", data: assets.body, weight: 400, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}
