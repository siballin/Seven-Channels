#!/usr/bin/env python3
"""Build the historical election map data (1980–2024 presidential, 1982–2022 midterms).

Historical results and district lines don't change, so this runs once and its output in
data/elections/ is committed. The 2026 preliminary midterm is refreshed separately by
scripts/update_election_2026.py.

Sources:
- Presidential results by state, 1976–2024: MIT Election Data and Science Lab, "U.S. President
  1976–2024" (Harvard Dataverse, doi:10.7910/DVN/42MVDX, CC0).
- Senate results, 1976–2024: MIT Election Data and Science Lab, "U.S. Senate statewide 1976–2024"
  (doi:10.7910/DVN/PEJ5QU, CC0).
- House results by district, 1976–2018: MIT Election Data and Science Lab, constituency returns
  (github.com/MEDSL/constituency-returns). 2022: FEC "Federal Elections 2022" (official).
- Party divisions of each Congress: U.S. Senate Historical Office and the House Office of the Historian.
- District lines, 1982–2014 (98th–114th Congresses): Lewis, DeVine, Pitcher and Martis, Digital
  Boundary Definitions of U.S. Congressional Districts (github.com/JeffreyBLewis/congressional-district-boundaries).
  2018 and 2022 (116th, 118th): U.S. Census Bureau cartographic boundary files (1:500k). 2026 (120th): Census TIGER/Line.
- State outlines: U.S. Census Bureau cartographic boundary file (2023, 1:20m).

Usage: python3 scripts/build_election_maps.py CACHE_DIR
CACHE_DIR holds the downloads (they're large, so they aren't committed); missing files are fetched.
Map processing uses mapshaper through npx (Node.js required).
"""

from collections import Counter, defaultdict
import csv
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "elections"
USER_AGENT = "SevenChannelsElections/1.0 (+https://siballin.github.io/Seven-Channels/)"
PRESIDENT_YEARS = list(range(1980, 2025, 4))
MIDTERM_YEARS = list(range(1982, 2023, 4))
LEWIS = "https://raw.githubusercontent.com/JeffreyBLewis/congressional-district-boundaries/master/GeoJson/"
DOWNLOADS = {
    "president.csv": "https://dataverse.harvard.edu/api/access/datafile/13887042",
    "senate.csv": "https://dataverse.harvard.edu/api/access/datafile/13887039?format=original",
    "house.csv": "https://raw.githubusercontent.com/MEDSL/constituency-returns/master/1976-2018-house.csv",
    "fec2022.xlsx": "https://www.fec.gov/documents/5676/federalelections2022.xlsx",
    "senate-divisions.html": "https://www.senate.gov/about/parties-leadership/party-division.htm",
    "house-divisions.html": "https://history.house.gov/Institution/Party-Divisions/Party-Divisions/",
    "cb_2023_us_state_20m.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip",
    "cb_2018_us_cd116_500k.zip": "https://www2.census.gov/geo/tiger/GENZ2018/shp/cb_2018_us_cd116_500k.zip",
    "cb_2023_us_cd118_500k.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_cd118_500k.zip",
}
STATES = {
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"), "05": ("AR", "Arkansas"),
    "06": ("CA", "California"), "08": ("CO", "Colorado"), "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"), "12": ("FL", "Florida"), "13": ("GA", "Georgia"), "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"), "17": ("IL", "Illinois"), "18": ("IN", "Indiana"), "19": ("IA", "Iowa"),
    "20": ("KS", "Kansas"), "21": ("KY", "Kentucky"), "22": ("LA", "Louisiana"), "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"), "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"), "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"), "30": ("MT", "Montana"), "31": ("NE", "Nebraska"),
    "32": ("NV", "Nevada"), "33": ("NH", "New Hampshire"), "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"), "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"), "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"), "42": ("PA", "Pennsylvania"), "44": ("RI", "Rhode Island"),
    "45": ("SC", "South Carolina"), "46": ("SD", "South Dakota"), "47": ("TN", "Tennessee"), "48": ("TX", "Texas"),
    "49": ("UT", "Utah"), "50": ("VT", "Vermont"), "51": ("VA", "Virginia"), "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"), "56": ("WY", "Wyoming"),
}
POSTAL = {postal: fips for fips, (postal, _) in STATES.items()}
NAME_TO_POSTAL = {name.lower(): postal for postal, name in STATES.values()}

