#!/usr/bin/env python3
"""Add releases for K-pop-adjacent artists that KPOP OFFICIAL doesn't cover (data/kpop-extra.json).

Artists are listed by MusicBrainz ID in kpop_extra_artists.json. Release dates come from MusicBrainz release
groups (first release date), which include announced releases once someone has entered them. Only exact
YYYY-MM-DD dates are kept, so nothing lands on a guessed day. On failure the previous file is kept.
"""

from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path(__file__).resolve().parent / "kpop_extra_artists.json"
OUTPUT = ROOT / "data" / "kpop-extra.json"
MB = "https://musicbrainz.org/ws/2"
USER_AGENT = "SevenChannelsKpopCalendar/1.0 ( https://github.com/siballin/Seven-Channels )"
MBID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
KEEP_DAYS = 730


def fetch(url):
    for attempt in range(5):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=30) as response:
                return json.load(response)
        except Exception as error:  # MusicBrainz answers 503 when busy
            if attempt == 4:
                raise
            print(f"Retrying MusicBrainz ({error})", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def releases_for(artist, data, today):
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    out = []
    for group in data.get("release-groups") or []:
        day = group.get("first-release-date") or ""
        if not group.get("id") or not DATE.match(day) or day < cutoff:
            continue
        kind = " · ".join([group.get("primary-type") or "Release", *(group.get("secondary-types") or [])])
        out.append({"id": group["id"], "title": group.get("title", "").strip() or "Untitled", "type": kind, "date": day,
                    "artist": artist["name"], "mbid": artist["mbid"]})
    return out


def build(config, previous, fetcher=fetch, today=None):
    today = today or date.today()
    old = {item.get("mbid"): item for item in previous.get("artists") or []}
    artists, releases, failed = [], [], 0
    for entry in config.get("artists") or []:
        mbid, name = entry.get("mbid", ""), entry.get("name", "").strip()
        if not MBID.match(mbid) or not name:
            continue
        artist = {"name": name, "mbid": mbid, "note": entry.get("note", "")}
        try:
            data = fetcher(f"{MB}/release-group?artist={mbid}&limit=100&fmt=json")
            time.sleep(1.1 if fetcher is fetch else 0)
            found = releases_for(artist, data or {}, today)
            artists.append({**artist, "status": "ok"})
        except Exception as error:
            print(f"MusicBrainz failed for {name}: {error}", file=sys.stderr)
            failed += 1
            found = [item for item in previous.get("releases") or [] if item.get("mbid") == mbid]
            artists.append({**artist, "status": "stale" if mbid in old else "error"})
        releases.extend(found)
    releases.sort(key=lambda item: (item["date"], item["artist"], item["title"]))
    status = "ok" if not failed else "partial" if failed < len(artists) else "error"
    return {"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": status, "artists": artists, "releases": releases}


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    snapshot = build(config, previous)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"K-pop extras: {snapshot['status']}; {len(snapshot['artists'])} artists, {len(snapshot['releases'])} releases")


if __name__ == "__main__":
    main()
