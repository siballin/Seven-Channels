import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import update_music_lab as lab

RECORDING = {
    "id": "rec-1", "title": "BO$$", "length": 171000, "first-release-date": "2014-07-07",
    "artist-credit": [{"name": "Fifth Harmony", "joinphrase": "", "artist": {"id": "fh", "name": "Fifth Harmony"}}],
    "releases": [
        {"id": "comp", "title": "Hits 2014", "status": "Official", "date": "2014-05-01",
         "release-group": {"id": "rg-comp", "primary-type": "Album", "secondary-types": ["Compilation"], "title": "Hits 2014"}},
        {"id": "single", "title": "BO$$", "status": "Official", "date": "2014-07-07",
         "release-group": {"id": "rg-single", "primary-type": "Single", "secondary-types": [], "title": "BO$$"}},
        {"id": "album", "title": "Reflection", "status": "Official", "date": "2015-01-30",
         "release-group": {"id": "rg-album", "primary-type": "Album", "secondary-types": [], "title": "Reflection"}},
    ],
    "relations": [
        {"target-type": "artist", "type": "producer", "attributes": [], "artist": {"id": "tp", "name": "Tayla Parx"}},
        {"target-type": "artist", "type": "mix", "attributes": ["assistant"], "artist": {"id": "mc", "name": "Maddox Chhim"}},
        {"target-type": "url", "type": "free streaming", "url": {"resource": "https://open.spotify.com/track/abc"}},
        {"target-type": "url", "type": "free streaming", "url": {"resource": "https://www.youtube.com/watch?v=xyz"}},
        {"target-type": "work", "type": "performance", "work": {"id": "w1", "title": "BO$$", "relations": [
            {"target-type": "artist", "type": "writer", "attributes": [], "artist": {"id": "tp", "name": "Tayla Parx"}},
            {"target-type": "artist", "type": "composer", "attributes": [], "artist": {"id": "rr", "name": "Ricky Reed"}},
        ]}},
    ],
}


class MusicLabTests(unittest.TestCase):
    def test_recording_keeps_writing_and_production_apart(self):
        parsed = lab.parse_recording(RECORDING, "2026-11-14T00:00:00+00:00")
        self.assertEqual([(c["type"], c["name"]) for c in parsed["credits"]], [("producer", "Tayla Parx"), ("mix", "Maddox Chhim")])
        self.assertEqual(parsed["credits"][1]["attributes"], ["assistant"])
        # Work-level credits are writers/composers only, tagged with their work.
        self.assertEqual([(w["type"], w["name"], w["work"]) for w in parsed["writers"]],
                         [("writer", "Tayla Parx", "w1"), ("composer", "Ricky Reed", "w1")])
        self.assertEqual(parsed["works"], ["w1"])
        self.assertEqual(parsed["links"], {"spotify": "https://open.spotify.com/track/abc", "youtube": "https://www.youtube.com/watch?v=xyz"})
        self.assertEqual(parsed["artists"], [{"id": "fh", "name": "Fifth Harmony", "join": ""}])

    def test_release_prefers_official_album_over_single_and_compilation(self):
        release = lab.pick_release(RECORDING["releases"])
        self.assertEqual((release["id"], release["group"]["id"], release["group"]["type"]), ("album", "rg-album", "Album"))
        self.assertIsNone(lab.pick_release([]))

    def test_canonical_recording_skips_versions(self):
        recordings = [
            {"id": "remix", "title": "BO$$ (Remix)", "first-release-date": "2014-01-01"},
            {"id": "inst", "title": "BO$$ instrumental", "first-release-date": "2014-02-01"},
            {"id": "mv", "title": "BO$$", "video": True, "first-release-date": "2014-03-01"},
            {"id": "live", "title": "BO$$", "disambiguation": "live", "first-release-date": "2014-04-01"},
            {"id": "late", "title": "BO$$", "first-release-date": "2015-01-01"},
            {"id": "orig", "title": "BO$$", "first-release-date": "2014-07-07"},
        ]
        self.assertEqual(lab.pick_canonical(recordings)["id"], "orig")
        # With only versions available, the earliest one still stands for the song.
        self.assertEqual(lab.pick_canonical(recordings[:2])["id"], "remix")
        self.assertIsNone(lab.pick_canonical([]))

    def test_person_links_and_credits(self):
        relations = [
            {"target-type": "url", "type": "wikidata", "url": {"resource": "https://www.wikidata.org/wiki/Q435807"}},
            {"target-type": "url", "type": "free streaming", "url": {"resource": "https://open.spotify.com/artist/1"}},
            {"target-type": "url", "type": "social network", "url": {"resource": "https://www.instagram.com/x/"}},
            {"target-type": "work", "type": "lyricist", "attributes": [], "work": {"id": "w2", "title": "Song"}},
            {"target-type": "recording", "type": "producer", "attributes": ["co"], "recording": {"id": "r2", "title": "Song"}},
            {"target-type": "release", "type": "producer", "release": {"id": "x"}},
        ]
        self.assertEqual(lab.person_links(relations), {"wikidata": "https://www.wikidata.org/wiki/Q435807",
                                                      "spotify": "https://open.spotify.com/artist/1", "instagram": "https://www.instagram.com/x/"})
        self.assertEqual(lab.person_credits(relations), [
            {"kind": "work", "type": "lyricist", "attributes": [], "id": "w2", "title": "Song"},
            {"kind": "recording", "type": "producer", "attributes": ["co"], "id": "r2", "title": "Song"},
        ])

    def test_build_reuses_fresh_details_and_marks_missing_people(self):
        now = datetime(2026, 11, 14, tzinfo=timezone.utc)
        previous = {"recordings": {"r2": {"id": "r2", "title": "Song", "fetchedAt": "2026-11-10T00:00:00+00:00"}},
                    "works": {"w2": {"id": "w2", "recording": "r2", "fetchedAt": "2026-11-10T00:00:00+00:00"}}}
        artist = {"id": "p1", "name": "Person", "relations": [
            {"target-type": "work", "type": "writer", "attributes": [], "work": {"id": "w2", "title": "Song"}},
            {"target-type": "recording", "type": "producer", "attributes": [], "recording": {"id": "r2", "title": "Song"}}]}
        calls = []
        def fake_get(url, mb=True):
            calls.append(url)
            return artist if "/artist/" in url else {"release-groups": [{"id": "g1", "title": "Debut", "primary-type": "Album"}]}
        client = lab.Client()
        with patch.object(client, "get", side_effect=fake_get):
            people, recordings, works, complete = lab.build(client, [{"name": "Person", "mbid": "p1"}, {"name": "Nobody", "mbid": None, "note": "none"}], previous, now)
        self.assertTrue(complete)
        self.assertEqual(len(calls), 2)  # artist + release groups; the song details were fresh
        self.assertEqual([p["status"] for p in people], ["ok", "missing"])
        self.assertEqual(people[0]["releaseGroups"][0]["id"], "g1")
        self.assertEqual(set(recordings), {"r2"})

    def test_budget_marks_snapshot_incomplete(self):
        client = lab.Client(budget=0)
        people, recordings, works, complete = lab.build(client, [{"name": "Person", "mbid": "p1"}], {}, datetime.now(timezone.utc))
        self.assertFalse(complete)
        self.assertEqual(people[0]["status"], "stale")


if __name__ == "__main__":
    unittest.main()
