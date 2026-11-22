"""Temporary, round 2: NASCAR results, IMSA CSV columns, WEC data endpoints, next-season calendars."""
import json, re
from urllib.parse import quote, unquote
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; motorsports channel)"

def get(url, timeout=40):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(body)
            except ValueError:
                return r.status, body
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200]

# NASCAR: race list fields, and a race's weekend feed
s, d = get("https://cf.nascar.com/cacher/2026/race_list_basic.json")
cup = d.get("series_1", []) if isinstance(d, dict) else []
print("NASCAR series keys", list(d.keys()) if isinstance(d, dict) else d, "cup races", len(cup))
if cup:
    print(" race fields", sorted(cup[0].keys()))
    done = [r for r in cup if r.get("winner_driver_id")]
    last = done[-1] if done else cup[0]
    print(" last done", {k: last.get(k) for k in ("race_id", "race_name", "track_name", "race_date", "winner_driver_id", "winner_driver_name", "pole_winner_driver_id", "playoff_round", "race_type_id")})
    s, w = get(f"https://cf.nascar.com/cacher/2026/1/{last['race_id']}/weekend-feed.json")
    if isinstance(w, dict):
        print(" weekend keys", list(w.keys()))
        race = (w.get("weekend_race") or [{}])[0]
        print(" weekend_race keys", sorted(race.keys())[:60])
        res = race.get("results") or []
        print(" results", len(res), json.dumps(res[:1])[:700])
    else:
        print(" weekend", s, w)
for path in ["2026/1/final/1-drivers-points.json", "2026/1/racinginsights-points-feed.json", "2026/1/points-feed.json"]:
    s, p = get(f"https://cf.nascar.com/cacher/{path}")
    print(" points", path, s, (json.dumps(p)[:300] if not isinstance(p, str) else p[:120]))
s, d27 = get("https://cf.nascar.com/cacher/2027/race_list_basic.json")
print("NASCAR 2027", s, len(d27.get("series_1", [])) if isinstance(d27, dict) else d27)

# IMSA Al Kamel: what series/events are listed for 2026, and a WeatherTech race CSV
s, html = get("https://imsa.results.alkamelcloud.com/")
links = [unquote(l) for l in re.findall(r'href="(Results/[^"]+)"', html if isinstance(html, str) else "")]
print("\nIMSA links", len(links))
series = sorted({l.split("/")[3] for l in links if len(l.split("/")) > 4})
events = sorted({l.split("/")[2] for l in links if len(l.split("/")) > 3})
print(" seasons", sorted({l.split("/")[1] for l in links}), "\n events", events[:40], "\n series", series[:40])
selects = re.findall(r'<select[^>]*id="([^"]+)"[^>]*>(.*?)</select>', html, re.S) if isinstance(html, str) else []
for sid, body in selects:
    print(" select", sid, re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', body)[:30])
print(" forms/params", set(re.findall(r'\?(\w+)=', html))[:20] if isinstance(html, str) else "")
wt = [l for l in links if "WeatherTech" in l and "Race" in l and l.endswith(".csv") and "03_Results" in l]
print(" weathertech race csvs", wt[:5])
if wt:
    s, csv = get("https://imsa.results.alkamelcloud.com/" + quote(wt[0]))
    print(" csv", s, (csv[:900] if isinstance(csv, str) else csv))

# WEC Al Kamel app: scripts and api paths
s, html = get("https://fiawec.alkamelsystems.com/")
if isinstance(html, str):
    print("\nWEC scripts", re.findall(r'<script[^>]*src="([^"]+)"', html)[:10])
    print(" api-like", sorted(set(re.findall(r'["\'](/?(?:api|Results|data|json)[^"\']{0,120})["\']', html)))[:30])
    print(" head", re.sub(r"\s+", " ", html[:1500]))

# Next-season calendars
s, d = get("https://api.jolpi.ca/ergast/f1/2027.json")
print("\nJolpica 2027", s, d.get("MRData", {}).get("total") if isinstance(d, dict) else d)
for title in ["2027_FIA_World_Endurance_Championship", "2027_IMSA_SportsCar_Championship", "2027_Formula_One_World_Championship", "2027_NASCAR_Cup_Series"]:
    s, d = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=sections&format=json&formatversion=2")
    print("Wikipedia", title, s, "exists" if isinstance(d, dict) and "parse" in d else (d.get("error", {}).get("code") if isinstance(d, dict) else d))

# Wikipedia table shapes: WEC calendar + results, IMSA results
for title, section_name in [("2026_FIA_World_Endurance_Championship", "Calendar"), ("2026_FIA_World_Endurance_Championship", "Race results"), ("2026_IMSA_SportsCar_Championship", "Race results"), ("2026_IMSA_SportsCar_Championship", "Schedule")]:
    s, d = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=sections&format=json&formatversion=2")
    sections = d.get("parse", {}).get("sections", []) if isinstance(d, dict) else []
    index = next((sec["index"] for sec in sections if sec["line"] == section_name), None)
    if index:
        s, w = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=wikitext&section={index}&format=json&formatversion=2")
        text = w.get("parse", {}).get("wikitext", "") if isinstance(w, dict) else ""
        print(f"\n{title} / {section_name} ({len(text)} chars)\n{text[:1800]}")