# Electoral votes that didn't follow the statewide winner: Maine and Nebraska district votes and faithless
# electors. Source: National Archives, Electoral College results by year.
ELECTORAL_EXCEPTIONS = {
    1988: {"WV": {"D": 5, "Bentsen": 1}},
    2000: {"DC": {"D": 2, "Abstained": 1}},
    2004: {"MN": {"D": 9, "Edwards": 1}},
    2008: {"NE": {"R": 4, "D": 1}},
    2016: {"ME": {"D": 3, "R": 1}, "TX": {"R": 36, "Kasich": 1, "Paul": 1},
           "WA": {"D": 8, "Powell": 3, "Spotted Eagle": 1}, "HI": {"D": 3, "Sanders": 1}},
    2020: {"ME": {"D": 3, "R": 1}, "NE": {"R": 4, "D": 1}},
    2024: {"ME": {"D": 3, "R": 1}, "NE": {"R": 4, "D": 1}},
}
# Official electoral vote totals, used to check the allocation above.
ELECTORAL_TOTALS = {
    1980: {"R": 489, "D": 49}, 1984: {"R": 525, "D": 13}, 1988: {"R": 426, "D": 111}, 1992: {"D": 370, "R": 168},
    1996: {"D": 379, "R": 159}, 2000: {"R": 271, "D": 266}, 2004: {"R": 286, "D": 251}, 2008: {"D": 365, "R": 173},
    2012: {"D": 332, "R": 206}, 2016: {"R": 304, "D": 227}, 2020: {"D": 306, "R": 232}, 2024: {"R": 312, "D": 226},
}
# House seats per state by apportionment (Census 1970, 1980, 1990, 2000, 2010, 2020) come from the district
# counts in the House results; electoral votes are seats + 2, and D.C. has 3.


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=300) as response:
        return response.read()


