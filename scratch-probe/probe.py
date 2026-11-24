import json, re, urllib.request, urllib.parse
UA = {"User-Agent": "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/)"}
def get(api, params):
    url = api + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
W = "https://en.wikipedia.org/w/api.php"; C = "https://commons.wikimedia.org/w/api.php"
out = []
for team in ["Utah Jazz", "Chicago Bulls", "Boston Celtics"]:
    text = get(W, {"action": "parse", "page": team, "prop": "wikitext", "section": 0})["parse"]["wikitext"]
    kit = [l for l in text.split("\n") if re.search(r"kit|body|shorts|pattern|uniform|jersey", l, re.I)][:40]
    out.append(f"== {team} infobox kit lines:\n" + "\n".join(kit))
    html = get(W, {"action": "parse", "page": team, "prop": "text", "section": 0})["parse"]["text"]
    i = html.find("Kit_body")
    out.append("html around kit: " + html[max(0, i - 1500):i + 1500].replace("\n", " ") if i >= 0 else "no Kit_body in html")
    for cat in [f"Category:{team} jerseys", f"Category:{team} uniforms", f"Category:{team} kit templates"]:
        m = get(C, {"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": 40})
        out.append(f"   {cat}: " + " | ".join(x["title"] for x in m.get("query", {}).get("categorymembers", [])[:25]))
open("scratch-probe/output.txt", "w").write("\n".join(out))
