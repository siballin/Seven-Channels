#!/usr/bin/env python3
"""Refresh source-labeled news and music-video links for the K-pop dashboard."""

from datetime import datetime, timezone
from calendar import monthrange
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from update_kpop_releases import fetch_page, fetch_terms


OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "kpop-sidebar.json"
NEWS_URL = "https://www.soompi.com/category/music/feed"
VIDEO_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCweOkPb1wVVH0Q0Tlj4a5Pw"
ATOM = "{http://www.w3.org/2005/Atom}"
YT = "{http://www.youtube.com/xml/schemas/2015}"


class ArticleImageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.image = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta" and values.get("property") == "og:image":
            url = values.get("content", "")
            parsed = urlparse(url)
            if parsed.scheme == "https" and (parsed.hostname or "").endswith(".soompi.io"):
                self.image = url


def article_image(url):
    request = Request(url, headers={"User-Agent": "SevenChannelsReleaseCalendar/1.0 (personal static calendar)"})
    with urlopen(request, timeout=20) as response:
        parser = ArticleImageParser()
        parser.feed(response.read().decode("utf-8"))
    return parser.image


def fetch_xml(url):
    request = Request(url, headers={"User-Agent": "SevenChannelsReleaseCalendar/1.0 (personal static calendar)"})
    with urlopen(request, timeout=30) as response:
        return ElementTree.fromstring(response.read())


def news_items(root):
    items = []
    for item in root.findall("./channel/item"):
        title, url = item.findtext("title", "").strip(), item.findtext("link", "").strip()
        parsed = urlparse(url)
        if not title or parsed.scheme != "https" or parsed.hostname not in ("soompi.com", "www.soompi.com"):
            continue
        published = parsedate_to_datetime(item.findtext("pubDate", "")).isoformat()
        items.append({"title": title, "url": url, "published": published})
    return items[:5]


def video_items(root):
    items = []
    for entry in root.findall(f"{ATOM}entry"):
        title = entry.findtext(f"{ATOM}title", "").strip()
        video_id = entry.findtext(f"{YT}videoId", "")
        published = entry.findtext(f"{ATOM}published", "")
        if not re.search(r"\[MV\]|\bM\/V\b|\bofficial music video\b", title, re.IGNORECASE):
            continue
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            continue
        datetime.fromisoformat(published.replace("Z", "+00:00"))
        items.append({"title": title, "url": f"https://www.youtube.com/watch?v={video_id}", "published": published})
    return items[:5]


def calendar_activity():
    now = datetime.now(timezone.utc)
    date_terms = fetch_terms("calendar-date")
    month_terms = fetch_terms("calendar-month")
    year_terms = fetch_terms("calendar-year")
    if {int(term["name"]) for term in date_terms} != set(range(1, 32)):
        raise ValueError("Calendar dates are incomplete.")
    dates = {term["id"]: int(term["name"]) for term in date_terms}
    months = {int(term["slug"][:2]): term["id"] for term in month_terms}
    years = {int(term["name"]): term["id"] for term in year_terms}
    if set(months) != set(range(1, 13)):
        raise ValueError("Calendar months are incomplete.")
    if now.year not in years:
        raise ValueError("Calendar data does not include the current year.")
    periods = []
    counts = {}
    for offset in range(3):
        year, month = divmod(now.year * 12 + now.month - 1 + offset, 12)
        month += 1
        if year not in years:
            break
        params = {
            "calendar-month": months[month],
            "calendar-year": years[year],
            "per_page": 100,
            "_fields": "id,title,link,calendar-date,calendar-month,calendar-year,group,artist_solo",
        }
        releases, pages, total = fetch_page("album", {**params, "page": 1})
        if (total and pages < 1) or (not total and pages > 1):
            raise ValueError("Calendar pagination is incomplete.")
        for page in range(2, pages + 1):
            batch, batch_pages, batch_total = fetch_page("album", {**params, "page": page})
            if batch_pages != pages or batch_total != total:
                raise ValueError("Calendar results changed while loading.")
            releases.extend(batch)
        if len(releases) != total:
            raise ValueError("Calendar results are incomplete.")
        periods.append({"year": year, "month": month, "releases": releases})
        if offset == 0:
            for release in releases:
                date_ids = release.get("calendar-date")
                day = dates.get(date_ids[0]) if isinstance(date_ids, list) and len(date_ids) == 1 else None
                title = release.get("title", {}).get("rendered")
                url = urlparse(release.get("link", ""))
                if (not day or day > monthrange(year, month)[1]
                    or release.get("calendar-month") != [months[month]]
                    or release.get("calendar-year") != [years[year]]
                    or not isinstance(release.get("id"), int) or isinstance(release["id"], bool) or release["id"] <= 0
                    or not isinstance(title, str) or not title.strip()
                    or url.scheme != "https" or url.hostname != "kpopofficial.com"):
                    continue
                for taxonomy in ("group", "artist_solo"):
                    for artist_id in dict.fromkeys(release.get(taxonomy, [])):
                        if isinstance(artist_id, int) and not isinstance(artist_id, bool) and artist_id > 0:
                            key = (taxonomy, artist_id)
                            counts[key] = counts.get(key, 0) + 1
    names = []
    for (taxonomy, artist_id), _ in sorted(counts.items(), key=lambda item: (-item[1], item[0][1]))[:5]:
        request = Request(f"https://kpopofficial.com/wp-json/wp/v2/{taxonomy}/{artist_id}?_fields=id,name",
                          headers={"User-Agent": "SevenChannelsReleaseCalendar/1.0 (personal static calendar)"})
        with urlopen(request, timeout=30) as response:
            term = json.load(response)
        if term.get("id") != artist_id or not isinstance(term.get("name"), str) or not term["name"].strip():
            raise ValueError("Calendar artist name is incomplete.")
        names.append({"taxonomy": taxonomy, "id": artist_id, "name": term["name"]})
    return {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dateTerms": date_terms, "monthTerms": month_terms, "yearTerms": year_terms,
        "periods": periods, "names": names,
    }


def main():
    previous = {}
    if OUTPUT_PATH.exists():
        try:
            previous = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            if not isinstance(previous, dict):
                raise ValueError("The previous sidebar data is not an object.")
        except (OSError, ValueError) as error:
            print(f"Could not reuse the previous sidebar data: {error}")
            previous = {}
    output = {}
    for key, url, parse in (("news", NEWS_URL, news_items), ("videos", VIDEO_URL, video_items)):
        try:
            items = parse(fetch_xml(url))
            if not items:
                raise ValueError(f"No {key} items found in the feed.")
            if key == "news":
                for item in items:
                    try:
                        image = article_image(item["url"])
                        if image:
                            item["image"] = image
                    except (OSError, UnicodeDecodeError) as error:
                        print(f"Could not load article image for {item['url']}: {error}")
            output[key] = {"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": items}
        except (OSError, ValueError, TypeError, ElementTree.ParseError) as error:
            print(f"Could not refresh K-pop {key}: {error}")
            output[key] = previous.get(key, {"fetchedAt": None, "items": []})
    try:
        output["calendar"] = calendar_activity()
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Could not refresh K-pop calendar activity: {error}")
        output["calendar"] = previous.get("calendar")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote K-pop sidebar data to {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
