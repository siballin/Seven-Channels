#!/usr/bin/env python3
"""Build the Music Lab credit snapshot (data/music-lab.json) for the people in music_lab_people.json.

Sources (all public, no keys):
- MusicBrainz web service (CC0 core data): artist records and their credit relationships. Writing credits
  (writer, lyricist, composer) live on works; production, arrangement, engineering and performance credits
  live on recordings. The two are kept apart, so a composer is never listed as a producer.
- Cover Art Archive (album artwork is linked by release-group ID in the page, not downloaded here).
- Wikidata, Wikimedia Commons and Wikipedia for a photo and biography when MusicBrainz links a Wikidata item.

MusicBrainz allows one request per second per client and answers 503 when it is busy, so every request is
spaced, retried with backoff, and the run stops at a request budget. Details fetched on earlier runs are reused
for REFRESH_DAYS, so each daily run only fetches new credits plus a slice of stale ones.
"""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "music-lab.json"
PEOPLE = Path(__file__).resolve().parent / "music_lab_people.json"
MB = "https://musicbrainz.org/ws/2"
USER_AGENT = "SevenChannelsMusicLab/1.0 ( https://github.com/siballin/Seven-Channels )"
SPACING = 1.1
REFRESH_DAYS = 30
REQUEST_BUDGET = int(os.environ.get("MUSIC_LAB_REQUEST_BUDGET", "900"))
TIME_BUDGET = int(os.environ.get("MUSIC_LAB_TIME_BUDGET", str(25 * 60)))
MAX_RECORDINGS_PER_WORK = 100

# Version markers that make a recording a poor choice to stand for a song.
VERSION_WORDS = re.compile(r"\b(remix|mix|instrumental|inst\.?|acapella|a cappella|live|edit|version|ver\.?|sped up|slowed|demo|karaoke|"
                           r"acoustic|remaster(?:ed)?|english|japanese|korean|chinese|tv size|off vocal|mr)\b", re.I)


class Budget(Exception):
    pass


class Client:
    def __init__(self, budget=REQUEST_BUDGET, seconds=TIME_BUDGET):
        self.budget = budget
        self.deadline = time.monotonic() + seconds
        self.last = 0.0
        self.used = 0

    def get(self, url, mb=True):
        if mb and (self.used >= self.budget or time.monotonic() > self.deadline):
            raise Budget()
        delay = 2.0
        for attempt in range(7):
            if mb:
                wait = self.last + SPACING - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                self.last = time.monotonic()
                self.used += 1
            try:
                with urlopen(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=40) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as error:
                if error.code == 404:
                    return None
                if error.code not in (429, 500, 502, 503, 504) or attempt == 6:
                    raise
            except (URLError, TimeoutError, ConnectionError, OSError):
                if attempt == 6:
                    raise
            time.sleep(delay)
            delay = min(delay * 1.8, 30)
        return None


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def is_fresh(stamp, now, days=REFRESH_DAYS):
    try:
        return now - datetime.fromisoformat(stamp.replace("Z", "+00:00")) < timedelta(days=days)
    except (AttributeError, ValueError):
        return False


def artist_credit(credits):
    return [{"id": item.get("artist", {}).get("id", ""), "name": item.get("name") or item.get("artist", {}).get("name", ""),
             "join": item.get("joinphrase", "")} for item in credits or []]


def person_ref(relation):
    artist = relation.get("artist") or {}
    return {"type": relation.get("type", ""), "attributes": sorted(relation.get("attributes") or []),
            "id": artist.get("id", ""), "name": relation.get("target-credit") or artist.get("name", "")}


def pick_canonical(recordings):
    """The earliest plain studio version of a song: no video, no version markers, no disambiguation."""
    def key(recording):
        title = recording.get("title", "")
        plain = not recording.get("video") and not recording.get("disambiguation") and not re.search(r"[(\[]", title) \
            and not VERSION_WORDS.search(title)
        date = recording.get("first-release-date") or "9999"
        return (0 if plain else 1, date, title)
    candidates = [recording for recording in recordings if recording.get("id")]
    return min(candidates, key=key) if candidates else None


