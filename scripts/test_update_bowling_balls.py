import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update_bowling_balls as balls

BRUNSWICK_PAGE = """<html><head><meta property="og:title" content="Purple Rhino Pro | Brunswick">
<meta property="og:image" content="https://example.test/rhino.png"></head><body>
<p>Its thick-shell design produces a higher RG and a lower differential.</p>
<h3>Core Numbers</h3><table><tr><td>16 lb</td><td>15 lb</td><td>14 lb</td></tr>
<tr><td>RG</td><td>2.517</td><td>2.568</td><td>2.585</td></tr>
<tr><td>DIFF</td><td>0.044</td><td>0.032</td><td>0.032</td></tr></table>
<h3>Spec Table</h3><dl><dt>Level</dt><dd>High</dd><dt>Core</dt><dd>Vintage Light Bulb</dd>
<dt>Coverstock</dt><dd>Savvy Hook 4.0 Solid</dd><dt>Cover Type</dt><dd>Solid Reactive</dd>
<dt>Release Date</dt><dd>October 22, 2026</dd></dl><p>Performance Index: HIGH</p></body></html>"""

TRACK_PAGE = """<h2>Specifications</h2><ul><li>Performance Upper Mid</li><li>Core MC 2 Asym</li>
<li>Coverstock Super Response Hybrid (HK22)</li><li>Cover Type Hybrid Reactive</li>
<li>Release Date August 13, 2026</li></ul><h3>Core Numbers</h3>
<table><tr><th>Weight</th><th>RG</th><th>DIFF</th><th>ASY</th></tr>
<tr><td>16 lb</td><td>2.485</td><td>0.044</td><td>0.017</td></tr>
<tr><td>15 lb</td><td>2.473</td><td>0.046</td><td>0.017</td></tr></table><p>Downloads</p>"""

HAMMER_BODY = """<h3>BALL SPECS</h3><ul><li><strong>CORE</strong><span> Obsession Tour</span></li>
<li><strong>COVERSTOCK</strong><span> C² Tour Edition</span></li><li><strong>COVER TYPE</strong><span> Solid Reactive</span></li>
<li><strong>RELEASE DATE</strong><span> September 17, 2026</span></li>
<li><strong>RG / DIFF / ASY</strong><span> 16 lb - RG (2.484) DIFF (0.029) ASY (0.011)
15 lb - RG (2.469) DIFF (0.034) ASY (0.013)</span></li></ul>"""

STORM_PAGE = """<div>Specifications</div><div>Brand: Storm</div><div>Line: Premier</div><div>Core: S_AI</div>
<div>Weight Block: S_Element Tour AI</div><div>Finish: S_4000 Grit</div><div>Symmetry: S_Asymmetrical</div>
<div>Differential: 0.035</div><div>Radius of Gyration: 2.47</div><div>Weight: 16</div>
<div>Coverstock: S_NRG_Pearl</div><div>Color: Amethyst Pearl</div><div>Release Date: 11/06/26</div><div>PSA: 0.013</div>
<div>Add To Compare</div>"""


