import json, urllib.request
def get(u):
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read())
out = []
d = get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/2/statistics?seasontype=2")
out.append("season " + json.dumps(d.get("season")))
for c in d["results"]["stats"]["categories"]:
    out.append(c["name"] + ": " + ", ".join(f'{s["name"]}={s.get("value")}' for s in c["stats"]))
s = get("https://site.api.espn.com/apis/v2/sports/basketball/nba/standings")
e = s["children"][0]["standings"]["entries"][0]
out.append("standings " + e["team"]["displayName"] + ": " + ", ".join(f'{x["name"]}={x.get("value")}' for x in e["stats"]))
open("scratch-probe/output.txt", "w").write("\n".join(out))
