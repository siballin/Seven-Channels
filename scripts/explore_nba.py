"""Temporary: can ESPN list every player season by season (with ids), back to the 1940s?"""
import json, time
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; NBA player directory)"

def get(url, timeout=60):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200]

core = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
for year in [2026, 1998, 1985, 1970, 1960, 1950, 1947]:
    s, d = get(f"{core}/seasons/{year}/athletes?limit=1000")
    if isinstance(d, dict):
        refs = [item.get("$ref", "") for item in d.get("items", [])]
        print(year, s, "count", d.get("count"), "pages", d.get("pageCount"), "sample", refs[:2])
    else:
        print(year, s, d)
    time.sleep(0.3)

# A season athlete record (bio for that season)
s, d = get(f"{core}/seasons/1985/athletes/1035")
print("\nseason athlete 1985/1035", s, json.dumps({k: d.get(k) for k in ("id", "displayName", "position", "draft", "debutYear", "dateOfBirth", "headshot", "statistics", "team")} if isinstance(d, dict) else d)[:900])

# Legends by searching the 1985 / 1962 / 1960 rosters
for year, names in [(1985, ["Larry Bird", "Magic Johnson", "Kareem Abdul-Jabbar"]), (1962, ["Wilt Chamberlain", "Bill Russell"]), (1950, ["George Mikan"])]:
    s, d = get(f"{core}/seasons/{year}/athletes?limit=1000")
    if not isinstance(d, dict):
        print(year, s, d); continue
    ids = [item["$ref"].split("/athletes/")[1].split("?")[0] for item in d.get("items", [])]
    found = {}
    for athlete in ids:
        s2, a = get(f"{core}/seasons/{year}/athletes/{athlete}")
        if isinstance(a, dict) and a.get("displayName") in names:
            found[a["displayName"]] = athlete
            if len(found) == len(names):
                break
    print(year, found, "(scanned", len(ids), ")")
    for name, athlete in found.items():
        s3, st = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athlete}/stats?region=us&lang=en&contentorigin=espn")
        if isinstance(st, dict):
            avg = next((c for c in st.get("categories", []) if c.get("name") == "averages"), {})
            seasons = [row.get("season", {}).get("displayName") for row in avg.get("statistics", [])]
            print("   ", name, athlete, "seasons", len(seasons), seasons[:1], seasons[-1:], "labels", avg.get("labels"), "career", avg.get("totals"))
            if avg.get("statistics"):
                print("     first season row", avg["statistics"][0].get("stats"), "team", avg["statistics"][0].get("teamSlug"), avg["statistics"][0].get("teamId"))
        else:
            print("   ", name, athlete, s3, st)

s, d = get("https://huggingface.co/api/datasets/cdechoch/nba-data-archive/tree/main?recursive=true")
print("\ncdechoch/nba-data-archive", s, [(f.get("path"), f.get("size")) for f in d[:40]] if isinstance(d, list) else d)
s, d = get("https://huggingface.co/datasets/cdechoch/nba-data-archive/raw/main/README.md")