def cached(cache, name, url=None):
    path = cache / name
    if not path.exists():
        print(f"Downloading {name}", flush=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(fetch(url or DOWNLOADS[name]))
    return path


def party_code(text):
    value = (text or "").lower()
    if "democrat" in value or value in ("dfl", "democratic-farmer-labor"):
        return "D"
    if "republican" in value:
        return "R"
    if "libertarian" in value:
        return "L"
    if "independent" in value:
        return "I"
    if "green" in value:
        return "G"
    return "O"


def title_name(name):
    name = re.sub(r"\s+", " ", (name or "").replace('""', '"')).strip()
    if "," in name and name.upper() == name:
        last, first = [part.strip() for part in name.split(",", 1)]
        name = f"{first} {last}"
    if name.upper() == name:
        name = " ".join(word.capitalize() if not re.fullmatch(r"[IVX]+\.?|[A-Z]\.", word) else word for word in name.split())
        name = re.sub(r"\bMc(\w)", lambda m: "Mc" + m.group(1).upper(), name)
    return name


def combine(candidates):
    """Merge fusion-ticket lines (one candidate on several party lines) and sort by votes."""
    merged = {}
    for name, party, votes in candidates:
        key = re.sub(r"[^a-z]", "", name.lower())
        if not key or key in ("na", "blank", "scattering", "scattered", "writein", "writeins", "other", "overvotes", "undervotes", "void"):
            continue
        entry = merged.setdefault(key, {"name": name, "parties": Counter(), "votes": 0})
        entry["votes"] += votes
        entry["parties"][party] += votes
    result = []
    for entry in merged.values():
        parties = entry["parties"]
        item = {"name": entry["name"], "votes": int(entry["votes"])}
        if parties.get("D") is not None and parties.get("R") is not None:
            # Cross-filed on both major tickets (common in Pennsylvania): take the larger line.
            item["party"] = "D" if parties["D"] > parties["R"] else "R"
            if parties["D"] == parties["R"]:
                item["partyTie"] = True  # resolved from Congress.gov where possible
        else:
            item["party"] = "D" if "D" in parties else "R" if "R" in parties else parties.most_common(1)[0][0]
        result.append(item)
    return sorted(result, key=lambda item: item["votes"], reverse=True)


def race_summary(candidates, total=None):
    total = total or sum(item["votes"] for item in candidates)
    winner = candidates[0] if candidates else None
    runner = candidates[1] if len(candidates) > 1 else None
    uncontested = bool(winner) and (winner["votes"] <= 1 or not runner or runner["votes"] == 0)
    tie = bool(candidates and candidates[0].get("partyTie"))
    candidates = [{key: value for key, value in item.items() if key != "partyTie"} for item in candidates]
    shown = candidates[:4]
    others = sum(item["votes"] for item in candidates[4:])
    if others:
        shown = shown + [{"name": "Others", "party": "O", "votes": others}]
    margin = None
    if winner and total and not uncontested:
        margin = round((winner["votes"] - (runner["votes"] if runner else 0)) / total * 100, 2)
    return {**({"_partyTie": True} if tie else {}),
            "winner": winner["party"] if winner else "", "winnerName": winner["name"] if winner else "",
            "margin": margin, "uncontested": uncontested, "total": total if not uncontested else None,
            "candidates": [] if uncontested and winner and winner["votes"] <= 1 else shown}


# ---------- Results ----------

def apportionment(house_rows, fec2022):
    """House seats per state, from the district counts in each year's results."""
    seats = defaultdict(dict)
    for row in house_rows:
        if row["stage"] == "gen":
            seats[int(row["year"])].setdefault(row["state_po"], set()).add(row["district"])
    by_year = {year: {state: len(districts) for state, districts in states.items()} for year, states in seats.items()}
    by_year[2022] = Counter(state for state, _ in fec2022)
    return by_year


def president_results(cache, seats_by_year):
    rows = list(csv.DictReader(open(cached(cache, "president.csv"), encoding="utf-8")))
    years = {}
    for year in PRESIDENT_YEARS:
        # Electoral votes follow the apportionment in force: 1970 for 1980, 1980 for 1984–88, and so on.
        # Use a House election under the same census apportionment whose results list all 435 seats
        # (1996 Texas results are incomplete after a court-ordered redraw).
        house_year = {1980: 1980, 1984: 1984, 1988: 1988, 1992: 1992, 1996: 1994, 2000: 2000, 2004: 2004,
                      2008: 2008, 2012: 2012, 2016: 2016, 2020: 2018, 2024: 2022}[year]
        seats = seats_by_year[house_year]
        if sum(seats.values()) != 435:
            raise ValueError(f"{house_year} House results list {sum(seats.values())} seats, not 435")
        states, national = {}, defaultdict(lambda: {"votes": 0, "ev": 0, "name": ""})
        grouped = defaultdict(list)
        for row in rows:
            if int(row["year"]) == year:
                votes = int(float(row["candidatevotes"] or 0))
                party = party_code(row["party_detailed"])
                grouped[row["state_po"]].append((title_name(row["candidate"]), party if party != "O" else party_code(row["party_simplified"]), votes))
        for state, candidates in grouped.items():
            combined = combine(candidates)
            summary = race_summary(combined)
            ev = 3 if state == "DC" else seats.get(state, 0) + 2
            allocation = ELECTORAL_EXCEPTIONS.get(year, {}).get(state) or {summary["winner"]: ev}
            if sum(allocation.values()) != ev:
                raise ValueError(f"{year} {state}: electoral votes {allocation} don't add up to {ev}")
            states[state] = {**summary, "ev": ev, "evAllocation": allocation}
            for item in combined:
                key = item["party"] if item["party"] in ("D", "R") else item["name"]
                national[key]["votes"] += item["votes"]
                national[key]["party"] = item["party"]
                if item["party"] in ("D", "R") and not national[key]["name"]:
                    national[key]["name"] = item["name"]
                elif item["party"] not in ("D", "R"):
                    national[key]["name"] = item["name"]
            for key, count in allocation.items():
                national[key]["ev"] += count
                national[key].setdefault("party", key if key in ("D", "R") else "O")
                if not national[key]["name"]:
                    national[key]["name"] = key
        totals = {party: national[party]["ev"] for party in ("D", "R")}
        if totals != ELECTORAL_TOTALS[year]:
            raise ValueError(f"{year}: electoral votes {totals} don't match the official totals {ELECTORAL_TOTALS[year]}")
        popular = sum(item["votes"] for item in national.values())
        candidates = sorted(({"name": item["name"], "party": item.get("party", "O"), "votes": item["votes"], "ev": item["ev"],
                              "pct": round(item["votes"] / popular * 100, 2) if popular else None}
                             for item in national.values() if item["votes"] >= popular * 0.005 or item["ev"]),
                            key=lambda item: (item["ev"], item["votes"]), reverse=True)
        years[str(year)] = {"candidates": candidates, "totalVotes": popular, "states": states}
    return years


def senate_class(year):
    return {0: 3, 2: 1, 4: 2}[(year - 2016) % 6]  # 2016 was Class III, 2018 Class I, 2020 Class II


# Changes to a seat's party that aren't in the election data: odd-year special elections and senators
# switching parties. (year, state, class, party). Sources: U.S. Senate Historical Office.
SENATE_SEAT_EVENTS = [
    (1991, "PA", 1, "D"),  # Harris Wofford won the November 1991 special election
    (1993, "TX", 1, "R"),  # Kay Bailey Hutchison won the June 1993 special election
    (1996, "OR", 3, "D"),  # Ron Wyden won the January 1996 special election
    (1995, "AL", 3, "R"),  # Richard Shelby became a Republican (November 9, 1994, after that election)
    (1995, "CO", 3, "R"),  # Ben Nighthorse Campbell became a Republican (March 1995)
    (2001, "VT", 1, "I"),  # Jim Jeffords became an independent (June 2001)
    (2009, "PA", 3, "D"),  # Arlen Specter became a Democrat (April 2009)
    (2013, "MA", 2, "D"),  # Ed Markey won the June 2013 special election
    (2013, "NJ", 2, "D"),  # Cory Booker won the October 2013 special election
    (2017, "AL", 2, "D"),  # Doug Jones won the December 2017 special election
]
# Candidates whose party is missing or recorded as "other" in the source.
SENATE_PARTY_OVERRIDES = {
    (2010, "AK", "lisamurkowski"): "R",  # won as a write-in, as a Republican
    (2022, "AK", "lisamurkowski"): "R",  # party missing in the source (top-four primary ballot)
    (2022, "AK", "kellyctshibaka"): "R",
}


def name_key(name):
    return re.sub(r"[^a-z]", "", (name or "").lower())


def last_name(name):
    words = [word for word in re.sub(r"[^A-Za-z\s-]", " ", name or "").split() if word.lower() not in ("jr", "sr", "ii", "iii", "iv")]
    return words[-1].lower() if words else ""


def senate_results(cache):
    rows = [row for row in csv.DictReader(open(cached(cache, "senate.csv"), encoding="utf-8"))
            if row["stage"].lower() in ("gen", "gen runoff", "runoff")]
    races = defaultdict(lambda: defaultdict(list))
    for row in rows:
        year, state = int(row["year"]), row["state_po"]
        stage = "runoff" if "runoff" in row["stage"].lower() else "gen"
        if year % 2:  # January runoffs (Georgia, 2021) decide the previous year's races
            year, stage = year - 1, "runoff"
        special = row["special"] == "True"
        name = title_name(row["candidate"])
        party = SENATE_PARTY_OVERRIDES.get((year, state, name_key(name))) or party_code(row["party_detailed"]) 
        if party == "O":
            party = party_code(row["party_simplified"])
        races[(year, state, special)][stage].append((name, party, int(float(row["candidatevotes"] or 0))))
    decided = {}
    for key, stages in races.items():
        summary = race_summary(combine(stages["runoff"]) if stages.get("runoff") else combine(stages["gen"]))
        if stages.get("runoff"):
            summary["runoff"] = True
            summary["firstRound"] = race_summary(combine(stages["gen"]))["candidates"]
        decided[key] = summary
    # Each state's two classes, from its regular elections.
    classes = defaultdict(set)
    for year, state, special in decided:
        if not special:
            classes[state].add(senate_class(year))

    def special_class(year, state):
        """A special election's seat: follow the winner to their next regular race, else it's the other seat."""
        # Match on last name: the same person is sometimes listed with and without a middle name.
        winner = last_name(decided[(year, state, True)]["winnerName"])
        for later in range(year, year + 7, 2):
            race = races.get((later, state, False))
            if race and any(last_name(name) == winner for name, _, _ in race["gen"]):
                return senate_class(later)
        regular = senate_class(year)
        return next((cls for cls in classes[state] if cls != regular), regular)

    events = sorted(SENATE_SEAT_EVENTS)
    holder, results = {}, defaultdict(list)
    for year, state, special in sorted(decided, key=lambda key: (key[0], key[2])):
        while events and events[0][0] <= year:
            _, event_state, event_class, party = events.pop(0)
            holder[(event_state, event_class)] = party
        seat_class = special_class(year, state) if special else senate_class(year)
        summary = decided[(year, state, special)]
        previous = holder.get((state, seat_class))
        summary.update(state=state, special=special, seatClass=seat_class, previousParty=previous or "",
                       flip=bool(previous and summary["winner"] and previous != summary["winner"]))
        holder[(state, seat_class)] = summary["winner"]
        if year in MIDTERM_YEARS:
            results[year].append(summary)
    return results


def house_results(cache):
    rows = list(csv.DictReader(open(cached(cache, "house.csv"), encoding="latin-1")))
    # Some rows have no party ("NA"); use the same candidate's party from their other races in that state.
    # Cross-filed candidates appear under both parties in some years, so use the party they ran under most often.
    counts = defaultdict(Counter)
    for row in rows:
        if row["party"] not in ("", "NA"):
            counts[(row["state_po"], name_key(row["candidate"]))][party_code(row["party"])] += 1
    known = {key: tally.most_common(1)[0][0] for key, tally in counts.items()}
    by_year = defaultdict(lambda: defaultdict(list))
    specials = defaultdict(lambda: defaultdict(list))
    unknown_party = set()
    for row in rows:
        if row["stage"] not in ("gen", ""):
            continue
        district = int(row["district"]) if row["district"].isdigit() else 0
        if row["party"] in ("", "NA"):
            party = known.get((row["state_po"], name_key(row["candidate"])), "O")
            unknown_party.add((int(row["year"]), row["state_po"], name_key(title_name(row["candidate"]))))
        else:
            party = party_code(row["party"])
        entry = (title_name(row["candidate"]), party, int(row["candidatevotes"]))
        target = specials if row["special"] == "TRUE" else by_year
        target[int(row["year"])][(row["state_po"], district)].append(entry)
    # Court-ordered redraws (Texas 2006) held November special elections instead of regular races.
    for year, races in specials.items():
        for key, candidates in races.items():
            by_year[year].setdefault(key, candidates)
    results = {}
    for year in MIDTERM_YEARS:
        if year > 2018:
            continue
        districts = {}
        for (state, district), candidates in by_year[year].items():
            districts[f"{state}-{district}"] = race_summary(combine(candidates))
        results[year] = districts
    return results, rows, unknown_party


def congress_member_parties(cache, congress):
    """Representatives who served in a Congress, from Congress.gov: {(state, district): [(last name, party)]}."""
    path = cache / f"congress-members-{congress}.json"
    if not path.exists():
        key = os.environ.get("CONGRESS_GOV_API_KEY", "")
        members, offset = [], 0
        while True:
            url = f"https://api.congress.gov/v3/member/congress/{congress}?format=json&limit=250&offset={offset}&currentMember=false"
            request = Request(url, headers={"User-Agent": USER_AGENT, **({"X-Api-Key": key} if key else {})})
            with urlopen(request, timeout=120) as response:
                data = json.loads(response.read())
            members += data.get("members", [])
            if not (data.get("pagination") or {}).get("next"):
                break
            offset += 250
        path.write_text(json.dumps(members))
    seats = defaultdict(list)
    for member in json.loads(path.read_text()):
        if member.get("district") is None:
            continue
        postal = NAME_TO_POSTAL.get(str(member.get("state", "")).lower())
        party = party_code(member.get("partyName", ""))
        surname = last_name(str(member.get("name", "")).split(",")[0])
        if postal:
            seats[(postal, int(member["district"]))].append((surname, party))
    return seats


def fill_missing_parties(cache, house_by_year, unknown_party, house_rows):
    """Correct House winners' parties that are missing or wrong in the source, using Congress.gov.

    Congress.gov gives a member's latest party, which would mislabel anyone who switched parties later
    (Billy Tauzin won in 1994 as a Democrat and became a Republican in 1995). So a winner's party is only
    changed when it's missing, or when the same candidate ran under Congress.gov's party in their previous
    election (the source sometimes lists unopposed or cross-filed incumbents under the wrong party).
    """
    history = defaultdict(dict)
    for row in house_rows:
        if row["party"] not in ("", "NA") and row["stage"] == "gen":
            history[(row["state_po"], last_name(title_name(row["candidate"])))][int(row["year"])] = party_code(row["party"])
    fixed = 0
    for year, districts in house_by_year.items():
        seats = congress_member_parties(cache, (year - 1788) // 2 + 1)
        for key, race in districts.items():
            tie = race.pop("_partyTie", False)
            state, number = key.split("-")
            surname = last_name(race["winnerName"])
            members = seats.get((state, int(number))) or (seats.get((state, 1)) if int(number) == 0 else None) or []
            official = next((party for name, party in members if name == surname), None)
            if not official or official == race["winner"]:
                continue
            missing = (year, state, name_key(race["winnerName"])) in unknown_party or tie
            record = history.get((state, surname), {})
            previous = record.get(year - 2)
            # A party switch is a clean break (D, D, then R, R). A mislabeled year has the member's real
            # party on both sides of it.
            surrounded = (any(other < year and party == official for other, party in record.items())
                          and any(other > year and party == official for other, party in record.items()))
            if missing or previous == official or surrounded:
                race["winner"] = official
                for candidate in race["candidates"]:
                    if candidate["name"] == race["winnerName"]:
                        candidate["party"] = official
                fixed += 1
    print(f"Corrected {fixed} House winner parties using Congress.gov", flush=True)


def fec_party(code):
    """FEC party codes, including fusion labels like "D/WF" and starred ones like "R*"."""
    parts = re.split(r"[/,]", code.upper().replace("*", ""))
    parts = [part.strip() for part in parts]
    for party, labels in (("D", ("D", "DEM", "DFL")), ("R", ("R", "REP")), ("L", ("L", "LIB")), ("I", ("I", "IND")), ("G", ("G", "GRE"))):
        if any(part in labels for part in parts):
            return party
    return "O"


def fec_house_2022(cache):
    import openpyxl  # only needed for the 2022 FEC workbook
    workbook = openpyxl.load_workbook(cached(cache, "fec2022.xlsx"), read_only=True)
    sheet = workbook["8. US House Results by State"]
    rows = list(sheet.iter_rows(values_only=True))
    header = [str(cell or "").strip().upper() for cell in rows[0]]
    col = {name: header.index(name) for name in header if name}
    races = defaultdict(list)
    winners = {}
    for row in rows[1:]:
        state, district = row[col["STATE ABBREVIATION"]], row[col["DISTRICT"]]
        name = row[col["CANDIDATE NAME"]]
        if not state or not district or not name or str(district).strip().upper().startswith("H"):
            continue
        district = str(district).strip()
        if "unexpired" in district.lower():
            continue  # same-day special for the rest of a vacated term; the map shows the full-term race
        district = re.sub(r"\s*-\s*full term$", "", district, flags=re.I)
        if not re.fullmatch(r"\d{2}", district) or state not in POSTAL or state == "DC":
            continue
        number = int(district)
        party_text = str(row[col["PARTY"]] or "").strip()
        if party_text.lower().startswith("combined"):
            continue  # a fusion candidate's total across party lines; the lines themselves are summed instead
        votes = row[col["GENERAL VOTES"]]
        runoff = row[col["GE RUNOFF ELECTION VOTES (WHEN APPLICABLE)"]]
        if isinstance(runoff, (int, float)):
            votes = runoff
        if isinstance(votes, str) and votes.strip().lower() == "unopposed":
            votes = 1
        if not isinstance(votes, (int, float)):
            continue
        last_first = str(name).strip()
        display = " ".join(reversed([part.strip() for part in last_first.split(",", 1)])) if "," in last_first else last_first
        races[(state, number)].append((display, fec_party(party_text), int(votes)))
        if str(row[col["GE WINNER INDICATOR"]] or "").strip().upper() == "W":
            winners[(state, number)] = display
    districts = {}
    for (state, number), candidates in races.items():
        combined = combine(candidates)
        # Use the FEC's official winner flag (it covers Alaska's ranked-choice count).
        winner = winners.get((state, number))
        if winner:
            combined.sort(key=lambda item: (item["name"] != winner, -item["votes"]))
        at_large = sum(1 for key in races if key[0] == state) == 1
        districts[f"{state}-{0 if at_large else number}"] = race_summary(combined)
    return districts, list(races)


def party_divisions(cache):
    senate_text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cached(cache, "senate-divisions.html").read_text(errors="replace"))))
    senate = {}
    for match in re.finditer(r"(\d+)(?:st|nd|rd|th) Congress \([\d/]+ to [\d/]+\) (\d+) (Republicans|Democrats) (\d+) (Republicans|Democrats) (\d+) (\d+) 100", senate_text):
        values = {match.group(3)[0]: int(match.group(2)), match.group(5)[0]: int(match.group(4))}
        senate[int(match.group(1))] = {"D": values["D"], "R": values["R"], "O": int(match.group(6)), "vacant": int(match.group(7))}
    house_html = cached(cache, "house-divisions.html").read_text(errors="replace")
    house, header = {}, []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", house_html, re.S):
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip() for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if cells and cells[0].startswith("Congress"):
            header = cells
            continue
        match = re.match(r"(\d+)(?:st|nd|rd|th)", cells[0] if cells else "")
        if match and "Democrats" in header and "Republicans" in header:
            number = lambda name: int(re.sub(r"\D", "", cells[header.index(name)]) or 0)
            house[int(match.group(1))] = {"D": number("Democrats"), "R": number("Republicans"), "O": number("Other")}
    for congress in range(97, 120):
        if congress not in senate or congress not in house:
            raise ValueError(f"Party division missing for the {congress}th Congress")
    return senate, house


