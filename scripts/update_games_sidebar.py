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
    ("Kotaku", "https://kotaku.com/rss", ("kotaku.com", "www.kotaku.com")),
    ("VGC", "https://www.videogameschronicle.com/feed/", ("www.videogameschronicle.com", "videogameschronicle.com")),
    ("PC Gamer", "https://www.pcgamer.com/rss/", ("www.pcgamer.com", "pcgamer.com")),
    ("Eurogamer", "https://www.eurogamer.net/feed", ("www.eurogamer.net", "eurogamer.net")),
]
TRAILER_CHANNELS = [
    ("PlayStation", "UC-2Y8dQb0S6DtpxNgAKoJKA"),
    ("Xbox", "UCjBp_7RuDBUYbd1LegWEJ8g"),
    ("Nintendo of America", "UCGIY_O-8vW4rfX98KlMkvRg"),
    ("IGN", "UCKy1dAqELo0zrOtPkf0eTMw"),
    ("GameSpot", "UCbu2SsF-Or3Rsn3NxqODImw"),
]
EPIC_URL = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
GAMERPOWER_URL = "https://www.gamerpower.com/api/giveaways?type=game"
GAME_PASS_LISTS = [  # Xbox's public Game Pass catalog lists (sigls)
    ("recent", "f13cf6b4-57e6-4459-89df-6aec18cf0538"),
    ("coming", "095bda36-f5cd-43f2-9ee1-0a72f371fb96"),
    ("leaving", "393f05bf-e596-4ef6-9487-6d4fa0eab987"),
]
GAME_PASS_CONSOLE = "f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e"
GAME_PASS_PC = "fdd9e2a7-0fee-49f6-ad69-4354098401ff"
SHOWCASE_WORDS = re.compile(r"\b(showcase|direct|state of play|game awards|summer game fest|gamescom|tokyo game show|pax|evo|blizzcon|quakecon|"
                            r"opening night live|d\.i\.c\.e|game developers conference|gdc|expo|convention|festival|bitsummit|wholesome direct|"
                            r"golden joystick|bafta games|future games show|day of the devs|devolver|ubisoft forward|games done quick)\b", re.I)
MONTHS = {name: index for index, name in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                                    "october", "november", "december"], 1)}
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


def store_of(platforms):
    """GamerPower's platform list ("PC, Steam") → the store to show."""
    text = platforms or ""
    for name, label in (("Steam", "Steam"), ("Epic Games Store", "Epic"), ("GOG", "GOG"), ("Itch.io", "itch.io"), ("Ubisoft", "Ubisoft"),
                        ("EA Origin", "EA"), ("Battle.net", "Battle.net"), ("Xbox", "Xbox"), ("PlayStation", "PlayStation"),
                        ("Nintendo Switch", "Switch"), ("Android", "Mobile"), ("iOS", "Mobile"), ("VR", "VR"), ("DRM-Free", "DRM-free")):
        if name in text:
            return label
    return "PC" if "PC" in text else "Other"


