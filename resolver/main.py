"""
Pickify resolver service.

Takes a batch of songs (artist, title, optional duration) and finds a playable
YouTube video ID for each one using ytmusicapi. Tries official YouTube Music
songs first, then falls back to any video (music videos, lyric videos, user
uploads). Results below the confidence threshold come back unresolved instead
of guessed.

Deploy as its own Vercel project with Root Directory set to "resolver".
Run locally with: uvicorn main:app --reload --port 8001
"""

import os
import re
import secrets
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from ytmusicapi import YTMusic

app = FastAPI(title="Pickify Resolver")

maxBatchSize = 50
maxWorkers = 8
searchResultLimit = 10
durationToleranceSeconds = 15
minConfidence = 0.6
minTitleScore = 0.6

# Words that usually mean "not the original recording". Skipped unless the
# requested title contains the same word (for example an official remix).
blockedWords = [
    "cover",
    "reaction",
    "live",
    "karaoke",
    "nightcore",
    "sped up",
    "slowed",
    "8d",
    "instrumental",
    "remix",
    "1 hour",
    "loop",
    "tutorial",
]

searchFilters = [
    ("songs", "ytmusicSongs"),
    ("videos", "ytmusicVideos"),
]

threadLocal = threading.local()


class TrackQuery(BaseModel):
    artist: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    durationSeconds: int | None = Field(default=None, ge=0, le=7200)


class ResolveRequest(BaseModel):
    tracks: list[TrackQuery] = Field(min_length=1, max_length=maxBatchSize)


def getClient() -> YTMusic:
    # One client per worker thread so threads never share a requests session.
    if not hasattr(threadLocal, "client"):
        threadLocal.client = YTMusic()
    return threadLocal.client


def requireSecret(providedSecret: str | None) -> None:
    expectedSecret = os.environ.get("RESOLVER_SECRET")
    if not expectedSecret:
        raise HTTPException(status_code=500, detail="RESOLVER_SECRET is not configured")
    if not providedSecret or not secrets.compare_digest(providedSecret, expectedSecret):
        raise HTTPException(status_code=401, detail="Invalid resolver secret")


def normalizeText(text: str) -> str:
    # Strip accents but keep non-Latin scripts (Korean, Japanese, etc.) intact.
    decomposed = unicodedata.normalize("NFKD", text)
    withoutMarks = "".join(char for char in decomposed if not unicodedata.combining(char))
    lowered = withoutMarks.casefold()
    lowered = re.sub(r"[\(\[](feat|ft|with)\b[^\)\]]*[\)\]]", " ", lowered)
    lowered = re.sub(r"\b(feat|ft)\b\.?\s.*$", " ", lowered)
    lowered = re.sub(r"[^\w\s]", " ", lowered)
    return " ".join(lowered.split())


def tokenOverlap(expectedText: str, candidateText: str) -> float:
    expectedTokens = set(expectedText.split())
    if not expectedTokens:
        return 0.0
    candidateTokens = set(candidateText.split())
    return len(expectedTokens & candidateTokens) / len(expectedTokens)


def textScore(expectedText: str, candidateText: str) -> float:
    if not expectedText:
        return 0.0
    if expectedText in candidateText:
        return 1.0
    return tokenOverlap(expectedText, candidateText)


def containsBlockedWord(candidateTitle: str, requestedTitle: str) -> bool:
    for blockedWord in blockedWords:
        pattern = r"\b" + re.escape(blockedWord) + r"\b"
        if re.search(pattern, candidateTitle) and not re.search(pattern, requestedTitle):
            return True
    return False


def scoreCandidate(track: TrackQuery, candidate: dict) -> float | None:
    """Returns a confidence from 0 to 1, or None if the candidate is rejected."""
    videoId = candidate.get("videoId")
    candidateTitle = normalizeText(candidate.get("title") or "")
    if not videoId or not candidateTitle:
        return None

    requestedTitle = normalizeText(track.title)
    requestedArtist = normalizeText(track.artist)

    if containsBlockedWord(candidateTitle, requestedTitle):
        return None

    titleScore = textScore(requestedTitle, candidateTitle)
    if titleScore < minTitleScore:
        return None

    # User uploads often put the artist in the title ("Artist - Song") or the
    # channel name, so check the artist against both.
    artistNames = " ".join(artist.get("name", "") for artist in candidate.get("artists") or [])
    artistHaystack = normalizeText(artistNames) + " " + candidateTitle
    artistScore = textScore(requestedArtist, artistHaystack)

    candidateDuration = candidate.get("duration_seconds")
    if track.durationSeconds and isinstance(candidateDuration, int):
        if abs(candidateDuration - track.durationSeconds) > durationToleranceSeconds:
            return None
        durationScore = 1.0
    else:
        durationScore = 0.5

    return round(0.5 * titleScore + 0.35 * artistScore + 0.15 * durationScore, 3)


def emptyResult(track: TrackQuery, error: str | None = None) -> dict:
    return {
        "artist": track.artist,
        "title": track.title,
        "videoId": None,
        "matchedTitle": None,
        "source": None,
        "confidence": 0.0,
        "error": error,
    }


def resolveTrack(track: TrackQuery) -> dict:
    query = f"{track.artist} {track.title}"
    bestResult = emptyResult(track)

    for filterName, sourceName in searchFilters:
        try:
            candidates = getClient().search(query, filter=filterName, limit=searchResultLimit)
        except Exception as error:  # ytmusicapi raises many types when YouTube blocks or changes
            bestResult["error"] = f"{sourceName} search failed: {type(error).__name__}: {error}"
            return bestResult

        for candidate in candidates[:searchResultLimit]:
            confidence = scoreCandidate(track, candidate)
            if confidence is not None and confidence > bestResult["confidence"]:
                bestResult = {
                    "artist": track.artist,
                    "title": track.title,
                    "videoId": candidate["videoId"],
                    "matchedTitle": candidate.get("title"),
                    "source": sourceName,
                    "confidence": confidence,
                    "error": None,
                }

        if bestResult["confidence"] >= minConfidence:
            return bestResult

    # Nothing passed the threshold, so report it as unresolved rather than guess.
    return emptyResult(track)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/youtube")
def youtubeHealth(xResolverSecret: str | None = Header(default=None, alias="x-resolver-secret")) -> dict:
    """Runs one real search. Use this after deploying to check whether YouTube blocks the server."""
    requireSecret(xResolverSecret)
    testTrack = TrackQuery(artist="Daft Punk", title="One More Time", durationSeconds=320)
    result = resolveTrack(testTrack)
    return {
        "status": "ok" if result["videoId"] else "failed",
        "result": result,
    }


@app.post("/resolve")
def resolve(
    body: ResolveRequest,
    xResolverSecret: str | None = Header(default=None, alias="x-resolver-secret"),
) -> dict:
    requireSecret(xResolverSecret)

    with ThreadPoolExecutor(max_workers=maxWorkers) as executor:
        results = list(executor.map(resolveTrack, body.tracks))

    resolvedCount = sum(1 for result in results if result["videoId"])
    return {
        "results": results,
        "resolvedCount": resolvedCount,
        "unresolvedCount": len(results) - resolvedCount,
    }
