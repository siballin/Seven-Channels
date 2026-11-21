#!/usr/bin/env python3
"""Build the K-pop idol database (data/idols/) from open data.

Sources
- Wikidata (CC0): which groups are K-pop (genre Q213665), who is or was in them (P463 "member of" and the
  group's P527 "has part", with start and end dates), K-pop soloists, and each profile's facts: names in
  English and Hangul, birth date and place, nationality, height, agency, debut, occupations, links.
- English Wikipedia (CC BY-SA 4.0): the first paragraph of each article, credited on the page.
- Wikimedia Commons: a photo when the profile has one (P18), with its author and license.
- data/idols/overrides.json (yours): positions, fandom names, MBTI and anything else, by Wikidata id or by
  name. Overrides win over the sources.

Output
- data/idols/index.json        search list for every idol and group (small; loaded by the Idols tab)
- data/idols/groups.json       every group with members, sub-units, agency, debut and bio
- data/idols/people/NN.json    idol profiles in 64 shards (NN = Wikidata number mod 64), loaded on demand

The full build takes a few minutes, so by default it's skipped when the data is under 6 days old
(--force rebuilds). If a source fails, the previous data is kept.

Usage: python3 scripts/build_idols.py [--force] [--max-age-days 6] [--limit N]
"""

from datetime import datetime, timezone
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "idols"
OVERRIDES = OUT / "overrides.json"
USER_AGENT = "SevenChannels/1.0 (personal static site; K-pop idol profiles; https://github.com/siballin/Seven-Channels)"
SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
KPOPWIKI_API = "https://kpop.fandom.com/api.php"
KPOPWIKI_CACHE = ROOT / "data" / "idols" / "kpopwiki.json"
NAMU_DUMP = ROOT / "data" / "idols" / "namu-positions.json"
NAMU_LIVE = ROOT / "data" / "idols" / "namu-live.json"
MBTI = re.compile(r"(?<![A-Za-z])([EI][NS][TF][JP])(?:-[AT])?(?![A-Za-z])")
FACT_SOURCES = {
    "namuDump": {"name": "Namu Wiki (2021 dump)", "license": "CC BY-NC-SA 2.0 KR", "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/2.0/kr/", "base": "https://namu.wiki/w/"},
    "namuLive": {"name": "Namu Wiki", "license": "CC BY-NC-SA 2.0 KR", "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/2.0/kr/", "base": "https://namu.wiki/w/"},
    "kpopWiki": {"name": "Kpop Wiki", "license": "CC BY-SA", "licenseUrl": "https://www.fandom.com/licensing", "base": "https://kpop.fandom.com/wiki/"},
}
SHARDS = 64
KPOP = "Q213665"

GROUPS_QUERY = f"""SELECT DISTINCT ?g WHERE {{
  ?g wdt:P136 wd:{KPOP} ; wdt:P31/wdt:P279* wd:Q215380 .
}}"""
# Members through either side of the relation; qualifiers give the years they were in the group.
MEMBERS_QUERY = f"""SELECT DISTINCT ?g ?p ?start ?end WHERE {{
  ?g wdt:P136 wd:{KPOP} ; wdt:P31/wdt:P279* wd:Q215380 .
  {{ ?p p:P463 ?s . ?s ps:P463 ?g . OPTIONAL {{ ?s pq:P580 ?start }} OPTIONAL {{ ?s pq:P582 ?end }} }}
  UNION
  {{ ?g p:P527 ?s . ?s ps:P527 ?p . OPTIONAL {{ ?s pq:P580 ?start }} OPTIONAL {{ ?s pq:P582 ?end }} }}
  ?p wdt:P31 wd:Q5 .
}}"""
# Groups added by name in overrides.json ("includeGroups"), e.g. acts Wikidata doesn't tag as K-pop.
# Entries are English names, Wikidata ids or MusicBrainz artist ids.
# (Two small queries: one combined query with a subclass path times out.)
EXTRA_BY_NAME_QUERY = """SELECT DISTINCT ?g WHERE {{
  VALUES ?name {{ {names} }}
  VALUES ?type {{ wd:Q215380 wd:Q641066 wd:Q216337 wd:Q2088357 }}
  ?g rdfs:label ?name ; wdt:P31 ?type .
}}"""
EXTRA_BY_MBID_QUERY = """SELECT DISTINCT ?g WHERE {{
  VALUES ?mbid {{ {mbids} }}
  ?g wdt:P434 ?mbid .
}}"""
# One group at a time and no UNION: the planner handles the combined form badly and times out.
# The group's own "has part" (P527) list is read from its entity instead.
EXTRA_MEMBERS_QUERY = """SELECT DISTINCT ?p ?start ?end WHERE {{
  ?p p:P463 ?s . ?s ps:P463 wd:{qid} .
  OPTIONAL {{ ?s pq:P580 ?start }} OPTIONAL {{ ?s pq:P582 ?end }}
}}"""
SOLOISTS_QUERY = f"""SELECT DISTINCT ?p WHERE {{
  ?p wdt:P31 wd:Q5 ; wdt:P136 wd:{KPOP} .
}}"""