# ---------- Maps ----------

def run_mapshaper(args):
    subprocess.run(["npx", "--yes", "mapshaper@0.6.102", *args], check=True, stdout=subprocess.DEVNULL)


def lewis_districts(cache, congress, work):
    """District lines for one Congress from the Lewis et al. files, keyed "ST-district"."""
    features = []
    for path in sorted((cache / "lewis").glob("*.geojson")):
        match = re.match(r"(.+)_(\d{3})_to_(\d{3})\.geojson", path.name)
        if not match or not int(match.group(2)) <= congress <= int(match.group(3)):
            continue
        for feature in json.loads(path.read_text())["features"]:
            props = feature["properties"]
            if not int(props["startcong"]) <= congress <= int(props["endcong"]):
                continue
            postal = NAME_TO_POSTAL.get(props["statename"].lower())
            district = int(float(props["district"]))
            if not postal or postal == "DC" or district < 0:
                continue
            features.append({"type": "Feature", "properties": {"key": f"{postal}-{district}"}, "geometry": feature["geometry"]})
    output = work / f"districts-{congress}.geojson"
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return output


def census_districts(sources, field, work, congress):
    """District lines from Census files, keyed "ST-district" (at-large seats are district 0)."""
    output = work / f"districts-{congress}.geojson"
    lookup = "{" + ",".join(f"'{fips}':'{postal}'" for fips, (postal, _) in STATES.items() if postal != "DC") + "}"
    run_mapshaper(["-i", *[str(item) for item in sources], "combine-files", "-merge-layers", "force",
                   "-filter", f"{lookup}[STATEFP] !== undefined && {field} !== 'ZZ' && {field} !== '98'",
                   "-each", f"key={lookup}[STATEFP] + '-' + (+{field})", "-filter-fields", "key",
                   "-o", "format=geojson", str(output)])
    return output


