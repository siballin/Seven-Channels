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
MAX_PER_SOURCE = 15
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
    ("axios", "Axios", "https://www.axios.com/politics-policy", {"axios.com"},
     [("https://api.axios.com/feed/", "politics"), ("https://api.axios.com/feed/top/", "politics"),
      (google_news("site:axios.com politics"), "google")]),
]
POLITICS_WORDS = re.compile(r"\b(politic|congress|senate|house|white house|trump|biden|election|campaign|gop|republican|democrat|"
                            r"governor|supreme court|capitol|lawmaker|speaker|vote|policy|administration)", re.I)


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


def punchbowl_title(title, summary):
    """Punchbowl's items are newsletter editions titled like "paid 11/17/26🕛 Midday:"; name the edition and
    lead with its first line so the headline says what it covers."""
    edition = re.sub(r"^(paid\s+)?\d{1,2}/\d{1,2}/\d{2,4}\s*", "", title, flags=re.I)
    edition = re.sub(r"[^\w\s'’&-]", "", edition).strip(" :") or "Newsletter"
    lead = plain(summary)
    first = re.split(r"(?<=[.!?])\s", lead, maxsplit=1)[0] if lead else ""
    headline = f"{edition}: {first}" if first and len(first) <= 200 else f"Punchbowl News {edition}"
    return headline, lead if first else ""


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
        yield (field(block, "title"), field(block, "link"), field(block, "pubDate"), field(block, "description"),
               re.findall(r"<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</category>", block, re.S))


def parse_feed(raw):
    """Yield (title, link, published, summary, categories) from RSS 2.0 or Atom."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        yield from parse_loose(raw)
        return
    if root.tag == f"{ATOM}feed":
        for entry in root.findall(f"{ATOM}entry"):
            link = next((node.get("href") for node in entry.findall(f"{ATOM}link") if node.get("rel") in (None, "alternate")), "")
            yield (entry.findtext(f"{ATOM}title") or "", link or "", entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated") or "",
                   entry.findtext(f"{ATOM}summary") or "", [node.get("term", "") for node in entry.findall(f"{ATOM}category")])
        return
    for item in root.iter("item"):
        yield (item.findtext("title") or "", item.findtext("link") or "", item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date") or "",
               item.findtext("description") or "", [node.text or "" for node in item.findall("category")])


def items_from(raw, name, hosts, mode, now):
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    out = []
    for title, link, published, summary, categories in parse_feed(raw):
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
                                       or POLITICS_WORDS.search(title + " " + plain(summary))):
            continue
        stamp = when(published)
        if not title or (stamp and stamp < cutoff):
            continue
        out.append({"source": name, "title": title[:300], "url": link[:600], "published": stamp.isoformat(timespec="seconds") if stamp else "",
                    "summary": plain(summary, 240)})
    out.sort(key=lambda item: item["published"], reverse=True)
    return out[:MAX_PER_SOURCE]


def build(previous, fetcher=fetch, now=None):
    now = now or datetime.now(timezone.utc)
    old_items = previous.get("items") or []
    sources, items = [], []
    for source_id, name, home, hosts, feeds in SOURCES:
        found, used, errors = [], "", []
        combined, combined_from = [], []
        for url, mode in feeds:
            try:
                batch = items_from(fetcher(url), name, hosts, mode, now)
            except Exception as error:  # network errors, HTTP errors, bad XML
                errors.append(f"{url}: {error}")
                continue
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
            sources.append({"id": source_id, "name": name, "home": home, "status": "stale" if kept else "unavailable", "feed": "", "count": len(kept)})
            found = kept
        items.extend(found)
    seen, unique = set(), []
    for item in sorted(items, key=lambda item: item["published"], reverse=True):
        key = item["title"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
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
