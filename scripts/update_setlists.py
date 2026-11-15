#!/usr/bin/env python3
"""Build data/setlists.json from the setlist.fm API for the artists in live_events_artists.json.

setlist.fm's API (https://api.setlist.fm/docs/1.0/) needs an API key sent in the x-api-key header and doesn't allow
browser requests, so setlists are fetched here, in GitHub Actions, with the SETLISTFM_API_KEY secret. Its use is free
for non-commercial projects; the page credits setlist.fm and links each setlist back to its setlist.fm page.
Artists are identified by MusicBrainz ID, which setlist.fm uses too, so similarly named artists aren't mixed up.
Without a key, the last saved setlists are kept.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "setlists.json"
CONFIG = Path(__file__).resolve().parent / "live_events_artists.json"
API = "https://api.setlist.fm/rest/1.0"
USER_AGENT = "SevenChannelsLiveEvents/1.0 (+https://siballin.github.io/Seven-Channels/)"
PER_ARTIST = 20
SPACING = 0.6


def setlist_date(value):
    """setlist.fm writes dates as dd-MM-yyyy."""
    try:
        return datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return ""


def parse_setlist(item):
    venue = item.get("venue") or {}
    city = venue.get("city") or {}
    sets = []
    for entry in (item.get("sets") or {}).get("set") or []:
        songs = [song.get("name", "").strip() for song in entry.get("song") or [] if song.get("name", "").strip()]
        if songs:
            sets.append({"encore": int(entry.get("encore") or 0), "songs": songs})
    return {
        "id": item.get("id", ""),
        "date": setlist_date(item.get("eventDate")),
        "venue": {"name": venue.get("name", ""), "city": city.get("name", ""), "country": (city.get("country") or {}).get("name", "")},
        "tour": (item.get("tour") or {}).get("name", ""),
        "url": item.get("url", ""),
        "sets": sets,
    }


def fetch(url, key, attempts=4):
    delay = 2.0
    for attempt in range(attempts):
        try:
            request = Request(url, headers={"x-api-key": key, "Accept": "application/json", "User-Agent": USER_AGENT})
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            if error.code == 404:
                return None
            if error.code not in (429, 500, 502, 503) or attempt == attempts - 1:
                raise
        except (URLError, TimeoutError, OSError):
            if attempt == attempts - 1:
                raise
        time.sleep(delay)
        delay *= 2
    return None


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def build(config, previous, key, fetcher=fetch):
    old = {artist.get("mbid"): artist for artist in previous.get("artists") or []}
    artists, failures = [], 0
    for entry in config.get("artists") or []:
        mbid, name = entry.get("mbid", ""), entry.get("name", "")
        if not mbid:
            continue
        try:
            data = fetcher(f"{API}/artist/{mbid}/setlists?p=1", key)
            time.sleep(SPACING if fetcher is fetch else 0)
            setlists = [parse_setlist(item) for item in (data or {}).get("setlist") or []]
            setlists = [setlist for setlist in setlists if setlist["date"]][:PER_ARTIST]
            artists.append({"mbid": mbid, "name": name or ((data or {}).get("setlist") or [{}])[0].get("artist", {}).get("name", ""), "setlists": setlists, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        except Exception as error:
            failures += 1
            print(f"setlist.fm failed for {name or mbid}: {error}", file=sys.stderr)
            if mbid in old:
                artists.append(old[mbid])
    return artists, failures


def main():
    config = load_json(CONFIG, {"artists": []})
    previous = load_json(OUTPUT, {})
    key = os.environ.get("SETLISTFM_API_KEY", "").strip()
    configured = bool(config.get("artists"))
    if not key:
        artists, status = previous.get("artists") or [], "no-key"
    elif not configured:
        artists, status = [], "no-artists"
    else:
        artists, failures = build(config, previous, key)
        status = "ok" if not failures else "partial"
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds") if key else previous.get("generatedAt", ""),
        "status": status,
        "configured": configured,
        "source": {"name": "setlist.fm", "url": "https://www.setlist.fm/"},
        "artists": artists,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Setlists: {status}; {len(artists)} artists, {sum(len(artist['setlists']) for artist in artists)} setlists")


if __name__ == "__main__":
    main()
