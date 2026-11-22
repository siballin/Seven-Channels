#!/usr/bin/env python3
"""Build the NBA player database (data/nba/) from ESPN's public stats endpoints.

How players are found
- ESPN's season stats lists (statistics/byathlete) name every player with regular-season stats, with ESPN ids:
  complete from 1996-97, partial through the 1980s, empty before that.
- Optional: data/nba/extra-players.json lists more ESPN ids (e.g. pre-1980 legends) to include.

What's stored per player
- Bio from the athlete endpoint: position, height, weight, birth date and place, college, draft, debut, jersey,
  current team, headshot.
- Every regular season from the career stats endpoint (averages, totals and double/triple-doubles per season and
  team), plus career totals.

Output
- data/nba/index.json          every player with career averages and totals (for search, filters and leaders)
- data/nba/players/NN.json     full profiles in 64 shards (NN = ESPN id mod 64), loaded on demand
- data/nba/records.json        all-time single-season and career leaders

Retired players are fetched once and kept. Players who appeared in the last two seasons are refreshed when
their data is over 6 days old, so the weekly publish keeps current stats fresh. --force refetches everyone.

Usage: python3 scripts/build_nba_players.py [--force] [--first-season 1980] [--limit N]
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "nba"
EXTRA = OUT / "extra-players.json"
USER_AGENT = "SevenChannels/1.0 (personal static site; NBA player directory)"
WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba"
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
SHARDS = 64
REFRESH_DAYS = 6

# Per-season columns stored for each player (compact rows; names listed once in each shard).
SEASON_COLUMNS = ["year", "season", "team", "gp", "gs", "min", "pts", "reb", "ast", "stl", "blk", "tov", "pf", "oreb", "dreb",
                  "fgm", "fga", "fgp", "fg3m", "fg3a", "fg3p", "ftm", "fta", "ftp", "dd2", "td3",
                  "tpts", "treb", "tast", "tstl", "tblk", "ttov"]  # season totals


# ---------- fetching ----------

def fetch_json(url, params=None, fetcher=None, tries=4):
    if fetcher:
        return fetcher(url, params or {})
    full = f"{url}{'&' if '?' in url else '?'}{urlencode(params)}" if params else url
    delay = 3
    for attempt in range(tries):
        try:
            with urlopen(Request(full, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), timeout=45) as response:
                return json.load(response)
        except Exception as error:
            code = getattr(error, "code", None)
            if code == 404 or attempt == tries - 1:
                raise
            print(f"  retry in {delay}s after {error}", file=sys.stderr, flush=True)
            time.sleep(delay)
            delay *= 2


def current_season(today=None):
    """ESPN names a season by the year it ends; the new season starts in October."""
    today = today or datetime.now(timezone.utc)
    return today.year + 1 if today.month >= 10 else today.year


def discover(first, last, fetcher=None, log=print):
    """{espn id: {"name", "seasons": set(years)}} from ESPN's season stats lists."""
    found = {}
    for season in range(first, last + 1):
        try:
            data = fetch_json(f"{WEB}/statistics/byathlete", {"region": "us", "lang": "en", "contentorigin": "espn", "isqualified": "false",
                                                              "page": "1", "limit": "1000", "sort": "offensive.avgPoints:desc",
                                                              "season": str(season), "seasontype": "2"}, fetcher)
        except Exception as error:
            log(f"  season {season}: {error}")
            continue
        athletes = data.get("athletes") or []
        for item in athletes:
            athlete = item.get("athlete") or {}
            if not re.fullmatch(r"\d+", str(athlete.get("id", ""))):
                continue
            entry = found.setdefault(str(athlete["id"]), {"name": athlete.get("displayName", ""), "seasons": set()})
            entry["seasons"].add(season)
        log(f"  {season}: {len(athletes)} players")
        if not fetcher:
            time.sleep(0.3)
    return found


