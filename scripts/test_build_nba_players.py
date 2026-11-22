"""Tests for build_nba_players.py with canned ESPN responses. Run: python3 scripts/test_build_nba_players.py"""

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_nba_players as nba  # noqa: E402

AVG_LABELS = ["GP", "GS", "MIN", "FG", "FG%", "3PT", "3P%", "FT", "FT%", "OR", "DR", "REB", "AST", "BLK", "STL", "PF", "TO", "PTS"]
TOT_LABELS = ["FG", "FG%", "3PT", "3P%", "FT", "FT%", "OR", "DR", "REB", "AST", "BLK", "STL", "PF", "TO", "PTS"]
MISC_LABELS = ["DD2", "TD3", "DQ", "EJECT", "TECH", "FLAG", "AST/TO", "STL/TO", "SC-EFF", "SH-EFF"]


def season(year, team, avg, tot, misc):
    return {"season": {"year": year, "displayName": f"{year - 1}-{str(year)[2:]}"}, "teamId": team, "avg": avg, "tot": tot, "misc": misc}


PLAYERS = {
    "1035": {"bio": {"displayName": "Michael Jordan", "position": {"displayName": "Guard", "abbreviation": "G"}, "displayHeight": "6' 6\"",
                     "displayDOB": "2/17/1963", "displayDraft": "1984: Rd 1, Pk 3 (CHI)", "college": {"name": "North Carolina"}, "active": False},
             "seasons": [
                 season(1985, "4", ["82", "82", "38.3", "10.2-19.8", "51.5", "0.1-0.6", "17.3", "9.1-10.9", "84.5", "2.0", "4.5", "6.5", "5.9", "0.8", "2.4", "3.5", "3.5", "28.2"],
                        ["837-1625", "51.5", "9-52", "17.3", "630-746", "84.5", "167", "367", "534", "481", "69", "196", "285", "291", "2313"], ["40", "1"]),
                 season(1988, "4", ["82", "82", "40.4", "13.0-24.4", "53.5", "0.1-0.6", "13.2", "8.8-10.5", "84.1", "1.7", "3.8", "5.5", "5.9", "1.6", "3.2", "3.3", "3.1", "35.0"],
                        ["1069-1998", "53.5", "7-53", "13.2", "723-860", "84.1", "139", "310", "449", "485", "131", "259", "270", "252", "2868"], ["30", "0"]),
             ],
             "career": (["1072", "1039", "38.3", "11.4-22.9", "49.7", "0.5-1.7", "32.7", "6.8-8.2", "83.5", "1.6", "4.6", "6.2", "5.3", "0.8", "2.3", "2.6", "2.7", "30.1"],
                        ["12192-24537", "49.7", "581-1778", "32.7", "7327-8772", "83.5", "1668", "5004", "6672", "5633", "893", "2514", "2783", "2924", "32292"], ["500", "28"])},
    "2000": {"bio": {"displayName": "Traded Guy", "position": {"displayName": "Forward", "abbreviation": "F"}, "active": True,
                     "headshot": {"href": "https://a.espncdn.com/i/headshots/nba/players/full/2000.png"}, "displayDraft": ""},
             "seasons": [
                 season(2026, "13", ["20", "5", "20.0", "3.0-7.0", "42.9", "1.0-3.0", "33.3", "1.0-1.5", "66.7", "1.0", "3.0", "4.0", "2.0", "0.5", "0.5", "2.0", "1.0", "8.0"],
                        ["60-140", "42.9", "20-60", "33.3", "20-30", "66.7", "20", "60", "80", "40", "10", "10", "40", "20", "160"], ["0", "0"]),
                 season(2026, "2", ["40", "40", "30.0", "6.0-12.0", "50.0", "2.0-5.0", "40.0", "2.0-2.5", "80.0", "1.0", "5.0", "6.0", "3.0", "0.5", "1.0", "2.0", "2.0", "16.0"],
                        ["240-480", "50.0", "80-200", "40.0", "80-100", "80.0", "40", "200", "240", "120", "20", "40", "80", "80", "640"], ["5", "0"]),
                 season(2026, "0", ["60", "45", "26.7", "5.0-10.3", "48.4", "1.7-4.3", "38.5", "1.7-2.2", "77.3", "1.0", "4.3", "5.3", "2.7", "0.5", "0.8", "2.0", "1.7", "13.3"],
                        ["300-620", "48.4", "100-260", "38.5", "100-130", "77.3", "60", "260", "320", "160", "30", "50", "120", "100", "800"], ["5", "0"]),
             ],
             "career": (["60", "45", "26.7", "5.0-10.3", "48.4", "1.7-4.3", "38.5", "1.7-2.2", "77.3", "1.0", "4.3", "5.3", "2.7", "0.5", "0.8", "2.0", "1.7", "13.3"],
                        ["300-620", "48.4", "100-260", "38.5", "100-130", "77.3", "60", "260", "320", "160", "30", "50", "120", "100", "800"], ["5", "0"])},
}
SEASON_LISTS = {1985: ["1035"], 1988: ["1035"], 2026: ["2000"], 2027: []}


