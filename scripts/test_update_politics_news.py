import unittest
from datetime import datetime, timezone

import update_politics_news as news

NOW = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
RSS = """<?xml version="1.0"?><rss><channel>
<item><title>Senate passes funding bill</title><link>https://thehill.com/homenews/senate/1</link>
<pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;The Senate voted 60-40.&lt;/p&gt;</description></item>
<item><title>Old story</title><link>https://thehill.com/homenews/2</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Offsite link</title><link>https://example.com/x</link><pubDate>Tue, 17 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>"""
AXIOS = """<?xml version="1.0"?><rss><channel>
<item><title>New iPhone launches</title><link>https://www.axios.com/2026/11/17/iphone</link><pubDate>Tue, 17 Nov 2026 11:00:00 GMT</pubDate><category>Technology</category></item>
<item><title>House GOP plans vote</title><link>https://www.axios.com/2026/11/17/house-vote</link><pubDate>Tue, 17 Nov 2026 11:30:00 GMT</pubDate></item>
</channel></rss>"""
GOOGLE = """<?xml version="1.0"?><rss><channel>
<item><title>Inside the leadership fight - Punchbowl News</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate></item>
</channel></rss>"""


class ImageTests(unittest.TestCase):
    def test_media_enclosure_and_inline_images(self):
        raw = b"""<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>A</title><link>https://x/a</link><media:content url="https://img.example/a.jpg" medium="image"/></item>
<item><title>B</title><link>https://x/b</link><enclosure url="http://img.example/b.jpg" type="image/jpeg"/></item>
<item><title>C</title><link>https://x/c</link><description>&lt;img src="https://img.example/c.png"&gt; text</description></item>
<item><title>D</title><link>https://x/d</link><content:encoded><![CDATA[<p><img src='https://img.example/d.webp'></p>]]></content:encoded></item>
<item><title>E</title><link>https://x/e</link><description>&lt;img src="https://feeds.feedburner.com/1x1.gif"&gt;</description></item>
</channel></rss>"""
        self.assertEqual([item[5] for item in news.parse_feed(raw)],
                         ["https://img.example/a.jpg", "https://img.example/b.jpg", "https://img.example/c.png", "https://img.example/d.webp", ""])


class BuildTests(unittest.TestCase):
    def test_parses_filters_and_falls_back(self):
        def fetcher(url):
            if "thehill.com/homenews" in url:
                return RSS.encode()
            if url.startswith("https://api.axios.com/feed/"):
                return AXIOS.encode()
            if "news.google.com" in url and "punchbowl" in url:
                return GOOGLE.encode()
            raise OSError("blocked")
        out = news.build({}, fetcher, NOW)
        by_source = {source["id"]: source for source in out["sources"]}
        self.assertEqual(by_source["thehill"]["count"], 1)  # old and offsite items dropped
        hill = next(item for item in out["items"] if item["source"] == "The Hill")
        self.assertEqual(hill["summary"], "The Senate voted 60-40.")
        self.assertEqual([item["title"] for item in out["items"] if item["source"] == "Axios"], ["House GOP plans vote"])
        punch = next(item for item in out["items"] if item["source"] == "Punchbowl News")
        self.assertEqual(punch["title"], "Inside the leadership fight")
        self.assertEqual(by_source["politico"]["status"], "unavailable")

    def test_failed_source_keeps_previous_items(self):
        previous = {"items": [{"source": "Roll Call", "title": "Earlier", "url": "https://rollcall.com/a", "published": "2026-11-16T10:00:00+00:00", "summary": ""}]}
        out = news.build(previous, lambda url: (_ for _ in ()).throw(OSError("down")), NOW)
        roll = next(source for source in out["sources"] if source["id"] == "rollcall")
        self.assertEqual((roll["status"], roll["count"]), ("stale", 1))
        self.assertEqual(out["items"][0]["title"], "Earlier")


if __name__ == "__main__":
    unittest.main()
