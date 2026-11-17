import unittest
from datetime import datetime, timezone

import update_channel_news as news

NOW = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
FEED = """<?xml version="1.0"?><rss><channel>
<item><title>Best NBA Picks for Tonight</title><link>https://www.covers.com/nba/picks-1</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Company opens new office</title><link>https://www.covers.com/about</link><pubDate>Tue, 17 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>"""
ATOM = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>New! Co-Views in View Counts</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>2026-11-16T18:12:00+00:00</published></entry>
</feed>"""


class ChannelNewsTests(unittest.TestCase):
    def test_filter_atom_and_fallback(self):
        config = {"title": "Test", "sources": [
            news.src("Covers", "https://www.covers.com/", {"covers.com"}, [("https://covers/feed", "betting")]),
            news.src("Creator Insider", "https://youtube.com/", {"youtube.com"}, [("https://yt/feed", None)]),
            news.src("Gone", "https://gone.example/", {"gone.example"}, [("https://gone/feed", None)]),
        ]}
        def fetcher(url):
            if url == "https://covers/feed":
                return FEED.encode()
            if url == "https://yt/feed":
                return ATOM.encode()
            raise OSError("down")
        previous = {"items": [{"source": "Gone", "title": "Kept", "url": "https://gone.example/a", "published": "2026-11-16T00:00:00+00:00", "summary": ""}]}
        out = news.build_channel(config, previous, fetcher, NOW)
        self.assertEqual([item["title"] for item in out["items"]], ["Best NBA Picks for Tonight", "New! Co-Views in View Counts", "Kept"])
        self.assertEqual([source["status"] for source in out["sources"]], ["ok", "ok", "stale"])


if __name__ == "__main__":
    unittest.main()
