#!/usr/bin/env python3
"""Summarize every midterm (data/elections/midterm-*.json) into data/elections/midterm-summary.json.

For each midterm: the sitting president and party, House and Senate seat changes (overall and for the
president's party), House votes by party with each party's share and the margin, and Senate seats that changed
party. Everything is computed from the result files already in the site, so it matches the maps.
House vote totals are the sum of the district results in the data; some states don't report votes for
unopposed candidates, so these are the votes counted here, not an official national popular vote.
Preliminary years (still being counted) are marked, and their House votes are left out when the data has none.
"""

import json
from pathlib import Path
import re

ELECTIONS = Path(__file__).resolve().parents[1] / "data" / "elections"
OUTPUT = ELECTIONS / "midterm-summary.json"


# Ballot-style names in the results (e.g. "Joseph R. Jr Biden") shown the usual way.
COMMON_NAMES = {"George H.w. Bush": "George H. W. Bush", "Barack H. Obama": "Barack Obama", "Joseph R. Jr Biden": "Joe Biden",
                "Donald J. Trump": "Donald Trump"}


def winner_of(year_data):
    """The presidential winner by electoral votes."""
    leader = max(year_data.get("candidates") or [], key=lambda candidate: candidate.get("ev") or 0, default=None)
    return {"name": COMMON_NAMES.get(leader["name"], leader["name"]), "party": leader["party"]} if leader else None


def previous_party(race):
    """The party that held a seat before. Preliminary results only mark flips, so a flip between the two major
    parties implies the other one held it."""
    if race.get("previousParty"):
        return race["previousParty"]
    if race.get("flip") and race.get("winner") in ("D", "R"):
        return "R" if race["winner"] == "D" else "D"
    return ""


def seats(block, key):
    data = block.get(key) or {}
    return {party: int(data.get(party) or 0) for party in ("D", "R", "O", "I") if data.get(party)}


def summarize(midterm, president):
    house, senate = midterm["house"], midterm["senate"]
    preliminary = bool(midterm.get("preliminary"))
    party = (president or {}).get("party", "")
    entry = {"year": midterm["year"], "congress": midterm.get("congress"), "preliminary": preliminary, "president": president}

    house_after = seats(house, "called" if preliminary else "after")
    house_before = seats(house, "before")
    votes = {"D": 0, "R": 0, "O": 0}
    for district in (house.get("districts") or {}).values():
        for candidate in district.get("candidates") or []:
            votes[candidate.get("party") if candidate.get("party") in ("D", "R") else "O"] += int(candidate.get("votes") or 0)
    total = sum(votes.values())
    entry["house"] = {
        "before": house_before, "after": house_after, "uncalled": int(house.get("uncalled") or 0) if preliminary else 0,
        # In preliminary years these compare the seats called so far with the seats held before.
        "change": {p: house_after.get(p, 0) - house_before.get(p, 0) for p in ("D", "R")},
        "presidentPartyChange": (house_after.get(party, 0) - house_before.get(party, 0)) if party else None,
        "votes": {**votes, "total": total} if total else None,
        "share": {p: round(votes[p] / total * 100, 1) for p in ("D", "R")} if total else None,
        "uncontested": sum(1 for district in (house.get("districts") or {}).values() if district.get("uncontested")),
    }

    races = senate.get("races") or []
    flips = [{"state": race["state"], "from": previous_party(race), "to": race.get("winner") or "", "special": bool(race.get("special"))}
             for race in races if race.get("flip")]
    senate_before = seats(senate, "before")
    senate_after = seats(senate, "after") if not preliminary else None
    gains = {p: sum(1 for flip in flips if flip["to"] == p) - sum(1 for flip in flips if flip["from"] == p) for p in ("D", "R")}
    entry["senate"] = {
        "before": senate_before, "after": senate_after, "racesUp": len(races),
        "change": {p: senate_after.get(p, 0) - senate_before.get(p, 0) for p in ("D", "R")} if senate_after else None,
        # Preliminary years have no final balance yet, so the president's party change comes from the seats that flipped.
        "presidentPartyChange": (senate_after.get(party, 0) - senate_before.get(party, 0)) if party and senate_after else (gains.get(party) if party else None),
        "flips": flips, "flipGains": gains,
    }
    return entry


def build(elections=ELECTIONS):
    index = json.loads((elections / "index.json").read_text(encoding="utf-8"))
    presidents = json.loads((elections / "president.json").read_text(encoding="utf-8"))["years"]
    years = []
    for year in index["midtermYears"]:
        path = elections / f"midterm-{year}.json"
        if not path.exists():
            continue
        midterm = json.loads(path.read_text(encoding="utf-8"))
        president = winner_of(presidents.get(str(year - 2), {}))
        years.append(summarize(midterm, president))
    # Swing in the House vote margin (D minus R) from the previous midterm.
    previous = None
    for entry in years:
        share = entry["house"]["share"]
        margin = round(share["D"] - share["R"], 1) if share else None
        entry["house"]["margin"] = margin
        entry["house"]["swing"] = round(margin - previous, 1) if margin is not None and previous is not None else None
        if margin is not None:
            previous = margin
    return {"years": years, "note": "House votes are summed from district results in this data; some states don't report votes for unopposed candidates."}


def main():
    summary = build()
    OUTPUT.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Midterm summary: {len(summary['years'])} midterms")


if __name__ == "__main__":
    main()