def gamerpower_free_games(data, now):
    """Free-to-keep games on every store (Steam, Epic, GOG, itch.io, mobile…) from GamerPower."""
    games = []
    for item in data if isinstance(data, list) else []:
        if (item.get("type") or "").lower() != "game" or (item.get("status") or "").lower() != "active":
            continue
        title = re.sub(r"\s*\((?:[^()]*)\)\s*Giveaway$|\s*Giveaway$", "", clean(item.get("title", ""))).strip()
        url = item.get("open_giveaway_url") or item.get("gamerpower_url") or ""
        if not title or not url.startswith("https://"):
            continue
        end = item.get("end_date") or ""
        end_iso = f"{end[:10]}T{end[11:19]}+00:00" if re.match(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", end) else ""
        if end_iso and end_iso < now:
            continue
        image = item.get("thumbnail") or ""
        games.append({"title": title[:120], "store": store_of(item.get("platforms")), "platforms": clean(item.get("platforms", ""))[:80],
                      "worth": item.get("worth") if re.fullmatch(r"\$\d+(?:\.\d\d)?", item.get("worth") or "") else "",
                      "end": end_iso, "url": url, **({"image": image} if image.startswith("https://") else {})})
    return games


def game_pass_ids(sigl_id):
    data = json.loads(fetch(f"https://catalog.gamepass.com/sigls/v2?id={sigl_id}&language=en-us&market=US"))
    return [row["id"] for row in data if isinstance(row, dict) and re.fullmatch(r"[0-9A-Z]{12}", row.get("id", ""))]


def game_pass_products(ids):
    """Names and box art for Microsoft Store product ids, 20 at a time."""
    products = {}
    for start in range(0, len(ids), 20):
        chunk = ",".join(ids[start:start + 20])
        data = json.loads(fetch(f"https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={chunk}&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMMp+F.1"))
        for product in data.get("Products") or []:
            local = (product.get("LocalizedProperties") or [{}])[0]
            images = {image.get("ImagePurpose"): image.get("Uri", "") for image in local.get("Images") or []}
            art = images.get("Poster") or images.get("BoxArt") or images.get("TitledHeroArt") or ""
            products[product.get("ProductId")] = {
                "title": clean(local.get("ProductTitle", ""))[:120],
                **({"image": f"https:{art}?w=200" if art.startswith("//") else art} if art else {}),
            }
    return products


def game_pass(fetch_ids=game_pass_ids, fetch_products=game_pass_products):
    """Game Pass: recently added, coming soon and leaving soon, each marked console and/or PC."""
    lists = {name: fetch_ids(sigl)[:30] for name, sigl in GAME_PASS_LISTS}
    console, pc = set(fetch_ids(GAME_PASS_CONSOLE)), set(fetch_ids(GAME_PASS_PC))
    products = fetch_products(sorted({pid for ids in lists.values() for pid in ids}))
    out = {}
    for name, ids in lists.items():
        out[name] = [{"id": pid, **products[pid], "url": f"https://www.xbox.com/en-US/games/store/game/{pid}",
                      "on": [label for label, pool in (("Console", console), ("PC", pc)) if pid in pool]}
                     for pid in ids if products.get(pid, {}).get("title")]
    return out


def showcase_events(wikitext, year, today):
    """Upcoming shows, showcases and award nights from Wikipedia's "<year> in video games" Major events table."""
    import update_motorsports as wiki  # shared wikitable parser
    match = re.search(r"^==\s*Major events\s*==\s*$", wikitext or "", re.M)
    if not match:
        return []
    section = wikitext[match.end():]
    end = re.search(r"^==[^=]", section, re.M)
    tables = wiki.wikitables(section[:end.start()] if end else section)
    events = []
    for row in (tables[0][1:] if tables else []):
        cells = [wiki.unflag(cell) for cell in row]
        if len(cells) >= 3 and cells[0].strip().lower() in MONTHS:
            month, days, text = cells[0].strip(), cells[1].strip(), cells[2]
        elif len(cells) >= 2:
            parts = cells[0].split()
            month, days, text = (parts[0] if parts else ""), " ".join(parts[1:]), cells[1]
        else:
            continue
        number = MONTHS.get(month.lower())
        if not number or not SHOWCASE_WORDS.search(text):
            continue
        day_match = re.match(r"(\d{1,2})(?:\s*[–-]\s*(?:[A-Za-z]+\s*)?(\d{1,2}))?", days)
        start = f"{year}-{number:02d}-{int(day_match.group(1)):02d}" if day_match else ""
        end_day = f"{year}-{number:02d}-{int(day_match.group(2)):02d}" if day_match and day_match.group(2) else start
        if (end_day or f"{year}-{number:02d}-31") < today:
            continue
        sentence = re.split(r"(?<=[.!?])\s", text.replace("\n", " "))[0].strip()
        events.append({"start": start, "end": end_day, "month": f"{year}-{number:02d}", "text": sentence[:240]})
    return events


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
                items += feed_items(fetch(url), source, hosts)[:6]
            except Exception as error:
                failures.append(source)
                print(f"News feed {source} failed: {error}", file=sys.stderr)
        return sorted(items, key=lambda item: item["published"], reverse=True)[:30], failures

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

    def free_everywhere():
        return gamerpower_free_games(json.loads(fetch(GAMERPOWER_URL)), now), []

    def pass_lists():
        lists = game_pass()
        if not any(lists.values()):
            return [], []
        return [lists], []

    def showcases():
        today = now[:10]
        events, failures = [], []
        for year in (int(today[:4]), int(today[:4]) + 1):
            try:
                data = json.loads(fetch("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&formatversion=2&page="
                                        + quote(f"{year} in video games")))
                events += showcase_events(data["parse"]["wikitext"], year, today)
            except Exception as error:
                failures.append(f"{year} in video games")
                print(f"Showcases {year} failed: {error}", file=sys.stderr)
        return sorted(events, key=lambda event: event["start"] or event["month"] + "-99"), failures

    section("news", news)
    section("trailers", trailers)
    section("freeGames", free_games)
    section("freeEverywhere", free_everywhere)
    section("gamePass", pass_lists)
    section("showcases", showcases)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
