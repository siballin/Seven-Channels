"""Temporary: ESPN coverage of retired players, Wikidata ESPN ids, open NBA datasets."""
import json, time
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; NBA player directory)"

def get(url, timeout=60):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200]

def sparql(q):
    return get("https://query.wikidata.org/sparql?" + urlencode({"query": q, "format": "json"}))

# Wikidata properties: which ids do NBA players carry, and how often?
status, d = sparql("""SELECT ?prop ?label (COUNT(DISTINCT ?p) AS ?n) WHERE {
  ?p wdt:P3647 [] . ?p ?direct [] . ?prop wikibase:directClaim ?direct ; wikibase:propertyType wikibase:ExternalId ; rdfs:label ?label .
  FILTER(LANG(?label) = "en")
} GROUP BY ?prop ?label ORDER BY DESC(?n) LIMIT 40""")
print("Wikidata external ids on NBA players", status)
if isinstance(d, dict):
    for row in d["results"]["bindings"]:
        print("  ", row["prop"]["value"].split("/")[-1], row["label"]["value"], row["n"]["value"])
else:
    print(d)

# ESPN stats for retired legends by known ESPN ids
for name, espn in [("Michael Jordan", 1035), ("Larry Bird", 1543), ("Magic Johnson", 1600), ("Kobe Bryant", 110), ("Shaquille O'Neal", 614), ("Tim Duncan", 215)]:
    s, d = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{espn}/stats?region=us&lang=en&contentorigin=espn")
    if isinstance(d, dict):
        cats = {c.get("name"): c for c in d.get("categories", [])}
        avg = cats.get("averages", {})
        seasons = [row.get("season", {}).get("displayName") for row in avg.get("statistics", [])]
        print(f"ESPN {name} {espn}: {s} seasons {len(seasons)} {seasons[:1]}..{seasons[-1:]} career PTS avg {(avg.get('totals') or ['?'])[-1]}")
    else:
        print(f"ESPN {name} {espn}: {s} {d}")
    s, d = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{espn}?region=us&lang=en&contentorigin=espn")
    if isinstance(d, dict):
        a = d.get("athlete", {})
        print("   ", a.get("displayName"), a.get("displayDraft"), (a.get("position") or {}).get("abbreviation"), a.get("displayDOB"), (a.get("headshot") or {}).get("href"))
    time.sleep(0.4)

# Older eras: Wilt Chamberlain / Bill Russell / George Mikan ESPN ids via Wikidata (if the property exists)
status, d = sparql("""SELECT ?p ?pLabel ?espn WHERE { VALUES ?p { wd:Q15711 wd:Q312936 wd:Q311025 wd:Q41421 } OPTIONAL { ?p wdt:P3685 ?espn } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }""")
print("\nlegends P3685", status, [(r["pLabel"]["value"], r.get("espn", {}).get("value")) for r in d["results"]["bindings"]] if isinstance(d, dict) else d)

# Open datasets
for query in ["nba", "basketball"]:
    s, d = get(f"https://huggingface.co/api/datasets?search={query}&limit=40&sort=downloads")
    print(f"\nHF datasets '{query}'", s)
    if isinstance(d, list):
        for item in d:
            print("  ", item["id"], item.get("lastModified", "")[:10], "downloads", item.get("downloads"), [t for t in item.get("tags", []) if t.startswith("license:")])
