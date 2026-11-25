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
    query = """SELECT ?espn ?nba ?image ?article ?category WHERE { ?item wdt:P3685 ?espn .
      OPTIONAL { ?item wdt:P3647 ?nba . } OPTIONAL { ?item wdt:P18 ?image . } OPTIONAL { ?item wdt:P373 ?category . }
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
        link = links.setdefault(espn_id, {"nba": "", "image": "", "article": "", "category": ""})
        category = (row.get("category") or {}).get("value", "")
        if not link["category"] and category:
            link["category"] = category
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


class OutOfTime(Exception):
    pass


DEADLINE = [None]  # time.monotonic() value after which Wikimedia requests stop (the daily sweep's budget)


def wm_fetch(url, params, fetcher=None, log=print):
    """Wikipedia/Commons request, paced, waiting out rate limits (429) with growing pauses, within the time budget."""
    if fetcher:
        return fetch_json(url, params, fetcher)
    for wait in (20, 40, 80, 160, None):
        if DEADLINE[0] and time.monotonic() > DEADLINE[0]:
            raise OutOfTime("time budget used up")
        time.sleep(1)
        try:
            return fetch_json(url, params, tries=2)
        except Exception as error:
            if getattr(error, "code", None) != 429 or wait is None:
                raise
            if DEADLINE[0] and time.monotonic() + wait > DEADLINE[0]:
                raise OutOfTime("rate-limited and out of time") from error
            log(f"  {url.split('/')[2]} is rate-limiting; waiting {wait}s")
            time.sleep(wait)


def commons_category_files(category, fetcher=None, log=print):
    """Photo file names in a player's Commons category (P373), best guesses first."""
    data = wm_fetch(COMMONS_API, {"action": "query", "list": "categorymembers", "cmtitle": f"Category:{category}", "cmtype": "file",
                                  "cmlimit": "30", "format": "json"}, fetcher, log)
    names = [item["title"].split(":", 1)[-1] for item in (data.get("query") or {}).get("categorymembers") or []]
    photos = [name for name in names if re.search(r"\.(jpe?g|png|webp)$", name, re.I) and not re.search(r"signature|autograph|logo|card|grave|jersey|\bmap\b", name, re.I)]
    surname = category.split("(")[0].split()[-1].lower() if category.split() else ""
    return sorted(photos, key=lambda name: (surname not in name.lower(), len(name)))[:3]


def wikipedia_lead_images(titles, fetcher=None, log=print):
    """{article title: file name} for articles whose lead image is freely licensed (so it is on Commons)."""
    out = {}
    names = sorted(set(titles))
    for start in range(0, len(names), 50):
        data = wm_fetch(WIKIPEDIA_API, {"action": "query", "titles": "|".join(names[start:start + 50]), "prop": "pageimages",
                                        "piprop": "name", "pilicense": "free", "pilimit": "50", "redirects": "1", "format": "json"}, fetcher, log)
        query = data.get("query") or {}
        back = {}
        for item in (query.get("normalized") or []) + (query.get("redirects") or []):
            back[item["to"]] = back.get(item["from"], item["from"])
        for page in (query.get("pages") or {}).values():
            if page.get("pageimage"):
                title = page.get("title", "")
                out[back.get(title, title)] = page["pageimage"].replace("_", " ")
    return out


def commons_page(name):
    return f"https://commons.wikimedia.org/wiki/File:{quote(name.replace(' ', '_'))}"


def commons_file_url(name):
    """Commons' own redirect to a 330px thumbnail of the file (330 is one of Wikimedia's standard thumbnail sizes)."""
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(name.replace(' ', '_'))}?width=330"