def wikidata_espn_ids(fetcher=None, log=print):
    """{ESPN id: name} for every Wikidata item with an ESPN NBA player id. Uses the regular Wikidata API
    (property lookup, haswbstatement search, entity data), not the query service, which is often overloaded.
    This is how players from before ESPN's season lists (Larry Bird, Kareem Abdul-Jabbar, …) are found."""
    found = fetch_json(WIKIDATA_API, {"action": "wbsearchentities", "type": "property", "language": "en", "search": "ESPN NBA player ID", "format": "json"}, fetcher)
    prop = next((item["id"] for item in found.get("search") or [] if re.search(r"ESPN.*NBA.*player", item.get("label", ""), re.I)), "")
    if not prop:
        log("  Wikidata: no ESPN NBA player id property found")
        return {}
    titles = []
    offset = 0
    while offset < 10000:
        data = fetch_json(WIKIDATA_API, {"action": "query", "list": "search", "srsearch": f"haswbstatement:{prop}", "srnamespace": "0",
                                         "srlimit": "500", "sroffset": str(offset), "srprop": "", "format": "json"}, fetcher)
        titles += [item["title"] for item in (data.get("query") or {}).get("search") or [] if re.fullmatch(r"Q\d+", item.get("title", ""))]
        if "continue" not in data:
            break
        offset = int(data["continue"].get("sroffset", offset + 500))
        if not fetcher:
            time.sleep(0.5)
    out = {}
    for start in range(0, len(titles), 50):
        data = fetch_json(WIKIDATA_API, {"action": "wbgetentities", "ids": "|".join(titles[start:start + 50]), "props": "claims|labels",
                                         "languages": "en", "format": "json"}, fetcher)
        for entity in (data.get("entities") or {}).values():
            for claim in (entity.get("claims") or {}).get(prop, []):
                value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
                if isinstance(value, str) and re.fullmatch(r"\d+", value):
                    out[value] = ((entity.get("labels") or {}).get("en") or {}).get("value", "")
        if not fetcher:
            time.sleep(0.5)
    log(f"  Wikidata ({prop}): {len(out)} players with ESPN ids")
    return out


# ---------- parsing ----------

def number(value):
    """'26.7' → 26.7, '1,634' → 1634, '' / '-' → None."""
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text or text in {"-", "--"}:
        return None
    try:
        result = float(text)
    except ValueError:
        return None
    return int(result) if result.is_integer() and "." not in text else result


def made_attempted(value):
    """'9.8-19.4' → (9.8, 19.4)."""
    match = re.fullmatch(r"\s*([\d.]+)\s*-\s*([\d.]+)\s*", str(value or ""))
    return (number(match[1]), number(match[2])) if match else (None, None)


def category(data, name):
    return next((item for item in data.get("categories") or [] if item.get("name") == name), None) or {}


def labelled(cat, stats):
    return {str(label).upper(): value for label, value in zip(cat.get("labels") or [], stats or [])}


def parse_stats(data, team_abbr):
    """Season rows (one per season and team, plus a combined row when traded) and career totals."""
    averages, totals, misc = category(data, "averages"), category(data, "totals"), category(data, "miscellaneous")

    def key(row):
        return (str((row.get("season") or {}).get("year", "")), str(row.get("teamId", "")))

    total_rows = {key(row): labelled(totals, row.get("stats")) for row in totals.get("statistics") or []}
    misc_rows = {key(row): labelled(misc, row.get("stats")) for row in misc.get("statistics") or []}
    seasons = []
    for row in averages.get("statistics") or []:
        season = row.get("season") or {}
        year = number(season.get("year"))
        if not isinstance(year, int):
            continue
        avg = labelled(averages, row.get("stats"))
        tot = total_rows.get(key(row), {})
        mis = misc_rows.get(key(row), {})
        team_id = str(row.get("teamId", ""))
        fgm, fga = made_attempted(tot.get("FG"))
        fg3m, fg3a = made_attempted(tot.get("3PT"))
        ftm, fta = made_attempted(tot.get("FT"))
        values = {
            "year": year, "season": season.get("displayName") or str(year),
            "team": "TOT" if team_id == "0" else team_abbr.get(team_id) or (row.get("teamSlug") or "").upper()[:16] or team_id,
            "gp": number(avg.get("GP")), "gs": number(avg.get("GS")), "min": number(avg.get("MIN")), "pts": number(avg.get("PTS")),
            "reb": number(avg.get("REB")), "ast": number(avg.get("AST")), "stl": number(avg.get("STL")), "blk": number(avg.get("BLK")),
            "tov": number(avg.get("TO")), "pf": number(avg.get("PF")), "oreb": number(avg.get("OR")), "dreb": number(avg.get("DR")),
            "fgm": fgm, "fga": fga, "fgp": number(avg.get("FG%")), "fg3m": fg3m, "fg3a": fg3a, "fg3p": number(avg.get("3P%")),
            "ftm": ftm, "fta": fta, "ftp": number(avg.get("FT%")), "dd2": number(mis.get("DD2")), "td3": number(mis.get("TD3")),
            "tpts": number(tot.get("PTS")), "treb": number(tot.get("REB")), "tast": number(tot.get("AST")),
            "tstl": number(tot.get("STL")), "tblk": number(tot.get("BLK")), "ttov": number(tot.get("TO")),
        }
        seasons.append([values[column] for column in SEASON_COLUMNS])
    seasons.sort(key=lambda row: (row[0], row[2] == "TOT"))

    avg_career = labelled(averages, averages.get("totals"))
    tot_career = labelled(totals, totals.get("totals"))
    misc_career = labelled(misc, misc.get("totals"))
    fgm, fga = made_attempted(tot_career.get("FG"))
    fg3m, fg3a = made_attempted(tot_career.get("3PT"))
    ftm, fta = made_attempted(tot_career.get("FT"))
    career = {
        "gp": number(avg_career.get("GP")), "gs": number(avg_career.get("GS")), "min": number(avg_career.get("MIN")),
        "pts": number(avg_career.get("PTS")), "reb": number(avg_career.get("REB")), "ast": number(avg_career.get("AST")),
        "stl": number(avg_career.get("STL")), "blk": number(avg_career.get("BLK")), "tov": number(avg_career.get("TO")),
        "fgp": number(avg_career.get("FG%")), "fg3p": number(avg_career.get("3P%")), "ftp": number(avg_career.get("FT%")),
        "totals": {"pts": number(tot_career.get("PTS")), "reb": number(tot_career.get("REB")), "ast": number(tot_career.get("AST")),
                   "stl": number(tot_career.get("STL")), "blk": number(tot_career.get("BLK")), "tov": number(tot_career.get("TO")),
                   "fgm": fgm, "fga": fga, "fg3m": fg3m, "fg3a": fg3a, "ftm": ftm, "fta": fta,
                   "dd2": number(misc_career.get("DD2")), "td3": number(misc_career.get("TD3"))},
    } if avg_career else {}
    return seasons, career


