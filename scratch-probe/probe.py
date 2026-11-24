import json, re, urllib.request, urllib.parse
UA = {"User-Agent": "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/)"}
def get(api, params):
    url = api + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
W = "https://en.wikipedia.org/w/api.php"; C = "https://commons.wikimedia.org/w/api.php"
out = []
html = get(W, {"action": "parse", "page": "Chicago Bulls", "prop": "text", "section": 0})["parse"]["text"]
i = html.find('<table class="kit">')
j = html.find("</table>", i)
out.append("KIT TABLE:\n" + html[i:j + 8])
for team in ["Chicago Bulls", "Boston Celtics", "Utah Jazz", "Golden State Warriors", "Detroit Pistons", "Washington Wizards"]:
    for part in ["body", "shorts"]:
        files, cont = [], {}
        while True:
            m = get(C, {"action": "query", "list": "categorymembers", "cmtitle": f"Category:Basketball kit {part}/{team}", "cmlimit": 500, "cmtype": "file", **cont})
            files += [x["title"] for x in m.get("query", {}).get("categorymembers", [])]
            if "continue" not in m: break
            cont = m["continue"]
        out.append(f"== {team} {part}: {len(files)}: " + " | ".join(files[:60]))
open("scratch-probe/output.txt", "w").write("\n".join(out))
