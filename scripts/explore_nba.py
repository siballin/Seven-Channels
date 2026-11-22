"""Temporary: ESPN per-season stats lists, and what's in cdechoch/nba-data-archive."""
import json, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; NBA player directory)"

def get(url, timeout=60, raw=False):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=timeout) as r:
            body = r.read()
            return r.status, (body.decode("utf-8", "replace") if raw else json.loads(body))
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200]

base = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
for season in [2026, 2010, 2000, 1997, 1985, 1962, 1950]:
    params = {"region": "us", "lang": "en", "contentorigin": "espn", "isqualified": "false", "page": "1", "limit": "1000",
              "sort": "offensive.avgPoints:desc", "season": str(season), "seasontype": "2"}
    s, d = get(f"{base}?{urlencode(params)}")
    if isinstance(d, dict):
        athletes = d.get("athletes", [])
        top = athletes[0] if athletes else {}
        a = top.get("athlete", {})
        cats = top.get("categories", [])
        print(season, s, "players", len(athletes), "pagination", d.get("pagination"), "top", a.get("displayName"), a.get("id"),
              "| cats", [(c.get("name"), len(c.get("values", []))) for c in cats][:6])
        if season in (2026, 1985):
            print("   categories meta", [(c.get("name"), c.get("names", [])[:20]) for c in d.get("categories", [])][:4])
            print("   athlete keys", sorted(a.keys()))
    else:
        print(season, s, d)
    time.sleep(0.5)

# The open archive
for path in ["per_season/nbastats", "per_season/nbastatsv3", "per_season/cdnnba", "merged"]:
    s, d = get(f"https://huggingface.co/api/datasets/cdechoch/nba-data-archive/tree/main/{path}")
    print("\narchive", path, s, [(f.get("path"), f.get("size")) for f in d[:25]] if isinstance(d, list) else d)
s, d = get("https://huggingface.co/datasets/cdechoch/nba-data-archive/raw/main/README.md", raw=True)
print("\nREADME", s, str(d)[:2500])
