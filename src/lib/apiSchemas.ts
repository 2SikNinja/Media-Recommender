import { z } from "zod";

const trimmedName = z.string().trim().min(1, "can't be empty").max(200, "is too long");

export const idSchema = z.uuid("must be a valid ID");

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "can't be empty").max(100, "is too long"),
});

export const createSessionSchema = z.object({
  artist: trimmedName,
  title: trimmedName,
});

const roundNumberSchema = z.number().int().min(1).max(10);

export const submitPickSchema = z.object({
  roundNumber: roundNumberSchema,
  trackKeys: z
    .array(z.string().min(3).max(500))
    .min(1, "must include at least one song")
    .max(10, "can include at most 10 songs"),
});

export const rerollSchema = z.object({
  roundNumber: roundNumberSchema,
});

export const youtubeExportSchema = z.object({
  shuffle: z.boolean().default(false),
});
