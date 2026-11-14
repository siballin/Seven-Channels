#!/usr/bin/env python3
"""Refresh the preliminary 2026 midterm results shown on the election maps.

There is no official or academic compilation of 2026 results yet (states certify through December and
federal compilations follow months later), so this reads Wikipedia's House and Senate election articles,
which volunteers update as races are called. The page labels this data as preliminary and from Wikipedia
(text available under CC BY-SA 4.0). Before-election party balances come from the Senate Historical Office
and the House Office of the Historian.

If Wikipedia can't be read or the tables look incomplete, the previous file is kept.
"""

from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_election_maps as maps  # noqa: E402  (shared state names and party-division parser)

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "elections" / "midterm-2026.json"
USER_AGENT = "SevenChannelsElections/1.0 (+https://siballin.github.io/Seven-Channels/)"
API = "https://en.wikipedia.org/w/api.php"
PAGES = {"house": "2026_United_States_House_of_Representatives_elections", "senate": "2026_United_States_Senate_elections"}
PARTIES = {"democratic": "D", "dfl": "D", "democratic-npl": "D", "democratic–npl": "D", "republican": "R",
           "libertarian": "L", "green": "G", "independent": "I"}


def fetch_page(title, attempts=3):
    query = urlencode({"action": "parse", "page": title, "prop": "text|revid", "format": "json", "formatversion": 2})
    for attempt in range(attempts):
        try:
            with urlopen(Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT}), timeout=90) as response:
                data = json.loads(response.read())["parse"]
            return data["text"], data["revid"]
        except HTTPError as error:
            # Wikipedia rate-limits busy clients; wait as long as it asks before trying again.
            if error.code != 429 or attempt == attempts - 1:
                raise
            wait = error.headers.get("Retry-After", "")
            time.sleep(min(int(wait) if wait.isdigit() else 30, 120))


def plain(fragment):
    fragment = re.sub(r"<sup\b.*?</sup>", "", fragment, flags=re.S)
    fragment = re.sub(r"<(style|link)\b[^>]*?(/>|>.*?</\1>)", "", fragment, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def party_of(label):
    """'(Democratic)', '(Republican/Cons.)', '(DFL)' -> party code."""
    first = re.split(r"[/,]", label.strip().lower())[0].strip()
    return PARTIES.get(first, "O")


def parse_candidates(cell):
    candidates = []
    for item in re.findall(r"<li\b[^>]*>(.*?)</li>", cell, re.S):
        winner = "Green_check" in item or re.search(r">\s*Y\s*</span>", item) is not None
        text = plain(re.sub(r'<span style="display:none">Y</span>', "", item)).replace("▌", "").strip()
        match = re.match(r"(.+?)\s*\(([^)]+)\)\s*(?:([\d.]+)\s*%)?", text)
        if not match:
            continue
        name, party, pct = match.group(1).strip(), party_of(match.group(2)), match.group(3)
        if name.lower() in ("others", "other"):
            continue
        candidates.append({"name": name, "party": party, **({"pct": float(pct)} if pct else {}), **({"won": True} if winner else {})})
    return candidates


def parse_rows(page_html, header_word):
    """Yield (label, result text, candidates) for each race row in tables that list candidates."""
    for table in re.findall(r'<table class="wikitable[^"]*"[^>]*>.*?</table>', page_html, re.S):
        head = plain(table[:3000])
        if "Candidate" not in head or header_word not in head:
            continue
        for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", table, re.S):
            cells = re.findall(r"<t([hd])\b[^>]*>(.*?)</t[hd]>", row, re.S)
            if len(cells) < 3 or "<li" not in cells[-1][1]:
                continue
            label = plain(cells[0][1])
            result = next((plain(cell) for _, cell in cells if re.search(r"\b(gain|hold|re-elected|elected|advanced|runoff)\b", plain(cell), re.I)), "")
            yield label, result, parse_candidates(cells[-1][1])


def summarize(result, candidates):
    winner = next((item for item in candidates if item.get("won")), None)
    called = winner is not None
    gain = re.search(r"\b(Democratic|Republican|Independent)\b[^.]*\bgain\b", result, re.I)
    with_pct = sorted((item for item in candidates if "pct" in item), key=lambda item: -item["pct"])
    margin = round(with_pct[0]["pct"] - with_pct[1]["pct"], 1) if called and len(with_pct) >= 2 and with_pct[0] is winner else None
    return {
        "called": called,
        "winner": winner["party"] if winner else "",
        "winnerName": winner["name"] if winner else "",
        "margin": margin,
        "flip": bool(called and gain),
        "uncontested": called and len(candidates) == 1,
        "result": result[:200],
        "candidates": [{key: value for key, value in item.items() if key != "won"} for item in candidates[:5]],
    }


def house_races(page_html):
    districts = {}
    for label, result, candidates in parse_rows(page_html, "District"):
        match = re.match(r"(.+?)\s+(at-large|\d+)$", label.replace(" ", " "))
        if not match:
            continue
        postal = maps.NAME_TO_POSTAL.get(match.group(1).strip().lower())
        if not postal or postal == "DC":
            continue  # territories and D.C. elect non-voting delegates
        number = 0 if match.group(2) == "at-large" else int(match.group(2))
        districts[f"{postal}-{number}"] = summarize(result, candidates)
    return districts


def senate_races(page_html):
    races = []
    for label, result, candidates in parse_rows(page_html, "State"):
        match = re.match(r"(.+?)(?:\s*\(Class (\d)\))?$", label)
        postal = maps.NAME_TO_POSTAL.get(match.group(1).strip().lower()) if match else None
        if not postal:
            continue
        seat_class = int(match.group(2)) if match and match.group(2) else 2
        races.append({"state": postal, "special": seat_class != 2, "seatClass": seat_class, **summarize(result, candidates)})
    return races


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    try:
        house_html, house_rev = fetch_page(PAGES["house"])
        senate_html, senate_rev = fetch_page(PAGES["senate"])
        districts, races = house_races(house_html), senate_races(senate_html)
        if len(districts) < 430 or len(races) < 30:
            raise ValueError(f"Tables look incomplete: {len(districts)} House districts, {len(races)} Senate races")
        with tempfile.TemporaryDirectory() as folder:
            senate_div, house_div = maps.party_divisions(Path(folder))
    except Exception as error:
        print(f"2026 refresh failed; keeping the previous file: {error}", file=sys.stderr)
        return
    tally = lambda items: {party: sum(1 for item in items if item["called"] and item["winner"] == party) for party in ("D", "R", "I", "O")}
    output = {
        "year": 2026, "congress": 120, "preliminary": True,
        "source": {
            "name": "Wikipedia", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            "fetchedAt": now,
            "pages": [{"title": title.replace("_", " "), "url": f"https://en.wikipedia.org/wiki/{title}", "revision": rev}
                      for title, rev in ((PAGES["house"], house_rev), (PAGES["senate"], senate_rev))],
        },
        "senate": {"races": races, "before": senate_div[119], "called": tally(races),
                   "uncalled": sum(1 for race in races if not race["called"])},
        "house": {"districts": districts, "before": house_div[119], "called": tally(districts.values()),
                  "uncalled": sum(1 for race in districts.values() if not race["called"])},
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"2026: {len(districts)} House districts ({output['house']['uncalled']} uncalled), "
          f"{len(races)} Senate races ({output['senate']['uncalled']} uncalled)")


if __name__ == "__main__":
    main()
