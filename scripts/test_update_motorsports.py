"""Tests for update_motorsports.py. Run: python3 scripts/test_update_motorsports.py"""

from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_motorsports as ms  # noqa: E402

WEC_RESULTS = """=== Race results ===
{| class="wikitable" style="font-size:85%;"
!Rnd.
!Circuit
!Hypercar winners
!LMGT3 winners
!Report
|-
! rowspan="2"| 1
| rowspan="2"| {{flagicon|ITA}} [[Imola Circuit|Imola]]
|nowrap| {{flagicon|JPN}} No. 8 [[Toyota Racing GmbH|Toyota Racing]]
|nowrap| {{flagicon|BEL}} No. 69 [[W Racing Team|Team WRT]]
| rowspan="2"| [[2026 6 Hours of Imola|Report]]
|-
| {{flagicon|CHE}} [[Sébastien Buemi]]<br>{{flagicon|NZL}} [[Brendon Hartley]]<br>{{flagicon|JPN}} [[Ryō Hirakawa]]
| {{flagicon|GBR}} [[Dan Harper]]<br>{{flagicon|USA}} [[Anthony McIntosh]]
|-
! rowspan="2"| 2
| rowspan="2"| {{flagicon|BEL}} [[Circuit de Spa-Francorchamps|Spa]]
|nowrap| {{flagicon|DEU}} No. 20 [[W Racing Team|BMW M Team WRT]]
|nowrap| {{flagicon|GBR}} No. 10 [[Garage 59]]
| rowspan="2"| [[2026 6 Hours of Spa-Francorchamps|Report]]
|-
| {{flagicon|GER}} [[René Rast]]<br>{{flagicon|NDL}} [[Robin Frijns]]
| {{flagicon|HKG}} [[Antares Au]]<ref>note</ref>
|}
"""

IMSA_RESULTS = """== Race results ==
{| class="wikitable" style="font-size:85%;"
! rowspan="2" |Rnd
! rowspan="2" |Circuit
! GTP Winning Team
! LMP2 Winning Team
! rowspan="24" |
! GTD Pro Winning Team
! GTD Winning Team
! rowspan="2" |Report
|-
! GTP Winning Drivers
! LMP2 Winning Drivers
! GTD Pro Winning Drivers
! GTD Winning Drivers
|-
! rowspan="2" |1
| rowspan="2" |[[2026 24 Hours of Daytona|Daytona]]
|nowrap| '''{{flagicon|DEU}} #7 [[Team Penske|Porsche Penske Motorsport]]'''
|nowrap| {{flagicon|USA}} #04 [[CrowdStrike]] Racing by [[Algarve Pro Racing|APR]]
|nowrap| '''{{flagicon|USA}} #1 [[Paul Miller Racing]]'''
|nowrap| {{flagicon|USA}} #57 [[Winward Racing]]
| rowspan="2" | [[2026 24 Hours of Daytona|Report]]
|-
|nowrap| '''{{flagicon|FRA}} [[Julien Andlauer]]<br>{{flagicon|DEU}} [[Laurin Heinrich]]<br>{{flagicon|BRA}} [[Felipe Nasr]]'''
|nowrap| {{flagicon|DNK}} [[Malthe Jakobsen]]<br>{{flagicon|USA}} [[George Kurtz]]
|nowrap| '''{{flagicon|USA}} [[Connor De Phillippi]]<br>{{flagicon|GBR}} [[Dan Harper]]'''
|nowrap| {{flagicon|AUT}} [[Lucas Auer]]<br>{{flagicon|NED}} [[Indy Dontje]]
|}
"""

STANDINGS = """====Hypercar World Endurance Drivers' Championship====
{|
|
{|class="wikitable" style="font-size:85%; text-align:center;"
! {{Tooltip|Pos.|Position number}}
! Driver
! Team
! [[2026 6 Hours of Imola|IMO]]<br>{{flagicon|ITA}}
! Points
|-
! 1
|align=left| {{flagicon|CHE}} [[Sébastien Buemi]]
|align=left| {{flagicon|JPN}} [[Toyota Racing GmbH|Toyota Racing]]
|style="background:#ffffbf;"| 1
! 115
|-
! 1
|align=left| {{flagicon|NZL}} [[Brendon Hartley]]
|align=left| {{flagicon|JPN}} [[Toyota Racing GmbH|Toyota Racing]]
|style="background:#ffffbf;"| 1
! 115
|-
! 2
|align=left| {{flagicon|DEU}} [[René Rast]]
|align=left| {{flagicon|DEU}} [[W Racing Team|BMW M Team WRT]]
|style="background:#dfdfdf;"| 2
! 98
|}
|}
"""

