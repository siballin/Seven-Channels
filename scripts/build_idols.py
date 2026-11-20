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
SOLOISTS_QUERY = f"""SELECT DISTINCT ?p WHERE {{
  ?p wdt:P31 wd:Q5 ; wdt:P136 wd:{KPOP} .
}}"""


# ---------- fetching ----------

def fetch_json(url, params=None, fetcher=None, tries=5):
    if fetcher:
        return fetcher(url, params or {})
    full = f"{url}?{urlencode(params)}" if params else url
    delay = 2
    for attempt in range(tries):
        try:
            request = Request(full, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=90) as response:
                return json.load(response)
        except Exception as error:  # rate limits and timeouts: back off and retry
            if attempt == tries - 1:
                raise
            print(f"  retry after {error}", file=sys.stderr)
            time.sleep(delay)
            delay *= 2


def sparql(query, fetcher=None):
    data = fetch_json(SPARQL, {"query": query, "format": "json"}, fetcher)
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
                  "languages": "en|ko", "sitefilter": "enwiki|kowiki", "format": "json"}
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


def label(entity, lang="en"):
    return ((entity.get("labels") or {}).get(lang) or {}).get("value", "")


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

def load_overrides():
    try:
        data = json.loads(OVERRIDES.read_text())
    except (OSError, ValueError):
        return {"people": {}, "groups": {}}
    return {"people": data.get("people") or {}, "groups": data.get("groups") or {}}


def apply_override(record, overrides, kind):
    """Overrides are keyed by Wikidata id (Q…) or by English name (case-insensitive, must be unique)."""
    table = overrides[kind]
    extra = table.get(record["id"])
    if extra is None:
        extra = next((value for key, value in table.items() if not key.startswith("_") and key.lower() == record["name"].lower()), None)
    if isinstance(extra, dict):
        for key, value in extra.items():
            if not key.startswith("_"):
                record[key] = value
        record["edited"] = sorted(key for key in extra if not key.startswith("_"))
    return record


# ---------- build ----------

def build(fetcher=None, limit=None, log=print):
    log("Finding K-pop groups and members on Wikidata…")
    group_ids = {qid_of(row["g"]["value"]) for row in sparql(GROUPS_QUERY, fetcher)}
    memberships = []
    for row in sparql(MEMBERS_QUERY, fetcher):
        memberships.append({"group": qid_of(row["g"]["value"]), "person": qid_of(row["p"]["value"]),
                            "start": sparql_date(row.get("start")), "end": sparql_date(row.get("end"))})
        group_ids.add(memberships[-1]["group"])
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
    labels = {key: label(value) or label(value, "ko") for key, value in get_entities(referenced - set(groups) - set(people), fetcher, props="labels").items()}
    labels.update({key: label(value) or label(value, "ko") for key, value in {**groups, **people}.items()})

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

    overrides = load_overrides()
    by_group = {}
    by_person = {}
    for item in memberships:
        if item["group"] in groups and item["person"] in people:
            by_group.setdefault(item["group"], {})[item["person"]] = item
            by_person.setdefault(item["person"], {})[item["group"]] = item

    group_records = {}
    for qid, entity in groups.items():
        name = label(entity) or label(entity, "ko")
        if not name:
            continue
        parents = [parent for parent in item_ids(entity, "P361") + item_ids(entity, "P463") if parent in groups and parent != qid]
        members = []
        for person, item in sorted(by_group.get(qid, {}).items(), key=lambda pair: (bool(pair[1]["end"]), pair[1]["start"] or "9999", label(people[pair[0]]))):
            members.append({"id": person, "name": label(people[person]) or label(people[person], "ko"), "start": item["start"], "end": item["end"]})
        record = {
            "id": qid, "name": name, "ko": label(entity, "ko") if label(entity, "ko") != name else "",
            "aliases": english_aliases(entity),
            "debut": first_date(entity, "P2031") or first_date(entity, "P571"),
            "disbanded": first_date(entity, "P2032") or first_date(entity, "P576"),
            "agencies": [{"name": labels.get(item["id"], ""), **item} for item in agencies(entity) if labels.get(item["id"])],
            "country": [labels[item] for item in item_ids(entity, "P495") if labels.get(item)],
            "parents": [{"id": parent, "name": labels.get(parent, "")} for parent in parents],
            "members": members, "links": links(entity), "photo": photo(entity), "bio": bio(entity),
        }
        group_records[qid] = apply_override(record, overrides, "groups")
    for record in group_records.values():
        record["subunits"] = [{"id": other["id"], "name": other["name"]} for other in group_records.values() if any(parent["id"] == record["id"] for parent in other["parents"])]

    person_records = {}
    for qid, entity in people.items():
        name = label(entity) or label(entity, "ko")
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
            "agencies": [{"name": labels.get(item["id"], ""), **item} for item in agencies(entity) if labels.get(item["id"])],
            "groups": memberships_of, "links": links(entity), "photo": photo(entity), "bio": bio(entity),
        }
        person_records[qid] = apply_override(record, overrides, "people")
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
        # Compact rows: n name, k Hangul, a aliases, g group ids, b birth date, p photo, d debut, x disbanded / inactive
        "people": sorted(({
            "id": record["id"], "n": record["name"], "k": record["ko"], "a": record["aliases"][:4],
            "g": [group["id"] for group in record["groups"]], "b": record["birth"], "p": (record["photo"] or {}).get("url", ""),
        } for record in person_records.values()), key=lambda row: row["n"].lower()),
        "groups": sorted(({
            "id": record["id"], "n": record["name"], "k": record["ko"], "a": record["aliases"][:4], "d": record["debut"],
            "x": bool(record["disbanded"]), "p": (record["photo"] or {}).get("url", ""),
            "m": len([member for member in record["members"] if not member["end"]]), "ag": [agency["name"] for agency in record["agencies"] if not agency["end"]][:2],
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
        previous = json.loads((OUT / "index.json").read_text()).get("generatedAt", "")
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(previous)).total_seconds() / 86400
    except (OSError, ValueError, TypeError):
        age = None
    if not args.force and age is not None and age < args.max_age_days:
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