WIKIDATA = {"Q1": ("1543", "Larry Bird"), "Q2": ("999", "No Stats Guy"), "Q3": ("1035", "Michael Jordan")}
PLAYERS_EXTRA = {"1543": {"bio": {"displayName": "Larry Bird", "position": {"displayName": "Forward", "abbreviation": "F"}, "active": False, "displayDraft": "1978: Rd 1, Pk 6 (BOS)"},
                          "seasons": [season(1980, "2", ["82", "82", "36.0", "8.5-17.8", "47.4", "0.7-1.7", "40.6", "3.7-4.2", "83.6", "2.6", "7.8", "10.4", "4.5", "0.6", "1.7", "3.4", "3.2", "21.3"],
                                             ["693-1463", "47.4", "58-143", "40.6", "301-360", "83.6", "216", "636", "852", "370", "53", "143", "279", "263", "1745"], ["50", "2"])],
                          "career": (["897", "870", "38.4", "9.6-19.3", "49.6", "0.7-1.9", "37.6", "4.4-5.0", "88.6", "2.0", "8.0", "10.0", "6.3", "0.8", "1.7", "2.5", "3.1", "24.3"],
                                     ["8591-17334", "49.6", "649-1727", "37.6", "3960-4471", "88.6", "1757", "7217", "8974", "5695", "755", "1556", "2279", "2816", "21791"], ["300", "59"])},
                 "999": {"bio": {"displayName": "No Stats Guy"}, "seasons": [], "career": ([], [], [])}}


def fetcher(url, params):
    if url == nba.WIKIDATA_API:
        if params["action"] == "wbsearchentities":
            return {"search": [{"id": "P3685", "label": "ESPN NBA player ID"}]}
        if params["action"] == "query":
            return {"query": {"search": [{"title": qid} for qid in WIKIDATA]}}
        return {"entities": {qid: {"labels": {"en": {"value": WIKIDATA[qid][1]}}, "claims": {"P3685": [{"mainsnak": {"datavalue": {"value": WIKIDATA[qid][0]}}}]}}
                             for qid in params["ids"].split("|")}}
    if url.endswith("/statistics/byathlete"):
        ids = SEASON_LISTS.get(int(params["season"]), [])
        return {"athletes": [{"athlete": {"id": espn_id, "displayName": PLAYERS[espn_id]["bio"]["displayName"]}} for espn_id in ids]}
    if url == nba.TEAMS_URL:
        return {"sports": [{"leagues": [{"teams": [{"team": {"id": "4", "abbreviation": "CHI"}}, {"team": {"id": "13", "abbreviation": "LAL"}},
                                                     {"team": {"id": "2", "abbreviation": "BOS"}}]}]}]}
    espn_id = url.split("/athletes/")[1].split("/")[0]
    player = {**PLAYERS, **PLAYERS_EXTRA}[espn_id]
    if url.endswith("/stats"):
        def cat(name, labels, part, career):
            return {"name": name, "labels": labels, "totals": career,
                    "statistics": [{"season": row["season"], "teamId": row["teamId"], "stats": row[part]} for row in player["seasons"]]}
        return {"categories": [cat("averages", AVG_LABELS, "avg", player["career"][0]), cat("totals", TOT_LABELS, "tot", player["career"][1]),
                               cat("miscellaneous", MISC_LABELS, "misc", player["career"][2])]}
    return {"athlete": player["bio"]}