def pick_release(releases):
    """The release a song is best known from: official albums, then EPs, then singles, earliest first; compilations last."""
    rank = {"Album": 0, "EP": 1, "Single": 2}
    def key(release):
        group = release.get("release-group") or {}
        secondary = group.get("secondary-types") or []
        return (
            0 if release.get("status") == "Official" else 1,
            1 if any(kind in secondary for kind in ("Compilation", "Live", "Remix", "DJ-mix", "Soundtrack")) else 0,
            rank.get(group.get("primary-type"), 3),
            release.get("date") or "9999",
        )
    if not releases:
        return None
    release = min(releases, key=key)
    group = release.get("release-group") or {}
    return {"id": release.get("id", ""), "title": release.get("title", ""), "date": release.get("date", ""),
            "group": {"id": group.get("id", ""), "title": group.get("title", ""), "type": group.get("primary-type") or "",
                      "secondary": group.get("secondary-types") or []}}


STREAMING_HOSTS = {"open.spotify.com": "spotify", "music.apple.com": "appleMusic", "itunes.apple.com": "appleMusic",
                   "www.youtube.com": "youtube", "youtube.com": "youtube", "music.youtube.com": "youtubeMusic", "youtu.be": "youtube"}


def streaming_links(relations):
    links = {}
    for relation in relations or []:
        resource = (relation.get("url") or {}).get("resource", "")
        match = re.match(r"https?://([^/]+)/", resource)
        kind = STREAMING_HOSTS.get(match.group(1)) if match else None
        if kind and kind not in links:
            links[kind] = resource
    return links


def parse_recording(data, fetched_at):
    relations = data.get("relations") or []
    credits = [person_ref(relation) for relation in relations if relation.get("target-type") == "artist"]
    writers, works = [], []
    for relation in relations:
        if relation.get("target-type") != "work":
            continue
        work = relation.get("work") or {}
        works.append(work.get("id", ""))
        for inner in work.get("relations") or []:
            if inner.get("target-type") == "artist":
                writers.append({**person_ref(inner), "work": work.get("id", "")})
    return {
        "id": data.get("id", ""),
        "title": data.get("title", ""),
        "length": data.get("length"),
        "date": data.get("first-release-date") or "",
        "artists": artist_credit(data.get("artist-credit")),
        "credits": credits,
        "writers": writers,
        "works": [work for work in works if work],
        "release": pick_release(data.get("releases")),
        "links": streaming_links(relations),
        "fetchedAt": fetched_at,
    }


URL_KINDS = {"official homepage": "homepage", "wikidata": "wikidata", "wikipedia": "wikipedia", "discogs": "discogs",
             "youtube": "youtube", "free streaming": None, "streaming": None, "social network": None}


def person_links(relations):
    links = {}
    for relation in relations or []:
        if relation.get("target-type") != "url":
            continue
        resource = (relation.get("url") or {}).get("resource", "")
        kind = relation.get("type")
        if kind in ("free streaming", "streaming", "social network", "youtube", "purchase for download"):
            host = re.sub(r"^https?://(www\.)?", "", resource).split("/")[0]
            kind = {"open.spotify.com": "spotify", "music.apple.com": "appleMusic", "itunes.apple.com": "appleMusic",
                    "instagram.com": "instagram", "twitter.com": "x", "x.com": "x", "youtube.com": "youtube",
                    "tiktok.com": "tiktok", "soundcloud.com": "soundcloud"}.get(host)
        else:
            kind = URL_KINDS.get(kind)
        if kind and kind not in links:
            links[kind] = resource
    return links


def person_credits(relations):
    credits = []
    for relation in relations or []:
        target = relation.get("target-type")
        if target not in ("recording", "work"):
            continue
        item = relation.get(target) or {}
        if not item.get("id"):
            continue
        credits.append({"kind": target, "type": relation.get("type", ""), "attributes": sorted(relation.get("attributes") or []),
                        "id": item["id"], "title": item.get("title", "")})
    return credits


