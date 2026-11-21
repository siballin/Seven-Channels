"""Tests for build_idols.py with canned API responses. Run: python3 scripts/test_build_idols.py"""

import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_idols  # noqa: E402


def item(qid):
    return {"mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": qid}}}, "rank": "normal"}


def text(value, rank="normal"):
    return {"mainsnak": {"snaktype": "value", "datavalue": {"value": value}}, "rank": rank}


def date(value, precision=11):
    return text({"time": value, "precision": precision})


def entity(qid, en, ko="", claims=None, enwiki="", aliases=()):
    return {"id": qid, "labels": {**({"en": {"value": en}} if en else {}), **({"ko": {"value": ko}} if ko else {})},
            "aliases": {"en": [{"value": alias} for alias in aliases]}, "claims": claims or {},
            "sitelinks": {"enwiki": {"title": enwiki}} if enwiki else {}}


ENTITIES = {
    "Q1": entity("Q1", "aespa", "에스파", {
        "P2031": [date("+2020-11-17T00:00:00Z")], "P264": [item("Q95"), {**item("Q90"), "qualifiers": {}}], "P18": [text("Aespa 2024.jpg")],
        "P434": [text("dbb3c1a7-0a4c-4e2b-9bcd-7e4e1d6a1a11")], "P2003": [text("aespa_official")], "P495": [item("Q884")]}, "Aespa"),
    "Q2": entity("Q2", "aespa sub-unit", "", {"P361": [item("Q1")]}),
    "Q10": entity("Q10", "Karina", "카리나", {
        "P569": [date("+2000-04-11T00:00:00Z")], "P1477": [text({"text": "유지민", "language": "ko"}), text({"text": "Yu Ji-min", "language": "en"})],
        "P19": [item("Q91")], "P27": [item("Q884")], "P106": [item("Q177220"), item("Q5716684")],
        "P2048": [text({"amount": "+168", "unit": "http://www.wikidata.org/entity/Q174728"})],
        "P264": [item("Q90")], "P18": [text("Karina 2024.jpg")], "P463": [item("Q1")]}, "Karina (singer)", aliases=["Yu Ji-min"]),
    "Q11": {**entity("Q11", "", "지젤", {"P569": [date("+2000-10-30T00:00:00Z")], "P27": [item("Q17")]}), "labels": {"ko": {"value": "지젤"}, "mul": {"value": "Giselle\u200e"}}},
    "Q3": entity("Q3", "XG", "", {"P527": [{**item("Q31"), "qualifiers": {"P580": [{"datavalue": {"value": {"time": "+2022-03-18T00:00:00Z", "precision": 11}}}]}}]}),
    "Q31": entity("Q31", "Cocona", "", {}),
    "Q30": entity("Q30", "", "", {}, "Jurin (singer)"),
    "Q12": entity("Q12", "Former Member", "", {"P569": [date("+1999-00-00T00:00:00Z", 9)]}),
    "Q20": entity("Q20", "IU", "아이유", {"P569": [date("+1993-05-16T00:00:00Z")], "P2031": [date("+2008-09-18T00:00:00Z")]}, "IU (singer)"),
    "Q90": entity("Q90", "SM Entertainment", claims={"P17": [item("Q884")]}), "Q95": entity("Q95", "Capitol Records", claims={"P17": [item("Q30x")]}), "Q91": entity("Q91", "Anyang"), "Q884": entity("Q884", "South Korea"), "Q17": entity("Q17", "Japan"),
    "Q177220": entity("Q177220", "singer"), "Q5716684": entity("Q5716684", "dancer"),
}


