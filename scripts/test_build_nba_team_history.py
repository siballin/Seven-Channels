import unittest

import build_nba_team_history as history

HTML = '''<div class="mw-heading mw-heading2"><h2 id="Logos">Logos and uniforms</h2></div>
<div role="note" class="hatnote">Main article: X</div>
<p>The Bucks' first logo was a deer<sup class="reference"><a>[1]</a></sup> wearing a sweater, used from 1968 to 1993.</p>
<figure typeof="mw:File/Thumb"><a href="/wiki/File:Bucks_1968.png"><img src="//upload.wikimedia.org/wikipedia/en/thumb/a/ab/Bucks_1968.png/220px-Bucks_1968.png" width="220" height="200"></a><figcaption>Logo, <i>1968–1993</i></figcaption></figure>
<h3>Uniforms</h3><ul class="gallery"><li class="gallerybox"><div class="thumb"><span><a href="/wiki/File:Home.svg"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Home.svg/120px-Home.svg.png" width="120" height="120"></a></span></div><div class="gallerytext">Home uniform (2015–present)</div></li></ul>
<table><tr><td>A long table cell that should never become a paragraph of text.</td></tr></table>
<p>Short.</p><img src="//upload.wikimedia.org/tiny.png" width="20" height="20"><img src="//thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Logo.png/250px-Logo.png?utm_source=x" width="180" height="85">'''


class TeamHistoryTests(unittest.TestCase):
    def test_parser_keeps_text_images_and_captions_in_order(self):
        parser = history.SectionParser()
        parser.feed(HTML)
        self.assertEqual(parser.blocks, [
            {"h": "Logos and uniforms", "level": 2},
            {"p": "The Bucks' first logo was a deer wearing a sweater, used from 1968 to 1993."},
            {"img": "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Bucks_1968.png/300px-Bucks_1968.png", "file": "https://en.wikipedia.org/wiki/File:Bucks_1968.png",
             "caption": "Logo, 1968–1993", "w": 220, "h": 200},
            {"h": "Uniforms", "level": 3},
            {"img": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Home.svg/300px-Home.svg.png", "file": "https://en.wikipedia.org/wiki/File:Home.svg",
             "caption": "Home uniform (2015–present)", "w": 120, "h": 120},
            {"img": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Logo.png/300px-Logo.png", "file": "", "caption": "", "w": 180, "h": 85},
        ])

    def test_every_team_has_an_article(self):
        self.assertEqual(len(history.TEAMS), 30)


if __name__ == "__main__":
    unittest.main()
