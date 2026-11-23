import json, re, urllib.request, urllib.parse
UA = {"User-Agent": "SevenChannelsGames/1.0 (+https://siballin.github.io/Seven-Channels/)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8", "replace")
out = []
for title in ["2026 in video games", "2027 in video games"]:
    text = json.loads(get("https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&formatversion=2&page=" + urllib.parse.quote(title)))["parse"]["wikitext"]
    heads = re.findall(r"^(==+)\s*(.*?)\s*\1\s*$", text, re.M)
    out.append(f"== {title}: " + " | ".join(f"{len(h[0])}:{h[1]}" for h in heads))
    for name in ["Events", "Major events", "Game events", "Notable events", "Conventions", "Trade shows"]:
        m = re.search(r"^==+\s*" + name + r"\s*==+\s*$", text, re.M)
        if m:
            out.append(f"-- section {name}:\n" + text[m.start():m.start() + 5000])
open("probe-output.txt", "w").write("\n\n".join(out))