def commons_info(files, fetcher=None, log=print):
    """{file name: {"src", "page", "author", "license"}} for Commons files (a 260px-wide thumbnail)."""
    out = {}
    names = sorted({name.replace("_", " ") for name in files})
    for start in range(0, len(names), 50):
        batch = names[start:start + 50]
        params = {"action": "query", "titles": "|".join(f"File:{name}" for name in batch), "prop": "imageinfo",
                  "iiprop": "url|extmetadata|mime", "iiurlwidth": "330", "iiextmetadatafilter": "Artist|LicenseShortName", "format": "json"}
        pages = {}
        for _ in range(20):
            data = wm_fetch(COMMONS_API, params, fetcher, log)
            for key, page in ((data.get("query") or {}).get("pages") or {}).items():
                if page.get("imageinfo") or key not in pages:
                    pages[key] = page
            # "iicontinue" means some files' answers are still to come; "iistart" only pages through older versions.
            if "iicontinue" not in (data.get("continue") or {}):
                break
            params = {**params, **data["continue"]}
        for page in pages.values():
            info = (page.get("imageinfo") or [None])[0]
            if not info or not str(info.get("mime", "")).startswith("image/"):
                continue
            name = page.get("title", "").split(":", 1)[-1].replace("_", " ")
            meta = info.get("extmetadata") or {}
            src = re.sub(r"\?utm_[^#]*$", "", info.get("thumburl") or info.get("url") or "")
            if not re.match(r"https://(upload|thumb)\.wikimedia\.org/", src):
                continue
            out[name] = {
                "src": src,
                "page": info.get("descriptionurl") or commons_page(name),
                "author": plain((meta.get("Artist") or {}).get("value"))[:120],
                "license": plain((meta.get("LicenseShortName") or {}).get("value"))[:60],
            }
    return out


IMAGE_FILE = re.compile(r"\.(jpe?g|png|webp|gif|tiff?)$", re.I)
SWEEP_BATCH = 60          # still-missing players tried per run with the slow sources
SWEEP_MINUTES = 8         # time budget for those requests
RETRY_DAYS = 7            # a player tried without luck waits this long before the next try


def load_links(wanted, fetcher, log, links_file):
    """Wikidata links for the wanted players, saved so a Wikidata outage or rate limit doesn't stop a refresh."""
    try:
        saved = json.loads(links_file.read_text()) if links_file and links_file.exists() else {}
    except (OSError, ValueError):
        saved = {}
    try:
        links = wikidata_links(set(wanted), fetcher, log)
    except Exception as error:
        if not saved:
            raise
        log(f"  Wikidata unavailable ({error}); using the {len(saved)} saved links")
        return {key: value for key, value in saved.items() if key in wanted}
    if links_file and len(links) >= len(saved) // 2:
        links_file.write_text(json.dumps(dict(sorted({**saved, **links}.items(), key=lambda pair: int(pair[0]))), separators=(",", ":")))
    return links


def resolve(players, choices, label, fetcher=None, log=print):
    """Look the candidate Commons files up (thumbnail + credits) and give each player the first that resolves."""
    info = {}
    try:
        info = commons_info([name for names in choices.values() for name in names], fetcher, log) if choices else {}
    except Exception as error:
        log(f"  Wikimedia Commons unavailable for {label} ({error})")
    found = 0
    for espn_id, names in choices.items():
        item = next((info[name.replace("_", " ")] for name in names if name.replace("_", " ") in info), None)
        if item and espn_id not in players:
            players[espn_id] = {**item, "source": "Wikimedia Commons"}
            found += 1
    log(f"  {label}: {found} photos from {len(choices)} players")
    return found


