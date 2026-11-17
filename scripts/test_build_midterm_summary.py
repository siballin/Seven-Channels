import json
import tempfile
import unittest
from pathlib import Path

import build_midterm_summary as summary


def write(folder, name, data):
    (folder / name).write_text(json.dumps(data), encoding="utf-8")


class SummaryTests(unittest.TestCase):
    def test_president_party_changes_votes_swing_and_flips(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            write(folder, "index.json", {"midtermYears": [1994, 1998, 2026]})
            write(folder, "president.json", {"years": {
                "1992": {"candidates": [{"name": "Bill Clinton", "party": "D", "ev": 370}, {"name": "George Bush", "party": "R", "ev": 168}]},
                "1996": {"candidates": [{"name": "Bill Clinton", "party": "D", "ev": 379}]},
                "2024": {"candidates": [{"name": "Donald J. Trump", "party": "R", "ev": 312}]}}})
            district = lambda d, r: {"candidates": [{"party": "D", "votes": d}, {"party": "R", "votes": r}]}
            write(folder, "midterm-1994.json", {"year": 1994, "congress": 104, "preliminary": False,
                "house": {"before": {"D": 258, "R": 176}, "after": {"D": 204, "R": 230}, "districts": {"A-1": district(45, 55)}},
                "senate": {"before": {"D": 57, "R": 43}, "after": {"D": 47, "R": 53},
                           "races": [{"state": "AZ", "winner": "R", "previousParty": "D", "flip": True}, {"state": "VT", "winner": "D", "previousParty": "D"}]}})
            write(folder, "midterm-1998.json", {"year": 1998, "congress": 106, "preliminary": False,
                "house": {"before": {"D": 207, "R": 226}, "after": {"D": 211, "R": 223}, "districts": {"A-1": district(50, 50)}},
                "senate": {"before": {"D": 45, "R": 55}, "after": {"D": 45, "R": 55}, "races": []}})
            write(folder, "midterm-2026.json", {"year": 2026, "congress": 120, "preliminary": True,
                "house": {"before": {"D": 215, "R": 220}, "called": {"D": 259, "R": 170}, "uncalled": 6, "districts": {}},
                "senate": {"before": {"D": 45, "R": 53}, "called": {"D": 21, "R": 13},
                           "races": [{"state": "TX", "winner": "D", "previousParty": None, "flip": True}]}})
            years = {entry["year"]: entry for entry in summary.build(folder)["years"]}
        y94, y98, y26 = years[1994], years[1998], years[2026]
        self.assertEqual((y94["president"]["name"], y94["house"]["presidentPartyChange"], y94["senate"]["presidentPartyChange"]), ("Bill Clinton", -54, -10))
        self.assertEqual((y94["house"]["share"], y94["house"]["margin"], y94["house"]["swing"]), ({"D": 45.0, "R": 55.0}, -10.0, None))
        self.assertEqual(y94["senate"]["flips"], [{"state": "AZ", "from": "D", "to": "R", "special": False}])
        self.assertEqual((y98["house"]["presidentPartyChange"], y98["house"]["swing"]), (4, 10.0))
        self.assertEqual(y26["president"]["name"], "Donald Trump")
        self.assertEqual((y26["house"]["presidentPartyChange"], y26["house"]["uncalled"], y26["house"]["votes"]), (-50, 6, None))
        self.assertEqual((y26["senate"]["flips"][0]["from"], y26["senate"]["presidentPartyChange"], y26["senate"]["after"]), ("R", -1, None))


if __name__ == "__main__":
    unittest.main()