def svg_paths(svg_text, layer):
    group = re.search(rf'<g id="{layer}"[^>]*>(.*?)</g>', svg_text, re.S)
    paths = {}
    for tag in re.findall(r"<path\b[^>]*>", group.group(1) if group else ""):
        key, d = re.search(r'\sid="([^"]+)"', tag), re.search(r'\sd="([^"]+)"', tag)
        if key and d:
            paths[key.group(1)] = (paths.get(key.group(1), "") + " " + d.group(1)).strip()
    return paths


def project_states(cache, work):
    output = work / "states.svg"
    run_mapshaper(["-i", str(cached(cache, "cb_2023_us_state_20m.zip")), "-filter", "+STATEFP <= 56",
                   "-each", "key=STUSPS", "-proj", "albersusa", "-simplify", "8%", "keep-shapes",
                   "-rename-layers", "states", "-o", "format=svg", "id-field=key", "precision=0.1", "width=975", str(output)])
    text = output.read_text()
    return {"viewBox": re.search(r'viewBox="([^"]+)"', text).group(1), "states": svg_paths(text, "states")}


def project_districts(districts_file, work, year):
    """Simplify districts, then dissolve them by state so the state outlines match the district edges exactly."""
    output = work / f"map-{year}.svg"
    # A fixed distance (in projected meters) gives every year the same level of detail, whatever the source resolution.
    run_mapshaper(["-i", str(districts_file), "-proj", "albersusa", "-simplify", "interval=1000", "keep-shapes",
                   "-rename-layers", "districts", "-each", "st=key.split('-')[0]",
                   "-dissolve", "st", "+", "name=states", "-each", "key=st", "target=states",
                   "-o", "format=svg", "id-field=key", "precision=0.1", "width=975", "target=districts,states", str(output)])
    text = output.read_text()
    return {"viewBox": re.search(r'viewBox="([^"]+)"', text).group(1),
            "districts": svg_paths(text, "districts"), "states": svg_paths(text, "states")}