def build(index, fetcher=None, opener=None, log=print, links_file=None, slow=True):
    """The full refresh: NBA.com headshots and Wikidata images for every player ESPN has no photo for.
    With slow=True (tests, --force) it also tries Wikipedia lead images and Commons categories for everyone;
    the daily sweep does those a batch at a time instead."""
    wanted = {row["id"]: row.get("n", "") for row in index.get("players") or [] if not row.get("h")}
    log(f"{len(wanted)} players without an ESPN headshot")
    links = load_links(wanted, fetcher, log, links_file)
    candidates = [(espn_id, link["nba"]) for espn_id, link in links.items() if link.get("nba")]
    fallback = fallback_etag(opener)
    with ThreadPoolExecutor(max_workers=1 if opener else 8) as pool:
        exists = dict(zip([espn_id for espn_id, _ in candidates], pool.map(lambda pair: nba_headshot_exists(pair[1], opener, fallback), candidates)))
    players = {}
    for espn_id, nba_id in candidates:
        if exists.get(espn_id):
            players[espn_id] = {"src": NBA_CDN.format(nba_id), "source": "NBA.com"}
    log(f"  NBA.com: {len(players)} headshots from {len(candidates)} NBA.com ids")
    # Free photos, in order: the Wikidata image (P18), the English Wikipedia article's free lead image,
    # then photos in the player's Commons category. Each step only looks at players still without one.
    images = {espn_id: link["image"] for espn_id, link in links.items() if espn_id not in players and link.get("image")}
    resolve(players, {espn_id: [name] for espn_id, name in images.items()}, "Wikidata images", fetcher, log)
    # Wikidata only lists files that exist on Commons, so when the API is rate-limiting, link the photo directly;
    # its Commons page (linked under the photo) names the photographer and license. The sweep fills those in.
    direct = 0
    for espn_id, name in images.items():
        if espn_id not in players and IMAGE_FILE.search(name):
            players[espn_id] = {"src": commons_file_url(name), "page": commons_page(name), "author": "", "license": "", "source": "Wikimedia Commons"}
            direct += 1
    if direct:
        log(f"  Wikidata images linked directly (credits pending): {direct}")
    if slow:
        try_free_photos(players, [espn_id for espn_id in links if espn_id not in players], links, fetcher, log)
    log(f"  {len(players)} photos in all; {len(wanted) - len(players)} players still without a photo")
    return players


def try_free_photos(players, ids, links, fetcher=None, log=print):
    """Wikipedia lead images, then Commons category photos, for these players. Returns the ids actually tried."""
    tried = []
    articles = {espn_id: links[espn_id]["article"] for espn_id in ids if links.get(espn_id, {}).get("article")}
    if articles:
        try:
            lead = wikipedia_lead_images(articles.values(), fetcher, log)
        except Exception as error:
            log(f"  Wikipedia lead images unavailable ({error})")
            return tried
        resolve(players, {espn_id: [lead[title]] for espn_id, title in articles.items() if title in lead}, "Wikipedia lead images", fetcher, log)
    choices = {}
    for espn_id in ids:
        category = links.get(espn_id, {}).get("category")
        if espn_id not in players and category:
            try:
                files = commons_category_files(category, fetcher, log)
            except Exception as error:
                log(f"  Commons categories unavailable ({error})")
                break
            if files:
                choices[espn_id] = files
        tried.append(espn_id)
    resolve(players, choices, "Commons categories", fetcher, log)
    return tried


def fill_credits(players, limit, fetcher=None, log=print):
    """Photographer and license for directly linked Commons photos (also swaps in the upload.wikimedia.org thumbnail)."""
    pending = {espn_id: unquote(item["page"].split("/File:", 1)[1]).replace("_", " ") for espn_id, item in players.items()
               if item.get("source") == "Wikimedia Commons" and not (item.get("author") or item.get("license")) and "/File:" in item.get("page", "")}
    pending = dict(list(pending.items())[:limit])
    if not pending:
        return 0
    try:
        info = commons_info(pending.values(), fetcher, log)
    except Exception as error:
        log(f"  Credits unavailable ({error})")
        return 0
    filled = 0
    for espn_id, name in pending.items():
        item = info.get(name)
        if item and (item["author"] or item["license"]):
            players[espn_id].update(item)
            filled += 1
    log(f"  Credits filled for {filled} of {len(pending)} photos")
    return filled


