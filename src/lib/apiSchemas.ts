import { z } from "zod";

const trimmedName = z.string().trim().min(1, "can't be empty").max(200, "is too long");

export const idSchema = z.uuid("must be a valid ID");

export const trackQuerySchema = z.object({
  artist: trimmedName.refine((value) => /[\p{L}\p{N}]/u.test(value), "needs letters or numbers"),
  title: trimmedName.refine((value) => /[\p{L}\p{N}]/u.test(value), "needs letters or numbers"),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "can't be empty").max(100, "is too long"),
});

const seedSchema = z.object({
  artist: trimmedName,
  title: trimmedName,
});

export const roundChoices = [3, 5, 8] as const;
export const playlistSizeChoices = [25, 50, 100] as const;

/**
 * Starts a session from one to three seed songs, with a choice of rounds and
 * playlist length. The older `{ artist, title }` body still works.
 */
export const createSessionSchema = z.preprocess(
  (body) =>
    body && typeof body === "object" && !("seeds" in body) && "artist" in body
      ? { seeds: [{ artist: (body as { artist: unknown }).artist, title: (body as { title?: unknown }).title }] }
      : body,
  z.object({
    seeds: z.array(seedSchema).min(1, "must include a seed song").max(3, "can include at most 3 seed songs"),
    rounds: z.union(roundChoices.map((choice) => z.literal(choice))).default(5),
    playlistSize: z.union(playlistSizeChoices.map((choice) => z.literal(choice))).default(50),
  }),
);

const roundNumberSchema = z.number().int().min(1).max(10);

const dislikedKeysSchema = z.array(z.string().min(3).max(500)).max(10, "can include at most 10 songs").default([]);

export const submitPickSchema = z.object({
  roundNumber: roundNumberSchema,
  trackKeys: z
    .array(z.string().min(3).max(500))
    .min(1, "must include at least one song")
    .max(10, "can include at most 10 songs"),
  dislikedKeys: dislikedKeysSchema,
});

export const rerollSchema = z.object({
  roundNumber: roundNumberSchema,
  dislikedKeys: dislikedKeysSchema,
});


export const playlistPositionSchema = z.coerce.number().int().min(1).max(100);

export const trackRemovalSchema = z.object({
  removed: z.boolean(),
});
