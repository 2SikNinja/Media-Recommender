import { z } from "zod";

/** The resolver accepts at most this many songs per request. */
export const resolverBatchSize = 50;
const defaultTimeoutMs = 55_000;

export type ResolveQuery = {
  artist: string;
  title: string;
  durationSeconds: number | null;
};

const resolvedTrackSchema = z.object({
  artist: z.string(),
  title: z.string(),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable(),
  source: z.enum(["ytmusicSongs", "ytmusicVideos"]).nullable(),
  confidence: z.number().min(0).max(1),
  error: z.string().nullable(),
});

const resolveResponseSchema = z.object({ results: z.array(resolvedTrackSchema) });

export type ResolvedTrack = z.infer<typeof resolvedTrackSchema>;

/** Finds a YouTube video for each song. Results come back in the same order as the input. */
export type Resolver = (queries: ResolveQuery[]) => Promise<ResolvedTrack[]>;

export class ResolverError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ResolverError";
  }
}

export type ResolverClientOptions = {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createResolverClient({
  url,
  secret,
  fetchImpl = fetch,
  timeoutMs = defaultTimeoutMs,
}: ResolverClientOptions): Resolver {
  const endpoint = new URL("/resolve", url).toString();

  return async (queries) => {
    const results: ResolvedTrack[] = [];
    for (let start = 0; start < queries.length; start += resolverBatchSize) {
      const batch = queries.slice(start, start + resolverBatchSize);

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-resolver-secret": secret },
          body: JSON.stringify({
            tracks: batch.map(({ artist, title, durationSeconds }) => ({
              artist: artist.slice(0, 200),
              title: title.slice(0, 200),
              ...(durationSeconds ? { durationSeconds } : {}),
            })),
          }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (error) {
        throw new ResolverError("Resolver request failed", error);
      }
      if (!response.ok) {
        throw new ResolverError(`Resolver returned HTTP ${response.status}`);
      }

      const parsed = resolveResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success || parsed.data.results.length !== batch.length) {
        throw new ResolverError("Resolver returned an unexpected response");
      }
      results.push(...parsed.data.results);
    }
    return results;
  };
}

export function getResolver(): Resolver {
  const url = process.env.RESOLVER_URL;
  const secret = process.env.RESOLVER_SECRET;
  if (!url || !secret) {
    throw new Error("RESOLVER_URL and RESOLVER_SECRET must be set");
  }
  return createResolverClient({ url, secret });
}
