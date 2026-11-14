"""Discogs and Genius credits for the Music Lab snapshot.

Discogs (official API; DISCOGS_TOKEN optional, raises the limit from 25 to 60 requests a minute):
- Releases are found through the Discogs links MusicBrainz stores on releases, release groups and artists,
  so no matching by name is needed to find them. Tracks within a release are matched by title.
- Credits are taken from each track and from release-level credits that name the track (or the whole release).
  Non-musical roles (A&R, management, design, legal…) are dropped.

Genius (official API; needs GENIUS_ACCESS_TOKEN, skipped without it):
- Songs are found by searching "artist title" and accepted only when the title and a performing artist match.
- Writers, producers and the "custom performances" roles (vocal producer, mixing engineer…) are kept.
  Genius credits are community-edited and are labeled that way in the page.
"""

import json
import os
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

USER_AGENT = "SevenChannelsMusicLab/1.0 +https://github.com/siballin/Seven-Channels"

NON_MUSICAL = re.compile(r"^(a&r|art direction|artwork|booking|coordinator|creative director|design|graphics|layout|legal|liner notes|"
                         r"management|manager|marketing|photography|photography by|product manager|promotion|publicity|stylist|"
                         r"copyright|phonographic copyright|published by|licensed|distributed|manufactured|marketed|lacquer cut|"
                         r"pressed by|printed by|translated by|other|technician|video|director|executive \(music\)|cover)", re.I)


def normalize(text):
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"[\(\[](feat|ft|with|prod)[^)\]]*[\)\]]", " ", text)
    text = re.sub(r"\b(feat|ft)\.?\s.*$", " ", text)
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).strip()


def clean_discogs_name(name):
    return re.sub(r"\s*\(\d+\)$", "", str(name or "").rstrip("*")).strip()


def split_roles(role):
    """'Producer, Programmed By' -> ['Producer', 'Programmed By']; commas inside [] stay together."""
    parts, depth, current = [], 0, ""
    for ch in role or "":
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current.strip())
    return parts


def discogs_category(part):
    base = re.sub(r"\s*\[.*?\]\s*", " ", part).strip().lower()
    qualifier = " ".join(re.findall(r"\[(.*?)\]", part)).lower()
    if NON_MUSICAL.search(base):
        return None
    if ("produc" in base and "vocal" in qualifier) or re.search(r"vocal produc", base):
        return "vocalProduction"
    if re.search(r"(^|-)produc|co-produc|producer", base) and "coordinator" not in base:
        return "production"
    if re.search(r"written-by|lyrics by|words by|songwriter|written by", base):
        return "songwriting"
    if re.search(r"music by|composed by|composer", base):
        return "composition"
    if re.search(r"arranged|arranger|orchestrat", base):
        return "arrangement"
    if re.search(r"mixed|mastered|recorded|engineer|edited|remastered|mastering|mixing|recording", base):
        return "engineering"
    if re.search(r"programm", base):
        return "programming"
    if re.search(r"remix", base):
        return "remix"
    if re.search(r"vocal|featuring|guitar|bass|drum|keyboard|piano|synth|horn|sax|trumpet|strings|violin|cello|percussion|instrument|choir|rap|beatbox|turntable", base):
        return "performance"
    return "other"


def discogs_credit_entries(extraartist):
    """One entry per musical role in a Discogs credit line."""
    name = clean_discogs_name(extraartist.get("name"))
    credited = clean_discogs_name(extraartist.get("anv"))
    entries = []
    for part in split_roles(extraartist.get("role", "")):
        category = discogs_category(part)
        if category and name:
            entry = {"category": category, "label": part, "name": name, "id": extraartist.get("id") or 0}
            if credited and credited != name:
                entry["as"] = credited
            entries.append(entry)
    return entries


def track_index(tracklist):
    return [track.get("position", "") for track in tracklist if track.get("type_", "track") == "track"]


def tracks_covered(spec, positions):
    """Release-level 'tracks' spec ('1 to 3, 5', 'A1 to B2') -> set of positions. Empty spec covers the whole release."""
    if not spec or not spec.strip():
        return set(positions)
    covered = set()
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if " to " in chunk:
            start, end = [value.strip() for value in chunk.split(" to ", 1)]
            if start in positions and end in positions:
                a, b = positions.index(start), positions.index(end)
                covered.update(positions[min(a, b):max(a, b) + 1])
        elif chunk in positions:
            covered.add(chunk)
    return covered


def discogs_tracks(release):
    """Every track of a Discogs release with its musical credits, including release-level credits that apply to it."""
    tracklist = [track for track in release.get("tracklist") or [] if track.get("type_", "track") == "track"]
    positions = track_index(tracklist)
    release_artists = [clean_discogs_name(artist.get("anv") or artist.get("name")) for artist in release.get("artists") or []]
    tracks = []
    for track in tracklist:
        credits = []
        for extra in track.get("extraartists") or []:
            credits.extend(discogs_credit_entries(extra))
        for extra in release.get("extraartists") or []:
            if track.get("position") in tracks_covered(extra.get("tracks", ""), positions):
                for entry in discogs_credit_entries(extra):
                    credits.append({**entry, "scope": "release" if not (extra.get("tracks") or "").strip() else "tracks"})
        seen, unique = set(), []
        for credit in credits:
            key = (credit["category"], credit["label"], credit["name"])
            if key not in seen:
                seen.add(key)
                unique.append(credit)
        artists = [clean_discogs_name(artist.get("anv") or artist.get("name")) for artist in track.get("artists") or []] or release_artists
        tracks.append({"position": track.get("position", ""), "title": track.get("title", ""), "duration": track.get("duration", ""),
                       "artists": artists, "credits": unique})
    return tracks


