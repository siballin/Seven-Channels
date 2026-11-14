import unittest

import build_election_maps as build
import update_election_2026 as prelim


class ElectionBuildTests(unittest.TestCase):
    def test_fusion_lines_merge_and_cross_filed_candidates_take_the_larger_line(self):
        merged = build.combine([
            ("Lee M. Zeldin", "R", 121562), ("Lee M. Zeldin", "O", 14284), ("Perry Gershon", "D", 124213),
            ("Perry Gershon", "O", 3778), ("NA", "O", 47),
        ])
        self.assertEqual([(item["name"], item["party"], item["votes"]) for item in merged],
                         [("Lee M. Zeldin", "R", 135846), ("Perry Gershon", "D", 127991)])
        cross = build.combine([("Bud Shuster", "R", 90000), ("Bud Shuster", "D", 40000)])
        self.assertEqual(cross[0]["party"], "R")
        tie = build.combine([("Bud Shuster", "R", 1), ("Bud Shuster", "D", 1)])
        self.assertTrue(tie[0].get("partyTie"))

    def test_race_summary_margins_and_uncontested_races(self):
        summary = build.race_summary([{"name": "A", "party": "D", "votes": 600}, {"name": "B", "party": "R", "votes": 400}])
        self.assertEqual((summary["winner"], summary["margin"], summary["uncontested"]), ("D", 20.0, False))
        unopposed = build.race_summary([{"name": "Kathy Castor", "party": "D", "votes": 1}])
        self.assertEqual((unopposed["winner"], unopposed["uncontested"], unopposed["margin"], unopposed["candidates"]), ("D", True, None, []))
        many = build.race_summary([{"name": c, "party": "O", "votes": v} for c, v in zip("ABCDEF", (60, 50, 40, 30, 20, 10))])
        self.assertEqual(many["candidates"][-1], {"name": "Others", "party": "O", "votes": 30})

    def test_party_codes(self):
        self.assertEqual([build.party_code(text) for text in ("DEMOCRAT", "democratic-farmer-labor", "REPUBLICAN", "independent", "Green", "conservative")],
                         ["D", "D", "R", "I", "G", "O"])
        self.assertEqual([build.fec_party(code) for code in ("D", "D/WF", "R*", "DFL", "CRV", "W(D)/D")], ["D", "D", "R", "D", "O", "D"])

    def test_senate_classes_follow_the_six_year_cycle(self):
        self.assertEqual([build.senate_class(year) for year in (2016, 2018, 2020, 2022, 1982, 1994)], [3, 1, 2, 3, 1, 1])

    def test_electoral_exceptions_add_up(self):
        for year, states in build.ELECTORAL_EXCEPTIONS.items():
            for state, allocation in states.items():
                self.assertGreater(sum(allocation.values()), 2, f"{year} {state}")
        self.assertEqual(build.ELECTORAL_TOTALS[2020], {"D": 306, "R": 232})

    def test_name_helpers(self):
        self.assertEqual(build.title_name("BUBAR, BENJAMIN"), "Benjamin Bubar")
        self.assertEqual(build.last_name("William F. Clinger, Jr."), "clinger")
        self.assertEqual(build.last_name("Mark Steven Kirk"), build.last_name("Mark Kirk"))


ROW = """<table class="wikitable"><tr><th>District</th><th>Incumbent</th><th>Candidates</th></tr>
<tr><th><a>Arizona&#160;1</a></th><td>Republican</td><td>Incumbent retired.<br /><b>Democratic gain.</b></td>
<td><div class="plainlist"><ul><li><span>▌</span><img alt="Green tick" src="//x/Green_check.svg"/><span style="display:none">Y</span> <b><a>Amish Shah</a></b> (Democratic) 52.4%</li>
<li><span>▌</span><a>Jay Feely</a> (Republican) 45.1%</li></ul></div></td></tr>
<tr><th><a>Alaska&#160;at-large</a></th><td>Republican</td><td>Incumbent advanced to general</td>
<td><ul><li>▌ Nick Begich III (Republican)</li><li>▌ Eric Hafner (Democratic)</li></ul></td></tr>
<tr><th><a>New York 1</a></th><td>Republican</td><td>Incumbent re-elected.</td>
<td><ul><li><span style="display:none">Y</span> Nick LaLota (Republican/Cons.)</li><li>Chris Gallant (Democratic/ WFP )</li></ul></td></tr></table>"""


class PreliminaryParserTests(unittest.TestCase):
    def test_house_rows(self):
        districts = prelim.house_races(ROW)
        self.assertEqual(sorted(districts), ["AK-0", "AZ-1", "NY-1"])
        arizona = districts["AZ-1"]
        self.assertEqual((arizona["called"], arizona["winner"], arizona["winnerName"], arizona["flip"], arizona["margin"]),
                         (True, "D", "Amish Shah", True, 7.3))
        self.assertEqual((districts["AK-0"]["called"], districts["AK-0"]["winner"]), (False, ""))
        self.assertEqual((districts["NY-1"]["winner"], districts["NY-1"]["flip"], districts["NY-1"]["margin"]), ("R", False, None))
        self.assertEqual(districts["NY-1"]["candidates"][1]["party"], "D")


if __name__ == "__main__":
    unittest.main()
