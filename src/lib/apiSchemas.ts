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

export const createSessionSchema = z.object({
  artist: trimmedName,
  title: trimmedName,
});

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


export const playlistPositionSchema = z.coerce.number().int().min(1).max(50);

export const trackRemovalSchema = z.object({
  removed: z.boolean(),
});

export const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(500),
  digest: z.string().max(100).optional(),
  path: z.string().max(300),
});
