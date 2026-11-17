#!/usr/bin/env python3
"""Build the news column for each channel (data/channel-news.json) from public RSS/Atom feeds.

Every channel lists its outlets; each outlet lists feed addresses to try in order, ending with Google News
results limited to the outlet's site when it has no working feed of its own. A filter can narrow a broad feed
to the channel's topic. Only headlines, links, times and short summaries are kept, and every item links to the
outlet. An outlet whose feeds all fail keeps its items from the previous run, marked stale.

The Guide's column takes the newest headlines across every channel, including the ones built by other scripts
(Politics, Video Games and K-pop news).
"""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

from update_politics_news import fetch, google_news, host_ok, parse_feed, plain, when

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "channel-news.json"
MAX_PER_SOURCE = 12
MAX_AGE_DAYS = 10

BETTING = re.compile(r"\b(odds|picks?|prediction|best bets?|spread|over/under|moneyline|parlay|props?|betting|lines?|futures)\b", re.I)
TOUR = re.compile(r"\b(tour|tours|concert|concerts|dates|festival|festivals|residency|lineup|headline\w*|arena|stadium|setlist|live)\b", re.I)
CREATOR = re.compile(r"\b(youtube|creator\w*|shorts|monetiz\w*|algorithm|tiktok|instagram|reels|twitch|streamer\w*|subscriber\w*|views)\b", re.I)


def src(name, home, hosts, feeds, google=None, filter=None):
    """An outlet: its feeds in order, then Google News for its site as a fallback."""
    feeds = list(feeds) + ([(google_news(google), "google")] if google else [])
    return {"name": name, "home": home, "hosts": set(hosts), "feeds": feeds, "filter": filter}


