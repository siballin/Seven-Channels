import unittest
from datetime import date

import update_kpop_extra as extra

XG = "8dfe067c-ae90-472e-80f2-fcee9be4e158"


class BuildTests(unittest.TestCase):
    def test_keeps_exact_recent_dates_only(self):
        data = {"release-groups": [
            {"id": "a", "title": "AWE", "primary-type": "EP", "first-release-date": "2025-01-08"},
            {"id": "b", "title": "Old", "primary-type": "Single", "first-release-date": "2020-01-01"},
            {"id": "c", "title": "Month only", "primary-type": "Single", "first-release-date": "2026-12"},
            {"id": "d", "title": "Live", "primary-type": "Album", "secondary-types": ["Live"], "first-release-date": "2026-12-03"},
        ]}
        out = extra.build({"artists": [{"name": "XG", "mbid": XG}]}, {}, lambda url: data, today=date(2026, 11, 15))
        self.assertEqual([(r["id"], r["type"]) for r in out["releases"]], [("a", "EP"), ("d", "Album · Live")])
        self.assertEqual(out["status"], "ok")

    def test_failure_keeps_previous_releases(self):
        previous = {"artists": [{"name": "XG", "mbid": XG}], "releases": [{"id": "a", "title": "AWE", "type": "EP", "date": "2026-01-01", "artist": "XG", "mbid": XG}]}
        def boom(url):
            raise OSError("down")
        out = extra.build({"artists": [{"name": "XG", "mbid": XG}]}, previous, boom, today=date(2026, 11, 15))
        self.assertEqual(out["status"], "error")
        self.assertEqual(out["artists"][0]["status"], "stale")
        self.assertEqual(len(out["releases"]), 1)


if __name__ == "__main__":
    unittest.main()
