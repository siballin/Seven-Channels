import json, re, sys
sys.path.insert(0, "scripts")
import build_nba_team_history as h
out = []
for name in ["Utah Jazz", "Chicago Bulls"]:
    index, section = h.find_section(name)
    html, _ = h.section_html(name, index)
    imgs = re.findall(r"<img[^>]+>", html)
    out.append(f"== {name} {section} imgs={len(imgs)}")
    for m in list(re.finditer(r"<img[^>]+>", html))[:6]:
        out.append(html[max(0, m.start() - 700):m.end() + 300].replace("\n", " "))
        out.append("----")
for name in ["Brooklyn Nets", "Denver Nuggets", "Los Angeles Lakers", "Philadelphia 76ers", "Phoenix Suns", "Portland Trail Blazers", "Sacramento Kings", "Washington Wizards"]:
    data = h.fetch_json({"action": "parse", "page": name, "prop": "sections", "redirects": 1})
    out.append(f"== {name}: " + " | ".join(f'{s["index"]}:{s["toclevel"]}:{re.sub("<[^>]+>", "", s["line"])}' for s in data["parse"]["sections"]))
    for title in [f"Logos and uniforms of the {name}", f"{name} logos and uniforms", f"List of {name} logos and uniforms"]:
        d = h.fetch_json({"action": "query", "titles": title, "redirects": 1})
        out.append(f"   {title}: {'missing' if d['query']['pages'][0].get('missing') else 'EXISTS'}")
open("scratch-probe/output.txt", "w").write("\n".join(out))
