"""Temporary: what historical NBA player data can GitHub Actions reach?"""
import json, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; NBA player directory)"

def get(url, headers=None, timeout=40):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})}), timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200]

# 1. ESPN core athletes list (does it include retired players?)
status, data = get("https://sports.core.api.espn.com/v3/sports/basketball/nba/athletes?limit=1000&page=1")
print("ESPN v3 athletes", status, {k: data[k] for k in ("count", "pageIndex", "pageSize", "pageCount")} if isinstance(data, dict) else data)
if isinstance(data, dict):
    items = data.get("items", [])
    print(" sample", json.dumps(items[:2])[:700])
    print(" keys", sorted({k for i in items for k in i}))
    print(" active", sum(1 for i in items if i.get("active")), "of", len(items))
legends = {}
if isinstance(data, dict):
    pages = data.get("pageCount", 1)
    every = list(data.get("items", []))
    for page in range(2, min(pages, 25) + 1):
        s, d = get(f"https://sports.core.api.espn.com/v3/sports/basketball/nba/athletes?limit=1000&page={page}")
        if isinstance(d, dict):
            every += d.get("items", [])
    print(" total fetched", len(every), "active", sum(1 for i in every if i.get("active")))
    for name in ["Michael Jordan", "Wilt Chamberlain", "Bill Russell", "Kareem Abdul-Jabbar", "George Mikan", "Larry Bird", "Kobe Bryant", "LeBron James", "Victor Wembanyama", "Cooper Flagg"]:
        hit = [i for i in every if (i.get("displayName") or i.get("fullName")) == name]
        print("  ", name, [(i.get("id"), i.get("active")) for i in hit])
        if hit:
            legends[name] = hit[0]["id"]

# 2. ESPN career stats for retired players
for name, athlete in list(legends.items())[:6]:
    s, d = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athlete}/stats?region=us&lang=en&contentorigin=espn")
    if not isinstance(d, dict):
        print("stats", name, s, d); continue
    print(f"\nstats {name} ({athlete}) {s}")
    for cat in d.get("categories", []):
        seasons = [row.get("season", {}).get("displayName") for row in cat.get("statistics", [])]
        print("  cat", cat.get("name"), "labels", cat.get("labels"), "seasons", len(seasons), seasons[:2], seasons[-1:], "totals", cat.get("totals"))
    s, d = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athlete}?region=us&lang=en&contentorigin=espn")
    if isinstance(d, dict):
        a = d.get("athlete", {})
        print("  bio keys", sorted(a.keys())[:60])
        print("  draft", a.get("draft"), "| headshot", (a.get("headshot") or {}).get("href"), "| position", (a.get("position") or {}).get("abbreviation"), "| awards", str(a.get("awards"))[:200])
    time.sleep(0.5)

# 3. Wikidata NBA players
q = """SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p wdt:P3647 ?nba . }"""
print("\nWikidata NBA.com ID", get("https://query.wikidata.org/sparql?" + urlencode({"query": q, "format": "json"}))[1])
q = """SELECT ?prop ?label WHERE { ?prop a wikibase:Property ; rdfs:label ?label . FILTER(LANG(?label) = "en" && CONTAINS(LCASE(?label), "espn")) }"""
status, d = get("https://query.wikidata.org/sparql?" + urlencode({"query": q, "format": "json"}))
if isinstance(d, dict):
    for row in d["results"]["bindings"]:
        print("  ", row["prop"]["value"].split("/")[-1], row["label"]["value"])

# 4. NBA.com stats API
status, d = get("https://stats.nba.com/stats/commonallplayers?" + urlencode({"LeagueID": "00", "Season": "2025-26", "IsOnlyCurrentSeason": "0"}),
                {"Referer": "https://www.nba.com/", "Origin": "https://www.nba.com", "x-nba-stats-origin": "stats", "x-nba-stats-token": "true"}, timeout=25)
print("\nstats.nba.com", status, (str(d)[:300] if not isinstance(d, dict) else [len(r["rowSet"]) for r in d.get("resultSets", [])]))
