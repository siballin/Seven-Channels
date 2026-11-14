import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import music_lab_enrich as enrich
import music_lab_sources as src

RELEASE = {
    "title": "Reflection", "year": 2015, "uri": "https://www.discogs.com/release/6602570",
    "artists": [{"name": "Fifth Harmony", "anv": ""}],
    "extraartists": [
        {"name": "Tom Coyne", "role": "Mastered By", "tracks": "", "id": 272899},
        {"name": "Joey Arbagey", "role": "A&R", "tracks": "", "id": 1},
        {"name": "Harvey Mason Jr.", "role": "Producer [Vocals]", "tracks": "1 to 2", "id": 132473},
    ],
    "tracklist": [
        {"position": "1", "title": "Top Down", "type_": "track", "extraartists": [{"name": "The Family (24)", "role": "Producer", "id": 4233639}]},
        {"position": "", "title": "Bonus", "type_": "heading"},
        {"position": "2", "title": "Bo$$", "type_": "track", "extraartists": [
            {"name": "Tayla Parx", "anv": "Taylor Parks", "role": "Producer [Vocals], Written-By", "id": 4775829},
            {"name": "Daylight (15)", "role": "Producer, Programmed By", "id": 3904410}]},
        {"position": "3", "title": "Sledgehammer (feat. Somebody)", "type_": "track", "extraartists": []},
    ],
}


class DiscogsTests(unittest.TestCase):
    def test_roles_are_split_and_categorized(self):
        self.assertEqual(src.split_roles("Instruments [All, Other], Producer"), ["Instruments [All, Other]", "Producer"])
        self.assertEqual(src.discogs_category("Producer [Vocals]"), "vocalProduction")
        self.assertEqual(src.discogs_category("Co-producer"), "production")
        self.assertEqual(src.discogs_category("Executive-Producer"), "production")
        self.assertEqual(src.discogs_category("Written-By"), "songwriting")
        self.assertEqual(src.discogs_category("Music By"), "composition")
        self.assertEqual(src.discogs_category("Mixed By [Assistant]"), "engineering")
        self.assertEqual(src.discogs_category("Arranged By [Vocals]"), "arrangement")
        self.assertIsNone(src.discogs_category("A&R [Coordinator]"))
        self.assertIsNone(src.discogs_category("Coordinator [Production]"))
        self.assertIsNone(src.discogs_category("Art Direction"))

    def test_tracks_get_track_and_release_credits(self):
        tracks = src.discogs_tracks(RELEASE)
        self.assertEqual([track["position"] for track in tracks], ["1", "2", "3"])
        boss = src.match_track(tracks, "BO$$", ["Fifth Harmony"])
        credits = {(c["category"], c["label"], c["name"], c.get("as", "")) for c in boss["credits"]}
        self.assertIn(("vocalProduction", "Producer [Vocals]", "Tayla Parx", "Taylor Parks"), credits)
        self.assertIn(("songwriting", "Written-By", "Tayla Parx", "Taylor Parks"), credits)
        self.assertIn(("production", "Producer", "Daylight", ""), credits)  # "(15)" disambiguation removed
        self.assertIn(("engineering", "Mastered By", "Tom Coyne", ""), credits)  # release-wide credit
        self.assertIn(("vocalProduction", "Producer [Vocals]", "Harvey Mason Jr.", ""), credits)  # "1 to 2"
        self.assertFalse(any(c["name"] == "Joey Arbagey" for c in boss["credits"]))  # A&R dropped
        third = src.match_track(tracks, "Sledgehammer", ["Fifth Harmony"])
        self.assertEqual(third["position"], "3")  # "(feat. …)" ignored when matching
        self.assertFalse(any(c["name"] == "Harvey Mason Jr." for c in third["credits"]))

    def test_links(self):
        self.assertEqual(src.discogs_link("https://www.discogs.com/release/6602570-Fifth-Harmony-Reflection"), ("release", 6602570))
        self.assertEqual(src.discogs_link("https://www.discogs.com/master/793044"), ("master", 793044))
        self.assertEqual(src.discogs_link("https://www.discogs.com/artist/4775829-Tayla-Parx"), ("artist", 4775829))
        self.assertEqual(src.discogs_link("https://example.com"), (None, None))


