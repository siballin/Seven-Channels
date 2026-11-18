#!/usr/bin/env python3
"""Build the Politics news feed (data/politics-news.json) from five outlets' public RSS/Atom feeds.

Each outlet lists feed addresses to try in order. Axios has no politics-only feed, so its main feed is
filtered to politics stories; Punchbowl News falls back to Google News results limited to its site.
Only headlines, links, times and short summaries are kept, and every item links to the outlet.
An outlet whose feeds all fail keeps its items from the previous run, marked stale.
"""

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import html
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote_plus, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "politics-news.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SevenChannelsPolitics/1.0)", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"}
MAX_PER_SOURCE = 10
MAX_AGE_DAYS = 7
ATOM = "{http://www.w3.org/2005/Atom}"


def google_news(query):
    return f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"


# (id, name, homepage, allowed link hosts, [(feed url, filter)])
SOURCES = [
    ("thehill", "The Hill", "https://thehill.com/", {"thehill.com"},
     [("https://thehill.com/homenews/senate/feed/", "combine"), ("https://thehill.com/homenews/house/feed/", "combine"),
      ("https://thehill.com/homenews/administration/feed/", "combine"), ("https://thehill.com/homenews/campaign/feed/", "combine"),
      ("https://thehill.com/homenews/feed/", "politics")]),
    ("politico", "Politico", "https://www.politico.com/", {"politico.com"},
     [("https://rss.politico.com/politics-news.xml", None), ("https://rss.politico.com/congress.xml", None)]),
    ("punchbowl", "Punchbowl News", "https://punchbowl.news/", {"punchbowl.news"},
     [("https://punchbowl.news/feed/", None), (google_news("site:punchbowl.news"), "google")]),
    ("rollcall", "Roll Call", "https://rollcall.com/", {"rollcall.com"},
     [("https://rollcall.com/feed/", None)]),
    ("npr", "NPR", "https://www.npr.org/sections/politics/", {"npr.org"},
     [("https://feeds.npr.org/1014/rss.xml", None)]),
    ("ap", "AP", "https://apnews.com/politics", {"apnews.com"},
     [(google_news("site:apnews.com politics"), "google")]),
    ("nbc", "NBC News", "https://www.nbcnews.com/politics", {"nbcnews.com"},
     [("https://feeds.nbcnews.com/nbcnews/public/politics", None), (google_news("site:nbcnews.com/politics"), "google")]),
    ("cnn", "CNN", "https://www.cnn.com/politics", {"cnn.com"},
     [("http://rss.cnn.com/rss/cnn_allpolitics.rss", None), (google_news("site:cnn.com/politics"), "google")]),
    ("semafor", "Semafor", "https://www.semafor.com/vertical/politics", {"semafor.com"},
     [("https://www.semafor.com/rss.xml", "politics"), (google_news("site:semafor.com politics"), "google")]),
    ("notus", "NOTUS", "https://www.notus.org/", {"notus.org"},
     [("https://www.notus.org/feed", None), (google_news("site:notus.org"), "google")]),
    ("cook", "Cook Political Report", "https://www.cookpolitical.com/", {"cookpolitical.com"},
     [("https://www.cookpolitical.com/rss.xml", None), (google_news("site:cookpolitical.com"), "google")]),
    ("splitticket", "Split Ticket", "https://split-ticket.org/", {"split-ticket.org"},
     [("https://split-ticket.org/feed/", None)]),
    ("silver", "Silver Bulletin", "https://www.natesilver.net/", {"natesilver.net"},
     [("https://www.natesilver.net/feed", None)]),
    ("axios", "Axios", "https://www.axios.com/politics-policy", {"axios.com"},
     [("https://api.axios.com/feed/", "politics"), ("https://api.axios.com/feed/top/", "politics"),
      (google_news("site:axios.com politics"), "google")]),
]
# Axios's feed only labels stories "top", so politics stories are picked by headline.
POLITICS_WORDS = re.compile(r"\b(politic\w*|congress\w*|senat\w+|house (?:gop|democrats|republicans|speaker|vote)|white house|trump|vance|"
                            r"biden|election\w*|midterm\w*|campaign\w*|gop|republican\w*|democrat\w*|governor\w*|supreme court|scotus|"
                            r"capitol|lawmaker\w*|speaker|jeffries|schumer|thune|johnson|filibuster|impeach\w*|ballot\w*|voter\w*|"
                            r"cabinet|administration|attorney general|doj|justice department|legislat\w+|bill|tariff\w*|shutdown)\b", re.I)


def fetch(url):
    with urlopen(Request(url, headers=HEADERS), timeout=30) as response:
        return response.read()


def plain(value, limit=None):
    text = re.sub(r"<[^>]+>", " ", html.unescape(value or ""))
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    if limit and len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0] + "…"
    return text


