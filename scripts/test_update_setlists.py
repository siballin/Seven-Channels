import unittest

import update_setlists as setlists

ITEM = {
    "id": "63d8a2b7", "eventDate": "23-08-2025", "url": "https://www.setlist.fm/setlist/x.html",
    "artist": {"mbid": "m1", "name": "Band"},
    "venue": {"name": "KSPO Dome", "city": {"name": "Seoul", "country": {"code": "KR", "name": "South Korea"}}},
    "tour": {"name": "World Tour"},
    "sets": {"set": [{"song": [{"name": "Intro"}, {"name": "Hit"}, {"name": " "}]}, {"encore": 1, "song": [{"name": "Finale"}]}, {"song": []}]},
}


class SetlistTests(unittest.TestCase):
    def test_parse(self):
        parsed = setlists.parse_setlist(ITEM)
        self.assertEqual(parsed["date"], "2025-08-23")
        self.assertEqual(parsed["venue"], {"name": "KSPO Dome", "city": "Seoul", "country": "South Korea"})
        self.assertEqual(parsed["tour"], "World Tour")
        self.assertEqual(parsed["sets"], [{"encore": 0, "songs": ["Intro", "Hit"]}, {"encore": 1, "songs": ["Finale"]}])
        self.assertEqual(setlists.setlist_date("2025-08-23"), "")

    def test_build_keeps_previous_on_failure(self):
        config = {"artists": [{"name": "Band", "mbid": "m1"}, {"name": "Other", "mbid": "m2"}]}
        previous = {"artists": [{"mbid": "m2", "name": "Other", "setlists": [{"id": "old"}]}]}
        def fake(url, key):
            if "/m2/" in url:
                raise RuntimeError("down")
            return {"setlist": [ITEM]}
        artists, failures = setlists.build(config, previous, "key", fetcher=fake)
        self.assertEqual(failures, 1)
        self.assertEqual([a["mbid"] for a in artists], ["m1", "m2"])
        self.assertEqual(artists[0]["setlists"][0]["id"], "63d8a2b7")
        self.assertEqual(artists[1]["setlists"], [{"id": "old"}])


if __name__ == "__main__":
    unittest.main()
