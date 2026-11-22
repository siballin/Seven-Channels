#!/usr/bin/env python3
"""Build the Motorsports channel data (data/motorsports/{f1,nascar,imsa,wec}.json and summary.json).

Sources
- F1: Jolpica (the open successor to the Ergast API): calendar with session times, race and sprint results,
  driver and constructor standings.
- NASCAR: NASCAR's public feeds (cf.nascar.com): Cup, O'Reilly Auto Parts and Truck schedules with session
  times, full results (start, laps led, status, points, stage winners) and points standings.
- IMSA and WEC: the season articles on English Wikipedia (CC BY-SA 4.0): calendar, class winners per round and
  class drivers' standings. Al Kamel's timing sites don't offer a usable index for either series.

Each series is built separately; one that fails keeps its previous file. Results of finished races are reused
from the previous file, so only new races are fetched.

Usage: python3 scripts/update_motorsports.py [--year 2026]
"""

from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from countries import country_code  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "motorsports"
USER_AGENT = "SevenChannels/1.0 (personal static site; motorsports channel)"
JOLPICA = "https://api.jolpi.ca/ergast/f1"
NASCAR = "https://cf.nascar.com/cacher"
WIKIPEDIA = "https://en.wikipedia.org/w/api.php"
NASCAR_SERIES = {1: "Cup Series", 2: "O'Reilly Auto Parts Series", 3: "Truck Series"}


