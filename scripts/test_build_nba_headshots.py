"""Tests for build_nba_headshots.py with canned Wikidata, NBA.com and Commons responses. Run: python3 scripts/test_build_nba_headshots.py"""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_nba_headshots as hs  # noqa: E402


def entity(espn, nba=None, image=None):
    claims = {"P3647": [{"mainsnak": {"datavalue": {"value": espn}}}]}
    if nba:
        claims["P4000"] = [{"mainsnak": {"datavalue": {"value": nba}}}]
    if image:
        claims["P18"] = [{"mainsnak": {"datavalue": {"value": image}}}]
    return {"claims": claims}


def fetcher(url, params):
    if params.get("action") == "wbsearchentities":
        if "ESPN" in params["search"]:
            return {"search": [{"id": "P3647", "label": "ESPN.com NBA player ID"}]}
        return {"search": [{"id": "P4000", "label": "NBA.com player ID"}]}
    if params.get("list") == "search":
        return {"query": {"search": [{"title": "Q1"}, {"title": "Q2"}, {"title": "Q3"}, {"title": "Q4"}]}}
    if params.get("action") == "wbgetentities":
        return {"entities": {
            "Q1": entity("1035", nba="893", image="Jordan.jpg"),      # NBA.com has him
            "Q2": entity("501", nba="252", image="Karl Malone.jpg"),  # NBA.com missing -> Commons
            "Q3": entity("77", image="Ghost.ogg"),                    # not an image -> nothing
            "Q4": entity("1966", nba="2544"),                          # already has an ESPN headshot: ignored
        }}
    if url == hs.COMMONS_API:
        return {"query": {"normalized": [{"from": "File:Karl_Malone.jpg", "to": "File:Karl Malone.jpg"}], "pages": {
            "1": {"title": "File:Karl Malone.jpg", "imageinfo": [{"mime": "image/jpeg", "thumburl": "https://upload.wikimedia.org/x/260px-Karl_Malone.jpg",
                                                                   "descriptionurl": "https://commons.wikimedia.org/wiki/File:Karl_Malone.jpg",
                                                                   "extmetadata": {"Artist": {"value": "<a href='x'>Jane Doe</a>"}, "LicenseShortName": {"value": "CC BY-SA 2.0"}}}]},
            "2": {"title": "File:Ghost.ogg", "imageinfo": [{"mime": "application/ogg", "url": "https://upload.wikimedia.org/g.ogg"}]}}}}
    raise AssertionError(f"unexpected request {url} {params}")


class Response:
    def __init__(self, status, kind, size):
        self.status, self.headers = status, {"Content-Type": kind, "Content-Length": str(size)}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


def opener(request, timeout=None):
    if request.full_url.endswith("/893.png"):
        return Response(200, "image/png", 90000)
    raise OSError("403 Forbidden")


class HeadshotTests(unittest.TestCase):
    def test_build_prefers_nba_then_commons(self):
        index = {"players": [{"id": "1035", "h": False}, {"id": "501", "h": False}, {"id": "77", "h": False}, {"id": "1966", "h": True}]}
        players = hs.build(index, fetcher, opener, log=lambda *args: None)
        self.assertEqual(players["1035"], {"src": "https://cdn.nba.com/headshots/nba/latest/260x190/893.png", "source": "NBA.com"})
        self.assertEqual(players["501"]["source"], "Wikimedia Commons")
        self.assertEqual(players["501"]["src"], "https://upload.wikimedia.org/x/260px-Karl_Malone.jpg")
        self.assertEqual(players["501"]["author"], "Jane Doe")
        self.assertEqual(players["501"]["license"], "CC BY-SA 2.0")
        self.assertNotIn("77", players)
        self.assertNotIn("1966", players)

    def test_tiny_or_non_image_response_is_not_a_headshot(self):
        self.assertFalse(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "image/png", 500)))
        self.assertFalse(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "text/html", 90000)))
        self.assertTrue(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "image/png", 90000)))


if __name__ == "__main__":
    unittest.main()