CHANNELS = {
    "sports": {"title": "More sports news", "sources": [
        src("The Athletic", "https://www.nytimes.com/athletic/", {"nytimes.com"}, [("https://www.nytimes.com/athletic/rss/news/", None)], "site:nytimes.com/athletic"),
        src("CBS Sports", "https://www.cbssports.com/", {"cbssports.com"}, [("https://www.cbssports.com/rss/headlines/", None)], "site:cbssports.com"),
        src("Yahoo Sports", "https://sports.yahoo.com/", {"yahoo.com"}, [("https://sports.yahoo.com/rss/", None)], "site:sports.yahoo.com"),
        src("Bleacher Report", "https://bleacherreport.com/", {"bleacherreport.com"}, [], "site:bleacherreport.com"),
    ]},
    "kpop": {"title": "K-pop news", "sources": [
        src("Allkpop", "https://www.allkpop.com/", {"allkpop.com"}, [("https://www.allkpop.com/feed", None), ("https://www.allkpop.com/rss", None)], "site:allkpop.com"),
        src("The Korea Herald", "https://www.koreaherald.com/list.php?ct=020500000000", {"koreaherald.com"}, [], "site:koreaherald.com K-pop"),
        src("Billboard K-Pop", "https://www.billboard.com/t/k-pop/", {"billboard.com"}, [("https://www.billboard.com/t/k-pop/feed/", None)], "site:billboard.com k-pop"),
    ]},
    "movies": {"title": "Movie news", "sources": [
        src("Variety", "https://variety.com/v/film/", {"variety.com"}, [("https://variety.com/v/film/feed/", None)], "site:variety.com film"),
        src("Deadline", "https://deadline.com/", {"deadline.com"}, [("https://deadline.com/category/movie-news/feed/", None), ("https://deadline.com/feed/", None)], "site:deadline.com movie"),
        src("The Hollywood Reporter", "https://www.hollywoodreporter.com/c/movies/", {"hollywoodreporter.com"},
            [("https://www.hollywoodreporter.com/c/movies/movie-news/feed/", None), ("https://www.hollywoodreporter.com/c/movies/feed/", None)], "site:hollywoodreporter.com movies"),
        src("IndieWire", "https://www.indiewire.com/c/film/", {"indiewire.com"}, [("https://www.indiewire.com/c/film/feed/", None), ("https://www.indiewire.com/feed/", None)], "site:indiewire.com film"),
        src("Collider", "https://collider.com/movie-news/", {"collider.com"}, [("https://collider.com/feed/category/movie-news/", None), ("https://collider.com/feed/", None)], "site:collider.com movie"),
        src("/Film", "https://www.slashfilm.com/", {"slashfilm.com"}, [("https://www.slashfilm.com/feed/", None)], "site:slashfilm.com"),
        src("Screen Rant", "https://screenrant.com/movie-news/", {"screenrant.com"}, [("https://screenrant.com/feed/movie-news/", None), ("https://screenrant.com/feed/", None)], "site:screenrant.com movie news"),
        src("TheWrap", "https://www.thewrap.com/category/movies/", {"thewrap.com"}, [("https://www.thewrap.com/category/movies/feed/", None), ("https://www.thewrap.com/feed/", None)], "site:thewrap.com movies"),
        src("Letterboxd Journal", "https://letterboxd.com/journal/", {"letterboxd.com"}, [("https://letterboxd.com/journal/rss/", None)], "site:letterboxd.com/journal"),
    ]},
    "anime": {"title": "Anime news", "sources": [
        src("Anime News Network", "https://www.animenewsnetwork.com/", {"animenewsnetwork.com"},
            [("https://www.animenewsnetwork.com/newsroom/rss.xml", None), ("https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us", None)], "site:animenewsnetwork.com"),
        src("Crunchyroll News", "https://www.crunchyroll.com/news", {"crunchyroll.com"},
            [("https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss", None)], "site:crunchyroll.com/news"),
        src("Anime Corner", "https://animecorner.me/", {"animecorner.me"}, [("https://animecorner.me/feed/", None)], "site:animecorner.me"),
        src("MyAnimeList News", "https://myanimelist.net/news", {"myanimelist.net"}, [("https://myanimelist.net/rss/news.xml", None)], "site:myanimelist.net/news"),
    ]},
    "bowling": {"title": "Bowling news", "sources": [
        src("USBC", "https://bowl.com/news", {"bowl.com"}, [("https://bowl.com/rss", None), ("https://bowl.com/news/rss", None)], "site:bowl.com"),
        src("PBA", "https://www.pba.com/", {"pba.com"}, [("https://www.pba.com/rss.xml", None), ("https://www.pba.com/news/rss", None)], "site:pba.com"),
        src("Bowling This Month", "https://www.bowlingthismonth.com/", {"bowlingthismonth.com"}, [("https://www.bowlingthismonth.com/feed/", None)], "site:bowlingthismonth.com"),
        src("Storm Bowling", "https://www.stormbowling.com/", {"stormbowling.com"}, [("https://www.stormbowling.com/feed", None)], "site:stormbowling.com"),
    ]},
    "music": {"title": "Music news", "sources": [
        src("Billboard", "https://www.billboard.com/c/music/music-news/", {"billboard.com"},
            [("https://www.billboard.com/c/music/music-news/feed/", None), ("https://www.billboard.com/feed/", None)], "site:billboard.com music news"),
        src("Pitchfork", "https://pitchfork.com/news/", {"pitchfork.com"}, [("https://pitchfork.com/feed/feed-news/rss", None), ("https://pitchfork.com/rss/news/", None)], "site:pitchfork.com/news"),
        src("Stereogum", "https://www.stereogum.com/", {"stereogum.com"}, [("https://www.stereogum.com/feed/", None)], "site:stereogum.com"),
        src("Rolling Stone", "https://www.rollingstone.com/music/music-news/", {"rollingstone.com"},
            [("https://www.rollingstone.com/music/music-news/feed/", None), ("https://www.rollingstone.com/music/feed/", None)], "site:rollingstone.com music"),
        src("NME", "https://www.nme.com/news/music", {"nme.com"}, [("https://www.nme.com/news/music/feed", None), ("https://www.nme.com/feed", None)], "site:nme.com/news/music"),
        src("Consequence", "https://consequence.net/category/music/", {"consequence.net"}, [("https://consequence.net/category/music/feed/", None)], "site:consequence.net music"),
        src("The Fader", "https://www.thefader.com/", {"thefader.com"}, [("https://www.thefader.com/rss", None), ("https://www.thefader.com/feed", None)], "site:thefader.com"),
        src("Complex Music", "https://www.complex.com/music", {"complex.com"}, [], "site:complex.com/music"),
        src("HotNewHipHop", "https://www.hotnewhiphop.com/", {"hotnewhiphop.com"}, [("https://www.hotnewhiphop.com/rss.xml", None), ("https://www.hotnewhiphop.com/feed", None)], "site:hotnewhiphop.com"),
        src("Hypebeast Music", "https://hypebeast.com/music", {"hypebeast.com"}, [("https://hypebeast.com/music/feed", None)], "site:hypebeast.com/music"),
    ]},
    "live": {"title": "Tour news", "sources": [
        src("Pollstar", "https://news.pollstar.com/", {"pollstar.com"}, [("https://news.pollstar.com/feed/", None)], "site:pollstar.com"),
        src("Consequence", "https://consequence.net/category/music/tour-dates/", {"consequence.net"},
            [("https://consequence.net/category/music/tour-dates/feed/", None), ("https://consequence.net/feed/", "tour")], "site:consequence.net tour"),
        src("Billboard Touring", "https://www.billboard.com/c/pro/touring/", {"billboard.com"}, [("https://www.billboard.com/c/pro/touring/feed/", None)], "site:billboard.com touring"),
        src("JamBase", "https://www.jambase.com/articles", {"jambase.com"}, [("https://www.jambase.com/feed", "tour"), ("https://www.jambase.com/articles/feed", "tour")], "site:jambase.com tour"),
        src("Live Nation", "https://www.livenationentertainment.com/news/", {"livenationentertainment.com"},
            [("https://www.livenationentertainment.com/feed/", None)], "site:livenationentertainment.com"),
        src("Soompi (tours)", "https://www.soompi.com/", {"soompi.com"}, [("https://www.soompi.com/feed", "tour")], "site:soompi.com tour"),
    ]},
    "betting": {"title": "Betting news", "sources": [
        src("Covers", "https://www.covers.com/", {"covers.com"}, [("https://www.covers.com/rss/news", "betting"), ("https://www.covers.com/feed", "betting")], "site:covers.com odds"),
        src("Action Network", "https://www.actionnetwork.com/", {"actionnetwork.com"}, [("https://www.actionnetwork.com/rss", "betting")], "site:actionnetwork.com odds"),
        src("VSiN", "https://vsin.com/", {"vsin.com"}, [("https://vsin.com/feed/", "betting")], "site:vsin.com"),
        src("The Lines", "https://www.thelines.com/", {"thelines.com"}, [("https://www.thelines.com/feed/", None)], "site:thelines.com"),
        src("Legal Sports Report", "https://www.legalsportsreport.com/", {"legalsportsreport.com"}, [("https://www.legalsportsreport.com/feed/", None)], "site:legalsportsreport.com"),
        src("Sports Handle", "https://sportshandle.com/", {"sportshandle.com"}, [("https://sportshandle.com/feed/", None)], "site:sportshandle.com"),
    ]},
    "creator": {"title": "Creator news", "sources": [
        src("YouTube Official Blog", "https://blog.youtube/", {"blog.youtube"}, [("https://blog.youtube/rss/", None)], "site:blog.youtube"),
        src("Creator Insider", "https://www.youtube.com/@CreatorInsider", {"youtube.com"},
            [("https://www.youtube.com/feeds/videos.xml?channel_id=UCGg-UqjRgzhYDPJMr-9HXCg", None)]),
        src("Tubefilter", "https://www.tubefilter.com/", {"tubefilter.com"}, [("https://www.tubefilter.com/feed/", "creator")], "site:tubefilter.com"),
        src("The Verge", "https://www.theverge.com/creators", {"theverge.com"}, [("https://www.theverge.com/rss/creators/index.xml", None), ("https://www.theverge.com/rss/index.xml", "creator")], "site:theverge.com creators"),
        src("Social Media Today", "https://www.socialmediatoday.com/", {"socialmediatoday.com"}, [("https://www.socialmediatoday.com/feeds/news/", "creator")], "site:socialmediatoday.com"),
        src("TechCrunch", "https://techcrunch.com/tag/creator-economy/", {"techcrunch.com"}, [("https://techcrunch.com/tag/creator-economy/feed/", None)], "site:techcrunch.com creator economy"),
        src("TikTok Newsroom", "https://newsroom.tiktok.com/", {"tiktok.com"}, [], "site:newsroom.tiktok.com"),
        src("Instagram", "https://about.instagram.com/blog", {"instagram.com"}, [], "site:about.instagram.com creators"),
        src("Twitch Blog", "https://blog.twitch.tv/", {"twitch.tv"}, [("https://blog.twitch.tv/en/rss.xml", None), ("https://blog.twitch.tv/feed/", None)], "site:blog.twitch.tv"),
        src("Publish Press", "https://www.publishpress.com/", {"publishpress.com"}, [("https://www.publishpress.com/feed", None)], "site:publishpress.com creator"),
    ]},
}
FILTERS = {"betting": BETTING, "tour": TOUR, "creator": CREATOR}
CHANNEL_NAMES = {"sports": "Sports", "movies": "Movies", "anime": "Anime", "bowling": "Bowling", "music": "Music Lab", "live": "Live Events",
                 "betting": "Betting", "creator": "Creator Studio", "politics": "Politics", "games": "Video Games", "kpop": "K-Pop"}


