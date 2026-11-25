"""Headshots for NBA players ESPN has no photo for (mostly retired players) -> data/nba/headshots.json.

For each player in data/nba/index.json without an ESPN headshot, Wikidata maps the ESPN player id to
  1. the NBA.com player id, whose official headshot (cdn.nba.com) is used when NBA.com has one, else
  2. the player's Wikimedia Commons image (P18), shown with its author and license.
Runs monthly from the Pages workflow; python3 scripts/build_nba_headshots.py --force rebuilds now.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote, unquote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_nba_players import OUT, WIKIDATA_API, fetch_json  # noqa: E402

SPARQL = "https://query.wikidata.org/sparql"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
NBA_CDN = "https://cdn.nba.com/headshots/nba/latest/260x190/{}.png"
USER_AGENT = "SevenChannels/1.0 (personal sports guide; static site builder)"
REFRESH_DAYS = 30


def find_property(label_pattern, search, fetcher=None):
    found = fetch_json(WIKIDATA_API, {"action": "wbsearchentities", "type": "property", "language": "en", "search": search, "format": "json"}, fetcher)
    return next((item["id"] for item in found.get("search") or [] if re.search(label_pattern, item.get("label", ""), re.I)), "")


def claim_values(entity, prop):
    out = []
    for claim in (entity.get("claims") or {}).get(prop, []):
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, str) and value:
            out.append(value)
    return out


def sparql_links(wanted, fetcher=None, log=print):
    """One Wikidata Query Service request: ESPN id (P3685) -> NBA.com id (P3647) and image (P18)."""
    query = """SELECT ?espn ?nba ?image ?article WHERE { ?item wdt:P3685 ?espn .
      OPTIONAL { ?item wdt:P3647 ?nba . } OPTIONAL { ?item wdt:P18 ?image . }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } }"""
    for attempt in range(4):
        try:
            data = fetch_json(SPARQL, {"query": query, "format": "json"}, fetcher, tries=1)
            break
        except Exception as error:
            # The query service sometimes allows one request a minute; wait that out a few times.
            if getattr(error, "code", None) != 429 or attempt == 3 or fetcher:
                raise
            log("  Wikidata query service is rate-limiting; waiting 70s")
            time.sleep(70)
    links = {}
    for row in (data.get("results") or {}).get("bindings") or []:
        espn_id = (row.get("espn") or {}).get("value", "")
        if espn_id not in wanted:
            continue
        link = links.setdefault(espn_id, {"nba": "", "image": "", "article": ""})
        article = (row.get("article") or {}).get("value", "")
        if not link["article"] and article.startswith("https://en.wikipedia.org/wiki/"):
            link["article"] = unquote(article.rsplit("/wiki/", 1)[1]).replace("_", " ")
        nba = (row.get("nba") or {}).get("value", "")
        if not link["nba"] and re.fullmatch(r"\d+", nba):
            link["nba"] = nba
        image = (row.get("image") or {}).get("value", "")
        if not link["image"] and "/Special:FilePath/" in image:
            link["image"] = unquote(image.rsplit("/Special:FilePath/", 1)[1]).replace("_", " ")
    log(f"  Wikidata query service: {len(links)} of {len(wanted)} wanted players linked")
    return links


def wikidata_links(wanted, fetcher=None, log=print):
    """{ESPN id: {"nba": NBA.com id, "image": Commons file name}} for the wanted ESPN ids.
    Tries the query service (one request), then the regular API (search + entity data), which rate-limits harder."""
    try:
        links = sparql_links(wanted, fetcher, log)
        if links:
            return links
    except Exception as error:
        log(f"  Wikidata query service unavailable ({error}); using the regular API")
    espn_prop = find_property(r"ESPN.*NBA.*player", "ESPN NBA player ID", fetcher)
    nba_prop = find_property(r"^NBA\.com player ID", "NBA.com player ID", fetcher)
    if not espn_prop:
        log("  Wikidata: no ESPN NBA player id property found")
        return {}
    log(f"  Wikidata properties: ESPN {espn_prop}, NBA.com {nba_prop or 'not found'}, image P18")
    titles, offset = [], 0
    while offset < 20000:
        data = fetch_json(WIKIDATA_API, {"action": "query", "list": "search", "srsearch": f"haswbstatement:{espn_prop}", "srnamespace": "0",
                                         "srlimit": "500", "sroffset": str(offset), "srprop": "", "format": "json"}, fetcher)
        titles += [item["title"] for item in (data.get("query") or {}).get("search") or [] if re.fullmatch(r"Q\d+", item.get("title", ""))]
        if "continue" not in data:
            break
        offset = int(data["continue"].get("sroffset", offset + 500))
        if not fetcher:
            time.sleep(2)
    links = {}
    for start in range(0, len(titles), 50):
        data = fetch_json(WIKIDATA_API, {"action": "wbgetentities", "ids": "|".join(titles[start:start + 50]), "props": "claims",
                                         "format": "json"}, fetcher)
        for entity in (data.get("entities") or {}).values():
            for espn_id in claim_values(entity, espn_prop):
                if espn_id in wanted and espn_id not in links:
                    nba = next((value for value in claim_values(entity, nba_prop) if re.fullmatch(r"\d+", value)), "") if nba_prop else ""
                    image = next(iter(claim_values(entity, "P18")), "")
                    links[espn_id] = {"nba": nba, "image": image}
        if not fetcher:
            time.sleep(0.5)
    log(f"  Wikidata: {len(titles)} items with ESPN ids; {len(links)} of {len(wanted)} wanted players linked")
    return links


def head(url, opener=None):
    request = Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with (opener or urlopen)(request, timeout=20) as response:
        return response.status, response.headers


def fallback_etag(opener=None):
    """NBA.com answers 200 for every id, serving a generic silhouette (fallback.png) when it has no photo."""
    try:
        return head(NBA_CDN.format("fallback"), opener)[1].get("ETag", "") or ""
    except Exception:
        return ""


def nba_headshot_exists(nba_id, opener=None, fallback=""):
    """True when NBA.com serves a real headshot for this player id, not its silhouette."""
    try:
        status, headers = head(NBA_CDN.format(nba_id), opener)
    except Exception:
        return False
    if "fallback.png" in (headers.get("Edge-Cache-Tag") or ""):
        return False
    if fallback and headers.get("ETag") == fallback:
        return False
    kind = headers.get("Content-Type") or ""
    return status == 200 and kind.startswith("image/") and int(headers.get("Content-Length") or 0) > 2000


def plain(html):
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def wikipedia_lead_images(titles, fetcher=None):
    """{article title: file name} for articles whose lead image is freely licensed (so it is on Commons)."""
    out = {}
    names = sorted(set(titles))
    for start in range(0, len(names), 50):
        data = fetch_json(WIKIPEDIA_API, {"action": "query", "titles": "|".join(names[start:start + 50]), "prop": "pageimages",
                                          "piprop": "name", "pilicense": "free", "redirects": "1", "format": "json"}, fetcher)
        query = data.get("query") or {}
        back = {}
        for item in (query.get("normalized") or []) + (query.get("redirects") or []):
            back[item["to"]] = back.get(item["from"], item["from"])
        for page in (query.get("pages") or {}).values():
            if page.get("pageimage"):
                title = page.get("title", "")
                out[back.get(title, title)] = page["pageimage"].replace("_", " ")
        if not fetcher:
            time.sleep(0.5)
    return out


def commons_info(files, fetcher=None):
    """{file name: {"src", "page", "author", "license"}} for Commons files (a 260px-wide thumbnail)."""
    out = {}
    names = sorted(set(files))
    for start in range(0, len(names), 50):
        batch = names[start:start + 50]
        data = fetch_json(COMMONS_API, {"action": "query", "titles": "|".join(f"File:{name}" for name in batch), "prop": "imageinfo",
                                        "iiprop": "url|extmetadata|mime", "iiurlwidth": "260", "format": "json"}, fetcher)
        for page in ((data.get("query") or {}).get("pages") or {}).values():
            info = (page.get("imageinfo") or [None])[0]
            if not info or not str(info.get("mime", "")).startswith("image/"):
                continue
            name = page.get("title", "").split(":", 1)[-1].replace("_", " ")
            meta = info.get("extmetadata") or {}
            src = info.get("thumburl") or info.get("url") or ""
            if not src.startswith("https://upload.wikimedia.org/"):
                continue
            out[name] = {
                "src": src,
                "page": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/File:{quote(name.replace(' ', '_'))}",
                "author": plain((meta.get("Artist") or {}).get("value"))[:120],
                "license": plain((meta.get("LicenseShortName") or {}).get("value"))[:60],
            }
        if not fetcher:
            time.sleep(0.5)
    return out


def build(index, fetcher=None, opener=None, log=print):
    wanted = {row["id"]: row.get("n", "") for row in index.get("players") or [] if not row.get("h")}
    log(f"{len(wanted)} players without an ESPN headshot")
    links = wikidata_links(set(wanted), fetcher, log)
    candidates = [(espn_id, link["nba"]) for espn_id, link in links.items() if link["nba"]]
    fallback = fallback_etag(opener)
    with ThreadPoolExecutor(max_workers=1 if opener else 8) as pool:
        exists = dict(zip([espn_id for espn_id, _ in candidates], pool.map(lambda pair: nba_headshot_exists(pair[1], opener, fallback), candidates)))
    players = {}
    for espn_id, nba_id in candidates:
        if exists.get(espn_id):
            players[espn_id] = {"src": NBA_CDN.format(nba_id), "source": "NBA.com"}
    log(f"  NBA.com: {len(players)} headshots from {len(candidates)} NBA.com ids")
    rest = {espn_id: link["image"] for espn_id, link in links.items() if espn_id not in players and link["image"]}
    articles = {espn_id: link.get("article", "") for espn_id, link in links.items() if espn_id not in players and espn_id not in rest and link.get("article")}
    if articles:
        try:
            lead = wikipedia_lead_images(articles.values(), fetcher)
        except Exception as error:
            log(f"  Wikipedia lead images unavailable ({error})")
            lead = {}
        found_lead = {espn_id: lead[title] for espn_id, title in articles.items() if title in lead}
        log(f"  Wikipedia: {len(found_lead)} free lead images for {len(articles)} more players")
        rest.update(found_lead)
    info = commons_info(rest.values(), fetcher) if rest else {}
    commons = 0
    for espn_id, name in rest.items():
        item = info.get(name.replace("_", " "))
        if item:
            players[espn_id] = {**item, "source": "Wikimedia Commons"}
            commons += 1
    log(f"  Wikimedia Commons: {commons} photos; {len(wanted) - len(players)} players still without a photo")
    return players


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    target = OUT / "headshots.json"
    try:
        previous = json.loads(target.read_text())
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(previous["generatedAt"])).total_seconds() / 86400
    except (OSError, ValueError, KeyError, TypeError):
        previous, age = None, None
    if not args.force and age is not None and age < REFRESH_DAYS:
        print(f"NBA headshots are {age:.1f} days old; skipping.")
        return
    try:
        index = json.loads((OUT / "index.json").read_text())
    except (OSError, ValueError) as error:
        print(f"No NBA player index ({error}); skipping headshots.", file=sys.stderr)
        return
    try:
        players = build(index)
    except Exception as error:
        print(f"NBA headshot build failed, keeping the previous file: {error}", file=sys.stderr)
        return
    if previous and len(players) < len(previous.get("players") or {}) // 2:
        print(f"Only {len(players)} headshots (had {len(previous['players'])}); keeping the previous file.", file=sys.stderr)
        return
    target.write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                  "players": dict(sorted(players.items(), key=lambda pair: int(pair[0])))}, separators=(",", ":")))
    print(f"Wrote {len(players)} headshots.")


if __name__ == "__main__":
    main()