def wiki_profile(client, wikidata_url, previous):
    """Photo (Wikimedia Commons) and summary (English Wikipedia) for a Wikidata item; keeps the last copy on failure."""
    match = re.search(r"(Q\d+)", wikidata_url or "")
    if not match:
        return {}
    qid = match.group(1)
    result = {"wikidata": qid}
    try:
        entity = client.get(f"https://www.wikidata.org/w/api.php?action=wbgetentities&ids={qid}&props=claims|sitelinks&format=json", mb=False)
        data = (entity or {}).get("entities", {}).get(qid, {})
        image = next((claim["mainsnak"]["datavalue"]["value"] for claim in data.get("claims", {}).get("P18", [])
                      if claim.get("mainsnak", {}).get("datavalue")), "")
        if image:
            info = client.get("https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=480"
                              f"&format=json&titles={quote('File:' + image)}", mb=False)
            page = next(iter(((info or {}).get("query", {}).get("pages") or {}).values()), {})
            details = (page.get("imageinfo") or [{}])[0]
            meta = details.get("extmetadata") or {}
            strip = lambda value: re.sub(r"<[^>]+>", "", (value or {}).get("value", "")).strip()
            result["photo"] = {"url": details.get("thumburl") or details.get("url", ""), "page": details.get("descriptionurl", ""),
                               "credit": strip(meta.get("Artist")), "license": strip(meta.get("LicenseShortName"))}
        title = data.get("sitelinks", {}).get("enwiki", {}).get("title")
        if title:
            summary = client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}", mb=False)
            if summary and summary.get("extract"):
                result["bio"] = {"text": summary["extract"], "url": summary.get("content_urls", {}).get("desktop", {}).get("page", ""),
                                 "source": "Wikipedia", "license": "CC BY-SA 4.0"}
    except Exception as error:  # Wikimedia is optional; keep what we had.
        print(f"Wikimedia lookup failed for {qid}: {error}", file=sys.stderr)
        return {**{key: previous.get(key) for key in ("photo", "bio") if previous.get(key)}, "wikidata": qid}
    for key in ("photo", "bio"):
        if key not in result and previous.get(key):
            result[key] = previous[key]
    return result