def when(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        stamp = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


PUNCHBOWL_LABELS = re.compile(r"^(presented by|in this edition|(?:tech |vault |defense )?lookahead|leader look:?)\b\s*", re.I)


def punchbowl_title(title, summary):
    """Punchbowl's items are newsletter editions titled like "paid 11/17/26🕛 Midday:" whose description lists the
    edition's story headings after "PRESENTED BY" / "IN THIS EDITION" labels. The headline names the edition and
    its lead story; the summary lists the next stories."""
    edition = re.sub(r"^(paid\s+)?\d{1,2}/\d{1,2}/\d{2,4}\s*", "", title, flags=re.I)
    edition = re.sub(r"[^\w\s'’&-]", "", edition).strip(" :") or "Newsletter"
    body = re.sub(r"The post .*? appeared first on .*$", "", summary or "", flags=re.S | re.I)
    parts = []
    for block in re.split(r"<(?:/p|/li|br\s*/?|/h\d|/div|/strong|/b)[^>]*>", body, flags=re.I):
        text = plain(block)
        while text and PUNCHBOWL_LABELS.match(text):
            text = PUNCHBOWL_LABELS.sub("", text, count=1).strip()
        if text and text.lower() not in {"presented by", "in this edition"}:
            parts.append(text)
    if len(parts) == 1:
        # No markup between headings: drop the labels and keep the remaining text as one line.
        parts = [re.sub(r"\b(PRESENTED BY|IN THIS EDITION|(?:TECH |VAULT |DEFENSE )?LOOKAHEAD)\b\s*", "", parts[0]).strip()]
    if parts:
        # Section labels can also sit inside the run-on text ("… Leader Look: …"); drop them.
        parts[0] = re.sub(r"\s*\bLeader( Look:?)?\s*$|\bLeader Look:\s*", " ", parts[0]).strip(" :")
    lead = re.sub(r"\s{2,}", " ", parts[0])[:160].strip() if parts else ""
    headline = f"Punchbowl {edition}: {lead}" if lead else f"Punchbowl News {edition}"
    return headline, " · ".join(parts[1:4])[:240]


def host_ok(url, hosts):
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host == allowed or host.endswith("." + allowed) for allowed in hosts)


def parse_loose(raw):
    """Regex fallback for RSS that isn't well-formed XML (Roll Call's feed has a duplicated attribute)."""
    body = raw.decode("utf-8", "replace")
    def field(block, name):
        match = re.search(rf"<{name}(?:\s[^>]*)?>(.*?)</{name}>", block, re.S)
        value = match.group(1) if match else ""
        return re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", value.strip(), flags=re.S)
    for block in re.findall(r"<item[\s>].*?</item>", body, re.S):
        media = re.search(r"<media:(?:content|thumbnail)[^>]+url=[\"']([^\"']+)", block) or IMG_TAG.search(html.unescape(block))
        image = html.unescape(media.group(1)) if media else ""
        yield (field(block, "title"), field(block, "link"), field(block, "pubDate"), field(block, "description"),
               re.findall(r"<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</category>", block, re.S),
               image if image.startswith("https://") else "")


MEDIA = "{http://search.yahoo.com/mrss/}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
IMG_TAG = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)


def image_of(node, *html):
    """The article's picture: media:content/thumbnail, an image enclosure, or the first <img> in its HTML."""
    candidates = []
    for tag in (f"{MEDIA}content", f"{MEDIA}thumbnail", f"{MEDIA}group/{MEDIA}content", f"{MEDIA}group/{MEDIA}thumbnail"):
        for media in node.findall(tag):
            kind = (media.get("medium") or media.get("type") or "image").lower()
            if "image" in kind or tag.endswith("thumbnail"):
                candidates.append(media.get("url") or "")
    for enclosure in node.findall("enclosure"):
        if (enclosure.get("type") or "").startswith("image"):
            candidates.append(enclosure.get("url") or "")
    for text in html:
        match = IMG_TAG.search(text or "")
        if match:
            candidates.append(html_unescape(match.group(1)))
    for url in candidates:
        url = url.strip().replace("http://", "https://", 1) if url.strip().startswith("http://") else url.strip()
        if url.startswith("https://") and len(url) <= 600 and not re.search(r"(pixel|tracking|1x1|feedburner|gravatar)", url, re.I):
            return url
    return ""


def html_unescape(value):
    return html.unescape(value or "")