def sweep(players, wanted, links, tried, today, fetcher=None, log=print, batch=SWEEP_BATCH):
    """The daily step: try a batch of still-missing players (never-tried first, then the longest ago) with the
    slow sources, and fill in pending credits. Progress is kept in `tried` ({ESPN id: date}) between runs."""
    def due(espn_id):
        last = tried.get(espn_id)
        return not last or (datetime.fromisoformat(today) - datetime.fromisoformat(last)).days >= RETRY_DAYS
    missing = sorted((espn_id for espn_id in wanted if espn_id not in players and espn_id in links and due(espn_id)),
                     key=lambda espn_id: (tried.get(espn_id, ""), int(espn_id)))
    todo = missing[:batch]
    before = len(players)
    log(f"Daily sweep: {len(todo)} of {len(missing)} due players")
    for espn_id in try_free_photos(players, todo, links, fetcher, log):
        tried[espn_id] = today
    for espn_id in list(tried):
        if espn_id in players or espn_id not in wanted:
            del tried[espn_id]
    fill_credits(players, batch, fetcher, log)
    log(f"  Sweep found {len(players) - before} new photos")
    return len(players) - before


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="full refresh now, trying every source for every player")
    args = parser.parse_args()
    target = OUT / "headshots.json"
    links_file = OUT / "headshot-links.json"
    now = datetime.now(timezone.utc)
    try:
        previous = json.loads(target.read_text())
    except (OSError, ValueError):
        previous = {}
    try:
        index = json.loads((OUT / "index.json").read_text())
    except (OSError, ValueError) as error:
        print(f"No NBA player index ({error}); skipping headshots.", file=sys.stderr)
        return
    wanted = {row["id"] for row in index.get("players") or [] if not row.get("h")}
    players = {key: value for key, value in (previous.get("players") or {}).items() if key in wanted}
    try:
        full_age = (now - datetime.fromisoformat(previous.get("fullAt") or previous["generatedAt"])).total_seconds() / 86400
    except (KeyError, ValueError, TypeError):
        full_age = None
    full_at = previous.get("fullAt") or previous.get("generatedAt")
    if args.force or full_age is None or full_age >= REFRESH_DAYS:
        # Monthly: rebuild from NBA.com and Wikidata; keep photos earlier sweeps found for players the rebuild didn't cover.
        try:
            fresh = build(index, links_file=links_file, slow=args.force)
        except Exception as error:
            print(f"NBA headshot refresh failed, keeping the previous photos: {error}", file=sys.stderr)
            fresh = None
        if fresh is not None and len(fresh) >= sum(1 for item in players.values() if item.get("source") == "NBA.com") // 2:
            credits = {item.get("page"): item for item in players.values() if item.get("page") and (item.get("author") or item.get("license"))}
            for item in fresh.values():
                old = credits.get(item.get("page"))
                if old and not (item.get("author") or item.get("license")):
                    item.update({key: old[key] for key in ("src", "author", "license") if old.get(key)})
            players = {**{key: value for key, value in players.items() if value.get("source") != "NBA.com"}, **fresh}
            full_at = now.isoformat(timespec="seconds")
    try:
        links = json.loads(links_file.read_text())
    except (OSError, ValueError):
        links = {}
    tried = dict((previous.get("sweep") or {}).get("tried") or {})
    if not args.force and links:
        DEADLINE[0] = time.monotonic() + SWEEP_MINUTES * 60
        try:
            sweep(players, wanted, links, tried, now.date().isoformat())
        except Exception as error:
            print(f"Daily headshot sweep stopped: {error}", file=sys.stderr)
        finally:
            DEADLINE[0] = None
    target.write_text(json.dumps({"generatedAt": now.isoformat(timespec="seconds"), "fullAt": full_at,
                                  "players": dict(sorted(players.items(), key=lambda pair: int(pair[0]))),
                                  "sweep": {"tried": dict(sorted(tried.items(), key=lambda pair: int(pair[0])))}}, separators=(",", ":")))
    print(f"Wrote {len(players)} headshots; {len(wanted) - len(players)} players still without a photo.")


if __name__ == "__main__":
    main()
