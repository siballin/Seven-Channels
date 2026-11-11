"""Tests for the K-pop dashboard feed generator."""

from datetime import datetime, timezone
import io
import json
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

import update_kpop_sidebar as sidebar


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 12, 11, tzinfo=timezone.utc)


class SidebarFeedTests(unittest.TestCase):
    def test_article_image_accepts_only_soompi_image_hosts(self):
        parser = sidebar.ArticleImageParser()
        parser.feed('<meta property="og:image" content="https://example.com/image.jpg">')
        self.assertEqual(parser.image, "")
        parser.feed('<meta property="og:image" content="https://0.soompi.io/image.jpg">')
        self.assertEqual(parser.image, "https://0.soompi.io/image.jpg")

    def test_news_rejects_non_soompi_links(self):
        root = ElementTree.fromstring("""
            <rss><channel>
              <item><title>Good</title><link>https://www.soompi.com/article/1</link>
                <pubDate>Wed, 11 Nov 2026 10:00:00 GMT</pubDate></item>
              <item><title>Wrong site</title><link>https://example.com/</link>
                <pubDate>Wed, 11 Nov 2026 10:00:00 GMT</pubDate></item>
            </channel></rss>
        """)
        self.assertEqual(sidebar.news_items(root), [{
            "title": "Good", "url": "https://www.soompi.com/article/1",
            "published": "2026-11-11T10:00:00+00:00",
        }])

    def test_video_feed_filters_teasers_and_invalid_ids(self):
        root = ElementTree.fromstring("""
            <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
              <entry><title>[MV] Test</title><yt:videoId>abcdefghijk</yt:videoId><published>2026-11-11T10:00:00Z</published></entry>
              <entry><title>Test teaser</title><yt:videoId>abcdefghijk</yt:videoId><published>2026-11-11T10:00:00Z</published></entry>
              <entry><title>[MV] Invalid</title><yt:videoId>bad</yt:videoId><published>2026-11-11T10:00:00Z</published></entry>
            </feed>
        """)
        self.assertEqual(sidebar.video_items(root), [{
            "title": "[MV] Test", "url": "https://www.youtube.com/watch?v=abcdefghijk",
            "published": "2026-11-11T10:00:00Z",
        }])

    def test_calendar_snapshot_crosses_year_and_excludes_undated_artists(self):
        terms = {
            "calendar-date": [{"id": day, "name": str(day)} for day in range(1, 32)],
            "calendar-month": [{"id": month + 100, "slug": f"{month:02d}-month"} for month in range(1, 13)],
            "calendar-year": [{"id": year, "name": str(year)} for year in (2026, 2027)],
        }

        def page(endpoint, params):
            year, month = params["calendar-year"], params["calendar-month"] - 100
            item = {
                "id": 1, "title": {"rendered": "Release"}, "link": "https://kpopofficial.com/album/a/",
                "calendar-date": [12], "calendar-month": [params["calendar-month"]],
                "calendar-year": [year], "group": [42], "artist_solo": [],
            }
            if month == 12:
                return ([item, {**item, "calendar-date": [], "group": [99]}], 1, 2)
            return ([], 0, 0)

        def artist_response(request, timeout):
            self.assertIn("/group/42?", request.full_url)
            return io.BytesIO(json.dumps({"id": 42, "name": "Artist"}).encode())

        with patch.object(sidebar, "datetime", FixedDatetime), \
             patch.object(sidebar, "fetch_terms", side_effect=lambda name: terms[name]), \
             patch.object(sidebar, "fetch_page", side_effect=page), \
             patch.object(sidebar, "urlopen", side_effect=artist_response):
            result = sidebar.calendar_activity()
        self.assertEqual([(period["year"], period["month"]) for period in result["periods"]],
                         [(2026, 12), (2027, 1), (2027, 2)])
        self.assertEqual(result["names"], [{"taxonomy": "group", "id": 42, "name": "Artist"}])

    def test_calendar_rejects_missing_page(self):
        terms = {
            "calendar-date": [{"id": day, "name": str(day)} for day in range(1, 32)],
            "calendar-month": [{"id": month, "slug": f"{month:02d}-month"} for month in range(1, 13)],
            "calendar-year": [{"id": 2026, "name": "2026"}],
        }
        with patch.object(sidebar, "datetime", FixedDatetime), \
             patch.object(sidebar, "fetch_terms", side_effect=lambda name: terms[name]), \
             patch.object(sidebar, "fetch_page", return_value=([], 1, 1)):
            with self.assertRaisesRegex(ValueError, "incomplete"):
                sidebar.calendar_activity()


if __name__ == "__main__":
    unittest.main()