def parse_feed(raw):
    """Yield (title, link, published, summary, categories, image) from RSS 2.0 or Atom."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        yield from parse_loose(raw)
        return
    if root.tag == f"{ATOM}feed":
        for entry in root.findall(f"{ATOM}entry"):
            link = next((node.get("href") for node in entry.findall(f"{ATOM}link") if node.get("rel") in (None, "alternate")), "")
            summary = entry.findtext(f"{ATOM}summary") or ""
            yield (entry.findtext(f"{ATOM}title") or "", link or "", entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated") or "",
                   summary, [node.get("term", "") for node in entry.findall(f"{ATOM}category")],
                   image_of(entry, summary, entry.findtext(f"{ATOM}content") or ""))
        return
    for item in root.iter("item"):
        description = item.findtext("description") or ""
        yield (item.findtext("title") or "", item.findtext("link") or "", item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date") or "",
               description, [node.text or "" for node in item.findall("category")], image_of(item, description, item.findtext(CONTENT) or ""))


def items_from(raw, name, hosts, mode, now):
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    out = []
    for title, link, published, summary, categories, image in parse_feed(raw):
        title, link = plain(title), (link or "").strip()
        if mode == "google":
            # Google News titles end with " - Outlet"; links go through news.google.com to the outlet.
            title = re.sub(r"\s+-\s+[^-]+$", "", title)
            if not host_ok(link, {"news.google.com"}):
                continue
            summary = ""
        elif not host_ok(link, hosts):
            continue
        if name == "Punchbowl News" and mode != "google":
            title, summary = punchbowl_title(title, summary)
        if mode == "politics" and not (any("politic" in category.lower() for category in categories) or "/politics" in link
                                       or POLITICS_WORDS.search(title)):
            continue
        stamp = when(published)
        if not title or (stamp and stamp < cutoff):
            continue
        out.append({"source": name, "title": title[:300], "url": link[:600], "published": stamp.isoformat(timespec="seconds") if stamp else "",
                    "image": image if mode != "google" else "",
                    "summary": plain(summary, 240)})
    out.sort(key=lambda item: item["published"], reverse=True)
    return out[:MAX_PER_SOURCE]


OG_IMAGE = re.compile(r"<meta[^>]+(?:property|name)=[\"'](?:og:image|twitter:image)(?::src)?[\"'][^>]*content=[\"']([^\"']+)[\"']"
                      r"|<meta[^>]+content=[\"']([^\"']+)[\"'][^>]*(?:property|name)=[\"'](?:og:image|twitter:image)", re.I)
PAGE_IMAGE_LIMIT = 30


def page_image(url, fetcher):
    """The share image an article page sets for social media (og:image), for feeds that carry no pictures."""
    html_text = fetcher(url)[:300_000].decode("utf-8", "replace")
    match = OG_IMAGE.search(html_text)
    image = html.unescape((match.group(1) or match.group(2)) if match else "").strip()
    return image if image.startswith("https://") and len(image) <= 600 else ""


def fetch_page(url):
    """Article pages get a short timeout so a slow site can't hold up the build."""
    with urlopen(Request(url, headers={**HEADERS, "Accept": "text/html"}), timeout=8) as response:
        return response.read(300_000)


def add_page_images(items, previous_items, fetcher):
    """Fill in missing pictures from article pages, reusing ones found on earlier runs; at most PAGE_IMAGE_LIMIT fetches."""
    known = {item.get("url"): item.get("image") for item in previous_items if item.get("image")}
    budget = PAGE_IMAGE_LIMIT
    for item in items:
        if item.get("image"):
            continue
        if item["url"] in known:
            item["image"] = known[item["url"]]
            continue
        if budget <= 0 or host_ok(item["url"], {"news.google.com"}):
            continue
        budget -= 1
        try:
            item["image"] = page_image(item["url"], fetcher)
        except Exception as error:  # paywalls, timeouts: the card just shows the outlet's icon instead
            print(f"No page image for {item['url']}: {error}", file=sys.stderr)


def build(previous, fetcher=fetch, now=None):
    now = now or datetime.now(timezone.utc)
    old_items = previous.get("items") or []
    sources, items = [], []
    for source_id, name, home, hosts, feeds in SOURCES:
        found, used, errors = [], "", []
        combined, combined_from = [], []
        reachable = False
        for url, mode in feeds:
            try:
                batch = items_from(fetcher(url), name, hosts, mode, now)
            except Exception as error:  # network errors, HTTP errors, bad XML
                errors.append(f"{url}: {error}")
                continue
            reachable = True
            if mode == "combine":
                # Section feeds are merged (e.g. The Hill's Senate, House, Administration and Campaign feeds).
                combined.extend(batch)
                if batch:
                    combined_from.append(url)
                continue
            if combined:
                break
            if batch:
                found, used = batch, url
                break
            errors.append(f"{url}: no recent items")
        if combined:
            unique = {item["url"]: item for item in combined}
            found = sorted(unique.values(), key=lambda item: item["published"], reverse=True)[:MAX_PER_SOURCE]
            used = ", ".join(combined_from)
        if found:
            sources.append({"id": source_id, "name": name, "home": home, "status": "ok", "feed": used, "count": len(found)})
        else:
            print(f"{name}: " + "; ".join(errors), file=sys.stderr)
            kept = [item for item in old_items if item.get("source") == name]
            # A feed that answered but had nothing recent is just quiet, not broken.
            status = "stale" if kept else "quiet" if reachable else "unavailable"
            sources.append({"id": source_id, "name": name, "home": home, "status": status, "feed": "", "count": len(kept)})
            found = kept
        items.extend(found)
    seen, unique = set(), []
    for item in sorted(items, key=lambda item: item["published"], reverse=True):
        key = item["title"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    add_page_images(unique, old_items, fetch_page if fetcher is fetch else fetcher)
    return {"fetchedAt": now.isoformat(timespec="seconds"), "sources": sources, "items": unique}


def main():
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    snapshot = build(previous)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("Politics news: " + ", ".join(f"{source['name']} {source['status']} ({source['count']}{' via ' + source['feed'] if source['feed'] else ''})"
                                         for source in snapshot["sources"]))


if __name__ == "__main__":
    main()
