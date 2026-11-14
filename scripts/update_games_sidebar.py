#!/usr/bin/env python3
"""Refresh the Video Games sidebar: gaming news, recent trailers and Epic's free games.

Sources (no API keys needed):
- News: IGN, GameSpot and Polygon RSS/Atom feeds.
- Trailers: YouTube channel feeds for PlayStation, Xbox, Nintendo of America, IGN and GameSpot.
- Free games: the Epic Games Store's free-games promotion feed.

Each section refreshes independently; a section that fails keeps its last saved items and timestamp.
"""

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import html
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "games-sidebar.json"
USER_AGENT = "SevenChannelsGames/1.0 (+https://siballin.github.io/Seven-Channels/)"
ATOM = "{http://www.w3.org/2005/Atom}"
YT = "{http://www.youtube.com/xml/schemas/2015}"
MEDIA = "{http://search.yahoo.com/mrss/}"
NEWS_FEEDS = [
    ("IGN", "https://feeds.ign.com/ign/games-all", ("ign.com", "www.ign.com")),
    ("GameSpot", "https://www.gamespot.com/feeds/game-news/", ("www.gamespot.com", "gamespot.com")),
    ("Polygon", "https://www.polygon.com/rss/index.xml", ("www.polygon.com", "polygon.com")),
]
TRAILER_CHANNELS = [
    ("PlayStation", "UC-2Y8dQb0S6DtpxNgAKoJKA"),
    ("Xbox", "UCjBp_7RuDBUYbd1LegWEJ8g"),
    ("Nintendo of America", "UCGIY_O-8vW4rfX98KlMkvRg"),
    ("IGN", "UCKy1dAqELo0zrOtPkf0eTMw"),
    ("GameSpot", "UCbu2SsF-Or3Rsn3NxqODImw"),
]
EPIC_URL = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
TRAILER_WORDS = re.compile(r"\b(trailer|reveal|teaser|gameplay|launch|announce(?:ment)?)\b", re.I)


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=30) as response:
        return response.read()


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def iso_date(value):
    value = (value or "").strip()
    if not value:
        return ""
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def feed_items(xml, source, hosts):
    """Articles from an RSS 2.0 or Atom feed, keeping only https links on the publisher's own site."""
    root = ElementTree.fromstring(xml)
    items = []
    entries = root.findall("./channel/item") or root.findall(f"{ATOM}entry")
    for entry in entries:
        if entry.tag == "item":
            title, url, published = entry.findtext("title", ""), entry.findtext("link", ""), entry.findtext("pubDate", "")
            image = ""
            for node in (entry.find(f"{MEDIA}content"), entry.find(f"{MEDIA}thumbnail"), entry.find("enclosure")):
                if node is not None and node.get("url", "").startswith("https://"):
                    image = node.get("url")
                    break
        else:
            title = entry.findtext(f"{ATOM}title", "")
            link = next((node.get("href") for node in entry.findall(f"{ATOM}link") if node.get("rel", "alternate") == "alternate"), "")
            url, published, image = link or "", entry.findtext(f"{ATOM}published", "") or entry.findtext(f"{ATOM}updated", ""), ""
        title, url = clean(title), (url or "").strip()
        parsed = urlparse(url)
        if not title or parsed.scheme != "https" or parsed.hostname not in hosts:
            continue
        items.append({"title": title[:200], "url": url, "source": source, "published": iso_date(published),
                      **({"image": image} if image else {})})
    return items


def trailer_items(xml, channel):
    root = ElementTree.fromstring(xml)
    items = []
    for entry in root.findall(f"{ATOM}entry"):
        title = clean(entry.findtext(f"{ATOM}title", ""))
        video_id = entry.findtext(f"{YT}videoId", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id or "") or not TRAILER_WORDS.search(title):
            continue
        items.append({"title": title[:200], "url": f"https://www.youtube.com/watch?v={video_id}", "videoId": video_id,
                      "channel": channel, "published": iso_date(entry.findtext(f"{ATOM}published", ""))})
    return items


def epic_free_games(data, now):
    """Games that are free to keep now or soon, from Epic's promotion feed."""
    games = []
    for element in data["data"]["Catalog"]["searchStore"]["elements"]:
        promotions = element.get("promotions") or {}
        for state, groups in (("now", promotions.get("promotionalOffers")), ("upcoming", promotions.get("upcomingPromotionalOffers"))):
            for group in groups or []:
                for offer in group.get("promotionalOffers") or []:
                    if (offer.get("discountSetting") or {}).get("discountPercentage") != 0:
                        continue  # a sale, not free
                    start, end = iso_date(offer.get("startDate")), iso_date(offer.get("endDate"))
                    if not end or end < now:
                        continue
                    slug = next((m.get("pageSlug") for m in ((element.get("catalogNs") or {}).get("mappings") or []) if m.get("pageSlug")), "") \
                        or (element.get("productSlug") or "").split("/")[0]
                    image = next((i.get("url") for kind in ("OfferImageWide", "Thumbnail", "OfferImageTall")
                                  for i in element.get("keyImages") or [] if i.get("type") == kind and str(i.get("url", "")).startswith("https://")), "")
                    games.append({"title": clean(element.get("title", ""))[:120], "state": state, "start": start, "end": end,
                                  "url": f"https://store.epicgames.com/en-US/p/{quote(slug)}" if slug else "https://store.epicgames.com/en-US/free-games",
                                  **({"image": image} if image else {})})
    return sorted(games, key=lambda game: (game["state"] != "now", game["start"]))


def load_previous():
    try:
        data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    previous = load_previous()
    output = {}

    def section(name, build):
        try:
            items, failures = build()
            if not items:
                raise ValueError("no items")
            output[name] = {"fetchedAt": now, "items": items, **({"unavailable": failures} if failures else {})}
            print(f"{name}: {len(items)} items" + (f" ({', '.join(failures)} unavailable)" if failures else ""))
        except Exception as error:
            print(f"{name}: refresh failed, keeping previous data: {error}", file=sys.stderr)
            if name in previous:
                output[name] = previous[name]

    def news():
        items, failures = [], []
        for source, url, hosts in NEWS_FEEDS:
            try:
                items += feed_items(fetch(url), source, hosts)[:8]
            except Exception as error:
                failures.append(source)
                print(f"News feed {source} failed: {error}", file=sys.stderr)
        return sorted(items, key=lambda item: item["published"], reverse=True)[:15], failures

    def trailers():
        items, failures = [], []
        for channel, channel_id in TRAILER_CHANNELS:
            try:
                items += trailer_items(fetch(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"), channel)[:4]
            except Exception as error:
                failures.append(channel)
                print(f"Trailer feed {channel} failed: {error}", file=sys.stderr)
        return sorted(items, key=lambda item: item["published"], reverse=True)[:12], failures

    def free_games():
        return epic_free_games(json.loads(fetch(EPIC_URL)), now), []

    section("news", news)
    section("trailers", trailers)
    section("freeGames", free_games)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
