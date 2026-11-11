"""Tests for the K-pop calendar preview generator."""

from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import update_kpop_releases as calendar


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 11, 11, tzinfo=timezone.utc)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.terms = {
            "calendar-date": [{"id": day, "name": str(day)} for day in range(1, 32)],
            "calendar-month": [{"id": month + 100, "slug": f"{month:02d}-month"} for month in range(1, 13)],
            "calendar-year": [{"id": 2026, "name": "2026"}],
        }

    def build(self, pages):
        with patch.object(calendar, "datetime", FixedDatetime), \
             patch.object(calendar, "fetch_terms", side_effect=lambda name: self.terms[name]), \
             patch.object(calendar, "fetch_page", side_effect=pages):
            return calendar.build_snapshot()

    def test_collects_all_pages_for_current_month(self):
        def pages(endpoint, params):
            self.assertEqual(endpoint, "album")
            self.assertEqual(params["calendar-month"], 111)
            self.assertEqual(params["calendar-year"], 2026)
            return ([{"id": params["page"]}], 2, 2)

        snapshot = self.build(pages)
        self.assertEqual((snapshot["year"], snapshot["month"]), (2026, 11))
        self.assertEqual(snapshot["releases"], [{"id": 1}, {"id": 2}])
        self.assertEqual(snapshot["fetchedAt"], "2026-11-11T00:00:00+00:00")

    def test_rejects_changed_pagination(self):
        def pages(endpoint, params):
            return ([{"id": params["page"]}], 2, 2 if params["page"] == 1 else 3)

        with self.assertRaisesRegex(ValueError, "changed while loading"):
            self.build(pages)

    def test_rejects_incomplete_taxonomy(self):
        self.terms["calendar-date"].pop()
        with self.assertRaisesRegex(ValueError, "taxonomy is incomplete"):
            self.build(lambda endpoint, params: ([], 0, 0))

    def test_rejects_missing_releases(self):
        with self.assertRaisesRegex(ValueError, "did not include every result"):
            self.build(lambda endpoint, params: ([], 1, 1))


if __name__ == "__main__":
    unittest.main()