def main():
    assert nba.number("1,634") == 1634 and nba.number("26.7") == 26.7 and nba.number("-") is None
    assert nba.made_attempted("9.8-19.4") == (9.8, 19.4)
    assert nba.parse_draft("1984: Rd 1, Pk 3 (CHI)") == {"year": 1984, "round": 1, "pick": 3, "team": "CHI"}
    assert nba.current_season(datetime(2026, 11, 22, tzinfo=timezone.utc)) == 2027 and nba.current_season(datetime(2026, 5, 1, tzinfo=timezone.utc)) == 2026

    folder = Path(tempfile.mkdtemp())
    nba.OUT = folder
    nba.EXTRA = folder / "extra-players.json"
    now = datetime(2026, 11, 22, tzinfo=timezone.utc)
    players, teams = nba.build(fetcher=fetcher, first_season=1985, now=now, log=lambda *_: None)
    assert set(players) == {"1035", "2000", "1543"}, set(players)  # Larry Bird found through Wikidata; no-stats ids dropped
    assert players["1543"]["seasons"][0][1] == "1979-80" and players["1543"]["career"]["totals"]["pts"] == 21791
    mj = players["1035"]
    columns = {name: index for index, name in enumerate(nba.SEASON_COLUMNS)}
    assert mj["birth"] == "1963-02-17" and mj["draft"]["pick"] == 3 and mj["college"] == "North Carolina" and mj["pos"] == "G"
    first = mj["seasons"][0]
    assert first[columns["season"]] == "1984-85" and first[columns["team"]] == "CHI" and first[columns["pts"]] == 28.2
    assert first[columns["fgm"]] == 837 and first[columns["fga"]] == 1625 and first[columns["dd2"]] == 40
    assert first[columns["tpts"]] == 2313 and first[columns["treb"]] == 534 and first[columns["tast"]] == 481
    assert mj["career"]["pts"] == 30.1 and mj["career"]["totals"]["pts"] == 32292 and mj["career"]["totals"]["td3"] == 28
    traded = [row[columns["team"]] for row in players["2000"]["seasons"]]
    assert traded == ["LAL", "BOS", "TOT"], traded  # per-team rows, then the combined row
    # ESPN sometimes marks the combined row with a "2025-26 TOTALS" slug instead of team id 0
    data = {"categories": [{"name": "averages", "labels": ["GP", "PTS"], "statistics": [{"season": {"year": 2026, "displayName": "2025-26"}, "teamId": "-1", "teamSlug": "2025-26 TOTALS", "stats": ["10", "5.0"]}]}]}
    assert nba.parse_stats(data, {})[0][0][columns["team"]] == "TOT"
    old = {"seasons": [[2026, "2025-26", "2025-26 TOTALS"] + [1] * 23], "pos": "NA"}
    cleaned = nba.clean(old, nba.SEASON_COLUMNS[:26])
    assert cleaned["seasons"][0][2] == "TOT" and len(cleaned["seasons"][0]) == len(nba.SEASON_COLUMNS) and cleaned["pos"] == ""

    nba.write(players, teams, now="2026-11-22T00:00:00+00:00")
    index = json.loads((folder / "index.json").read_text())
    row = next(item for item in index["players"] if item["id"] == "1035")
    assert row["from"] == 1985 and row["to"] == 1988 and row["t"] == ["CHI"] and row["ppg"] == 30.1 and row["pts"] == 32292 and row["d"] == 1984
    assert next(item for item in index["players"] if item["id"] == "2000")["t"] == ["LAL", "BOS"]
    records = json.loads((folder / "records.json").read_text())
    assert records["career"]["pts"][0] == ["1035", "Michael Jordan", 32292]
    assert records["careerAverage"]["ppg"][0][0] == "1035"  # 1,072 games
    assert records["season"]["pts"][0] == ["1035", "Michael Jordan", "1987-88", "CHI", 35.0]
    assert all(item[0] != "2000" or item[3] == "TOT" for item in records["season"]["pts"])  # traded season counts once, combined
    shard = json.loads((folder / "players" / f"{1035 % 64:02d}.json").read_text())
    assert shard["players"]["1035"]["name"] == "Michael Jordan" and shard["seasonColumns"] == nba.SEASON_COLUMNS

    # Second run: the retired player is kept without refetching; the active one is fresh (under 6 days), so nothing is fetched.
    calls = []
    def counting(url, params):
        calls.append(url)
        return fetcher(url, params)
    players2, _ = nba.build(fetcher=counting, first_season=1985, now=now, log=lambda *_: None)
    assert set(players2) == {"1035", "2000", "1543"} and not [url for url in calls if "/athletes/" in url], calls
    # A week later only the active player is refetched.
    calls.clear()
    nba.build(fetcher=counting, first_season=1985, now=datetime(2026, 11, 30, tzinfo=timezone.utc), log=lambda *_: None)
    fetched = {url.split("/athletes/")[1].split("/")[0] for url in calls if "/athletes/" in url}
    assert fetched == {"2000"}, fetched
    print("build_nba_players tests passed")


if __name__ == "__main__":
    main()