def fetch_json(url, params=None, fetcher=None, tries=4):
    if fetcher:
        return fetcher(url, params or {})
    full = f"{url}?{urlencode(params)}" if params else url
    delay = 3
    for attempt in range(tries):
        try:
            with urlopen(Request(full, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=45) as response:
                return json.load(response)
        except Exception as error:
            if getattr(error, "code", None) in (403, 404) or attempt == tries - 1:
                raise
            print(f"  retry in {delay}s after {error}", file=sys.stderr, flush=True)
            time.sleep(delay)
            delay *= 2


def load_previous(name):
    try:
        return json.loads((OUT / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


# ---------- F1 (Jolpica) ----------

F1_SESSIONS = [("FirstPractice", "Practice 1"), ("SecondPractice", "Practice 2"), ("ThirdPractice", "Practice 3"),
               ("SprintQualifying", "Sprint qualifying"), ("SprintShootout", "Sprint shootout"), ("Sprint", "Sprint"), ("Qualifying", "Qualifying")]


def iso(date, time_text=""):
    if not date:
        return ""
    return f"{date}T{time_text.rstrip('Z') or '00:00:00'}Z" if time_text else date


def jolpica_pages(path, key, fetcher=None):
    """Every race in a paged Jolpica table, merging the result rows split across pages."""
    races = {}
    offset = 0
    while True:
        data = fetch_json(f"{JOLPICA}/{path}.json", {"limit": "100", "offset": str(offset)}, fetcher)["MRData"]
        for race in data.get("RaceTable", {}).get("Races", []):
            entry = races.setdefault(race["round"], {**race, key: []})
            entry[key] += race.get(key, [])
        offset += int(data.get("limit", 100))
        if offset >= int(data.get("total", 0)):
            break
        if not fetcher:
            time.sleep(0.4)
    return races


def f1_row(item):
    driver = item.get("Driver", {})
    return {"pos": int(item["position"]) if str(item.get("position", "")).isdigit() else None, "number": item.get("number", ""),
            "driver": f"{driver.get('givenName', '')} {driver.get('familyName', '')}".strip(), "code": driver.get("code", ""),
            "cc": country_code(driver.get("nationality")),
            "team": item.get("Constructor", {}).get("name", ""), "grid": int(item["grid"]) if str(item.get("grid", "")).isdigit() else None,
            "laps": int(item["laps"]) if str(item.get("laps", "")).isdigit() else None,
            "time": (item.get("Time") or {}).get("time") or item.get("status", ""), "status": item.get("status", ""),
            "points": float(item.get("points") or 0), "fastest": (item.get("FastestLap") or {}).get("rank") == "1"}


def build_f1(year, fetcher=None):
    schedule = fetch_json(f"{JOLPICA}/{year}.json", None, fetcher)["MRData"]["RaceTable"]["Races"]
    if not schedule:
        raise RuntimeError(f"No F1 calendar for {year}")
    results = jolpica_pages(f"{year}/results", "Results", fetcher)
    sprints = jolpica_pages(f"{year}/sprint", "SprintResults", fetcher)
    drivers = fetch_json(f"{JOLPICA}/{year}/driverstandings.json", None, fetcher)["MRData"]["StandingsTable"]["StandingsLists"]
    teams = fetch_json(f"{JOLPICA}/{year}/constructorstandings.json", None, fetcher)["MRData"]["StandingsTable"]["StandingsLists"]
    rounds = []
    for race in schedule:
        sessions = [{"name": label, "start": iso(race[key]["date"], race[key].get("time", ""))} for key, label in F1_SESSIONS if race.get(key)]
        sessions.append({"name": "Race", "start": iso(race["date"], race.get("time", ""))})
        location = race.get("Circuit", {}).get("Location", {})
        done = results.get(race["round"], {}).get("Results", [])
        rounds.append({
            "round": int(race["round"]), "name": race["raceName"], "circuit": race.get("Circuit", {}).get("circuitName", ""),
            "location": ", ".join(part for part in [location.get("locality"), location.get("country")] if part),
            "start": sessions[-1]["start"], "sessions": sorted(sessions, key=lambda item: item["start"]), "wiki": race.get("url", ""),
            "results": [f1_row(item) for item in done], "sprint": [f1_row(item) for item in sprints.get(race["round"], {}).get("SprintResults", [])],
        })
    standing = drivers[0] if drivers else {}
    team_standing = teams[0] if teams else {}
    complete = all(item["results"] for item in rounds)
    return {
        "id": "f1", "name": "Formula 1", "season": year, "complete": complete, "source": {"name": "Jolpica F1 API", "url": "https://jolpi.ca/"},
        "rounds": rounds,
        "standings": [
            {"title": "Drivers", "rows": [{"pos": int(row["position"]) if str(row.get("position", "")).isdigit() else None,
                                           "name": f"{row['Driver'].get('givenName', '')} {row['Driver'].get('familyName', '')}".strip(),
                                           "cc": country_code(row["Driver"].get("nationality")),
                                           "team": ", ".join(team.get("name", "") for team in row.get("Constructors", [])),
                                           "points": float(row.get("points") or 0), "wins": int(row.get("wins") or 0)} for row in standing.get("DriverStandings", [])]},
            {"title": "Constructors", "rows": [{"pos": int(row["position"]) if str(row.get("position", "")).isdigit() else None, "name": row["Constructor"].get("name", ""),
                                                "cc": country_code(row["Constructor"].get("nationality")),
                                                "points": float(row.get("points") or 0), "wins": int(row.get("wins") or 0)} for row in team_standing.get("ConstructorStandings", [])]},
        ],
    }


# ---------- NASCAR ----------

def nascar_time(value):
    """NASCAR feed times are US Eastern without an offset → UTC ISO (daylight saving included)."""
    if not (isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", value)):
        return ""
    local = datetime.fromisoformat(value[:19]).replace(tzinfo=ZoneInfo("America/New_York"))
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def nascar_sessions(race):
    sessions = []
    for item in race.get("schedule") or []:
        name = item.get("event_name") or item.get("name") or ""
        utc = item.get("start_time_utc") or ""
        start = utc[:19] + "Z" if re.match(r"\d{4}-\d{2}-\d{2}T", utc) else nascar_time(item.get("start_time") or "")
        # On-track sessions only; the feed also lists hauler parking, garage hours and meetings.
        if name and start and re.search(r"practice|qualif|race|duel|heat|clash", name, re.I) and not re.search(r"garage|hauler|meeting|access|drawing|showcase|briefing|parade|inspection|report|introduction|ceremon", name, re.I):
            sessions.append({"name": name, "start": start})
    return sorted(sessions, key=lambda item: item["start"])


def build_nascar(year, fetcher=None, previous=None):
    races = fetch_json(f"{NASCAR}/{year}/race_list_basic.json", None, fetcher)
    previous_results = {}
    for series in (previous or {}).get("series", []):
        for race in series.get("rounds", []):
            if race.get("results") and all("cc" in row for row in race["results"]):
                previous_results[race["id"]] = race
    out = []
    for series_id, label in NASCAR_SERIES.items():
        rounds = []
        for race in races.get(f"series_{series_id}", []):
            if race.get("race_type_id") not in (1, None):  # 1 = points race; skip exhibitions and qualifying races
                continue
            entry = {"id": race["race_id"], "name": race.get("race_name", ""), "track": race.get("track_name", ""),
                     "start": nascar_time(race.get("date_scheduled") or race.get("race_date")), "sessions": nascar_sessions(race),
                     "laps": race.get("scheduled_laps"), "stages": [race.get(f"stage_{n}_laps") for n in (1, 2, 3) if race.get(f"stage_{n}_laps")],
                     "playoff": race.get("playoff_round") or 0, "tv": race.get("television_broadcaster") or "",
                     "cautions": race.get("number_of_cautions"), "leadChanges": race.get("number_of_lead_changes"), "leaders": race.get("number_of_leaders"),
                     "winnerId": race.get("winner_driver_id"), "results": []}
            if race.get("winner_driver_id"):
                if race["race_id"] in previous_results:
                    old = previous_results[race["race_id"]]
                    entry.update({key: old[key] for key in ("results", "stageWinners", "margin", "averageSpeed") if key in old})
                else:
                    try:
                        weekend = fetch_json(f"{NASCAR}/{year}/{series_id}/{race['race_id']}/weekend-feed.json", None, fetcher)
                        detail = (weekend.get("weekend_race") or [{}])[0]
                        entry["results"] = [{"pos": item.get("finishing_position"), "start": item.get("starting_position"), "car": item.get("car_number", ""),
                                             "driver": item.get("driver_fullname", ""), "cc": country_code(item.get("hometown_country")),
                                             "team": item.get("team_name", ""), "make": item.get("car_make", ""),
                                             "laps": item.get("laps_completed"), "led": item.get("laps_led"), "status": item.get("finishing_status", ""),
                                             "points": item.get("points_earned"), "playoffPoints": item.get("playoff_points_earned")}
                                            for item in sorted(detail.get("results") or [], key=lambda item: item.get("finishing_position") or 99)]
                        entry["stageWinners"] = [{"stage": item.get("stage_number"), "driver": (item.get("results") or [{}])[0].get("driver_fullname", "")}
                                                 for item in detail.get("stage_results") or [] if item.get("results")]
                        entry["margin"] = detail.get("margin_of_victory")
                        entry["averageSpeed"] = detail.get("average_speed")
                    except Exception as error:
                        print(f"  NASCAR race {race['race_id']}: {error}", file=sys.stderr)
                    if not fetcher:
                        time.sleep(0.3)
            winner = next((item for item in entry["results"] if item.get("pos") == 1), None)
            entry["winner"] = winner["driver"] if winner else ""
            rounds.append(entry)
        rounds.sort(key=lambda item: item["start"])
        for number, entry in enumerate(rounds, 1):
            entry["round"] = number
        try:
            points = fetch_json(f"{NASCAR}/{year}/{series_id}/points-feed.json", None, fetcher)
        except Exception as error:
            print(f"  NASCAR points {series_id}: {error}", file=sys.stderr)
            points = []
        # Points feeds have no country: take it from the driver's race results.
        countries = {row["driver"]: row.get("cc", "") for race in rounds for row in race["results"] if row.get("driver")}
        standings = [{"pos": item.get("position"), "name": item.get("driver_name", ""), "cc": countries.get(item.get("driver_name", ""), ""), "points": item.get("points"), "wins": item.get("wins"),
                      "starts": item.get("starts"), "poles": item.get("poles"), "top5": item.get("top_5") if item.get("top_5") is not None else item.get("top5"),
                      "top10": item.get("top_10") if item.get("top_10") is not None else item.get("top10"), "playoff": item.get("playoff_rank") or None}
                     for item in points if isinstance(item, dict) and item.get("driver_name")]
        if rounds:
            out.append({"id": series_id, "name": label, "rounds": rounds, "standings": [{"title": "Drivers", "rows": standings[:40]}],
                        "complete": all(item.get("winnerId") for item in rounds)})
    if not out:
        raise RuntimeError(f"No NASCAR races for {year}")
    return {"id": "nascar", "name": "NASCAR", "season": year, "source": {"name": "NASCAR", "url": "https://www.nascar.com/"}, "series": out,
            "complete": out[0]["complete"], "timesNote": "Race times are US Eastern."}


# ---------- Wikipedia tables (IMSA, WEC) ----------

FLAG = re.compile("\x01([^\x02]*)\x02")


def unflag(text):
    """Remove the flag markers strip_markup leaves in cells."""
    return FLAG.sub("", text or "").strip()


def people(text):
    """A cell listing drivers, one per line, each led by a flag → [{"name", "cc"}]."""
    out = []
    for line in (text or "").split("\n"):
        name = unflag(line)
        if name:
            code = FLAG.search(line)
            out.append({"name": name, "cc": country_code(code.group(1)) if code else ""})
    return out


def strip_markup(text):
    """Wikitext → plain text: links, bold, refs, simple templates; <br> becomes a newline. {{flagicon|XXX}} becomes a
    marker (\x01XXX\x02) so driver cells keep their nationality; unflag() removes markers from other cells."""
    text = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", text or "", flags=re.S)
    text = re.sub(r"\{\{(?:flagicon|flagdeco|flag icon)\|([^{}|]*)(?:\|[^{}]*)?\}\}", lambda match: f"\x01{match.group(1).strip()}\x02", text, flags=re.I)
    text = re.sub(r"\{\{(?:nowrap|small|nobr|abbr|tooltip|sortname|sort)\|([^{}|]*)(?:\|[^{}]*)?\}\}", r"\1", text, flags=re.I)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"'''?|<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ")
    return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")).strip()


def split_cells(line, marker):
    """Cells on one wikitable line ('| a || b' or '! a !! b'), each as (attributes, content)."""
    body = line[1:]
    parts = re.split(r"\|\||!!" if marker == "!" else r"\|\|", body)
    cells = []
    for part in parts:
        # 'style="…" | content' — the first single pipe outside [[ ]] and {{ }} separates attributes.
        depth = 0
        split_at = -1
        for index, char in enumerate(part):
            if part.startswith("[[", index) or part.startswith("{{", index):
                depth += 1
            elif part.startswith("]]", index) or part.startswith("}}", index):
                depth = max(0, depth - 1)
            elif char == "|" and depth == 0:
                split_at = index
                break
        prefix = part[:split_at] if split_at >= 0 else ""
        # Attributes are words with or without values: 'nowrap', 'rowspan="2"', 'style="…"'.
        is_attributes = split_at >= 0 and re.fullmatch(r"""\s*(?:[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+))?\s*)+""", prefix)
        attributes, content = (prefix, part[split_at + 1:]) if is_attributes else ("", part)
        cells.append((attributes, content))
    return cells


def wikitables(text):
    """Every class="wikitable" table as a list of rows of plain-text cells, with rowspans expanded."""
    tables = []
    for match in re.finditer(r"\{\|[^\n]*wikitable[^\n]*\n(.*?)\n\|\}", text or "", re.S):
        rows = []
        pending = {}  # column → (remaining rows, text)
        for chunk in re.split(r"\n\|-[^\n]*", "\n" + match.group(1)):
            cells = []
            for line in chunk.split("\n"):
                if line.startswith("|+") or not line.strip():
                    continue
                if line.startswith("|") or line.startswith("!"):
                    cells += [(attributes, content, line[0] == "!") for attributes, content in split_cells(line, line[0])]
                elif cells:  # continuation of the previous cell's content
                    attributes, content, header = cells[-1]
                    cells[-1] = (attributes, content + "\n" + line, header)
            if not cells:
                continue
            row = []
            column = 0
            queue = list(cells)
            while queue or column in pending:
                if column in pending:
                    remaining, value = pending[column]
                    row.append(value)
                    if remaining <= 1:
                        del pending[column]
                    else:
                        pending[column] = (remaining - 1, value)
                    column += 1
                    continue
                attributes, content, _ = queue.pop(0)
                value = strip_markup(content)
                span = re.search(r'rowspan\s*=\s*"?(\d+)', attributes)
                colspan = re.search(r'colspan\s*=\s*"?(\d+)', attributes)
                for offset in range(int(colspan.group(1)) if colspan else 1):
                    if span and int(span.group(1)) > 1:
                        pending[column] = (int(span.group(1)) - 1, value)
                    row.append(value)
                    column += 1
            rows.append(row)
        tables.append(rows)
    return tables


def wiki_page(title, fetcher=None):
    data = fetch_json(WIKIPEDIA, {"action": "parse", "page": title, "prop": "wikitext", "format": "json", "formatversion": "2", "redirects": "1"}, fetcher)
    if "parse" not in data:
        raise RuntimeError(f"Wikipedia page {title} not found")
    return data["parse"]["wikitext"]


def section(text, heading):
    """The wikitext under a heading (any level), up to the next heading of the same or higher level."""
    match = re.search(rf"^(=+)\s*{re.escape(heading)}\s*\1\s*$", text, re.M)
    if not match:
        return ""
    level = len(match.group(1))
    rest = text[match.end():]
    end = re.search(rf"^={{1,{level}}}[^=].*?={{1,{level}}}\s*$", rest, re.M)
    return rest[:end.start()] if end else rest


MONTHS = {name: index for index, name in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                                     "october", "november", "december"], 1)}


def parse_date(text, year):
    """'24–25 January', 'January 24–25', '19 April' → (first day ISO, text)."""
    clean = re.sub(r"\s+", " ", (text or "").replace("–", "-").replace("—", "-")).strip()
    match = re.search(r"(\d{1,2})(?:\s*-\s*\d{1,2})?\s+([A-Za-z]+)", clean) or None
    month_first = re.search(r"([A-Za-z]+)\s+(\d{1,2})(?:\s*-\s*\d{1,2})?", clean)
    day = month = None
    if match and match.group(2).lower() in MONTHS:
        day, month = int(match.group(1)), MONTHS[match.group(2).lower()]
    elif month_first and month_first.group(1).lower() in MONTHS:
        day, month = int(month_first.group(2)), MONTHS[month_first.group(1).lower()]
    years = re.findall(r"\b(20\d{2})\b", clean)
    if not day:
        return "", clean
    return f"{int(years[0]) if years else year}-{month:02d}-{day:02d}", clean


def column(header, *names):
    for index, value in enumerate(header):
        if any(name.lower() in unflag(value).lower() for name in names):
            return index
    return None


def parse_calendar(text, year):
    """Rounds from the first table that has round, circuit/race and date columns."""
    for table in wikitables(text):
        if len(table) < 2:
            continue
        header = table[0]
        rnd, race, circuit, date = column(header, "Rnd", "Round", "No."), column(header, "Race"), column(header, "Circuit", "Track"), column(header, "Date")
        if rnd is None or date is None or (race is None and circuit is None):
            continue
        rounds = []
        for row in table[1:]:
            if len(row) <= max(i for i in [rnd, date, race, circuit] if i is not None) or not re.fullmatch(r"\d+", row[rnd].strip()):
                continue
            row = [unflag(cell) for cell in row]
            start, date_text = parse_date(row[date], year)
            location = column(header, "Location")
            rounds.append({"round": int(row[rnd]), "name": (row[race] if race is not None else row[circuit]).replace("\n", " "),
                           "circuit": (row[circuit] if circuit is not None else "").replace("\n", " "), "location": (row[location].replace("\n", ", ") if location is not None and location < len(row) else ""),
                           "start": start, "dateText": date_text})
        if rounds:
            return rounds
    return []


def parse_class_winners(text):
    """{round: {class: {"team": …, "drivers": [...]}}} from a results table where each round has a team row then a drivers row."""
    out = {}
    for table in wikitables(text):
        headers = [row for row in table[:2]]
        header = table[0]
        if column(header, "Rnd", "Round") is None:
            continue
        rnd = column(header, "Rnd", "Round")
        classes = {}
        for index, value in enumerate(header):
            match = re.match(r"(.+?)\s+(?:Winning Team|winners|Winning Teams|Winner)$", unflag(value), re.I)
            if match:
                classes[index] = match.group(1).strip()
        if not classes:
            continue
        body = table[2:] if len(table) > 1 and column(table[1], "Driver") is not None else table[1:]
        by_round = {}
        for row in body:
            if rnd < len(row) and re.fullmatch(r"\d+", row[rnd].strip()):
                by_round.setdefault(int(row[rnd]), []).append(row)
        for number, rows in by_round.items():
            winners = {}
            for index, name in classes.items():
                team = rows[0][index] if index < len(rows[0]) else ""
                drivers = rows[1][index] if len(rows) > 1 and index < len(rows[1]) else ""
                if team or drivers:
                    team_code = FLAG.search(team)
                    winners[name] = {"team": unflag(team).replace("\n", " "), "cc": country_code(team_code.group(1)) if team_code else "", "drivers": people(drivers)}
            out[number] = winners
        if out:
            return out
    return out


def parse_standings(text, limit=10):
    """Top entries of the first drivers' standings table: co-drivers sharing a position and points are grouped."""
    for table in wikitables(text):
        if not table:
            continue
        header = table[0]
        pos, driver, team, points = column(header, "Pos"), column(header, "Driver"), column(header, "Team", "Entrant"), column(header, "Points")
        if pos is None or driver is None or points is None:
            continue
        entries = []
        for row in table[1:]:
            if len(row) <= max(pos, driver, points) or not re.fullmatch(r"\d+", row[pos].strip()):
                continue
            key = (row[pos], unflag(row[points]), unflag(row[team]) if team is not None and team < len(row) else "")
            names = people(row[driver])  # co-drivers can share one cell
            if entries and entries[-1]["key"] == key:
                entries[-1]["drivers"] += names
            else:
                entries.append({"key": key, "pos": int(row[pos]), "drivers": names, "team": key[2].replace("\n", " "),
                                "points": float(re.sub(r"[^\d.]", "", unflag(row[points])) or 0)})
        if entries:
            return [{k: v for k, v in entry.items() if k != "key"} for entry in entries[:limit]]
    return []


def wiki_url(title):
    return f"https://en.wikipedia.org/wiki/{quote(title)}"


def build_wiki_series(series_id, name, title, calendar_heading, results_heading, standings_headings, year, fetcher=None):
    text = wiki_page(title, fetcher)
    rounds = parse_calendar(section(text, calendar_heading), year)
    winners = parse_class_winners(section(text, results_heading))
    for entry in rounds:
        entry["winners"] = winners.get(entry["round"], {})
        entry["results"] = bool(entry["winners"])
    standings = []
    for class_name, heading in standings_headings:
        rows = parse_standings(section(text, heading))
        if rows:
            standings.append({"title": f"{class_name} drivers", "rows": rows})
    if not rounds:
        raise RuntimeError(f"No calendar parsed from {title}")
    return {"id": series_id, "name": name, "season": year, "rounds": rounds, "standings": standings, "complete": all(entry["results"] for entry in rounds),
            "source": {"name": f"Wikipedia: {title.replace('_', ' ')}", "url": wiki_url(title), "license": "CC BY-SA 4.0"}}


def build_imsa(year, fetcher=None):
    return build_wiki_series("imsa", "IMSA WeatherTech SportsCar Championship", f"{year}_IMSA_SportsCar_Championship", "Schedule", "Race results",
                             [("GTP", "Standings: Grand Touring Prototype (GTP)"), ("LMP2", "Standings: Le Mans Prototype 2 (LMP2)"),
                              ("GTD Pro", "Standings: GT Daytona Pro (GTD Pro)"), ("GTD", "Standings: GT Daytona (GTD)")], year, fetcher)


def build_wec(year, fetcher=None):
    return build_wiki_series("wec", "FIA World Endurance Championship", f"{year}_FIA_World_Endurance_Championship", "Calendar", "Race results",
                             [("Hypercar", "Hypercar World Endurance Drivers' Championship"), ("LMGT3", "FIA Endurance Trophy for LMGT3 Drivers")], year, fetcher)


# ---------- summary ----------

def summarize(series_list, now=None):
    """Next race and last winner per series, for the Guide and This week."""
    now = now or datetime.now(timezone.utc)

    def when(start):
        """Race start as a UTC datetime; a date-only start counts until the end of that day."""
        if not start:
            return None
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
            return datetime.fromisoformat(f"{start}T23:59:59+00:00")
        return datetime.fromisoformat(start.replace("Z", "+00:00"))
    out = []
    for data in series_list:
        groups = data.get("series") or [data]
        for group in groups[:1]:
            rounds = group.get("rounds", [])
            upcoming = [entry for entry in rounds if not entry.get("results") and when(entry.get("start")) and when(entry.get("start")) >= now]
            done = [entry for entry in rounds if entry.get("results")]
            last = done[-1] if done else None
            winner = ""
            winner_cc = ""
            if last:
                if isinstance(last.get("results"), list) and last["results"]:
                    winner = last["results"][0].get("driver", "")
                    winner_cc = last["results"][0].get("cc", "")
                elif last.get("winners"):
                    first_class = next(iter(last["winners"].values()))
                    winner = f"{first_class.get('team', '')}".strip()
                    winner_cc = first_class.get("cc", "")
            table = (group.get("standings") or data.get("standings") or [{}])[0]
            leader = (table.get("rows") or [{}])[0]
            out.append({"id": data["id"], "name": data["name"], "season": data.get("season"),
                        "next": {"name": upcoming[0]["name"], "start": upcoming[0].get("start", ""), "round": upcoming[0].get("round"),
                                 "track": upcoming[0].get("circuit") or upcoming[0].get("track", "")} if upcoming else None,
                        "last": {"name": last["name"], "winner": winner, "cc": winner_cc, "start": last.get("start", "")} if last else None,
                        "leader": {"name": leader.get("name") or ", ".join(item["name"] if isinstance(item, dict) else item for item in leader.get("drivers", [])),
                                   "cc": leader.get("cc") or next((item.get("cc", "") for item in leader.get("drivers", []) if isinstance(item, dict)), ""),
                                   "points": leader.get("points"), "title": table.get("title", "")} if leader else None,
                        "complete": bool(data.get("complete"))})
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=datetime.now(timezone.utc).year)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    built = []
    for key, builder in [("f1", lambda: build_f1(args.year)), ("nascar", lambda: build_nascar(args.year, previous=load_previous("nascar"))),
                         ("imsa", lambda: build_imsa(args.year)), ("wec", lambda: build_wec(args.year))]:
        try:
            data = builder()
            data["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            (OUT / f"{key}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            print(f"{key}: {len(data.get('rounds') or data.get('series', [{}])[0].get('rounds', []))} rounds")
            built.append(data)
        except Exception as error:
            print(f"{key} failed, keeping the previous file: {error}", file=sys.stderr)
            previous = load_previous(key)
            if previous:
                built.append(previous)
    (OUT / "summary.json").write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "series": summarize(built)},
                                                 ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
