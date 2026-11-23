import json, re, urllib.request
UA = {"User-Agent": "SevenChannelsGames/1.0 (+https://siballin.github.io/Seven-Channels/)"}
out = []
def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")
def log(name, fn):
    try:
        out.append(f"== {name}\n{fn()}")
    except Exception as e:
        out.append(f"== {name}\nERROR {e!r}")
log("catalog index head", lambda: get("https://siballin.github.io/Seven-Channels/data/games-catalog/index.json")[:300])
log("catalog detail", lambda: get("https://siballin.github.io/Seven-Channels/data/games-catalog/details-05.json")[:800])
def gp():
    d = json.loads(get("https://www.gamerpower.com/api/giveaways?type=game"))
    return f"{len(d)} items\n" + json.dumps(d[:2], indent=1)[:2500] + "\nplatforms: " + str(sorted({x.get('platforms') for x in d}))
log("gamerpower", gp)
for name, sid in [("all console", "f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e"), ("pc all", "fdd9e2a7-0fee-49f6-ad69-4354098401ff"),
                  ("coming soon", "095bda36-f5cd-43f2-9ee1-0a72f371fb96"), ("leaving soon", "393f05bf-e596-4ef6-9487-6d4fa0eab987"),
                  ("recently added", "f13cf6b4-57e6-4459-89df-6aec18cf0538")]:
    log(f"gamepass {name}", lambda sid=sid: get(f"https://catalog.gamepass.com/sigls/v2?id={sid}&language=en-us&market=US")[:600])
def disp():
    d = json.loads(get("https://catalog.gamepass.com/sigls/v2?id=f13cf6b4-57e6-4459-89df-6aec18cf0538&language=en-us&market=US"))
    ids = [x["id"] for x in d if "id" in x][:3]
    p = json.loads(get(f"https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={','.join(ids)}&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMMp+F.1"))
    prod = p["Products"][0]
    lp = prod["LocalizedProperties"][0]
    return json.dumps({"title": lp.get("ProductTitle"), "images": [(i.get("ImagePurpose"), i.get("Uri")) for i in lp.get("Images", [])][:8], "keys": list(prod.keys())})
log("displaycatalog", disp)
def wiki(title):
    d = json.loads(get("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&formatversion=2&page=" + urllib.parse.quote(title)))
    text = d["parse"]["wikitext"]
    i = text.find("==Events")
    if i < 0: i = text.find("== Events")
    return f"len {len(text)} events at {i}\n" + text[i:i+3500]
import urllib.parse
log("wiki 2026 in video games", lambda: wiki("2026 in video games"))
log("wiki 2027 in video games", lambda: wiki("2027 in video games")[:1500])
open("probe-output.txt", "w").write("\n\n".join(out))
