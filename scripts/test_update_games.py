import json
import unittest
from unittest.mock import patch

import update_game_catalog as catalog
import update_game_releases as releases
import update_games_sidebar as sidebar
import update_steam as steam
import update_esports as esports
from urllib.error import HTTPError

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

    def test_game_page_extras(self):
        extras = catalog.extras({"summary": "  A   game. ", "screenshots": [{"image_id": "sc1"}, {"image_id": "BAD ID"}], "videos": [{"video_id": "abcdefghijk"}],
                                 "similar_games": [3, 4], "involved_companies": [{"company": {"name": "Dev Co"}, "developer": True, "publisher": False},
                                                                                {"company": {"name": "Pub Co"}, "developer": False, "publisher": True}],
                                 "websites": [{"url": "https://store.steampowered.com/app/1"}, {"url": "https://example.com"}, {"url": "https://foo.itch.io/game"}]})
        self.assertEqual(extras, {"summary": "A game.", "screenshots": ["sc1"], "video": "abcdefghijk", "similar": [3, 4], "developers": ["Dev Co"],
                                  "publishers": ["Pub Co"], "stores": {"Steam": "https://store.steampowered.com/app/1", "itch.io": "https://foo.itch.io/game"}})
        self.assertEqual(catalog.extras({}), {})

    def test_skips_without_credentials(self):
        with patch.dict("os.environ", {"TWITCH_CLIENT_ID": "", "TWITCH_CLIENT_SECRET": ""}), patch.object(catalog, "write") as write:
            catalog.main()
        write.assert_not_called()


class GamesExtraTests(unittest.TestCase):
    def test_gamerpower_free_games(self):
        data = [
            {"title": "Mark of the Deep (Epic Games) Giveaway", "type": "Game", "status": "Active", "platforms": "PC, Epic Games Store", "worth": "$19.99",
             "end_date": "2026-11-26 23:59:00", "open_giveaway_url": "https://www.gamerpower.com/open/mark", "thumbnail": "https://www.gamerpower.com/a.jpg"},
            {"title": "Old Giveaway", "type": "Game", "status": "Active", "platforms": "PC, Steam", "end_date": "2026-11-01 00:00:00", "open_giveaway_url": "https://x.com/a"},
            {"title": "Skin pack", "type": "DLC", "status": "Active", "platforms": "PC, Steam", "open_giveaway_url": "https://x.com/b"},
            {"title": "Lonesome Village (Mobile) Giveaway", "type": "Game", "status": "Active", "platforms": "Android, iOS", "worth": "N/A",
             "end_date": "N/A", "open_giveaway_url": "https://www.gamerpower.com/open/lv"},
        ]
        games = sidebar.gamerpower_free_games(data, "2026-11-23T00:00:00+00:00")
        self.assertEqual([game["title"] for game in games], ["Mark of the Deep", "Lonesome Village"])
        self.assertEqual(games[0]["store"], "Epic")
        self.assertEqual(games[0]["worth"], "$19.99")
        self.assertEqual(games[0]["end"], "2026-11-26T23:59:00+00:00")
        self.assertEqual(games[1]["store"], "Mobile")
        self.assertEqual(games[1]["worth"], "")

    def test_game_pass(self):
        ids = {"f13cf6b4-57e6-4459-89df-6aec18cf0538": ["9AAAAAAAAAAA", "9BBBBBBBBBBB"], "095bda36-f5cd-43f2-9ee1-0a72f371fb96": ["9CCCCCCCCCCC"],
               "393f05bf-e596-4ef6-9487-6d4fa0eab987": [], sidebar.GAME_PASS_CONSOLE: ["9AAAAAAAAAAA"], sidebar.GAME_PASS_PC: ["9AAAAAAAAAAA", "9BBBBBBBBBBB"]}
        products = {"9AAAAAAAAAAA": {"title": "Alpha", "image": "https://store-images.s-microsoft.com/a?w=200"}, "9BBBBBBBBBBB": {"title": "Beta"}}
        out = sidebar.game_pass(lambda sigl: ids[sigl], lambda wanted: {key: value for key, value in products.items() if key in wanted})
        self.assertEqual([game["title"] for game in out["recent"]], ["Alpha", "Beta"])
        self.assertEqual(out["recent"][0]["on"], ["Console", "PC"])
        self.assertEqual(out["recent"][1]["on"], ["PC"])
        self.assertEqual(out["coming"], [])  # no product details → left out
        self.assertTrue(out["recent"][0]["url"].endswith("/9AAAAAAAAAAA"))

    def test_showcase_events(self):
        wikitext = """==Major events==
{{Table alignment}}
{| class="wikitable"
! Month
! Day(s)
! Event
|-
| rowspan="2" | June
| 5
| [[Summer Game Fest]] will be held in Los Angeles.<ref>x</ref> More text here.
|-
| 9
| [[Ubisoft]] announced layoffs.
|-
| December
| 10
| [[The Game Awards 2026]] will take place at the Peacock Theater.
|-
| August
| 26–30
| [[Gamescom]] will be held in Cologne.
|}
==Notable deaths==
"""
        events = sidebar.showcase_events(wikitext, 2026, "2026-08-27")
        self.assertEqual([event["start"] for event in events], ["2026-12-10", "2026-08-26"])
        self.assertEqual(events[0]["text"], "The Game Awards 2026 will take place at the Peacock Theater.")
        self.assertEqual(events[1]["end"], "2026-08-30")


