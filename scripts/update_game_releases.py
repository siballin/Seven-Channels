#!/usr/bin/env python3
"""Refresh the static Game Informer release data used by the native calendar."""

from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


SITE_URL = "https://gameinformer.com/"
CURRENT_YEAR = datetime.now(timezone.utc).year
# Game Informer publishes one schedule page per year; the calendar covers last year, this year and next year.
YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]
SOURCE_URL = f"{SITE_URL}{CURRENT_YEAR}"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "game-releases.json"


class CoverParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cover = ""

    def handle_starttag(self, tag, attrs):
        if tag != "img" or self.cover:
            return
        attributes = dict(attrs)
        if "image-style-product-box-art" not in attributes.get("class", "").split():
            return
        candidate = urljoin(SOURCE_URL, attributes.get("src", ""))
        parsed = urlparse(candidate)
        if parsed.scheme == "https" and parsed.hostname == "static.gameinformer.com":
            self.cover = candidate


class ReleaseParser(HTMLParser):
    def __init__(self, year=CURRENT_YEAR):
        self.year = year
        super().__init__(convert_charrefs=True)
        self.entry = None
        self.releases = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if self.entry is None:
            if tag == "span" and "calendar_entry" in attributes.get("class", "").split():
                self.entry = {
                    "span_depth": 1,
                    "title_depth": 0,
                    "platform_depth": 0,
                    "title": [],
                    "platforms": [],
                    "url": "",
                    "date": "",
                }
            return

        if tag == "span":
            self.entry["span_depth"] += 1
        elif tag == "a":
            self.entry["title_depth"] += 1
            if not self.entry["url"]:
                self.entry["url"] = attributes.get("href", "")
        elif tag == "em":
            self.entry["platform_depth"] += 1
        elif tag == "time" and not self.entry["date"]:
            self.entry["date"] = attributes.get("datetime", "")[:10]

    def handle_endtag(self, tag):
        if self.entry is None:
            return
        if tag == "a" and self.entry["title_depth"]:
            self.entry["title_depth"] -= 1
        elif tag == "em" and self.entry["platform_depth"]:
            self.entry["platform_depth"] -= 1
        elif tag == "span":
            self.entry["span_depth"] -= 1
            if self.entry["span_depth"] == 0:
                self._finish_entry()

    def handle_data(self, data):
        if self.entry is None:
            return
        if self.entry["title_depth"]:
            self.entry["title"].append(data)
        if self.entry["platform_depth"]:
            self.entry["platforms"].append(data)

    def _finish_entry(self):
        entry = self.entry
        self.entry = None
        title = " ".join("".join(entry["title"]).split())
        platforms = " ".join("".join(entry["platforms"]).split())
        if not title or not entry["url"] or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["date"]):
            return
        if not entry["date"].startswith(f"{self.year}-"):
            return
        url = urljoin(SOURCE_URL, entry["url"])
        if urlparse(url).hostname != "gameinformer.com":
            return
        self.releases.append({
            "date": entry["date"],
            "title": title,
            "platforms": [platform.strip() for platform in platforms.split(",") if platform.strip()],
            "url": url,
        })


def fetch_year(year):
    request = Request(
        f"{SITE_URL}{year}",
        headers={"User-Agent": "SevenChannelsReleaseCalendar/1.0 (personal static calendar)"},
    )
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"Game Informer returned HTTP {response.status}.")
        html = response.read().decode("utf-8")
    parser = ReleaseParser(year)
    parser.feed(html)
    return parser.releases


def fetch_releases():
    previous_data, previous_releases = {}, {}
    if OUTPUT_PATH.exists():
        try:
            previous_data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            previous_releases = {
                release["url"]: release
                for release in previous_data.get("releases", [])
                if release.get("url")
            }
        except (OSError, json.JSONDecodeError) as error:
            print(f"Could not reuse cached game data: {error}")

    found, sources = [], []
    for year in YEARS:
        try:
            year_releases = fetch_year(year)
            if len(year_releases) < 20:
                raise RuntimeError(f"parsed only {len(year_releases)} release entries")
            found += year_releases
            sources.append({"year": year, "url": f"{SITE_URL}{year}", "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        except (OSError, UnicodeDecodeError, RuntimeError) as error:
            if year == CURRENT_YEAR:
                raise RuntimeError(f"Expected a populated {year} schedule: {error}") from error
            # Another year's page may not exist yet or may fail; keep that year's last saved entries.
            kept = [release for release in previous_releases.values() if release.get("date", "").startswith(f"{year}-")]
            found += [{key: value for key, value in release.items() if key != "cover"} for release in kept]
            old = next((source for source in previous_data.get("sources", []) if source.get("year") == year), None)
            if old:
                sources.append(old)
            print(f"Could not refresh the {year} schedule ({error}); kept {len(kept)} saved entries.")
    unique = {
        (release["date"], release["title"], tuple(release["platforms"]), release["url"]): release
        for release in found
    }
    releases = sorted(unique.values(), key=lambda item: (item["date"], item["title"].casefold()))

    missing_covers = {}
    for release in releases:
        old_release = previous_releases.get(release["url"], {})
        old_cover = old_release.get("cover", "")
        if isinstance(old_cover, str) and old_cover.startswith("https://static.gameinformer.com/"):
            release["cover"] = old_cover
        else:
            missing_covers[release["url"]] = release

    unavailable_covers = 0
    covers = {}
    for index, (url, release) in enumerate(missing_covers.items(), start=1):
        request = Request(
            url,
            headers={"User-Agent": "SevenChannelsReleaseCalendar/1.0 (personal static calendar)"},
        )
        try:
            with urlopen(request, timeout=20) as response:
                if response.status != 200:
                    raise RuntimeError(f"Game Informer returned HTTP {response.status}.")
                cover_parser = CoverParser()
                cover_parser.feed(response.read().decode("utf-8"))
            if cover_parser.cover:
                covers[url] = cover_parser.cover
            else:
                unavailable_covers += 1
        except (OSError, UnicodeDecodeError, RuntimeError) as error:
            unavailable_covers += 1
            print(f"Could not load cover for {release['title']}: {error}")
        if index < len(missing_covers):
            time.sleep(0.25)

    for release in releases:
        if release["url"] in covers:
            release["cover"] = covers[release["url"]]

    cover_count = sum(bool(release.get("cover")) for release in releases)
    print(f"Found covers for {cover_count} of {len(releases)} release entries.")
    if unavailable_covers:
        print(f"{unavailable_covers} covers were unavailable and will remain blank.")
    return {
        "source": "Game Informer",
        "sourceUrl": SOURCE_URL,
        "sources": sorted(sources, key=lambda source: source["year"]),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "releases": releases,
    }


def main():
    data = fetch_releases()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['releases'])} release entries to {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
