import json, urllib.request, urllib.parse
UA = {"User-Agent": "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/)"}
def get(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
out = []
for team in ["Utah Jazz", "Chicago Bulls", "New York Knicks", "Milwaukee Bucks", "Golden State Warriors"]:
    d = get({"action": "query", "list": "search", "srsearch": f'intitle:"{team}" logos', "srnamespace": 14, "srlimit": 10})
    out.append(f"== {team} categories: " + " | ".join(x["title"] for x in d["query"]["search"]))
    for cat in [f"Category:{team} logos", f"Category:Logos of the {team}", f"Category:{team} uniforms"]:
        m = get({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": 50})
        members = m.get("query", {}).get("categorymembers", [])
        out.append(f"   {cat}: {len(members)} " + " | ".join(x["title"] for x in members[:15]))
    nick = team.split()[-1]
    s = get({"action": "query", "list": "search", "srsearch": f'intitle:"{nick}" intitle:logo', "srnamespace": 6, "srlimit": 20})
    out.append(f"   file search: " + " | ".join(x["title"] for x in s["query"]["search"]))
open("scratch-probe/output.txt", "w").write("\n".join(out))