def load_previous():
    try:
        data = json.loads(OUTPUT.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def build(client, people_config, previous, now):
    stamp = now.isoformat(timespec="seconds")
    recordings = dict(previous.get("recordings") or {})
    works = dict(previous.get("works") or {})
    old_people = {person.get("key"): person for person in previous.get("people") or []}
    people, complete = [], True
    queue_recordings, queue_works = [], []

    for config in people_config:
        key = config.get("mbid") or re.sub(r"[^a-z0-9]+", "-", config["name"].lower()).strip("-")
        old = old_people.get(key, {})
        if not config.get("mbid"):
            people.append({"key": key, "mbid": None, "name": config["name"], "status": "missing", "note": config.get("note", ""), "credits": [], "releaseGroups": []})
            continue
        try:
            artist = client.get(f"{MB}/artist/{config['mbid']}?inc=aliases+url-rels+recording-rels+work-rels&fmt=json")
            groups = client.get(f"{MB}/release-group?artist={config['mbid']}&limit=100&fmt=json") or {}
        except Budget:
            complete = False
            people.append({**old, "status": "stale"} if old else {"key": key, "mbid": config["mbid"], "name": config["name"], "status": "stale", "credits": [], "releaseGroups": []})
            continue
        except Exception as error:
            print(f"MusicBrainz artist lookup failed for {config['name']}: {error}", file=sys.stderr)
            complete = False
            people.append({**old, "status": "stale"} if old else {"key": key, "mbid": config["mbid"], "name": config["name"], "status": "error", "credits": [], "releaseGroups": []})
            continue
        if not artist:
            people.append({"key": key, "mbid": config["mbid"], "name": config["name"], "status": "missing", "note": "MusicBrainz no longer has this artist ID.", "credits": [], "releaseGroups": []})
            continue
        relations = artist.get("relations") or []
        links = person_links(relations)
        person = {
            "key": key, "mbid": artist["id"], "name": artist.get("name", config["name"]), "sortName": artist.get("sort-name", ""),
            "type": artist.get("type") or "", "disambiguation": artist.get("disambiguation", ""), "country": artist.get("country") or "",
            "area": (artist.get("area") or {}).get("name", ""), "beginArea": (artist.get("begin-area") or {}).get("name", ""),
            "begin": (artist.get("life-span") or {}).get("begin") or "",
            "aliases": sorted({alias.get("name", "") for alias in artist.get("aliases") or [] if alias.get("name") and alias.get("name") != artist.get("name")}),
            "links": links, "credits": person_credits(relations), "status": "ok", "checkedAt": stamp,
            "releaseGroups": [{"id": group["id"], "title": group.get("title", ""), "type": group.get("primary-type") or "",
                               "secondary": group.get("secondary-types") or [], "date": group.get("first-release-date") or ""}
                              for group in groups.get("release-groups") or [] if group.get("id")],
        }
        if config["name"] != person["name"] and config["name"] not in person["aliases"]:
            person["aliases"].insert(0, config["name"])
        person.update(wiki_profile(client, links.get("wikidata"), old) if links.get("wikidata") else {})
        people.append(person)
        for credit in person["credits"]:
            (queue_recordings if credit["kind"] == "recording" else queue_works).append(credit["id"])

    # Writing credits: pick the recording that stands for each song.
    for work_id in dict.fromkeys(queue_works):
        if is_fresh((works.get(work_id) or {}).get("fetchedAt"), now):
            continue
        try:
            listing = client.get(f"{MB}/recording?work={work_id}&inc=artist-credits&limit={MAX_RECORDINGS_PER_WORK}&fmt=json") or {}
        except Budget:
            complete = False
            break
        except Exception as error:
            print(f"Work {work_id} failed: {error}", file=sys.stderr)
            complete = False
            continue
        canonical = pick_canonical(listing.get("recordings") or [])
        works[work_id] = {"id": work_id, "recording": canonical["id"] if canonical else None,
                          "versions": len(listing.get("recordings") or []), "fetchedAt": stamp}
    for work_id in dict.fromkeys(queue_works):
        if (works.get(work_id) or {}).get("recording"):
            queue_recordings.append(works[work_id]["recording"])

    # Full credits for every recording: the oldest-fetched stale ones first.
    pending = [rid for rid in dict.fromkeys(queue_recordings) if not is_fresh((recordings.get(rid) or {}).get("fetchedAt"), now)]
    pending.sort(key=lambda rid: (recordings.get(rid) or {}).get("fetchedAt", ""))
    for recording_id in pending:
        try:
            data = client.get(f"{MB}/recording/{recording_id}?inc=artist-credits+releases+release-groups+artist-rels+work-rels+work-level-rels+url-rels&fmt=json")
        except Budget:
            complete = False
            break
        except Exception as error:
            print(f"Recording {recording_id} failed: {error}", file=sys.stderr)
            complete = False
            continue
        if data:
            recordings[recording_id] = parse_recording(data, stamp)

    # Keep only what the current people still reference.
    wanted_works = {credit["id"] for person in people for credit in person.get("credits", []) if credit["kind"] == "work"}
    works = {key: value for key, value in works.items() if key in wanted_works}
    wanted = {credit["id"] for person in people for credit in person.get("credits", []) if credit["kind"] == "recording"}
    wanted |= {work["recording"] for work in works.values() if work.get("recording")}
    recordings = {key: value for key, value in recordings.items() if key in wanted}
    return people, recordings, works, complete


def main():
    now = datetime.now(timezone.utc)
    previous = load_previous()
    people_config = json.loads(PEOPLE.read_text(encoding="utf-8"))
    client = Client()
    people, recordings, works, complete = build(client, people_config, previous, now)
    output = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "complete": complete,
        "sources": [
            {"name": "MusicBrainz", "url": "https://musicbrainz.org/", "license": "CC0 (core data)"},
            {"name": "Cover Art Archive", "url": "https://coverartarchive.org/", "license": "Artwork © its owners"},
            {"name": "Wikidata / Wikimedia Commons / Wikipedia", "url": "https://www.wikidata.org/", "license": "CC0 / per-file / CC BY-SA 4.0"},
        ],
        "people": people,
        "works": works,
        "recordings": recordings,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    missing = sum(1 for person in people for credit in person.get("credits", [])
                  if credit["kind"] == "recording" and credit["id"] not in recordings)
    print(f"Music Lab: {len(people)} people, {len(recordings)} recordings, {len(works)} works; "
          f"{client.used} MusicBrainz requests; {'complete' if complete and not missing else f'{missing} recording credits still pending'}")


if __name__ == "__main__":
    main()
