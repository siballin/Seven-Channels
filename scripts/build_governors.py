#!/usr/bin/env python3
"""Build governor results for every midterm year (data/elections/governors.json).

Source: the race summary table in Wikipedia's "<year> United States gubernatorial elections" article
(text available under CC BY-SA 4.0). For each state it lists the incumbent and party, the result, and every
candidate with party and vote share; the winner is marked. Historical years don't change, so the output is
committed; the current year is refreshed when the site is published and marked preliminary until the article's
results are complete.

Usage: python3 scripts/build_governors.py [YEAR ... | --preliminary]
(default: every midterm year; --preliminary refreshes only years still marked preliminary; keeps earlier data on failure)
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "elections" / "governors.json"
INDEX = ROOT / "data" / "elections" / "index.json"
USER_AGENT = "SevenChannels/1.0 (personal static site; election maps)"
STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT",
    "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI",
    "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN",
    "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}


def party_code(text):
    """D, R, I (independents and third parties that won), or O, from a party name or abbreviation."""
    # Keep link targets too: short labels like [[Independent-Republican|IR]] only say the party in the target.
    value = re.sub(r"\[\[([^|\]]*)\|([^\]]*)\]\]", r"\1 \2", text or "").replace("[[", "").replace("]]", "").strip().lower()
    if re.search(r"\bdemocrat|^d$|^dfl$|farmer.labor", value):
        return "D"
    if re.search(r"\brepublican|^r$|^gop$", value):
        return "R"
    if re.search(r"independent|^i$", value):
        return "I"
    return "O" if value else ""


def strip_links(text):
    text = re.sub(r"\{\{efn[^{}]*\}\}|<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", text or "", flags=re.S)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\{\{(?:small|nowrap)\|([^{}]*)\}\}", r"\1", text)
    text = re.sub(r"'''?|<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_candidates(cell):
    out = []
    for line in re.findall(r"^\*\s*(.+)$", cell, re.M):
        won = "{{aye}}" in line or "'''" in line
        line = line.replace("{{aye}}", "")
        match = re.search(r"^(.*?)\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*([\d.]+)\s*%", line)
        if not match:
            continue
        name, party, pct = strip_links(match.group(1)), match.group(2), float(match.group(3))
        out.append({"name": name, "party": party_code(party), "partyName": strip_links(party)[:40], "pct": pct, "won": won})
    return out


def parse_year(wikitext, year):
    """Races from the article's race summary table: the wikitable with the most rows that list candidates and results.
    (Some years put a ratings table first.)"""
    best = []
    for match in re.finditer(r"\{\|\s*class=\"wikitable", wikitext):
        end = wikitext.find("\n|}", match.start())
        races = parse_table(wikitext[match.start():end])
        if len(races) > len(best):
            best = races
    return best


def parse_table(table):
    races = []
    for row in re.split(r"\n\|-[^\n]*", table):
        head = re.search(r"^!\s*(?:[a-z]+=\"[^\"]*\"\s*)*\|?\s*\[\[([^|\]]+)\|([^\]]+)\]\]", row.strip(), re.M)
        if not head:
            continue
        label = head.group(2).strip()
        state_name = re.sub(r"\s*\(.*\)$", "", label).strip()
        state = STATES.get(state_name)
        if not state:
            continue
        cells = [cell.strip() for cell in re.split(r"\n\|(?!\|)", "\n" + row.strip().split("\n", 1)[1]) if cell.strip()] if "\n" in row.strip() else []
        incumbent = strip_links(cells[0]) if cells else ""
        party_cell = cells[1] if len(cells) > 1 else ""
        shading = re.search(r"party shading/(?:Text/)?([A-Za-z–\-]+)", party_cell)
        incumbent_party = party_code(shading.group(1) if shading else party_cell.split("|")[-1])
        candidates = parse_candidates(row)
        if not candidates:
            continue
        winners = [candidate for candidate in candidates if candidate["won"]]
        winner = winners[0] if winners else None
        ordered = sorted(candidates, key=lambda candidate: -candidate["pct"])
        result_text = strip_links(" ".join(cells[2:4])) if len(cells) > 3 else ""
        runner = next((candidate for candidate in ordered if candidate is not winner), None)
        races.append({
            "state": state,
            "special": "special" in label.lower() or "special" in result_text.lower(),
            "incumbent": incumbent[:80],
            "previousParty": incumbent_party,
            "winner": winner["party"] if winner else "",
            "winnerName": winner["name"][:80] if winner else "",
            "flip": bool(winner and incumbent_party and winner["party"] != incumbent_party),
            "margin": round(winner["pct"] - runner["pct"], 1) if winner and runner else (100.0 if winner else None),
            "uncontested": len(candidates) == 1,
            "candidates": [{key: candidate[key] for key in ("name", "party", "partyName", "pct")} for candidate in ordered[:6]],
        })
    return races


def fetch_article(year):
    title = f"{year}_United_States_gubernatorial_elections"
    url = f"https://en.wikipedia.org/w/api.php?action=parse&page={quote(title)}&prop=wikitext%7Crevid&format=json&formatversion=2"
    for attempt in range(5):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=40) as response:
                data = json.load(response)
            return data["parse"]["wikitext"], data["parse"].get("revid"), title
        except Exception as error:  # Wikipedia rate-limits bursts; wait and retry
            if attempt == 4:
                raise
            print(f"{year}: retrying ({error})", file=sys.stderr)
            time.sleep(10 * (attempt + 1))


def summarize(races):
    gains = {party: sum(1 for race in races if race["flip"] and race["winner"] == party)
             - sum(1 for race in races if race["flip"] and race["previousParty"] == party) for party in ("D", "R")}
    won = {party: sum(1 for race in races if race["winner"] == party) for party in ("D", "R", "I", "O")}
    return {"racesUp": len(races), "won": won, "gains": gains, "flips": sum(1 for race in races if race["flip"])}


def build(years, previous, fetcher=fetch_article, current_year=None):
    current_year = current_year or datetime.now(timezone.utc).year
    out = dict(previous.get("years") or {})
    for year in years:
        try:
            wikitext, revid, title = fetcher(year)
            races = parse_year(wikitext, year)
            if len(races) < 20:
                raise ValueError(f"only {len(races)} races parsed")
        except Exception as error:
            print(f"Governors {year}: keeping previous data ({error})", file=sys.stderr)
            continue
        preliminary = year >= current_year and any(not race["winner"] for race in races)
        out[str(year)] = {"year": year, "preliminary": preliminary or year >= current_year, "races": races, **summarize(races),
                          "source": {"title": title.replace("_", " "), "url": f"https://en.wikipedia.org/wiki/{title}", "revision": revid}}
        time.sleep(3 if fetcher is fetch_article else 0)
    return {"note": "From Wikipedia's race summary tables (CC BY-SA 4.0).", "license": "https://creativecommons.org/licenses/by-sa/4.0/",
            "years": dict(sorted(out.items()))}


def main():
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    if sys.argv[1:] == ["--preliminary"]:
        # Site builds only refresh years still being counted (one Wikipedia request each).
        years = [int(year) for year, entry in (previous.get("years") or {}).items() if entry.get("preliminary")]
        if not years:
            print("Governors: no preliminary years to refresh")
            return
    else:
        years = [int(arg) for arg in sys.argv[1:]] or index["midtermYears"]
    data = build(years, previous)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for year, entry in data["years"].items():
        print(f"{year}: {entry['racesUp']} races, won {entry['won']}, gains {entry['gains']}{' (preliminary)' if entry['preliminary'] else ''}")


if __name__ == "__main__":
    main()