CALENDAR = """== Calendar ==
Text before the table.
{| class="wikitable"
! Rnd
! Race
! Circuit
! Location
! Date
|-
| 1
| [[6 Hours of Imola]]
| [[Imola Circuit]]
| {{flagicon|ITA}} [[Imola]], [[Italy]]
| 19 April
|-
| 2
| [[24 Hours of Le Mans]]
| [[Circuit de la Sarthe]]
| [[Le Mans]], France
| 13–14 June
|}
"""


def fetcher(url, params):
    if url.startswith(ms.JOLPICA):
        path = url[len(ms.JOLPICA) + 1:]
        if path == "2026.json":
            return {"MRData": {"RaceTable": {"Races": [
                {"round": "1", "raceName": "Australian Grand Prix", "url": "https://en.wikipedia.org/wiki/2026_Australian_Grand_Prix", "date": "2026-03-08", "time": "04:00:00Z",
                 "Circuit": {"circuitName": "Albert Park", "Location": {"locality": "Melbourne", "country": "Australia"}},
                 "FirstPractice": {"date": "2026-03-06", "time": "01:30:00Z"}, "Qualifying": {"date": "2026-03-07", "time": "05:00:00Z"}},
                {"round": "2", "raceName": "Chinese Grand Prix", "date": "2026-03-15", "time": "07:00:00Z", "Circuit": {"circuitName": "Shanghai", "Location": {"locality": "Shanghai", "country": "China"}},
                 "Sprint": {"date": "2026-03-14", "time": "03:00:00Z"}}]}}}
        if path == "2026/results.json":
            # Two pages; round 1's results split across them.
            row = lambda pos, given, family, team: {"position": str(pos), "number": str(pos), "points": str(26 - pos), "grid": str(pos), "laps": "58", "status": "Finished",
                                                    "Driver": {"givenName": given, "familyName": family, "code": family[:3].upper(), "nationality": "British" if family == "Norris" else "Dutch"}, "Constructor": {"name": team}}
            if params["offset"] == "0":
                return {"MRData": {"limit": "1", "total": "2", "RaceTable": {"Races": [{"round": "1", "Results": [row(1, "Lando", "Norris", "McLaren")]}]}}}
            return {"MRData": {"limit": "1", "total": "2", "RaceTable": {"Races": [{"round": "1", "Results": [row(2, "Max", "Verstappen", "Red Bull")]}]}}}
        if path == "2026/sprint.json":
            return {"MRData": {"limit": "100", "total": "0", "RaceTable": {"Races": []}}}
        if path == "2026/driverstandings.json":
            return {"MRData": {"StandingsTable": {"StandingsLists": [{"DriverStandings": [{"position": "1", "points": "25", "wins": "1", "Driver": {"givenName": "Lando", "familyName": "Norris", "nationality": "British"}, "Constructors": [{"name": "McLaren"}]}]}]}}}
        if path == "2026/constructorstandings.json":
            return {"MRData": {"StandingsTable": {"StandingsLists": [{"ConstructorStandings": [{"position": "1", "points": "43", "wins": "1", "Constructor": {"name": "McLaren"}}]}]}}}
    if url.endswith("race_list_basic.json"):
        return {"series_1": [
            {"race_id": 1, "race_name": "Daytona 500", "track_name": "Daytona", "date_scheduled": "2026-02-15T14:30:00", "race_type_id": 1, "winner_driver_id": 9,
             "scheduled_laps": 200, "stage_1_laps": 65, "stage_2_laps": 65, "number_of_cautions": 7, "schedule": [{"event_name": "Race", "start_time_utc": "2026-02-15T19:30:00"}]},
            {"race_id": 2, "race_name": "Clash", "track_name": "Bowman Gray", "date_scheduled": "2026-02-01T20:00:00", "race_type_id": 2},
            {"race_id": 3, "race_name": "Summer race", "track_name": "Pocono", "date_scheduled": "2026-07-01T15:00:00", "race_type_id": 1}]}
    if url.endswith("/1/weekend-feed.json"):
        return {"weekend_race": [{"results": [{"finishing_position": 2, "driver_fullname": "Second Guy"}, {"finishing_position": 1, "driver_fullname": "William Byron", "laps_led": 40, "hometown_country": "United States"}],
                                  "stage_results": [{"stage_number": 1, "results": [{"driver_fullname": "Stage Winner"}]}], "margin_of_victory": "0.1"}]}
    if url.endswith("points-feed.json"):
        return [{"position": 1, "driver_name": "William Byron", "points": 60, "wins": 1}]
    if url == ms.WIKIPEDIA:
        return {"parse": {"wikitext": CALENDAR + WEC_RESULTS + STANDINGS}}
    raise AssertionError(url)


