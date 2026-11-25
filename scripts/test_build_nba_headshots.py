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
    def __init__(self, status, kind, size, etag="real", tag=""):
        self.status, self.headers = status, {"Content-Type": kind, "Content-Length": str(size), "ETag": etag, "Edge-Cache-Tag": tag}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


def opener(request, timeout=None):
    if request.full_url.endswith("/893.png"):
        return Response(200, "image/png", 90000)
    if request.full_url.endswith("/fallback.png"):
        return Response(200, "image/png", 4937, etag="silhouette")
    return Response(200, "image/png", 4937, etag="silhouette", tag="nba-headshots,x/252.png,x/fallback.png")


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

    def test_query_service_links(self):
        def sparql(url, params):
            self.assertEqual(url, hs.SPARQL)
            return {"results": {"bindings": [
                {"espn": {"value": "1035"}, "nba": {"value": "893"}, "image": {"value": "http://commons.wikimedia.org/wiki/Special:FilePath/Michael%20Jordan%20in%201987.jpg"}},
                {"espn": {"value": "1035"}, "nba": {"value": "893"}, "image": {"value": "http://commons.wikimedia.org/wiki/Special:FilePath/Second.jpg"}},
                {"espn": {"value": "999"}, "nba": {"value": "1"}},
            ]}}
        links = hs.wikidata_links({"1035"}, sparql, log=lambda *args: None)
        self.assertEqual(links, {"1035": {"nba": "893", "image": "Michael Jordan in 1987.jpg", "article": "", "category": ""}})

    def test_wikipedia_lead_image_fills_the_gap(self):
        def fake(url, params):
            if url == hs.SPARQL:
                return {"results": {"bindings": [{"espn": {"value": "42"}, "article": {"value": "https://en.wikipedia.org/wiki/Old_Timer"}}]}}
            if url == hs.WIKIPEDIA_API:
                self.assertEqual(params["pilicense"], "free")
                return {"query": {"pages": {"9": {"title": "Old Timer", "pageimage": "Old_Timer_1975.jpg"}}}}
            if url == hs.COMMONS_API:
                return {"query": {"pages": {"1": {"title": "File:Old Timer 1975.jpg", "imageinfo": [{"mime": "image/jpeg",
                        "thumburl": "https://upload.wikimedia.org/t/260px-Old_Timer_1975.jpg", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Old_Timer_1975.jpg",
                        "extmetadata": {"LicenseShortName": {"value": "Public domain"}}}]}}}}
            raise AssertionError(url)
        players = hs.build({"players": [{"id": "42", "h": False}]}, fake, opener, log=lambda *args: None)
        self.assertEqual(players["42"]["src"], "https://upload.wikimedia.org/t/260px-Old_Timer_1975.jpg")
        self.assertEqual(players["42"]["license"], "Public domain")

    def test_saved_links_are_used_when_wikidata_fails(self):
        import tempfile
        def down(url, params):
            if url in (hs.SPARQL, hs.WIKIDATA_API):
                raise OSError("429 Too Many Requests")
            return fetcher(url, params)
        with tempfile.TemporaryDirectory() as folder:
            links = Path(folder) / "links.json"
            links.write_text('{"1035": {"nba": "893", "image": "", "article": ""}}')
            players = hs.build({"players": [{"id": "1035", "h": False}]}, down, opener, log=lambda *args: None, links_file=links)
        self.assertEqual(players["1035"]["source"], "NBA.com")

    def test_commons_continuation_and_category_fallback(self):
        calls = []
        def fake(url, params):
            if url == hs.SPARQL:
                return {"results": {"bindings": [
                    {"espn": {"value": "1"}, "image": {"value": "http://commons.wikimedia.org/wiki/Special:FilePath/A%20One.jpg"}},
                    {"espn": {"value": "2"}, "image": {"value": "http://commons.wikimedia.org/wiki/Special:FilePath/B%20Two.jpg"}},
                    {"espn": {"value": "3"}, "category": {"value": "Carl Three"}}]}}
            if url == hs.COMMONS_API and params.get("list") == "categorymembers":
                self.assertEqual(params["cmtitle"], "Category:Carl Three")
                return {"query": {"categorymembers": [{"title": "File:Carl Three signature.png"}, {"title": "File:Team photo 1990.jpg"}, {"title": "File:Carl Three 1989.jpg"}]}}
            if url == hs.COMMONS_API:
                calls.append(params.get("iicontinue"))
                def page(name):
                    return {"title": f"File:{name}", "imageinfo": [{"mime": "image/jpeg", "thumburl": f"https://upload.wikimedia.org/{name}", "extmetadata": {}}]}
                titles = params["titles"].split("|")
                if "File:Carl Three 1989.jpg" in titles:
                    return {"query": {"pages": {"9": page("Carl Three 1989.jpg")}}}
                if not params.get("iicontinue"):  # first answer covers one file, the rest comes after "continue"
                    return {"continue": {"iicontinue": "B", "continue": "||"}, "query": {"pages": {"1": page("A One.jpg"), "2": {"title": "File:B Two.jpg"}}}}
                return {"query": {"pages": {"2": page("B Two.jpg")}}}
            raise AssertionError((url, params))
        index = {"players": [{"id": "1", "h": False}, {"id": "2", "h": False}, {"id": "3", "h": False}]}
        players = hs.build(index, fake, opener, log=lambda *args: None)
        self.assertEqual(sorted(players), ["1", "2", "3"])
        self.assertEqual(players["2"]["src"], "https://upload.wikimedia.org/B Two.jpg")
        self.assertEqual(players["3"]["src"], "https://upload.wikimedia.org/Carl Three 1989.jpg")  # surname match, not the signature
        self.assertIn("B", calls)

    def test_tiny_or_non_image_response_is_not_a_headshot(self):
        self.assertFalse(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "image/png", 500)))
        self.assertFalse(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "text/html", 90000)))
        self.assertTrue(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "image/png", 90000)))
        # NBA.com's silhouette for ids it has no photo for, recognised by its cache tag or its ETag
        self.assertFalse(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "image/png", 9000, tag="a/fallback.png")))
        self.assertFalse(hs.nba_headshot_exists("1", lambda request, timeout=None: Response(200, "image/png", 9000, etag="sil"), "sil"))


if __name__ == "__main__":
    unittest.main()
