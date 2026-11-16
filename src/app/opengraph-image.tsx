import { renderShareImage, shareImageSize } from "@/lib/shareImage";

export const alt = "Pickify: start with one song and get a 50-song playlist";
export const size = shareImageSize;
export const contentType = "image/png";

/** The link preview for the home page. */
export default function Image() {
  return renderShareImage({
    title: "Start with one song.",
    subtitle: "Pick your favorites and get a 50-song playlist for YouTube Music.",
  });
}