def main():
    assert ms.unflag(ms.strip_markup("{{flagicon|JPN}} No. 8 [[Toyota Racing GmbH|Toyota Racing]]<ref>x</ref>")) == "No. 8 Toyota Racing"
    assert ms.people(ms.strip_markup("{{flagicon|CHE}} [[Sébastien Buemi]]<br>{{flagicon|NZL}} [[Brendon Hartley]]<br>[[No Flag]]")) == [
        {"name": "Sébastien Buemi", "cc": "ch"}, {"name": "Brendon Hartley", "cc": "nz"}, {"name": "No Flag", "cc": ""}]
    assert ms.parse_date("13–14 June", 2026) == ("2026-06-13", "13-14 June")
    assert ms.parse_date("January 24–25", 2026)[0] == "2026-01-24"
    assert ms.nascar_time("2026-02-15T14:30:00") == "2026-02-15T19:30:00Z"  # EST
    assert ms.nascar_time("2026-07-01T15:00:00") == "2026-07-01T19:00:00Z"  # EDT

    winners = ms.parse_class_winners(WEC_RESULTS)
    assert winners[1]["Hypercar"] == {"team": "No. 8 Toyota Racing", "cc": "jp", "drivers": [{"name": "Sébastien Buemi", "cc": "ch"}, {"name": "Brendon Hartley", "cc": "nz"}, {"name": "Ryō Hirakawa", "cc": "jp"}]}, winners[1]
    assert winners[2]["LMGT3"]["drivers"] == [{"name": "Antares Au", "cc": "hk"}]
    assert winners[2]["Hypercar"]["drivers"][0] == {"name": "René Rast", "cc": "de"}  # {{flagicon|GER}}
    imsa = ms.parse_class_winners(IMSA_RESULTS)
    assert set(imsa[1]) == {"GTP", "LMP2", "GTD Pro", "GTD"}, imsa
    assert imsa[1]["GTP"]["team"] == "#7 Porsche Penske Motorsport" and [d["name"] for d in imsa[1]["GTD"]["drivers"]] == ["Lucas Auer", "Indy Dontje"]
    assert imsa[1]["GTD"]["drivers"][1]["cc"] == "nl"  # {{flagicon|NED}}
    skipped = ms.parse_class_winners(IMSA_RESULTS.replace("#57 [[Winward Racing]]", "''did not participate''"))
    assert "GTD" not in skipped[1] and "GTP" in skipped[1]
    assert ms.country_code("SPA") == "es" and ms.country_code("NDL") == "nl"
    standings = ms.parse_standings(STANDINGS)
    assert standings[0] == {"pos": 1, "drivers": [{"name": "Sébastien Buemi", "cc": "ch"}, {"name": "Brendon Hartley", "cc": "nz"}], "team": "Toyota Racing", "points": 115.0}, standings
    assert standings[1]["drivers"] == [{"name": "René Rast", "cc": "de"}]
    shared = STANDINGS.replace("[[René Rast]]", "[[René Rast]]<br>[[Robin Frijns]]")
    assert [d["name"] for d in ms.parse_standings(shared)[1]["drivers"]] == ["René Rast", "Robin Frijns"]
    sessions = ms.nascar_sessions({"schedule": [{"event_name": "Haulers Enter", "start_time_utc": "2026-02-10T21:00:00"}, {"event_name": "Practice 1", "start_time_utc": "2026-02-11T15:00:00"},
                                               {"event_name": "Garage Hours", "start_time_utc": "2026-02-11T11:00:00"}, {"event_name": "Qualifying (Impound)", "start_time_utc": "2026-02-12T15:00:00"}]})
    assert [item["name"] for item in sessions] == ["Practice 1", "Qualifying (Impound)"], sessions
    calendar = ms.parse_calendar(CALENDAR, 2026)
    assert calendar[1] == {"round": 2, "name": "24 Hours of Le Mans", "circuit": "Circuit de la Sarthe", "location": "Le Mans, France", "start": "2026-06-13", "dateText": "13-14 June"}, calendar[1]
    assert ms.section(CALENDAR + WEC_RESULTS, "Race results").strip().startswith("{|")

    f1 = ms.build_f1(2026, fetcher)
    assert [r["name"] for r in f1["rounds"]] == ["Australian Grand Prix", "Chinese Grand Prix"]
    assert [row["driver"] for row in f1["rounds"][0]["results"]] == ["Lando Norris", "Max Verstappen"]  # pages merged
    assert [row["cc"] for row in f1["rounds"][0]["results"]] == ["gb", "nl"] and f1["standings"][0]["rows"][0]["cc"] == "gb"
    assert [s["name"] for s in f1["rounds"][0]["sessions"]] == ["Practice 1", "Qualifying", "Race"]
    assert f1["rounds"][1]["sessions"][0]["name"] == "Sprint" and not f1["complete"]
    assert f1["standings"][0]["rows"][0]["name"] == "Lando Norris" and f1["standings"][1]["rows"][0]["points"] == 43

    nascar = ms.build_nascar(2026, fetcher)
    cup = nascar["series"][0]
    assert [r["name"] for r in cup["rounds"]] == ["Daytona 500", "Summer race"]  # the exhibition is skipped
    assert cup["rounds"][0]["winner"] == "William Byron" and cup["rounds"][0]["results"][0]["led"] == 40
    assert cup["rounds"][0]["stageWinners"] == [{"stage": 1, "driver": "Stage Winner"}] and cup["rounds"][0]["sessions"][0]["start"] == "2026-02-15T19:30:00Z"
    assert cup["standings"][0]["rows"][0]["name"] == "William Byron" and cup["standings"][0]["rows"][0]["cc"] == "us"
    assert cup["rounds"][0]["results"][0]["cc"] == "us"
    # Finished races are reused from the previous file instead of refetched.
    calls = []
    def counting(url, params):
        calls.append(url)
        return fetcher(url, params)
    ms.build_nascar(2026, counting, previous=nascar)
    assert not [url for url in calls if "weekend-feed" in url], calls

    wec = ms.build_wec(2026, fetcher)
    assert wec["rounds"][0]["winners"]["Hypercar"]["team"] == "No. 8 Toyota Racing" and wec["standings"][0]["title"] == "Hypercar drivers"
    assert wec["source"]["license"] == "CC BY-SA 4.0"

    summary = ms.summarize([f1, nascar, wec], now=datetime(2026, 3, 10, tzinfo=timezone.utc))
    by_id = {item["id"]: item for item in summary}
    assert by_id["f1"]["next"]["name"] == "Chinese Grand Prix" and by_id["f1"]["last"]["winner"] == "Lando Norris"
    assert by_id["nascar"]["next"]["name"] == "Summer race" and by_id["nascar"]["last"]["winner"] == "William Byron"
    assert by_id["wec"]["last"]["winner"] == "No. 10 Garage 59" or by_id["wec"]["last"]["winner"].startswith("No.")
    assert by_id["f1"]["leader"] == {"name": "Lando Norris", "cc": "gb", "points": 25.0, "title": "Drivers"}
    assert by_id["f1"]["last"]["cc"] == "gb" and by_id["wec"]["leader"]["cc"] == "ch"
    # Team logos: lead image when it's a logo, else the infobox logo; teams looked up before are kept.
    def wiki(url, params):
        if params.get("prop") == "pageimages":
            return {"query": {"pages": [{"title": "Team Penske", "pageimage": "Penske_car_2026.jpg"}, {"title": "Mercedes-Benz in Formula One", "pageimage": "Mercedes_F1_logo.svg"}]}}
        if params.get("action") == "parse":
            return {"parse": {"wikitext": "{{Infobox racing team\n| logo = Team Penske logo.png\n| image = Car.jpg\n}}"}} if params["page"] == "Team Penske" else {"parse": {"wikitext": ""}}
        if params.get("prop") == "imageinfo":
            return {"query": {"pages": [{"title": f"File:{name}", "imageinfo": [{"thumburl": f"https://thumb.wikimedia.org/thumb/{name}?utm_source=x"}]} for name in [t.removeprefix("File:") for t in params["titles"].split("|")]]}}
        raise AssertionError(params)
    built = [{"teamArticles": {"Mercedes": "Mercedes-Benz in Formula One"}}, {"teamArticles": {"Team Penske": "Team Penske", "Unknown Racing": "Unknown Racing"}}]
    logos = ms.build_logos(built, fetcher=wiki, now=datetime(2026, 11, 22, tzinfo=timezone.utc))
    assert logos["Mercedes"]["url"].endswith("Mercedes_F1_logo.svg") and logos["Team Penske"]["url"].endswith("Team Penske logo.png"), logos
    assert logos["Unknown Racing"]["url"] == ""
    again = ms.build_logos(built, previous=logos, fetcher=lambda *a: (_ for _ in ()).throw(AssertionError("refetched")), now=datetime(2026, 11, 30, tzinfo=timezone.utc))
    assert again == logos
    wec_full = ms.build_wec(2026, fetcher)
    assert wec_full["teamArticles"].get("No. 8 Toyota Racing") == "Toyota Racing GmbH", wec_full["teamArticles"]
    infobox = """{{Infobox motor racing venue
| logo              = [[File:Daytona International Speedway logo.png|frameless]]
| image             = [[File:Daytona International Speedway 2024.svg|class=skin-invert|250px]]
| image_caption     = Tri-Oval (1959–present)
| track_map         = [[File:Daytona International Speedway Road Course 2024.svg|class=skin-invert|250px|]]
| track_map_caption = Sports Car Course (1985–present)
| layout            = NASCAR [[Tri-oval|Tri-Oval]]
}}"""
    assert ms.track_layouts(infobox) == [("Daytona International Speedway 2024.svg", "Tri-Oval (1959–present)"),
                                         ("Daytona International Speedway Road Course 2024.svg", "Sports Car Course (1985–present)")], ms.track_layouts(infobox)
    def track_wiki(url, params):
        if params.get("prop") == "pageimages":
            return {"query": {"pages": [{"title": t, "pageimage": f"{t}_2024.svg"} for t in params["titles"].split("|")]}}
        if params.get("action") == "parse":
            return {"parse": {"wikitext": infobox}}
        return {"query": {"pages": [{"title": t, "imageinfo": [{"thumburl": "https://thumb.wikimedia.org/x/" + t.removeprefix("File:")}]} for t in params["titles"].split("|")]}}
    maps = ms.build_track_maps([{"id": "imsa", "circuitArticles": {"Daytona": "Daytona International Speedway"}},
                                {"id": "f1", "circuitArticles": {"Las Vegas": "Las Vegas Grand Prix#Circuit"}}], fetcher=track_wiki)
    assert [m["caption"] for m in maps["Daytona"]["maps"]] == ["Tri-Oval (1959–present)", "Sports Car Course (1985–present)"], maps  # infobox for sports-car tracks
    assert maps["Las Vegas"]["article"] == "Las Vegas Grand Prix" and maps["Las Vegas"]["maps"][0]["url"].endswith("Las Vegas Grand Prix 2024.svg"), maps["Las Vegas"]  # lead image
    assert ms.build_wec(2026, fetcher)["circuitArticles"].get("Circuit de la Sarthe") == "Circuit de la Sarthe", ms.build_wec(2026, fetcher)["circuitArticles"]
    print("update_motorsports tests passed")


if __name__ == "__main__":
    main()