def parse_draft(text):
    """'1984: Rd 1, Pk 3 (CHI)' → {"year": 1984, "round": 1, "pick": 3, "team": "CHI"}."""
    match = re.match(r"\s*(\d{4}):\s*Rd\s*(\d+),\s*Pk\s*(\d+)\s*\(([^)]+)\)", text or "")
    return {"year": int(match[1]), "round": int(match[2]), "pick": int(match[3]), "team": match[4]} if match else None


def parse_bio(data):
    athlete = data.get("athlete") or {}
    birth = ""
    match = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", athlete.get("displayDOB") or "")
    if match:
        birth = f"{match[3]}-{int(match[1]):02d}-{int(match[2]):02d}"
    headshot = (athlete.get("headshot") or {}).get("href") or ""
    team = athlete.get("team") or {}
    return {
        "name": athlete.get("displayName") or athlete.get("fullName") or "",
        "position": (athlete.get("position") or {}).get("displayName") or "",
        "pos": (athlete.get("position") or {}).get("abbreviation") or "",
        "height": athlete.get("displayHeight") or "", "weight": athlete.get("displayWeight") or "",
        "birth": birth, "birthplace": athlete.get("displayBirthPlace") or "",
        "college": (athlete.get("college") or {}).get("name") or (athlete.get("collegeTeam") or {}).get("displayName") or "",
        "draft": parse_draft(athlete.get("displayDraft")), "draftText": athlete.get("displayDraft") or "",
        "debut": athlete.get("debutYear"), "experience": athlete.get("displayExperience") or "",
        "jersey": athlete.get("displayJersey") or "", "active": bool(athlete.get("active")),
        "team": {"id": str(team.get("id", "")), "name": team.get("displayName", ""), "abbr": team.get("abbreviation", "")} if team.get("id") else None,
        "headshot": headshot if headshot.startswith("https://a.espncdn.com/") else "",
        "status": (athlete.get("status") or {}).get("name") or "",
    }


# ---------- build ----------

def shard(espn_id):
    return f"{int(espn_id) % SHARDS:02d}"


def load_existing():
    players = {}
    for path in sorted((OUT / "players").glob("*.json")):
        try:
            players.update(json.loads(path.read_text()).get("players") or {})
        except (OSError, ValueError):
            continue
    return players


def team_abbreviations(fetcher=None):
    data = fetch_json(TEAMS_URL, None, fetcher)
    teams = {}
    for sport in data.get("sports") or []:
        for league in sport.get("leagues") or []:
            for item in league.get("teams") or []:
                team = item.get("team") or {}
                if team.get("id"):
                    teams[str(team["id"])] = team.get("abbreviation") or team.get("shortDisplayName") or ""
    return teams