def fetcher(url, params):
    if url == build_idols.SPARQL:
        query = params["query"]
        g = lambda qid: {"type": "uri", "value": f"http://www.wikidata.org/entity/{qid}"}  # noqa: E731
        if "VALUES ?name" in query:
            rows = []
        elif "VALUES ?mbid" in query:
            rows = [{"g": g("Q3")}] if '"8dfe067c-ae90-472e-80f2-fcee9be4e158"' in query else []
        elif "ps:P463 wd:Q3 " in query:
            rows = [{"p": g("Q30"), "start": {"value": "2022-01-01T00:00:00Z"}}]
        elif "?start" in query:
            rows = [{"g": g("Q1"), "p": g("Q10"), "start": {"value": "2020-01-01T00:00:00Z"}},
                    {"g": g("Q1"), "p": g("Q11")},
                    {"g": g("Q1"), "p": g("Q12"), "start": {"value": "2019-01-01T00:00:00Z"}, "end": {"value": "2021-01-01T00:00:00Z"}}]
        elif "?g" in query:
            rows = [{"g": g("Q1")}, {"g": g("Q2")}]
        else:
            rows = [{"p": g("Q20")}]
        return {"results": {"bindings": rows}}
    if url == build_idols.WIKIDATA_API:
        return {"entities": {qid: ENTITIES[qid] if qid in ENTITIES else {"id": qid, "missing": ""} for qid in params["ids"].split("|")}}
    if url == build_idols.WIKIPEDIA_API:
        pages = [{"title": "Aespa", "extract": "Aespa (Korean: 에스파; RR: eseupa) is a South Korean girl group formed by SM Entertainment."},
                 {"title": "Karina (singer)", "extract": "Yu Ji-min (Korean: 유지민; born April 11, 2000), known as Karina, is a South Korean singer."}]
        return {"query": {"pages": [page for page in pages if page["title"] in params["titles"].split("|")]}}
    if url == build_idols.KPOPWIKI_API:
        wiki = {
            "Karina (aespa)": "{{Infobox\n| birth_date = {{Birth date and age|2000|4|11}}\n}}\n== Trivia ==\n* Her MBTI was INFP.<ref>x ENTJ</ref> She later said it is now ENFP.\n",
            "Giselle (aespa)": "{{Infobox\n| birth_date = {{Birth date and age|1999|1|1}}\n}}\n* Her MBTI is ISTP.\n",
        }
        titles = params["titles"].split("|")
        return {"query": {"pages": [{"title": title, "revisions": [{"slots": {"main": {"content": wiki[title]}}}]} for title in titles if title in wiki]}}
    if url == build_idols.COMMONS_API:
        return {"query": {"pages": [{"title": f"File:{name}", "imageinfo": [{
            "thumburl": f"https://upload.wikimedia.org/thumb/{name}", "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{name}",
            "extmetadata": {"Artist": {"value": "<a href='x'>Photographer</a>"}, "LicenseShortName": {"value": "CC BY 4.0"}}}]}
            for name in [title.removeprefix("File:") for title in params["titles"].split("|")]]}}
    raise AssertionError(url)


