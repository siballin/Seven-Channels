import unittest

import build_governors as governors

TABLE = """{| class="wikitable sortable"
! State !! Incumbent !! Party !! First elected !! Result !! Candidates
|-
! [[1994 Texas gubernatorial election|Texas]]
| [[Ann Richards]]
| {{party shading/Democratic}} | Democratic
| 1990
| {{party shading/Republican}} | Incumbent lost re-election.<br>'''Republican gain'''.
| nowrap | {{plainlist |
* {{aye}} '''[[George W. Bush]]''' (Republican) 53.5%
* [[Ann Richards]] (Democratic) 45.9%
}}
|-
! [[#Minnesota|Minnesota]]
| [[Arne Carlson]]
| {{party shading/Text/Republican}}
| 1990
| Incumbent re-elected.
| nowrap | {{plainlist |
* {{aye}} '''[[Arne Carlson]]''' ([[Independent-Republican|IR]]) 63.3%
* [[John Marty]] ([[Minnesota Democratic–Farmer–Labor Party|DFL]]) 34.1%
}}
|}"""


class GovernorTests(unittest.TestCase):
    def test_rows_flips_and_parties(self):
        races = governors.parse_year('{| class="wikitable"\n! Ratings\n|}\n' + TABLE, 1994)
        self.assertEqual([(r["state"], r["previousParty"], r["winner"], r["flip"], r["margin"]) for r in races],
                         [("TX", "D", "R", True, 7.6), ("MN", "R", "R", False, 29.2)])
        self.assertEqual(races[1]["candidates"][1]["party"], "D")  # DFL counts as Democratic
        self.assertEqual(governors.summarize(races)["gains"], {"D": -1, "R": 1})


if __name__ == "__main__":
    unittest.main()
