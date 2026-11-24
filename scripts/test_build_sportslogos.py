import unittest

import build_sportslogos as logos

PAGE = """<h1 style="x">  Utah Jazz Logos  </h1>
<div class="franchise"><a href="/logos/list_by_team/255/New-Orleans-Jazz-Logos/" title="x">New Orleans Jazz</a> (1974/75-1978/79) ► <span>Utah Jazz</span> (1979/80-Pres)</div>
<div class="sln-two-col">
<h3 class="x">Utah Jazz Primary Logos History</h3></div><div class="team-card-list">
<div class="team-card" style="x"><a href="/logos/view/abc/Utah-Jazz-Logo/1980/Primary-Logo" title="Utah Jazz Primary Logo (1980 - 1996)"><div><img src="https://content.sportslogos.net/logos/6/234/thumbs/abc.gif" alt="a"><span>SportsLogos.Net</span></div>
<div class="card-text"><span style="x">1979/80 - 1995/96</span></div></a> </div>
<div class="team-card" style="x"><a href="/logos/view/def/Utah-Jazz-Logo/2023/Primary-Logo" title="Utah Jazz Primary Logo (2023 - Pres)"><div><img src="https://content.sportslogos.net/logos/6/234/thumbs/def.png" alt="a"></div>
<div class="card-text"><span style="x">2022/23 - Pres</span></div></a> </div>
<h3>Utah Jazz Alt on Dark Logos History</h3><div class="team-card" style="x"><a href="/logos/view/ghi/x" title="t"><img src="https://content.sportslogos.net/logos/6/234/thumbs/ghi.gif"></a> </div>
<h3>Utah Jazz Home Uniforms History</h3><div class="team-card" style="x"><a href="/logos/view/jkl/x" title="Utah Jazz Home Uniform (1980 - 1984)"><img src="https://content.sportslogos.net/logos/6/234/thumbs/jkl.gif">
<div class="card-text"><span>1979/80 - 1983/84</span></div></a> </div>
<h3>Utah Jazz Pocket Schedules History</h3><div class="team-card" style="x"><a href="/logos/view/mno/x" title="t"><img src="https://content.sportslogos.net/logos/6/234/thumbs/mno.gif"></a> </div>
"""


class SportsLogosTests(unittest.TestCase):
    def test_parse_team_page(self):
        page = logos.parse_team_page(PAGE)
        self.assertEqual(page["franchises"], [{"name": "New Orleans Jazz", "years": "1974/75-1978/79", "url": "https://www.sportslogos.net/logos/list_by_team/255/New-Orleans-Jazz-Logos/"}])
        self.assertEqual([section["name"] for section in page["sections"]], ["Primary Logos", "Home Uniforms"])  # on-dark and pocket schedules skipped
        first, second = page["sections"][0]["items"]
        self.assertEqual((first["from"], first["to"], first["view"]), ("1979/80", "1995/96", "https://www.sportslogos.net/logos/view/abc/Utah-Jazz-Logo/1980/Primary-Logo"))
        self.assertEqual((second["from"], second["to"]), ("2022/23", "present"))
        self.assertEqual(page["sections"][1]["items"][0]["thumb"], "https://content.sportslogos.net/logos/6/234/thumbs/jkl.gif")

    def test_local_image_names(self):
        self.assertEqual(logos.local_name("https://content.sportslogos.net/logos/6/234/thumbs/abc.gif"), "6-234-abc.gif")

    def test_team_links(self):
        html = '<a href="/logos/list_by_team/234/Utah-Jazz-Logos/">Utah Jazz</a><a href="/logos/list_by_team/236/Los-Angeles-Clippers-Logos/"><img></a>'
        links = logos.team_links(html)
        self.assertEqual(links["utahjazz"], "https://www.sportslogos.net/logos/list_by_team/234/Utah-Jazz-Logos/")
        self.assertEqual(links["losangelesclippers"], "https://www.sportslogos.net/logos/list_by_team/236/Los-Angeles-Clippers-Logos/")


if __name__ == "__main__":
    unittest.main()
