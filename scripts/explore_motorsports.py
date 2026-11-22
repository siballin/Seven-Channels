"""Temporary: which motorsport data sources answer, and what do they hold?"""
import json, re
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; motorsports channel)"

def get(url, timeout=40):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html;q=0.9"}), timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            headers = dict(r.headers)
            try:
                return r.status, json.loads(body), headers
            except ValueError:
                return r.status, body, headers
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200], {}

def show(label, url, keys=None, n=600):
    status, data, headers = get(url)
    cors = headers.get("Access-Control-Allow-Origin") or headers.get("access-control-allow-origin")
    if isinstance(data, (dict, list)):
        summary = json.dumps(data if keys is None else {k: data.get(k) for k in keys} if isinstance(data, dict) else data[:2])[:n]
    else:
        summary = re.sub(r"\s+", " ", str(data))[:n]
    print(f"\n== {label} [{status}] CORS={cors}\n   {url}\n   {summary}")
    return data

# F1: Jolpica (Ergast successor)
d = show("Jolpica 2026 schedule", "https://api.jolpi.ca/ergast/f1/2026.json", n=900)
show("Jolpica driver standings", "https://api.jolpi.ca/ergast/f1/2026/driverstandings.json", n=700)
show("Jolpica last results", "https://api.jolpi.ca/ergast/f1/current/last/results.json", n=900)
show("OpenF1 sessions", "https://api.openf1.org/v1/sessions?year=2026&session_type=Race", n=500)

# ESPN racing
for slug in ["f1", "nascar-premier", "irl", "imsa", "wec"]:
    show(f"ESPN racing {slug} scoreboard", f"https://site.api.espn.com/apis/site/v2/sports/racing/{slug}/scoreboard", n=700)
show("ESPN NASCAR standings", "https://site.api.espn.com/apis/v2/sports/racing/nascar-premier/standings", n=600)

# NASCAR feeds
show("NASCAR race list", "https://cf.nascar.com/cacher/2026/race_list_basic.json", n=800)
show("NASCAR 2025 race list", "https://cf.nascar.com/cacher/2025/race_list_basic.json", n=400)

# IMSA / WEC (Al Kamel timing)
for label, url in [("IMSA Al Kamel", "https://imsa.results.alkamelcloud.com/"), ("WEC Al Kamel", "https://fiawec.alkamelsystems.com/"),
                   ("IMSA site schedule", "https://www.imsa.com/weathertech/weathertech-2026-schedule/"), ("WEC site calendar", "https://www.fiawec.com/en/calendar/80")]:
    status, data, headers = get(url)
    text = str(data)
    links = re.findall(r'href="([^"]+)"', text)
    print(f"\n== {label} [{status}] len {len(text)}\n   links sample: {[l for l in links if re.search(r'(?i)result|season|20\d\d|csv|json|pdf', l)][:25]}")

# Wikipedia calendars
for title in ["2026_FIA_World_Endurance_Championship", "2026_IMSA_SportsCar_Championship", "2026_NASCAR_Cup_Series", "2026_Formula_One_World_Championship"]:
    status, data, _ = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=sections&format=json&formatversion=2")
    secs = [s["line"] for s in data.get("parse", {}).get("sections", [])][:30] if isinstance(data, dict) else data
    print(f"\n== Wikipedia {title} [{status}] sections: {secs}")
