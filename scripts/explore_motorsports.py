"""Temporary, round 3: IMSA/WEC navigation, Wikipedia table shapes, Jolpica 2027, and ESPN soccer fixtures."""
import json, re
from pathlib import Path
from urllib.parse import quote, unquote, urlencode
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site)"

def get(url, timeout=40):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            cors = r.headers.get("Access-Control-Allow-Origin")
            try:
                return r.status, json.loads(body), cors
            except ValueError:
                return r.status, body, cors
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:200], None

# ---- IMSA Al Kamel navigation ----
s, html, _ = get("https://imsa.results.alkamelcloud.com/")
if isinstance(html, str):
    anchors = re.findall(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', html, re.S)
    nav = [(unquote(h), re.sub(r"<[^>]+>|\s+", " ", t).strip()) for h, t in anchors if not h.startswith("Results/")]
    print("IMSA nav anchors", nav[:60])
    print("IMSA query params", sorted(set(re.findall(r'[?&](\w+)=', html)))[:20])
    print("IMSA scripts", re.findall(r'<script[^>]*src="([^"]+)"', html)[:10])
    m = re.search(r"(season|evvent|event)[^<]{0,300}", html)
    print("IMSA snippet", m.group(0)[:300] if m else None)
for url in ["https://imsa.results.alkamelcloud.com/?season=26_2026", "https://imsa.results.alkamelcloud.com/Results/26_2026/"]:
    s, body, _ = get(url)
    text = body if isinstance(body, str) else json.dumps(body)
    events = sorted({unquote(l).split("/")[2] for l in re.findall(r'href="(Results/[^"]+)"', text) if len(l.split("/")) > 3})
    print("IMSA", url, s, "events", events[:30], "| WeatherTech links", sum("WeatherTech" in unquote(l) for l in re.findall(r'href="([^"]+)"', text)))

# ---- WEC Al Kamel app ----
s, html, _ = get("https://fiawec.alkamelsystems.com/")
if isinstance(html, str):
    print("\nWEC scripts", re.findall(r'<script[^>]*src="([^"]+)"', html)[:10])
    print("WEC strings", sorted(set(re.findall(r'["\'](/?(?:api|Results|data|json|results)[^"\'\s]{0,100})["\']', html)))[:30])
    print("WEC head", re.sub(r"\s+", " ", html[:1200]))
    for src in re.findall(r'<script[^>]*src="([^"]+)"', html)[:4]:
        full = src if src.startswith("http") else "https://fiawec.alkamelsystems.com/" + src.lstrip("/")
        s2, js, _ = get(full)
        if isinstance(js, str):
            print(" script", src, len(js), sorted(set(re.findall(r'["\'`](/?(?:api|Results|results|data)/[^"\'`\s]{0,100})["\'`]', js)))[:30])

# ---- Wikipedia table shapes and next seasons ----
def section_text(title, name):
    s, d, _ = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=sections&format=json&formatversion=2")
    sections = d.get("parse", {}).get("sections", []) if isinstance(d, dict) else []
    index = next((sec["index"] for sec in sections if sec["line"] == name), None)
    if not index:
        return ""
    s, w, _ = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=wikitext&section={index}&format=json&formatversion=2")
    return w.get("parse", {}).get("wikitext", "") if isinstance(w, dict) else ""
for title, name in [("2026_FIA_World_Endurance_Championship", "Calendar"), ("2026_FIA_World_Endurance_Championship", "Race results"),
                    ("2026_IMSA_SportsCar_Championship", "Schedule"), ("2026_IMSA_SportsCar_Championship", "Race results"),
                    ("2026_FIA_World_Endurance_Championship", "Hypercar World Endurance Drivers' Championship")]:
    text = section_text(title, name)
    print(f"\n--- {title} / {name} ({len(text)} chars)\n{text[:1500]}")
for title in ["2027_FIA_World_Endurance_Championship", "2027_IMSA_SportsCar_Championship", "2027_Formula_One_World_Championship", "2027_NASCAR_Cup_Series"]:
    s, d, _ = get(f"https://en.wikipedia.org/w/api.php?action=parse&page={title}&prop=sections&format=json&formatversion=2")
    print("Wikipedia", title, "exists" if isinstance(d, dict) and "parse" in d else "missing")
s, d, _ = get("https://api.jolpi.ca/ergast/f1/2027.json")
print("Jolpica 2027 races", d.get("MRData", {}).get("total") if isinstance(d, dict) else d)

# ---- ESPN soccer fixtures (saved for tests) ----
out = Path("tests/fixtures/espn-soccer")
out.mkdir(parents=True, exist_ok=True)
def save(name, url):
    s, d, cors = get(url)
    print(f"\nsoccer {name} [{s}] CORS={cors} {url}")
    if isinstance(d, (dict, list)):
        (out / f"{name}.json").write_text(json.dumps(d))
        print("  keys", list(d.keys())[:20] if isinstance(d, dict) else len(d), "size", len(json.dumps(d)))
    else:
        print("  ", str(d)[:200])
    return d
for league in ["eng.1", "usa.1"]:
    tag = league.replace(".", "")
    save(f"{tag}-standings", f"https://site.api.espn.com/apis/v2/sports/soccer/{league}/standings")
    board = save(f"{tag}-scoreboard", f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard")
    done = [e for e in (board.get("events") or []) if e.get("status", {}).get("type", {}).get("completed")] if isinstance(board, dict) else []
    if not done:
        for days in range(1, 21):
            from datetime import date, timedelta
            day = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
            s, b, _ = get(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates={day}")
            done = [e for e in (b.get("events") or []) if e.get("status", {}).get("type", {}).get("completed")] if isinstance(b, dict) else []
            if done:
                (out / f"{tag}-scoreboard-past.json").write_text(json.dumps(b))
                print("  past scoreboard", day, len(done))
                break
    if done:
        summary = save(f"{tag}-summary", f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={done[0]['id']}")
        if isinstance(summary, dict):
            print("  boxscore team stat names", [s.get("name") for s in (summary.get("boxscore", {}).get("teams", [{}])[0].get("statistics") or [])])
            print("  keyEvents sample", json.dumps((summary.get("keyEvents") or [])[:2])[:600])
            print("  rosters", [(r.get("team", {}).get("abbreviation"), r.get("formation"), len(r.get("roster") or [])) for r in summary.get("rosters") or []])
        team_id = done[0]["competitions"][0]["competitors"][0]["team"]["id"]
        save(f"{tag}-team-schedule", f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams/{team_id}/schedule")
        save(f"{tag}-team-stats", f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams/{team_id}/statistics")
    save(f"{tag}-statistics", f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/statistics")
    save(f"{tag}-byathlete", f"https://site.web.api.espn.com/apis/common/v3/sports/soccer/{league}/statistics/byathlete?" + urlencode({"region": "us", "lang": "en", "contentorigin": "espn", "limit": "50", "sort": "general.totalGoals:desc"}))
    save(f"{tag}-teams", f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams")