def needs_refresh(record, recent_seasons, now, force):
    if force or not record or not record.get("fetchedAt"):
        return True
    age = (now - datetime.fromisoformat(record["fetchedAt"])).total_seconds() / 86400
    played_recently = any(row[0] in recent_seasons for row in record.get("seasons") or [])
    return (played_recently or record.get("active")) and age >= REFRESH_DAYS


def build(fetcher=None, force=False, first_season=1980, limit=None, now=None, log=lambda *args: print(*args, flush=True)):
    now = now or datetime.now(timezone.utc)
    last = current_season(now)
    existing = {} if force else load_existing()
    log(f"Finding players in ESPN's season stats ({first_season}–{last})…")
    found = discover(first_season, last, fetcher, log)
    try:
        extra = json.loads(EXTRA.read_text()).get("players") or []
    except (OSError, ValueError):
        extra = []
    for item in extra:
        if re.fullmatch(r"\d+", str(item.get("id", ""))):
            found.setdefault(str(item["id"]), {"name": item.get("name", ""), "seasons": set()})
    try:
        for espn_id, name in wikidata_espn_ids(fetcher, log).items():
            found.setdefault(espn_id, {"name": name, "seasons": set(), "wikidata": True})
    except Exception as error:  # optional: the season lists still cover 1985 on
        log(f"  Wikidata unavailable ({error}); using ESPN's season lists only")
    ids = sorted(set(found) | set(existing), key=int)
    if limit:
        ids = ids[:limit]
    teams = team_abbreviations(fetcher)
    recent = {last, last - 1}
    try:
        no_stats = set(json.loads((OUT / "no-stats.json").read_text()).get("ids") or []) if not force else set()
    except (OSError, ValueError):
        no_stats = set()
    todo = [espn_id for espn_id in ids if espn_id not in no_stats and needs_refresh(existing.get(espn_id), recent, now, force)]
    log(f"  {len(ids)} players; fetching {len(todo)} (new or active), keeping {len(ids) - len(todo)}")
    players = {espn_id: existing[espn_id] for espn_id in ids if espn_id in existing}

    def fetch_player(espn_id):
        try:
            bio = parse_bio(fetch_json(f"{WEB}/athletes/{espn_id}", {"region": "us", "lang": "en", "contentorigin": "espn"}, fetcher))
            stats = fetch_json(f"{WEB}/athletes/{espn_id}/stats", {"region": "us", "lang": "en", "contentorigin": "espn"}, fetcher)
            seasons, career = parse_stats(stats, teams)
        except Exception as error:
            return espn_id, None, error
        finally:
            if not fetcher:
                time.sleep(0.2)
        return espn_id, (bio, seasons, career), None

    failures = 0
    # Four at a time against ESPN (each worker pauses between players); one at a time in tests.
    with ThreadPoolExecutor(max_workers=1 if fetcher else 4) as pool:
        for number_done, (espn_id, result, error) in enumerate(pool.map(fetch_player, todo), 1):
            if error:
                failures += 1
                if espn_id not in players:
                    log(f"  {espn_id} {found.get(espn_id, {}).get('name', '')}: {error}")
                if failures > 200 and failures > len(todo) // 3:
                    raise RuntimeError(f"Too many failures ({failures}); stopping") from error
                continue
            bio, seasons, career = result
            if not seasons:
                no_stats.add(espn_id)
            if seasons:
                players[espn_id] = {"id": espn_id, **bio, "name": bio["name"] or found.get(espn_id, {}).get("name", ""),
                                    "seasons": seasons, "career": career, "fetchedAt": now.isoformat(timespec="seconds")}
            if number_done % 250 == 0:
                log(f"  {number_done}/{len(todo)}")
    log(f"  done: {len(players)} players, {failures} failed, {len(no_stats)} without ESPN stats")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "no-stats.json").write_text(json.dumps({"ids": sorted(no_stats, key=int)}))
    return players, teams


def summarize(player):
    """One index row: who, when, where, career averages and totals."""
    seasons = player["seasons"]
    years = [row[0] for row in seasons]
    team_list = []
    for row in seasons:
        if row[2] != "TOT" and row[2] not in team_list:
            team_list.append(row[2])
    career = player.get("career") or {}
    totals = career.get("totals") or {}
    return {
        "id": player["id"], "n": player["name"], "pos": player.get("pos", ""), "from": min(years), "to": max(years),
        "t": team_list, "a": bool(player.get("active")), "h": bool(player.get("headshot")),
        "d": player["draft"]["year"] if player.get("draft") else None, "pk": player["draft"]["pick"] if player.get("draft") else None,
        "gp": career.get("gp"), "ppg": career.get("pts"), "rpg": career.get("reb"), "apg": career.get("ast"),
        "spg": career.get("stl"), "bpg": career.get("blk"),
        "pts": totals.get("pts"), "reb": totals.get("reb"), "ast": totals.get("ast"), "stl": totals.get("stl"), "blk": totals.get("blk"),
        "td3": totals.get("td3"), "b": player.get("birth", ""), "c": player.get("college", ""),
    }


