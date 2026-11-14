import json
import unittest
from unittest.mock import patch

import update_game_catalog as catalog
import update_game_releases as releases
import update_games_sidebar as sidebar

RSS = b"""<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>&#8220;Big&#8221; News</title><link>https://www.gamespot.com/articles/big/</link><pubDate>Sat, 14 Nov 2026 02:02:04 +0000</pubDate>
<media:content url="https://www.gamespot.com/a/uploads/big.jpg"/></item>
<item><title>Off-site</title><link>https://example.com/x</link><pubDate>Sat, 14 Nov 2026 02:02:04 +0000</pubDate></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Polygon story</title><link rel="alternate" href="https://www.polygon.com/story"/><published>2026-11-13T10:00:00-05:00</published></entry>
</feed>"""

YOUTUBE = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<entry><yt:videoId>abcdefghijk</yt:videoId><title>Ghost of Yotei - Launch Trailer</title><published>2026-11-12T15:00:00+00:00</published></entry>
<entry><yt:videoId>lmnopqrstuv</yt:videoId><title>Behind the scenes podcast</title><published>2026-11-12T15:00:00+00:00</published></entry>
</feed>"""

EPIC = {"data": {"Catalog": {"searchStore": {"elements": [
    {"title": "Free Now", "catalogNs": {"mappings": [{"pageSlug": "free-now"}]}, "keyImages": [{"type": "Thumbnail", "url": "https://cdn1.epicgames.com/a.jpg"}],
     "promotions": {"promotionalOffers": [{"promotionalOffers": [{"startDate": "2026-11-12T16:00:00.000Z", "endDate": "2026-11-19T16:00:00.000Z", "discountSetting": {"discountPercentage": 0}}]}], "upcomingPromotionalOffers": []}},
    {"title": "On Sale", "productSlug": "on-sale", "promotions": {"promotionalOffers": [{"promotionalOffers": [{"startDate": "2026-11-12T16:00:00.000Z", "endDate": "2026-11-19T16:00:00.000Z", "discountSetting": {"discountPercentage": 50}}]}]}},
    {"title": "Next Week", "productSlug": "next-week/home", "promotions": {"promotionalOffers": [], "upcomingPromotionalOffers": [{"promotionalOffers": [{"startDate": "2026-11-19T16:00:00.000Z", "endDate": "2026-11-26T16:00:00.000Z", "discountSetting": {"discountPercentage": 0}}]}]}},
    {"title": "No Promotion", "promotions": None},
]}}}}


class GamesSidebarTests(unittest.TestCase):
    def test_rss_and_atom_feeds(self):
        items = sidebar.feed_items(RSS, "GameSpot", ("www.gamespot.com",))
        self.assertEqual(len(items), 1)  # off-site links are dropped
        self.assertEqual((items[0]["title"], items[0]["image"], items[0]["published"]),
                         ("“Big” News", "https://www.gamespot.com/a/uploads/big.jpg", "2026-11-14T02:02:04+00:00"))
        atom = sidebar.feed_items(ATOM, "Polygon", ("www.polygon.com",))
        self.assertEqual((atom[0]["url"], atom[0]["published"]), ("https://www.polygon.com/story", "2026-11-13T15:00:00+00:00"))

    def test_trailers_keep_only_trailer_videos(self):
        items = sidebar.trailer_items(YOUTUBE, "PlayStation")
        self.assertEqual([item["videoId"] for item in items], ["abcdefghijk"])
        self.assertEqual(items[0]["url"], "https://www.youtube.com/watch?v=abcdefghijk")

    def test_epic_free_games(self):
        games = sidebar.epic_free_games(EPIC, "2026-11-14T00:00:00+00:00")
        self.assertEqual([(game["title"], game["state"]) for game in games], [("Free Now", "now"), ("Next Week", "upcoming")])
        self.assertEqual(games[0]["url"], "https://store.epicgames.com/en-US/p/free-now")
        self.assertEqual(games[1]["url"], "https://store.epicgames.com/en-US/p/next-week")
        # Promotions that already ended are skipped.
        self.assertEqual(sidebar.epic_free_games(EPIC, "2026-12-01T00:00:00+00:00"), [])


class GameCatalogTests(unittest.TestCase):
    def test_build_index_and_details(self):
        games = [
            {"id": 1001, "name": "Hades II", "first_release_date": 1758758400, "cover": {"image_id": "co1abc"},
             "platforms": [{"abbreviation": "PC"}, {"abbreviation": "Switch"}, {"name": "Nintendo Switch 2"}],
             "genres": [{"name": "Roguelike"}], "aggregated_rating": 92.6, "aggregated_rating_count": 40,
             "total_rating": 91.2, "total_rating_count": 300, "url": "https://www.igdb.com/games/hades-ii"},
            {"id": 7, "name": "No Date"},
            {"id": 8, "name": ""},
        ]
        times = {1001: {"game_id": 1001, "hastily": 88200, "normally": 144000, "completely": 324000, "count": 120}}
        index, shards = catalog.build(games, times)
        self.assertEqual(index, [[1001, "Hades II", 2025, "co1abc"], [7, "No Date", None, ""]])
        detail = shards[1001 % catalog.SHARDS]["1001"]
        self.assertEqual(detail["released"], "2025-09-25")
        self.assertEqual(detail["platforms"], ["Nintendo Switch 2", "PC", "Switch"])
        self.assertEqual((detail["criticScore"], detail["criticCount"]), (93, 40))
        self.assertEqual(detail["timeToBeat"], {"main": 24.5, "extra": 40.0, "complete": 90.0, "submissions": 120})
        self.assertNotIn("timeToBeat", shards[7]["7"])

    def test_skips_without_credentials(self):
        with patch.dict("os.environ", {"TWITCH_CLIENT_ID": "", "TWITCH_CLIENT_SECRET": ""}), patch.object(catalog, "write") as write:
            catalog.main()
        write.assert_not_called()


class GameReleaseTests(unittest.TestCase):
    def test_parser_keeps_only_its_year(self):
        html = """<span class="calendar_entry"><a href="/product/a">Game A</a><time datetime="2027-02-03">x</time></span>"""
        parser = releases.ReleaseParser(2026)
        parser.feed(html)
        self.assertEqual(parser.releases, [])
        self.assertEqual(releases.YEARS, [releases.CURRENT_YEAR - 1, releases.CURRENT_YEAR, releases.CURRENT_YEAR + 1])


if __name__ == "__main__":
    unittest.main()