def collect(raw, source, mode, now):
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    pattern = FILTERS.get(mode or source.get("filter") or "")
    out = []
    for title, link, published, summary, _categories in parse_feed(raw):
        title, link = plain(title), (link or "").strip()
        if mode == "google":
            title = re.sub(r"\s+-\s+[^-]+$", "", title)
            if not host_ok(link, {"news.google.com"}):
                continue
            summary = ""
        elif not host_ok(link, source["hosts"]):
            continue
        if pattern and not pattern.search(title + " " + plain(summary)[:300]):
            continue
        stamp = when(published)
        if not title or (stamp and stamp < cutoff):
            continue
        out.append({"source": source["name"], "title": title[:300], "url": link[:600],
                    "published": stamp.isoformat(timespec="seconds") if stamp else "", "summary": plain(summary, 200)})
    out.sort(key=lambda item: item["published"], reverse=True)
    return out[:MAX_PER_SOURCE]


def build_channel(config, previous, fetcher, now):
    old_items = previous.get("items") or []
    sources, items = [], []
    for source in config["sources"]:
        found, used, errors, reachable = [], "", [], False
        for url, mode in source["feeds"]:
            try:
                found = collect(fetcher(url), source, mode, now)
            except Exception as error:  # network errors, HTTP errors, bad XML
                errors.append(f"{url}: {error}")
                continue
            reachable = True
            if found:
                used = url
                break
            errors.append(f"{url}: no recent items")
        status = "ok"
        if not found:
            print(f"{source['name']}: " + "; ".join(errors), file=sys.stderr)
            found = [item for item in old_items if item.get("source") == source["name"]]
            # A feed that answered but had nothing recent is just quiet, not broken.
            status = "quiet" if reachable and not found else "stale" if found else "unavailable"
        sources.append({"name": source["name"], "home": source["home"], "status": status, "count": len(found),
                        "via": "Google News" if used.startswith("https://news.google.com") else ""})
        items.extend(found)
    seen, unique = set(), []
    for item in sorted(items, key=lambda item: item["published"], reverse=True):
        if item["title"].lower() not in seen:
            seen.add(item["title"].lower())
            unique.append(item)
    return {"title": config["title"], "sources": sources, "items": unique}


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def guide_items(channels, now):
    """The newest few headlines from every channel, for the Guide."""
    pools = {key: value.get("items") or [] for key, value in channels.items()}
    pools["politics"] = read_json(ROOT / "data" / "politics-news.json").get("items") or []
    games = read_json(ROOT / "data" / "games-sidebar.json").get("news") or {}
    pools["games"] = [{"source": item.get("source", ""), "title": item.get("title", ""), "url": item.get("url", ""),
                       "published": item.get("published", ""), "summary": ""} for item in games.get("items") or []]
    kpop = read_json(ROOT / "data" / "kpop-sidebar.json").get("news") or {}
    pools["kpop"] = [{"source": item.get("source") or urlparse(item.get("url", "")).hostname.removeprefix("www.").split(".")[0].capitalize(), "title": item.get("title", ""), "url": item.get("url", ""),
                      "published": item.get("published", "") or item.get("date", ""), "summary": ""}
                     for item in (kpop.get("items") if isinstance(kpop, dict) else kpop) or []]
    picked = []
    for key, pool in pools.items():
        fresh = [item for item in pool if item.get("title") and str(item.get("url", "")).startswith("https://")]
        fresh.sort(key=lambda item: item.get("published") or "", reverse=True)
        picked.extend({**item, "channel": key, "channelName": CHANNEL_NAMES.get(key, key)} for item in fresh[:3])
    picked.sort(key=lambda item: item.get("published") or "", reverse=True)
    return picked


def build(previous, fetcher=fetch, now=None):
    now = now or datetime.now(timezone.utc)
    channels = {key: build_channel(config, (previous.get("channels") or {}).get(key) or {}, fetcher, now) for key, config in CHANNELS.items()}
    return {"fetchedAt": now.isoformat(timespec="seconds"), "channels": channels, "guide": {"title": "Top headlines", "items": guide_items(channels, now)}}


def main():
    snapshot = build(read_json(OUTPUT))
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for key, channel in snapshot["channels"].items():
        print(f"{key}: " + ", ".join(f"{s['name']} {s['status']} ({s['count']}{' via Google News' if s['via'] else ''})" for s in channel["sources"]))
    print(f"guide: {len(snapshot['guide']['items'])} headlines")


if __name__ == "__main__":
    main()