def records(players, top=100):
    """All-time leaders: career totals and averages (min. 400 games), best single seasons (min. 58 games or the season's full-time share)."""
    rows = [summarize(player) for player in players.values()]
    out = {"career": {}, "careerAverage": {}, "season": {}}
    for stat in ["pts", "reb", "ast", "stl", "blk", "td3"]:
        ranked = sorted((row for row in rows if row.get(stat)), key=lambda row: -row[stat])[:top]
        out["career"][stat] = [[row["id"], row["n"], row[stat]] for row in ranked]
    for stat, column in [("ppg", "ppg"), ("rpg", "rpg"), ("apg", "apg"), ("spg", "spg"), ("bpg", "bpg")]:
        ranked = sorted((row for row in rows if row.get(column) is not None and (row.get("gp") or 0) >= 400), key=lambda row: -row[column])[:top]
        out["careerAverage"][stat] = [[row["id"], row["n"], row[column]] for row in ranked]
    index = {name: position for position, name in enumerate(SEASON_COLUMNS)}
    singles = []
    for player in players.values():
        by_year = {}
        for row in player["seasons"]:
            # One row per season: the combined row when the player was traded.
            if row[index["year"]] not in by_year or row[index["team"]] == "TOT":
                by_year[row[index["year"]]] = row
        singles += [(player["id"], player["name"], row) for row in by_year.values() if (row[index["gp"]] or 0) >= 58]
    for stat in ["pts", "reb", "ast", "stl", "blk"]:
        ranked = sorted((item for item in singles if item[2][index[stat]] is not None), key=lambda item: -item[2][index[stat]])[:top]
        out["season"][stat] = [[espn_id, name, row[index["season"]], row[index["team"]], row[index[stat]]] for espn_id, name, row in ranked]
    return out


def write(players, teams, now=None):
    now = now or datetime.now(timezone.utc).isoformat(timespec="seconds")
    (OUT / "players").mkdir(parents=True, exist_ok=True)
    rows = sorted((summarize(player) for player in players.values()), key=lambda row: (-(row["pts"] or 0)))
    (OUT / "index.json").write_text(json.dumps({
        "generatedAt": now, "source": {"name": "ESPN", "url": "https://www.espn.com/nba/"}, "shards": SHARDS,
        "seasonColumns": SEASON_COLUMNS, "teams": teams, "players": rows,
    }, separators=(",", ":")))
    (OUT / "records.json").write_text(json.dumps({"generatedAt": now, **records(players)}, separators=(",", ":")))
    buckets = {}
    for espn_id, player in players.items():
        buckets.setdefault(shard(espn_id), {})[espn_id] = player
    for number_index in range(SHARDS):
        key = f"{number_index:02d}"
        (OUT / "players" / f"{key}.json").write_text(json.dumps({"generatedAt": now, "seasonColumns": SEASON_COLUMNS,
                                                                  "players": dict(sorted(buckets.get(key, {}).items(), key=lambda pair: int(pair[0])))},
                                                                 separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="refetch every player")
    parser.add_argument("--first-season", type=int, default=1980)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    try:
        previous = json.loads((OUT / "index.json").read_text())
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(previous["generatedAt"])).total_seconds() / 86400
    except (OSError, ValueError, KeyError, TypeError):
        age = None
    if not args.force and age is not None and age < REFRESH_DAYS:
        print(f"NBA player data is {age:.1f} days old; skipping.")
        return
    try:
        players, teams = build(force=args.force, first_season=args.first_season, limit=args.limit)
    except Exception as error:
        print(f"NBA player build failed, keeping the previous data: {error}", file=sys.stderr)
        sys.exit(0 if (OUT / "index.json").exists() else 1)
    if len(players) < 500 and not args.limit:
        print(f"Only {len(players)} players; keeping the previous data.", file=sys.stderr)
        sys.exit(0 if (OUT / "index.json").exists() else 1)
    write(players, teams)
    print(f"Wrote {len(players)} players.")


if __name__ == "__main__":
    main()