class GeniusTests(unittest.TestCase):
    def test_credits_and_matching(self):
        song = {"writer_artists": [{"id": 1, "name": "Tayla Parx"}], "producer_artists": [{"id": 2, "name": "Ricky Reed"}],
                "custom_performances": [{"label": "Vocal Producer", "artists": [{"id": 1, "name": "Tayla Parx"}]},
                                        {"label": "Mixing Engineer", "artists": [{"id": 3, "name": "Jaycen Joshua"}]},
                                        {"label": "Label", "artists": [{"id": 4, "name": "Epic Records"}]}]}
        credits = [(c["category"], c["label"], c["name"]) for c in src.genius_song_credits(song)]
        self.assertEqual(credits, [("songwriting", "Writer", "Tayla Parx"), ("production", "Producer", "Ricky Reed"),
                                   ("vocalProduction", "Vocal Producer", "Tayla Parx"), ("engineering", "Mixing Engineer", "Jaycen Joshua")])
        hits = [{"type": "song", "result": {"id": 9, "title": "Boss", "primary_artist": {"name": "Somebody Else"}}},
                {"type": "song", "result": {"id": 10, "title": "BO$$", "primary_artist": {"name": "Fifth Harmony"}}}]
        self.assertEqual(src.genius_pick(hits, "BO$$", ["Fifth Harmony"])["id"], 10)
        self.assertIsNone(src.genius_pick(hits, "Work from Home", ["Fifth Harmony"]))

    def test_genius_skipped_without_token(self):
        with patch.dict("os.environ", {"GENIUS_ACCESS_TOKEN": ""}):
            songs, cache, status = enrich.genius_phase([], {"r1": {"title": "x", "artists": [], "genius": "5"}}, {},
                                                       {"geniusSongs": {"5": {"id": 5, "credits": []}}, "cache": {"genius": {"lookups": {"mb:r1": {"song": 5, "checkedAt": "2026-11-14T00:00:00+00:00"}}}}},
                                                       datetime(2026, 11, 14, tzinfo=timezone.utc), 10 ** 9)
        self.assertEqual(status["status"], "off")
        self.assertEqual(list(songs), ["5"])  # last saved credits kept


class DiscogsPhaseTests(unittest.TestCase):
    def test_links_recordings_and_people_through_musicbrainz(self):
        now = datetime(2026, 11, 14, tzinfo=timezone.utc)
        recordings = {"r-boss": {"id": "r-boss", "title": "BO$$", "artists": [{"name": "Fifth Harmony"}], "release": {"id": "mb-rel"}}}
        people = [{"key": "tp", "mbid": "tp", "discogsUrls": ["https://www.discogs.com/artist/4775829"]}]

        class FakeMb:
            def get(self, url):
                return {"relations": [{"url": {"resource": "https://www.discogs.com/release/6602570"}}], "release-group": {"relations": []}}

        class FakeDiscogs:
            used = 0
            def get(self, url):
                self.used += 1
                if "/artists/" in url:
                    return {"releases": [{"id": 6602570, "type": "release", "role": "Producer", "year": 2015}], "pagination": {"pages": 1}}
                return RELEASE

        with patch.object(src, "discogs_client", return_value=(FakeDiscogs(), False)):
            tracks, cache, status = enrich.discogs_phase(FakeMb(), people, recordings, {}, now, 10 ** 9)
        self.assertEqual(recordings["r-boss"]["discogs"], "6602570:2")
        self.assertEqual(tracks["6602570:2"]["recording"], "r-boss")
        self.assertEqual(people[0]["discogsIds"], [4775829])
        self.assertEqual(people[0]["discogsTracks"], ["6602570:2"])  # only tracks crediting the person
        self.assertEqual(cache["mbReleases"]["mb-rel"]["release"], 6602570)


if __name__ == "__main__":
    unittest.main()