# ---------- fetching ----------

def fetch_json(url, params=None, fetcher=None, tries=5, first_delay=2):
    if fetcher:
        return fetcher(url, params or {})
    full = f"{url}?{urlencode(params)}" if params else url
    delay = first_delay
    for attempt in range(tries):
        try:
            request = Request(full, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=90) as response:
                return json.load(response)
        except Exception as error:  # rate limits and timeouts: back off and retry
            if attempt == tries - 1:
                raise
            print(f"  retry in {delay}s after {error}", file=sys.stderr, flush=True)
            time.sleep(delay)
            delay *= 2


def sparql(query, fetcher=None):
    if not fetcher:
        print(f"  query: {' '.join(query.split())[:90]}…", flush=True)
    # The query service is often briefly overloaded (502/504); give it time.
    data = fetch_json(SPARQL, {"query": query, "format": "json"}, fetcher, tries=6, first_delay=20)
    return data["results"]["bindings"]


def sparql_date(cell):
    """SPARQL dates lose their precision, so membership dates keep only the year."""
    match = re.match(r"^\+?(\d{4})-", (cell or {}).get("value", ""))
    return match.group(1) if match else ""


def qid_of(uri):
    match = re.search(r"(Q\d+)$", uri or "")
    return match.group(1) if match else ""