def main():
    folder = Path(tempfile.mkdtemp())
    build_idols.NAMU_DUMP = folder / "namu-dump.json"
    build_idols.NAMU_LIVE = folder / "namu-live.json"
    build_idols.KPOPWIKI_CACHE = folder / "kpopwiki.json"
    build_idols.NAMU_DUMP.write_text(json.dumps({"people": {"Q10": {"positions": ["Leader", "Main dancer"], "mbti": "INFP", "title": "카리나(aespa)"}, "Q11": {"positions": ["Main rapper"], "title": "지젤(aespa)"}}}))
    build_idols.NAMU_LIVE.write_text(json.dumps({"people": {"Q11": {"positions": ["Main rapper", "Sub vocalist"], "mbti": "ENFJ", "title": "지젤"}}}))
    groups, people = build_idols.build(fetcher=fetcher, log=lambda *_: None)
    # Source priority: Namu dump < Kpop Wiki < Namu live; the Kpop Wiki page must have the same birth date.
    assert people["Q10"]["positions"] == ["Leader", "Main dancer"] and people["Q10"]["mbti"] == "ENFP", people["Q10"]
    assert people["Q10"]["factSources"]["mbti"]["name"] == "Kpop Wiki" and people["Q10"]["factSources"]["positions"]["name"] == "Namu Wiki (2021 dump)"
    assert people["Q10"]["factSources"]["positions"]["url"].startswith("https://namu.wiki/w/%EC%B9%B4")
    assert people["Q11"]["positions"] == ["Main rapper", "Sub vocalist"] and people["Q11"]["mbti"] == "ENFJ"  # Giselle's Kpop Wiki birth date differs
    assert people["Q11"]["factSources"]["mbti"]["name"] == "Namu Wiki"
    assert build_idols.kpopwiki_mbti_from("* His MBTI personality type is ENFP.<ref>[https://x INTJ]</ref>") == "ENFP"
    aespa = groups["Q1"]
    assert aespa["ko"] == "에스파" and aespa["debut"] == "2020-11-17", aespa
    assert [member["name"] for member in aespa["members"]] == ["Karina", "Giselle", "Former Member"], aespa["members"]
    assert aespa["members"][2]["end"] == "2021"
    assert [agency["name"] for agency in aespa["agencies"]] == ["SM Entertainment", "Capitol Records"], aespa["agencies"]
    assert aespa["agencies"][0]["korean"] and not aespa["agencies"][1]["korean"]
    assert people["Q11"]["name"] == "Giselle", people["Q11"]["name"]  # multilingual label, invisible mark removed
    assert aespa["photo"]["author"] == "Photographer" and aespa["photo"]["license"] == "CC BY 4.0"
    assert aespa["bio"]["text"].startswith("Aespa is a South Korean girl group"), aespa["bio"]
    assert aespa["subunits"] == [{"id": "Q2", "name": "aespa sub-unit"}]
    assert aespa["links"]["instagram"] == "https://www.instagram.com/aespa_official/"
    karina = people["Q10"]
    assert karina["birthName"] == "유지민" and karina["birthNameEn"] == "Yu Ji-min"
    assert karina["birth"] == "2000-04-11" and karina["height"] == 168 and karina["birthplace"] == "Anyang"
    assert karina["occupations"] == ["singer", "dancer"] and karina["nationality"] == ["South Korea"]
    assert karina["groups"] == [{"id": "Q1", "name": "aespa", "start": "2020", "end": ""}]
    assert karina["bio"]["url"] == "https://en.wikipedia.org/wiki/Karina_%28singer%29"
    assert people["Q12"]["birth"] == "1999"
    assert people["Q20"]["groups"] == [] and people["Q20"]["debut"] == "2008-09-18"

    # Overrides by id and by name; overrides win.
    with tempfile.TemporaryDirectory() as folder:
        build_idols.OUT = Path(folder)
        build_idols.OVERRIDES = Path(folder) / "overrides.json"
        build_idols.OVERRIDES.write_text(json.dumps({"includeGroups": ["8dfe067c-ae90-472e-80f2-fcee9be4e158"], "groups": {"AESPA": {"fandom": "MY", "removeMembers": ["former member"]}}, "people": {"Q10": {"positions": ["Leader"], "height": 167}}}))
        groups, people = build_idols.build(fetcher=fetcher, log=lambda *_: None)
        assert groups["Q1"]["fandom"] == "MY" and groups["Q1"]["edited"] == ["fandom"]
        assert [member["name"] for member in groups["Q1"]["members"]] == ["Karina", "Giselle"]
        assert [member["name"] for member in groups["Q3"]["members"]] == ["Cocona", "Jurin"], groups["Q3"]["members"]  # English Wikipedia title as a name; P527 members
        assert people["Q10"]["positions"] == ["Leader"] and people["Q10"]["height"] == 167
        assert "positions" not in people["Q10"]["factSources"] and people["Q10"]["factSources"]["mbti"]["name"] == "Kpop Wiki"  # your override has no outside source
        build_idols.write(groups, people, now="2026-11-20T00:00:00+00:00")
        index = json.loads((Path(folder) / "index.json").read_text())
        assert {row["id"] for row in index["groups"]} == {"Q1", "Q2", "Q3"}
        karina_row = next(row for row in index["people"] if row["id"] == "Q10")
        assert karina_row["g"] == ["Q1"] and karina_row["k"] == "카리나" and karina_row["p"].startswith("https://upload.wikimedia.org/")
        shard = json.loads((Path(folder) / "people" / f"{10 % 64:02d}.json").read_text())
        assert shard["people"]["Q10"]["name"] == "Karina"
        assert len(list((Path(folder) / "people").glob("*.json"))) == 64
    print("build_idols tests passed")


if __name__ == "__main__":
    main()
