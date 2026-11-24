import re, time, urllib.request
UA = {"User-Agent": "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/; personal non-commercial fan site)"}
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return getattr(e, "code", 0), str(e)
out = []
for url in ["https://www.sportslogos.net/robots.txt",
            "https://www.sportslogos.net/teams/list_by_league/6/National_Basketball_Association/NBA/logos/"]:
    status, body = get(url)
    out.append(f"===== {url} [{status}] len={len(body)}")
    if "robots" in url:
        out.append(body[:3000])
    else:
        links = sorted(set(re.findall(r'href="([^"]*list_by_team[^"]*)"', body)))
        out.append("team links: " + "\n".join(links[:60]))
    time.sleep(3)
# One team: logos and uniforms pages.
status, body = get("https://www.sportslogos.net/teams/list_by_league/6/National_Basketball_Association/NBA/logos/")
team = next(iter(re.findall(r'href="([^"]*list_by_team/[^"]*Utah[^"]*)"', body)), "")
for url in [team, team.replace("/teams/", "/uniforms/") if team else ""]:
    if not url:
        continue
    url = url if url.startswith("http") else "https://www.sportslogos.net" + url
    time.sleep(3)
    status, body = get(url)
    out.append(f"===== {url} [{status}] len={len(body)}")
    i = body.find("logoWall") if "logoWall" in body else body.find("<ul")
    imgs = re.findall(r'<img[^>]+>', body)
    out.append(f"{len(imgs)} imgs; sample:\n" + "\n".join(imgs[:12]))
    for m in list(re.finditer(r'content\.sportslogos\.net', body))[:3]:
        out.append("CONTEXT: " + body[max(0, m.start() - 600):m.start() + 400].replace("\n", " "))
open("scratch-probe/output.txt", "w").write("\n".join(out))
