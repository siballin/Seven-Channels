import json, urllib.request
def get(u):
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read())
out = []
for url in ["https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3", "https://site.api.espn.com/apis/v2/sports/football/nfl/standings"]:
    d = get(url)
    out.append(f"== {url}")
    for conf in d.get("children", []):
        out.append(f"  {conf.get('name')} abbr={conf.get('abbreviation')} entries={len((conf.get('standings') or {}).get('entries', []))} children={len(conf.get('children', []))}")
        for div in conf.get("children", []):
            entries = (div.get("standings") or {}).get("entries", [])
            out.append(f"    {div.get('name')} abbr={div.get('abbreviation')} entries={len(entries)}")
            if entries and div is conf["children"][0]:
                out.append("      stats: " + ", ".join(f"{s['name']}={s.get('displayValue')}" for s in entries[0]["stats"]))
open("scratch-probe/output.txt", "w").write("\n".join(out))