def chunks(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def get_entities(ids, fetcher=None, props="labels|aliases|claims|sitelinks", pause=0.2):
    """wbgetentities, 50 at a time."""
    out = {}
    for batch in chunks(sorted(qid for qid in set(ids) if re.fullmatch(r"Q\d+", qid or "")), 50):
        params = {"action": "wbgetentities", "ids": "|".join(batch), "props": props,
                  "languages": "en|ko|mul", "sitefilter": "enwiki|kowiki", "format": "json"}
        for attempt in range(6):
            data = fetch_json(WIKIDATA_API, params, fetcher)
            error = data.get("error")
            if not error:
                break
            # Wikidata asks bots to back off while its servers lag; anything else is a real error.
            if error.get("code") != "maxlag" or attempt == 5:
                raise RuntimeError(f"Wikidata error: {error.get('code')}: {error.get('info', '')[:200]}")
            time.sleep(5 * (attempt + 1))
        out.update({key: value for key, value in (data.get("entities") or {}).items() if "missing" not in value})
        if not fetcher:
            time.sleep(pause)
    return out


# ---------- reading Wikidata claims ----------

def claims(entity, prop):
    return [claim for claim in (entity.get("claims") or {}).get(prop, []) if claim.get("rank") != "deprecated"]


def preferred(entity, prop):
    """Preferred-rank statements if any, else normal ones."""
    found = claims(entity, prop)
    best = [claim for claim in found if claim.get("rank") == "preferred"]
    return best or found


def value_of(claim):
    snak = claim.get("mainsnak") or {}
    return (snak.get("datavalue") or {}).get("value") if snak.get("snaktype") == "value" else None


def item_ids(entity, prop):
    return [value["id"] for value in (value_of(claim) for claim in preferred(entity, prop)) if isinstance(value, dict) and value.get("id")]


def strings(entity, prop):
    return [value for value in (value_of(claim) for claim in preferred(entity, prop)) if isinstance(value, str)]


def wiki_date(value):
    """'+1998-04-11T00:00:00Z' → '1998-04-11', '1998-04' or '1998' by precision."""
    if not isinstance(value, dict) or not isinstance(value.get("time"), str):
        return ""
    match = re.match(r"^\+(\d{4})-(\d{2})-(\d{2})", value["time"])
    if not match:
        return ""
    year, month, day = match.groups()
    precision = value.get("precision", 11)
    if precision >= 11 and month != "00" and day != "00":
        return f"{year}-{month}-{day}"
    if precision == 10 and month != "00":
        return f"{year}-{month}"
    return year if precision >= 9 else ""


def first_date(entity, prop):
    for claim in preferred(entity, prop):
        date = wiki_date(value_of(claim))
        if date:
            return date
    return ""


def qualifier_date(claim, prop):
    for snak in (claim.get("qualifiers") or {}).get(prop, []):
        date = wiki_date((snak.get("datavalue") or {}).get("value"))
        if date:
            return date
    return ""


INVISIBLE = re.compile(r"[\u200b-\u200f\u2060\ufeff]")


def label(entity, lang="en"):
    return INVISIBLE.sub("", ((entity.get("labels") or {}).get(lang) or {}).get("value", "")).strip()


def display_name(entity):
    """English label, else the multilingual label, else the English Wikipedia title, else Hangul."""
    title = re.sub(r"\s*\([^)]*\)$", "", sitelink(entity, "enwiki"))
    return label(entity) or label(entity, "mul") or INVISIBLE.sub("", title).strip() or label(entity, "ko")


def monolingual(entity, prop, lang):
    for claim in preferred(entity, prop):
        value = value_of(claim)
        if isinstance(value, dict) and value.get("language") == lang and value.get("text"):
            return value["text"]
    return ""


def height_cm(entity):
    for claim in preferred(entity, "P2048"):
        value = value_of(claim)
        if not isinstance(value, dict):
            continue
        try:
            amount = float(value.get("amount", ""))
        except ValueError:
            continue
        unit = value.get("unit", "")
        if unit.endswith("/Q174728"):  # centimetre
            return round(amount)
        if unit.endswith("/Q11573"):  # metre
            return round(amount * 100)
    return None


def links(entity):
    out = {}
    website = strings(entity, "P856")
    if website and website[0].startswith("https://"):
        out["website"] = website[0]
    for prop, key, template in [("P2003", "instagram", "https://www.instagram.com/{}/"), ("P2002", "x", "https://x.com/{}"),
                                ("P2397", "youtube", "https://www.youtube.com/channel/{}"), ("P7085", "tiktok", "https://www.tiktok.com/@{}"),
                                ("P1902", "spotify", "https://open.spotify.com/artist/{}"), ("P434", "musicbrainz", "https://musicbrainz.org/artist/{}")]:
        found = strings(entity, prop)
        if found and re.fullmatch(r"[A-Za-z0-9_.\-]+", found[0]):
            out[key] = template.format(found[0])
    return out


def sitelink(entity, site):
    return ((entity.get("sitelinks") or {}).get(site) or {}).get("title", "")


def agencies(entity):
    out = []
    for claim in preferred(entity, "P264"):
        value = value_of(claim)
        if isinstance(value, dict) and value.get("id"):
            out.append({"id": value["id"], "start": qualifier_date(claim, "P580"), "end": qualifier_date(claim, "P582")})
    return out


def english_aliases(entity):
    return [alias["value"] for alias in (entity.get("aliases") or {}).get("en", []) if alias.get("value")][:8]


# ---------- Wikipedia and Commons ----------

def trim_bio(text, limit=700):
    text = re.sub(r"\s*\([^()]*(?:Korean|Hangul|RR|born)[^()]*\)", "", text or "")  # drop romanization asides
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = cut.rfind(". ")
    return cut[:end + 1] if end > 200 else cut.rstrip() + "…"


def wikipedia_intros(titles, fetcher=None):
    out = {}
    for batch in chunks(sorted(set(titles)), 20):
        data = fetch_json(WIKIPEDIA_API, {"action": "query", "prop": "extracts", "exintro": "1", "explaintext": "1", "exlimit": "20",
                                          "redirects": "1", "titles": "|".join(batch), "format": "json", "formatversion": "2"}, fetcher)
        query = data.get("query") or {}
        renamed = {item["to"]: item["from"] for item in query.get("redirects", []) + query.get("normalized", [])}
        for page in query.get("pages", []):
            title = page.get("title", "")
            original = renamed.get(title, title)
            original = renamed.get(original, original)
            if page.get("extract"):
                out[original] = trim_bio(page["extract"])
        if not fetcher:
            time.sleep(0.3)
    return out


def commons_images(files, fetcher=None):
    out = {}
    for batch in chunks(sorted(set(files)), 50):
        data = fetch_json(COMMONS_API, {"action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": "360",
                                        "titles": "|".join(f"File:{name}" for name in batch), "format": "json", "formatversion": "2"}, fetcher)
        query = data.get("query") or {}
        renamed = {item["to"]: item["from"] for item in query.get("normalized", [])}
        for page in query.get("pages", []):
            info = (page.get("imageinfo") or [None])[0]
            if not info or not str(info.get("thumburl", "")).startswith("https://upload.wikimedia.org/"):
                continue
            meta = info.get("extmetadata") or {}
            artist = re.sub(r"<[^>]+>", "", html.unescape((meta.get("Artist") or {}).get("value", ""))).strip()
            title = renamed.get(page["title"], page["title"])
            out[title.removeprefix("File:")] = {
                "url": info["thumburl"], "page": info.get("descriptionurl", ""),
                "author": re.sub(r"\s+", " ", artist)[:120], "license": (meta.get("LicenseShortName") or {}).get("value", "")[:60]}
        if not fetcher:
            time.sleep(0.3)
    return out


# ---------- overrides ----------

def overrides_hash():
    """Changes to your overrides or the Namu Wiki imports trigger a rebuild."""
    digest = hashlib.sha256()
    for path in [OVERRIDES, NAMU_DUMP, NAMU_LIVE]:
        try:
            digest.update(path.read_bytes())
        except OSError:
            digest.update(b"-")
    return digest.hexdigest()[:16]


# ---------- Kpop Wiki (MBTI from trivia) and Namu Wiki imports ----------

def kpopwiki_pages(titles, fetcher=None):
    """{requested title: (page title, wikitext)}, 50 titles a request, following redirects."""
    out = {}
    for batch in chunks(sorted(set(titles)), 50):
        data = fetch_json(KPOPWIKI_API, {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": "1",
                                         "titles": "|".join(batch), "format": "json", "formatversion": "2"}, fetcher)
        query = data.get("query") or {}
        back = {}
        for item in query.get("normalized", []) + query.get("redirects", []):
            back[item["to"]] = back.get(item["from"], item["from"])
        for page in query.get("pages", []):
            text = ((page.get("revisions") or [{}])[0].get("slots") or {}).get("main", {}).get("content", "")
            if text:
                out[back.get(page["title"], page["title"])] = (page["title"], text)
        if not fetcher:
            time.sleep(0.5)
    return out


def kpopwiki_birth(text):
    match = re.search(r"\{\{\s*Birth date(?: and age)?\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", text or "", re.I)
    return f"{match[1]}-{int(match[2]):02d}-{int(match[3]):02d}" if match else ""


def kpopwiki_mbti_from(text):
    """The MBTI the trivia states (the last one when it changed), or ''."""
    found = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n", text or ""):
        if "MBTI" in sentence or "personality type" in sentence:
            found += MBTI.findall(re.sub(r"<ref[^>]*>.*?</ref>|<ref[^>]*/>", "", sentence))
    return found[-1] if found else ""


def kpopwiki_mbti(person_records, fetcher=None):
    """{qid: {"mbti", "title"}} for idols whose Kpop Wiki page states an MBTI; the page must have the same birth date."""
    tries = {}
    for qid, record in person_records.items():
        titles = [f"{record['name']} ({group['name']})" for group in record["groups"]] + [record["name"]]
        tries[qid] = list(dict.fromkeys(titles))
    pages = kpopwiki_pages([title for titles in tries.values() for title in titles], fetcher)
    out = {}
    for qid, titles in tries.items():
        birth = person_records[qid]["birth"]
        for title in titles:
            page = pages.get(title)
            if not page:
                continue
            page_birth = kpopwiki_birth(page[1])
            if (len(birth) == 10 and page_birth == birth) or (len(birth) != 10 and "(" in title):
                mbti = kpopwiki_mbti_from(page[1])
                if mbti:
                    out[qid] = {"mbti": mbti, "title": page[0]}
                break
    return out


def load_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def apply_facts(record, namu_dump, kpopwiki, namu_live):
    """Positions and MBTI from the imports, most current source last so it wins. Records where each came from."""
    sources = {}
    for key, table in [("namuDump", namu_dump), ("kpopWiki", kpopwiki), ("namuLive", namu_live)]:
        item = table.get(record["id"]) or {}
        for field in ["positions", "mbti"]:
            if item.get(field):
                record[field] = item[field]
                sources[field] = {**FACT_SOURCES[key], "url": FACT_SOURCES[key]["base"] + quote(item.get("title", "").replace(" ", "_"))}
    if sources:
        record["factSources"] = sources
    return record


def load_overrides():
    try:
        data = json.loads(OVERRIDES.read_text())
    except (OSError, ValueError):
        return {"people": {}, "groups": {}, "includeGroups": []}
    return {"people": data.get("people") or {}, "groups": data.get("groups") or {},
            "includeGroups": [name for name in data.get("includeGroups") or [] if isinstance(name, str) and name.strip()]}


def apply_override(record, overrides, kind):
    """Overrides are keyed by Wikidata id (Q…) or by English name (case-insensitive, must be unique)."""
    table = overrides[kind]
    extra = table.get(record["id"])
    if extra is None:
        extra = next((value for key, value in table.items() if not key.startswith("_") and key.lower() == record["name"].lower()), None)
    if isinstance(extra, dict):
        # removeMembers: ids or names of people wrongly listed in a group on Wikidata.
        remove = {str(item).lower() for item in extra.get("removeMembers") or []}
        if remove and "members" in record:
            record["members"] = [member for member in record["members"] if member["id"].lower() not in remove and member["name"].lower() not in remove]
        for key, value in extra.items():
            if not key.startswith("_") and key != "removeMembers":
                record[key] = value
        record["edited"] = sorted(key for key in extra if not key.startswith("_") and key != "removeMembers")
    return record


# ---------- build ----------

def build(fetcher=None, limit=None, log=lambda *args: print(*args, flush=True)):
    log("Finding K-pop groups and members on Wikidata…")
    group_ids = {qid_of(row["g"]["value"]) for row in sparql(GROUPS_QUERY, fetcher)}
    memberships = []
    for row in sparql(MEMBERS_QUERY, fetcher):
        memberships.append({"group": qid_of(row["g"]["value"]), "person": qid_of(row["p"]["value"]),
                            "start": sparql_date(row.get("start")), "end": sparql_date(row.get("end"))})
        group_ids.add(memberships[-1]["group"])
    overrides = load_overrides()
    if overrides["includeGroups"]:
        wanted = overrides["includeGroups"]
        mbid = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
        names = " ".join(json.dumps(name) + "@en" for name in wanted if not mbid.fullmatch(name) and not re.fullmatch(r"Q\d+", name))
        mbids = " ".join(json.dumps(name) for name in wanted if mbid.fullmatch(name))
        extra = set()
        if names:
            extra |= {qid_of(row["g"]["value"]) for row in sparql(EXTRA_BY_NAME_QUERY.format(names=names), fetcher)}
        if mbids:
            extra |= {qid_of(row["g"]["value"]) for row in sparql(EXTRA_BY_MBID_QUERY.format(mbids=mbids), fetcher)}
        extra = (extra | {name for name in wanted if re.fullmatch(r"Q\d+", name)}) - group_ids
        for qid in sorted(extra):
            for row in sparql(EXTRA_MEMBERS_QUERY.format(qid=qid), fetcher):
                memberships.append({"group": qid, "person": qid_of(row["p"]["value"]),
                                    "start": sparql_date(row.get("start")), "end": sparql_date(row.get("end"))})
            for claim in preferred(get_entities([qid], fetcher).get(qid, {}), "P527"):
                value = value_of(claim)
                if isinstance(value, dict) and value.get("id"):
                    memberships.append({"group": qid, "person": value["id"], "start": qualifier_date(claim, "P580")[:4], "end": qualifier_date(claim, "P582")[:4]})
        group_ids |= extra
    soloist_ids = {qid_of(row["p"]["value"]) for row in sparql(SOLOISTS_QUERY, fetcher)}
    person_ids = {item["person"] for item in memberships} | soloist_ids
    if limit:
        group_ids = set(sorted(group_ids)[:limit])
        memberships = [item for item in memberships if item["group"] in group_ids]
        person_ids = {item["person"] for item in memberships} | set(sorted(soloist_ids)[:limit])
    log(f"  {len(group_ids)} groups, {len(person_ids)} people")

    groups = get_entities(group_ids, fetcher)
    people = get_entities(person_ids, fetcher)
    log(f"  details for {len(groups)} groups and {len(people)} people")
    # Sub-units: groups whose "part of" (P361) or "member of" is another K-pop group.
    referenced = set()
    for entity in list(groups.values()) + list(people.values()):
        for prop in ["P19", "P27", "P264", "P106", "P495", "P361", "P463"]:
            referenced.update(item_ids(entity, prop))
        for claim in preferred(entity, "P264"):
            value = value_of(claim)
            if isinstance(value, dict) and value.get("id"):
                referenced.add(value["id"])
    labels = {key: display_name(value) for key, value in get_entities(referenced - set(groups) - set(people), fetcher, props="labels").items()}
    labels.update({key: display_name(value) for key, value in {**groups, **people}.items()})
    # Agencies vs. overseas record labels: Wikidata lists both under P264; Korean companies (country P17) count as agencies.
    agency_ids = {item["id"] for entity in list(groups.values()) + list(people.values()) for item in agencies(entity)}
    korean = {key for key, value in get_entities(agency_ids, fetcher, props="claims").items() if "Q884" in item_ids(value, "P17")}

    def agency_list(entity):
        found = [{"name": labels.get(item["id"], ""), "korean": item["id"] in korean, **item} for item in agencies(entity) if labels.get(item["id"])]
        return sorted(found, key=lambda item: not item["korean"])

    log("Fetching Wikipedia introductions and Commons photos…")
    titles = [sitelink(entity, "enwiki") for entity in list(groups.values()) + list(people.values()) if sitelink(entity, "enwiki")]
    bios = wikipedia_intros(titles, fetcher)
    files = [strings(entity, "P18")[0] for entity in list(groups.values()) + list(people.values()) if strings(entity, "P18")]
    images = commons_images(files, fetcher)

    def photo(entity):
        found = strings(entity, "P18")
        return images.get(found[0].replace("_", " ")) or images.get(found[0]) if found else None

    def bio(entity):
        title = sitelink(entity, "enwiki")
        return {"text": bios[title], "title": title, "url": f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}"} if title in bios else None

    by_group = {}
    by_person = {}
    for item in memberships:
        if item["group"] in groups and item["person"] in people:
            by_group.setdefault(item["group"], {})[item["person"]] = item
            by_person.setdefault(item["person"], {})[item["group"]] = item

    group_records = {}
    for qid, entity in groups.items():
        name = display_name(entity)
        if not name:
            continue
        parents = [parent for parent in item_ids(entity, "P361") + item_ids(entity, "P463") if parent in groups and parent != qid]
        members = []
        for person, item in sorted(by_group.get(qid, {}).items(), key=lambda pair: (bool(pair[1]["end"]), pair[1]["start"] or "9999", display_name(people[pair[0]]))):
            members.append({"id": person, "name": display_name(people[person]), "start": item["start"], "end": item["end"]})
        record = {
            "id": qid, "name": name, "ko": label(entity, "ko") if label(entity, "ko") != name else "",
            "aliases": english_aliases(entity),
            "debut": first_date(entity, "P2031") or first_date(entity, "P571"),
            "disbanded": first_date(entity, "P2032") or first_date(entity, "P576"),
            "agencies": agency_list(entity),
            "country": [labels[item] for item in item_ids(entity, "P495") if labels.get(item)],
            "parents": [{"id": parent, "name": labels.get(parent, "")} for parent in parents],
            "members": members, "links": links(entity), "photo": photo(entity), "bio": bio(entity),
        }
        group_records[qid] = apply_override(record, overrides, "groups")
    for record in group_records.values():
        record["subunits"] = [{"id": other["id"], "name": other["name"]} for other in group_records.values() if any(parent["id"] == record["id"] for parent in other["parents"])]

    person_records = {}
    for qid, entity in people.items():
        name = display_name(entity)
        if not name:
            continue
        memberships_of = [{"id": group, "name": group_records[group]["name"], "start": item["start"], "end": item["end"]}
                          for group, item in sorted(by_person.get(qid, {}).items(), key=lambda pair: pair[1]["start"] or "9999") if group in group_records]
        record = {
            "id": qid, "name": name, "ko": label(entity, "ko") if label(entity, "ko") != name else "",
            "birthName": monolingual(entity, "P1477", "ko") or monolingual(entity, "P1477", "en"),
            "birthNameEn": monolingual(entity, "P1477", "en"),
            "aliases": english_aliases(entity),
            "birth": first_date(entity, "P569"),
            "death": first_date(entity, "P570"),
            "birthplace": labels.get((item_ids(entity, "P19") or [""])[0], ""),
            "nationality": [labels[item] for item in item_ids(entity, "P27") if labels.get(item)],
            "height": height_cm(entity),
            "occupations": [labels[item] for item in item_ids(entity, "P106") if labels.get(item)][:6],
            "debut": first_date(entity, "P2031"),
            "agencies": agency_list(entity),
            "groups": memberships_of, "links": links(entity), "photo": photo(entity), "bio": bio(entity),
        }
        person_records[qid] = record

    log("Reading positions and MBTI (Namu Wiki imports, Kpop Wiki)…")
    try:
        kpopwiki = kpopwiki_mbti(person_records, fetcher)
        if not fetcher:
            KPOPWIKI_CACHE.write_text(json.dumps({"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "people": kpopwiki}, ensure_ascii=False, separators=(",", ":")))
    except Exception as error:  # Kpop Wiki is optional; reuse last week's answers
        log(f"  Kpop Wiki unavailable ({error}); using the last saved MBTI list")
        kpopwiki = load_json(KPOPWIKI_CACHE).get("people", {})
    namu_dump = load_json(NAMU_DUMP).get("people", {})
    namu_live = load_json(NAMU_LIVE).get("people", {})
    log(f"  MBTI from Kpop Wiki for {len(kpopwiki)}; Namu Wiki dump {len(namu_dump)}, live {len(namu_live)}")
    for qid, record in person_records.items():
        record = apply_facts(record, namu_dump, kpopwiki, namu_live)
        record = apply_override(record, overrides, "people")
        for field in record.get("edited", []):
            record.get("factSources", {}).pop(field, None)
        person_records[qid] = record
    return group_records, person_records


def shard(qid):
    return f"{int(qid[1:]) % SHARDS:02d}"


def write(group_records, person_records, now=None):
    now = now or datetime.now(timezone.utc).isoformat(timespec="seconds")
    (OUT / "people").mkdir(parents=True, exist_ok=True)
    index = {
        "generatedAt": now,
        "sources": [
            {"name": "Wikidata", "url": "https://www.wikidata.org/", "license": "CC0"},
            {"name": "Wikipedia", "url": "https://en.wikipedia.org/", "license": "CC BY-SA 4.0"},
            {"name": "Wikimedia Commons", "url": "https://commons.wikimedia.org/", "license": "per photo"},
        ],
        "shards": SHARDS,
        "overrides": overrides_hash(),
        # Compact rows: n name, k Hangul, a aliases, g group ids, b birth date, p photo, d debut, x disbanded / inactive
        "people": sorted(({
            "id": record["id"], "n": record["name"], "k": record["ko"], "a": record["aliases"][:4],
            "g": [group["id"] for group in record["groups"]], "b": record["birth"], "p": (record["photo"] or {}).get("url", ""),
        } for record in person_records.values()), key=lambda row: row["n"].lower()),
        "groups": sorted(({
            "id": record["id"], "n": record["name"], "k": record["ko"], "a": record["aliases"][:4], "d": record["debut"],
            "x": bool(record["disbanded"]), "p": (record["photo"] or {}).get("url", ""),
            "m": len([member for member in record["members"] if not member["end"]]), "ag": ([agency["name"] for agency in record["agencies"] if not agency["end"] and agency.get("korean")] or [agency["name"] for agency in record["agencies"] if not agency["end"]])[:2],
        } for record in group_records.values()), key=lambda row: row["n"].lower()),
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    (OUT / "groups.json").write_text(json.dumps({"generatedAt": now, "groups": group_records}, ensure_ascii=False, separators=(",", ":")))
    buckets = {}
    for qid, record in person_records.items():
        buckets.setdefault(shard(qid), {})[qid] = record
    for number in range(SHARDS):
        key = f"{number:02d}"
        (OUT / "people" / f"{key}.json").write_text(json.dumps({"generatedAt": now, "people": buckets.get(key, {})}, ensure_ascii=False, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--max-age-days", type=float, default=6)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    try:
        previous = json.loads((OUT / "index.json").read_text())
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(previous.get("generatedAt", ""))).total_seconds() / 86400
        same_overrides = previous.get("overrides") == overrides_hash()
    except (OSError, ValueError, TypeError):
        age, same_overrides = None, False
    if not args.force and age is not None and age < args.max_age_days and same_overrides:
        print(f"Idol data is {age:.1f} days old; skipping (use --force to rebuild).")
        return
    try:
        groups, people = build(limit=args.limit)
    except Exception as error:
        print(f"Idol build failed, keeping the previous data: {error}", file=sys.stderr)
        sys.exit(0 if (OUT / "index.json").exists() else 1)
    if len(groups) < 50 and not args.limit:
        print(f"Only {len(groups)} groups found; keeping the previous data.", file=sys.stderr)
        sys.exit(0 if (OUT / "index.json").exists() else 1)
    write(groups, people)
    print(f"Wrote {len(groups)} groups and {len(people)} idols.")


if __name__ == "__main__":
    main()