def match_track(tracks, title, artists=None):
    wanted = normalize(title)
    candidates = [track for track in tracks if normalize(track["title"]) == wanted]
    if len(candidates) > 1 and artists:
        names = {normalize(name) for name in artists}
        narrowed = [track for track in candidates if names & {normalize(name) for name in track["artists"]}]
        candidates = narrowed or candidates
    return candidates[0] if candidates else None


DISCOGS_LINK = re.compile(r"discogs\.com/(?:[a-z]{2}/)?(release|master|artist)/(\d+)")


def discogs_link(url):
    match = DISCOGS_LINK.search(url or "")
    return (match.group(1), int(match.group(2))) if match else (None, None)


GENIUS_CATEGORIES = [
    (re.compile(r"vocal produc", re.I), "vocalProduction"),
    (re.compile(r"co-produc|produc", re.I), "production"),
    (re.compile(r"lyric|writ|songwrit", re.I), "songwriting"),
    (re.compile(r"compos", re.I), "composition"),
    (re.compile(r"arrang|orchestrat", re.I), "arrangement"),
    (re.compile(r"mix|master|engineer|record", re.I), "engineering"),
    (re.compile(r"program", re.I), "programming"),
    (re.compile(r"remix", re.I), "remix"),
    (re.compile(r"vocal|guitar|bass|drum|keyboard|piano|synth|horn|sax|string|percussion|choir|instrument|featur", re.I), "performance"),
    (re.compile(r"label|publish|copyright|phonographic|distribut|a&r|manag|video|photo|art|design|market|licens|release date|recorded at|mixed at|mastered at|studio", re.I), None),
]


def genius_category(label):
    for pattern, category in GENIUS_CATEGORIES:
        if pattern.search(label or ""):
            return category
    return "other"


def genius_song_credits(song):
    credits = []
    for artist in song.get("writer_artists") or []:
        credits.append({"category": "songwriting", "label": "Writer", "name": artist.get("name", ""), "id": artist.get("id") or 0})
    for artist in song.get("producer_artists") or []:
        credits.append({"category": "production", "label": "Producer", "name": artist.get("name", ""), "id": artist.get("id") or 0})
    for performance in song.get("custom_performances") or []:
        label = performance.get("label", "")
        category = genius_category(label)
        if not category:
            continue
        for artist in performance.get("artists") or []:
            credits.append({"category": category, "label": label, "name": artist.get("name", ""), "id": artist.get("id") or 0})
    return [credit for credit in credits if credit["name"]]


def genius_pick(hits, title, artists):
    wanted = normalize(title)
    names = {normalize(name) for name in artists if name}
    for hit in hits:
        result = hit.get("result") or {}
        if hit.get("type") != "song" or normalize(result.get("title")) != wanted:
            continue
        primary = normalize((result.get("primary_artist") or {}).get("name"))
        if primary in names or any(name and (name in primary or primary in name) for name in names):
            return result
    return None


class Api:
    """A small rate-limited JSON client with retries, shared by the Discogs and Genius phases."""

    def __init__(self, spacing, budget, deadline, headers=None):
        self.spacing = spacing
        self.budget = budget
        self.deadline = deadline
        self.headers = headers or {}
        self.last = 0.0
        self.used = 0

    def get(self, url):
        if self.used >= self.budget or time.monotonic() > self.deadline:
            raise TimeoutError("budget")
        delay = 3.0
        for attempt in range(5):
            wait = self.last + self.spacing - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            self.used += 1
            try:
                with urlopen(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **self.headers}), timeout=40) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as error:
                if error.code == 404:
                    return None
                if error.code in (401, 403):
                    raise
                if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise
            except (URLError, TimeoutError, ConnectionError, OSError):
                if attempt == 4:
                    raise
            time.sleep(delay)
            delay = min(delay * 2, 60)
        return None


def discogs_client(deadline, budget=600):
    token = os.environ.get("DISCOGS_TOKEN", "").strip()
    headers = {"Authorization": f"Discogs token={token}"} if token else {}
    return Api(1.1 if token else 2.5, budget, deadline, headers), bool(token)


def genius_client(deadline, budget=700):
    token = os.environ.get("GENIUS_ACCESS_TOKEN", "").strip()
    if not token:
        return None
    return Api(0.4, budget, deadline, {"Authorization": f"Bearer {token}"})


def genius_search_url(artist, title):
    return f"https://api.genius.com/search?q={quote(f'{artist} {title}'.strip())}&per_page=10"