class BowlingBallTests(unittest.TestCase):
    def test_dates_and_cover_types(self):
        self.assertEqual(balls.parse_date("September 17, 2026"), "2026-09-17")
        self.assertEqual(balls.parse_date("11/06/26"), "2026-11-06")
        self.assertEqual(balls.parse_date("2026-10-16"), "2026-10-16")
        self.assertEqual(balls.parse_date("not a date"), "")
        self.assertEqual(balls.cover_category("Hybrid Reactive"), "hybrid")
        self.assertEqual(balls.cover_category("Pearl Reactive"), "pearl")
        self.assertEqual(balls.cover_category("Solid Reactive"), "solid")
        self.assertEqual(balls.cover_category("Urethane"), "urethane")
        self.assertEqual(balls.cover_category("Polyester"), "polyester")
        self.assertEqual(balls.cover_category("R Clear Poly"), "polyester")

    def test_brunswick_column_layout(self):
        ball = balls.parse_brunswick_family_page(BRUNSWICK_PAGE, brand="Brunswick", url="https://brunswickbowling.com/products/balls/current/purple-rhino-pro")
        self.assertEqual((ball["name"], ball["releaseDate"], ball["coverType"]), ("Purple Rhino Pro", "2026-10-22", "solid"))
        self.assertEqual((ball["weight"], ball["rg"], ball["diff"], ball["intDiff"]), (15, 2.568, 0.032, None))
        self.assertEqual(ball["symmetry"], "symmetric")
        self.assertEqual(ball["core"], "Vintage Light Bulb")

    def test_row_layout_with_asymmetry(self):
        ball = balls.parse_shopify_product({"title": "Theorem Delta", "handle": "theorem-delta", "tags": ["Ball"]}, TRACK_PAGE,
                                           brand="Track", site="https://trackbowling.com")
        self.assertEqual((ball["rg"], ball["diff"], ball["intDiff"], ball["symmetry"]), (2.473, 0.046, 0.017, "asymmetric"))
        self.assertEqual((ball["coverType"], ball["releaseDate"]), ("hybrid", "2026-08-13"))

    def test_hammer_description_layout(self):
        ball = balls.parse_shopify_product({"title": "Zero Mercy Tour", "handle": "zero-mercy-tour", "tags": ["Balls"]}, HAMMER_BODY,
                                           brand="Hammer", site="https://hammerbowling.com")
        self.assertEqual((ball["weight"], ball["rg"], ball["diff"], ball["intDiff"]), (15, 2.469, 0.034, 0.013))
        self.assertEqual((ball["coverType"], ball["releaseDate"], ball["core"]), ("solid", "2026-09-17", "Obsession Tour"))

    def test_storm_layout(self):
        item = {"name": "Ion Pro Pearl", "brand": "STORM", "performanceLine": "Premier", "dateAvailable": "2026-10-16",
                "url": "https://www.stormbowling.com/storm-ion-pro-pearl-bowling-ball", "image": "https://example.test/ion.webp", "discontinued": "no"}
        ball = balls.parse_storm_page(STORM_PAGE, item)
        self.assertEqual((ball["brand"], ball["releaseDate"], ball["coverType"], ball["coverstock"]), ("Storm", "2026-11-06", "pearl", "NRG Pearl"))
        self.assertEqual((ball["weight"], ball["rg"], ball["diff"], ball["intDiff"], ball["symmetry"]), (16, 2.47, 0.035, 0.013, "asymmetric"))
        self.assertIs(ball["discontinued"], False)

    def test_inline_single_weight_layout(self):
        page = """<h3>Spec Table</h3><p>Level Top Shelf Core Katana Assault Asymmetric Coverstock HK22 - HyperKinetic
        Cover Type Hybrid Reactive Weights 16-14 lbs. RG 2.501 (15 lb.) DIFF 0.051 (15 lb.) ASY 0.020 (15 lb.)
        Warranty Two years from purchase date Release Date August 17, 2023</p>"""
        ball = balls.parse_brunswick_family_page(page, brand="Radical", url="https://radicalbowling.com/products/balls/retired/katana-strike",
                                                 fallback_name="Katana Strike")
        self.assertEqual((ball["weight"], ball["rg"], ball["diff"], ball["intDiff"], ball["symmetry"]), (15, 2.501, 0.051, 0.02, "asymmetric"))
        self.assertEqual((ball["releaseDate"], ball["coverType"], ball["discontinued"]), ("2023-08-17", "hybrid", True))

    def test_storm_feed_relative_links(self):
        feed = [{"name": "Level", "brand": "STORM", "dateAvailable": "2025-01-17", "url": "/storm-level-bowling-ball-2025", "discontinued": "no"},
                {"name": "No link", "brand": "STORM", "dateAvailable": "2025-01-17", "url": "", "discontinued": "no"}]
        fetched = []

        def fake_fetch(url, budgeted=True):
            fetched.append(url)
            return json.dumps(feed) if url == balls.STORM_FEED else STORM_PAGE

        collector = balls.Collector({})
        with patch.object(balls, "fetch", side_effect=fake_fetch):
            balls.collect_storm(collector)
        self.assertEqual(fetched[1:], ["https://www.stormbowling.com/storm-level-bowling-ball-2025"])
        level, unlinked = collector.balls.values()
        self.assertEqual((level["url"], level["rg"]), ("https://www.stormbowling.com/storm-level-bowling-ball-2025", 2.47))
        # Entries without a product page keep their release details, link to Storm's catalog and have no specs.
        self.assertEqual((unlinked["name"], unlinked["url"], unlinked["releaseDate"], unlinked["rg"]),
                         ("No link", balls.STORM_CATALOG_URL, "2025-01-17", None))

    def test_storm_missing_page_keeps_release(self):
        from urllib.error import HTTPError
        feed = [{"name": "Phaze A.I.", "brand": "STORM", "dateAvailable": "2024-10-18", "url": "/gone", "discontinued": "yes"}]

        def fake_fetch(url, budgeted=True):
            if url == balls.STORM_FEED:
                return json.dumps(feed)
            raise HTTPError(url, 404, "Not Found", None, None)

        collector = balls.Collector({})
        with patch.object(balls, "fetch", side_effect=fake_fetch):
            balls.collect_storm(collector)
        ball = next(iter(collector.balls.values()))
        self.assertEqual((ball["name"], ball["releaseDate"], ball["discontinued"], ball["rg"]), ("Phaze A.I.", "2024-10-18", True, None))

    def test_bowling_com_motiv_page(self):
        page = """<meta property="og:title" content="Motiv Lethal Venom Bowling Ball"><meta property="og:image" content="//cdn-images.bowling.com/lv.jpg">
        <a>Details &amp; Specs</a><p>A low RG (2.47), low differential (.036) core.</p>
        <h2>Details &amp; Specs</h2><dl><dt>Color</dt><dd>Black/Red</dd><dt>Core</dt><dd>Gear APG Asymmetric</dd>
        <dt>Coverstock</dt><dd>Leverage MXC Solid Reactive A few tiny pit holes in the cover stock of the ball are normal</dd>
        <dt>Finish</dt><dd>3000 Grit LSS</dd><dt>RG</dt><dd>2.47 (15# ball)</dd><dt>Differential</dt><dd>0.036 (15# ball)</dd>
        <dt>Mass Bias Diff</dt><dd>0.013 (15# ball)</dd><dt>Brand</dt><dd>Motiv</dd><dt>Release Date</dt><dd>February 2025</dd></dl>"""
        ball = balls.parse_bowling_com_page(page, "https://www.bowling.com/products/motiv-lethal-venom.htm")
        self.assertEqual((ball["name"], ball["brand"], ball["source"]), ("Lethal Venom", "Motiv", "Bowling.com"))
        self.assertEqual((ball["releaseDate"], ball["releaseDatePrecision"]), ("2025-02-01", "month"))
        self.assertEqual((ball["weight"], ball["rg"], ball["diff"], ball["intDiff"], ball["symmetry"]), (15, 2.47, 0.036, 0.013, "asymmetric"))
        self.assertEqual((ball["coverType"], ball["coverstock"], ball["image"]), ("solid", "Leverage MXC Solid Reactive", "https://cdn-images.bowling.com/lv.jpg"))
        self.assertIsNone(balls.parse_bowling_com_page(page.replace("<dd>Motiv</dd>", "<dd>Storm</dd>"), "https://www.bowling.com/x.htm"))

    def test_balls_sharing_a_link_survive_cached_runs(self):
        feed = [{"name": "Phaze A.I.", "brand": "STORM", "dateAvailable": "2024-10-18", "url": "", "discontinued": "yes"},
                {"name": "Road Warrior", "brand": "STORM", "dateAvailable": "2024-11-22", "url": "", "discontinued": "yes"}]
        fake_fetch = lambda url, budgeted=True: json.dumps(feed)
        first = balls.Collector({})
        with patch.object(balls, "fetch", side_effect=fake_fetch):
            balls.collect_storm(first)
        previous = {"balls": list(first.balls.values()), "checked": first.checked}
        second = balls.Collector(previous)
        with patch.object(balls, "fetch", side_effect=fake_fetch):
            balls.collect_storm(second)
        self.assertEqual(sorted(ball["name"] for ball in second.balls.values()), ["Phaze A.I.", "Road Warrior"])
        self.assertEqual({ball["url"] for ball in second.balls.values()}, {balls.STORM_CATALOG_URL})

    def test_symmetric_balls_hide_small_intermediate_numbers(self):
        ball = balls.build_ball(brand="Test", name="Sym", url="https://x.test/a", numbers={15: (2.5, 0.04, 0.003)})
        self.assertEqual((ball["symmetry"], ball["intDiff"]), ("symmetric", None))

    def test_cache_reuse_and_release_cutoff(self):
        previous = {"checked": {"https://x.test/a": "v1", "https://x.test/old": "v1"},
                    "balls": [{"url": "https://x.test/a", "name": "A", "releaseDate": "2024-01-01"}]}
        collector = balls.Collector(previous)
        self.assertTrue(collector.cached("https://x.test/a", "v1"))
        self.assertFalse(collector.cached("https://x.test/a2", "v1"))
        collector.record("https://x.test/old", "v2", {"name": "Old", "releaseDate": "2019-12-31"})
        self.assertEqual(list(collector.balls), ["https://x.test/a"])
        self.assertEqual(collector.checked["https://x.test/old"], "v2")

    def test_failed_brand_keeps_previous_data(self):
        previous = {
            "sources": [{"brand": "Hammer", "status": "ok", "refreshedAt": "2026-11-01T00:00:00Z", "count": 1}],
            "balls": [{"id": "hammer-a", "brand": "Hammer", "name": "A", "url": "https://hammerbowling.com/products/a", "releaseDate": "2025-01-01"}],
            "checked": {"https://hammerbowling.com/products/a": "v1"},
        }
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bowling-balls.json"
            path.write_text(json.dumps(previous))
            with patch.object(balls, "OUTPUT_PATH", path), patch.object(balls, "fetch", side_effect=OSError("offline")):
                balls.main()
            output = json.loads(path.read_text())
        hammer = next(source for source in output["sources"] if source["brand"] == "Hammer")
        self.assertEqual((hammer["status"], hammer["count"], hammer["refreshedAt"]), ("stale", 1, "2026-11-01T00:00:00Z"))
        self.assertEqual([ball["id"] for ball in output["balls"]], ["hammer-a"])
        self.assertEqual(output["checked"], {"https://hammerbowling.com/products/a": "v1"})
        self.assertEqual(next(source for source in output["sources"] if source["brand"] == "Track")["status"], "error")


if __name__ == "__main__":
    unittest.main()