def build_maps(cache, work):
    maps = {"states": project_states(cache, work)}
    census = {116: ("cb_2018_us_cd116_500k.zip", "CD116FP"), 118: ("cb_2023_us_cd118_500k.zip", "CD118FP")}
    for year in [*MIDTERM_YEARS, 2026]:
        congress = (year - 1788) // 2 + 1
        if congress <= 114:
            districts = lewis_districts(cache, congress, work)
        elif congress == 120:
            files = sorted((cache / "cd120").glob("tl_2026_*_cd120.zip"))
            if not files:
                raise FileNotFoundError("Download the 2026 TIGER/Line cd120 files into CACHE_DIR/cd120 first")
            districts = census_districts(files, "CD120FP", work, congress)
        else:
            name, field = census[congress]
            districts = census_districts([cached(cache, name)], field, work, congress)
        maps[year] = project_districts(districts, work, year)
        print(f"{year}: {len(maps[year]['districts'])} districts, {len(maps[year]['states'])} states", flush=True)
    return maps


# ---------- Output ----------

def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    cache = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        house_by_year, house_rows, unknown_party = house_results(cache)
        fill_missing_parties(cache, house_by_year, unknown_party, house_rows)
        fec_districts, fec_seats = fec_house_2022(cache)
        house_by_year[2022] = fec_districts
        seats = apportionment(house_rows, fec_seats)
        president = president_results(cache, seats)
        senate = senate_results(cache)
        senate_div, house_div = party_divisions(cache)
        if os.environ.get("ELECTION_REUSE_MAPS"):  # results-only rebuild; map lines haven't changed
            maps = {"states": json.loads((OUT / "map-states.json").read_text())}
            for year in [*MIDTERM_YEARS, 2026]:
                maps[year] = json.loads((OUT / f"map-districts-{year}.json").read_text())
        else:
            maps = build_maps(cache, work)
        write("map-states.json", maps["states"])
        for year in [*MIDTERM_YEARS, 2026]:
            write(f"map-districts-{year}.json", {"viewBox": maps[year]["viewBox"], "states": maps[year]["states"], "districts": maps[year]["districts"]})
        write("president.json", {"years": president})
        for year in MIDTERM_YEARS:
            congress = (year - 1788) // 2 + 1
            missing = sorted(set(maps[year]["districts"]) - set(house_by_year[year]))
            if missing:
                print(f"{year}: no results for {missing}", flush=True)
            write(f"midterm-{year}.json", {
                "year": year, "congress": congress, "preliminary": False,
                "senate": {"races": senate[year], "before": senate_div[congress - 1], "after": senate_div[congress]},
                "house": {"districts": house_by_year[year], "before": house_div[congress - 1], "after": house_div[congress]},
            })
        write("index.json", {
            "presidentYears": PRESIDENT_YEARS, "midtermYears": [*MIDTERM_YEARS, 2026],
            "sources": [
                {"label": "Presidential and Senate results", "name": "MIT Election Data and Science Lab", "url": "https://electionlab.mit.edu/data"},
                {"label": "House results 1982–2018", "name": "MIT Election Data and Science Lab", "url": "https://github.com/MEDSL/constituency-returns"},
                {"label": "House results 2022", "name": "Federal Election Commission", "url": "https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/federal-elections-2022/"},
                {"label": "Party balance", "name": "U.S. Senate Historical Office and House Office of the Historian",
                 "url": "https://history.house.gov/Institution/Party-Divisions/Party-Divisions/"},
                {"label": "District lines 1982–2014", "name": "Lewis, DeVine, Pitcher and Martis (UCLA)", "url": "https://cdmaps.polisci.ucla.edu/"},
                {"label": "District lines 2018–2026 and state outlines", "name": "U.S. Census Bureau", "url": "https://www.census.gov/geographies/mapping-files.html"},
            ],
        })
        print("Done", flush=True)


if __name__ == "__main__":
    main()