class SteamAndEsportsTests(unittest.TestCase):
    def test_steam_build(self):
        def fetch(path, params):
            if "GetOwnedGames" in path:
                return {"response": {"games": [{"appid": 10, "name": "Played", "playtime_forever": 600, "playtime_2weeks": 30},
                                               {"appid": 20, "name": "Unplayed", "playtime_forever": 0}, {"appid": 30, "name": ""}]}}
            if "GetPlayerSummaries" in path:
                return {"response": {"players": [{"personaname": "me", "avatarfull": "https://avatars.steamstatic.com/a.jpg", "profileurl": "https://steamcommunity.com/id/me/"}]}}
            if "GetPlayerAchievements" in path:
                if params["appid"] != 10:
                    raise HTTPError("u", 400, "no stats", {}, None)
                return {"playerstats": {"success": True, "achievements": [{"apiname": "A", "achieved": 1, "unlocktime": 5, "name": "Rare one"},
                                                                          {"apiname": "B", "achieved": 1, "unlocktime": 9, "name": "Common"}, {"apiname": "C", "achieved": 0}]}}
            if "GetGlobalAchievementPercentages" in path:
                return {"achievementpercentages": {"achievements": [{"name": "A", "percent": "2.5"}, {"name": "B", "percent": 80}, {"name": "C", "percent": 1}]}}
            if "GetSchemaForGame" in path:
                return {"game": {"availableGameStats": {"achievements": [{"name": "A", "icon": "https://steamcdn-a.akamaihd.net/a.jpg"}]}}}
            raise AssertionError(path)
        data = steam.build("key", "76561198000000000", fetch, now="2026-11-23T00:00:00+00:00")
        self.assertEqual([row[:4] for row in data["games"]], [[10, "Played", 600, 30], [20, "Unplayed", 0, 0]])
        self.assertEqual(data["profile"]["name"], "me")
        stats = data["achievements"]["10"]
        self.assertEqual((stats["unlocked"], stats["total"], stats["lastUnlock"]), (2, 3, 9))
        self.assertEqual(stats["rare"][0], {"name": "Rare one", "description": "", "percent": 2.5, "icon": "https://steamcdn-a.akamaihd.net/a.jpg", "unlocked": 5})

    def test_steam_id_lookup(self):
        self.assertEqual(steam.resolve_id("k", "https://steamcommunity.com/profiles/76561198000000001/"), "76561198000000001")
        fetch = lambda path, params: {"response": {"success": 1, "steamid": "76561198000000002"}}
        self.assertEqual(steam.resolve_id("k", "https://steamcommunity.com/id/myname/", fetch), "76561198000000002")

    def test_esports_rows(self):
        match = {"id": 1, "status": "finished", "begin_at": "2026-11-20T10:00:00Z", "match_type": "best_of", "number_of_games": 3,
                 "league": {"name": "LCK", "image_url": "https://cdn.pandascore.co/l.png"}, "serie": {"full_name": "Winter 2026"}, "tournament": {"name": "Playoffs", "tier": "s"},
                 "opponents": [{"opponent": {"id": 5, "name": "T1", "acronym": "T1", "image_url": "https://cdn.pandascore.co/t1.png"}}, {"opponent": {"id": 6, "name": "Gen.G", "acronym": "GEN"}}],
                 "results": [{"team_id": 5, "score": 2}, {"team_id": 6, "score": 1}], "winner_id": 5,
                 "streams_list": [{"language": "ko", "official": True, "main": False, "raw_url": "https://twitch.tv/ko"}, {"language": "en", "official": True, "main": True, "raw_url": "https://twitch.tv/lck"}]}
        row = esports.match_row(match, "lol")
        self.assertEqual(row["teams"][0], {"id": 5, "name": "T1", "short": "T1", "logo": "https://cdn.pandascore.co/t1.png", "score": 2})
        self.assertEqual((row["event"], row["tier"], row["winner"], row["stream"], row["bestOf"]), ("Winter 2026 · Playoffs", "s", 5, "https://twitch.tv/lck", 3))
        calls = []
        def fetch(path, params, key):
            calls.append(path)
            if path.startswith("csgo"):
                raise HTTPError("u", 403, "forbidden", {}, None)
            return [match] if path.endswith("past") else []
        data = esports.build("key", fetch)
        self.assertEqual([m["id"] for m in data["matches"]], [1])
        self.assertEqual(data["unavailable"], ["Counter-Strike 2"])


class GameReleaseTests(unittest.TestCase):
    def test_parser_keeps_only_its_year(self):
        html = """<span class="calendar_entry"><a href="/product/a">Game A</a><time datetime="2027-02-03">x</time></span>"""
        parser = releases.ReleaseParser(2026)
        parser.feed(html)
        self.assertEqual(parser.releases, [])
        self.assertEqual(releases.YEARS, [releases.CURRENT_YEAR - 1, releases.CURRENT_YEAR, releases.CURRENT_YEAR + 1])


if __name__ == "__main__":
    unittest.main()
