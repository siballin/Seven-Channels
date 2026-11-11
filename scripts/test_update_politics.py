import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import update_politics as politics


class PoliticsTests(unittest.TestCase):
    def test_bill_links_and_vote_labels(self):
        self.assertEqual(politics.bill_url(119, "H.R. 123"), "https://www.congress.gov/bill/119th-congress/house-bill/123")
        self.assertIn("/121st-congress/", politics.bill_url(121, "S 1"))
        self.assertEqual(politics.bill_url(119, "not a bill"), "")
        self.assertEqual(politics.category("On Passage of the Bill"), "Final passage")
        self.assertEqual(politics.category("On the Amendment"), "Amendment")
        self.assertEqual(politics.category("Motion to Proceed"), "Procedural or other")

    def test_house_vote_parsing(self):
        xml = b"""<rollcall-vote><vote-metadata><congress>119</congress>
        <vote-question>On Passage</vote-question><action-date>10-Nov-2026</action-date>
        <vote-result>Passed</vote-result><legis-num>H R 7</legis-num><vote-totals>
        <totals-by-vote><yea-total>1</yea-total><nay-total>0</nay-total><present-total>0</present-total><not-voting-total>0</not-voting-total></totals-by-vote>
        </vote-totals></vote-metadata><vote-data><recorded-vote>
        <legislator party="D" state="NY">Example</legislator><vote>Yea</vote>
        </recorded-vote></vote-data></rollcall-vote>"""
        with patch.object(politics, "fetch", return_value=xml):
            vote = politics.house_vote(2026, 2)
        self.assertEqual(vote["date"], "2026-11-10")
        self.assertEqual(vote["tally"]["Not voting"], "0")
        self.assertEqual(vote["members"][0]["vote"], "Yea")
        self.assertTrue(vote["billUrl"].endswith("/house-bill/7"))

    def test_failure_retains_previous_source_and_missing_key_does_not_remove_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "politics.json"
            previous = {"house": {"fetchedAt": "2020-01-01T00:00:00+00:00", "items": [{"question": "prior"}]},
                        "bills": {"fetchedAt": "2020-01-01T00:00:00+00:00", "items": [{"id": "prior"}]}}
            path.write_text(json.dumps(previous), encoding="utf-8")
            with patch.object(politics, "OUTPUT", path), patch.object(politics, "house_votes", side_effect=ValueError("offline")), \
                 patch.object(politics, "senate_votes", return_value=[{"question": "new"}]), \
                 patch.object(politics, "hearings", return_value=[]), \
                 patch.object(politics, "house_seats", return_value=[]), patch.object(politics, "senate_seats", return_value=[]), \
                 patch.dict(politics.os.environ, {"CONGRESS_GOV_API_KEY": ""}):
                politics.main()
            result = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(result["house"], previous["house"])
            self.assertEqual(result["bills"], previous["bills"])
            self.assertEqual(result["senate"]["items"][0]["question"], "new")
            self.assertEqual(result["hearings"]["items"], [])

    def test_no_hearings_notice_is_not_an_event(self):
        xml = b"<css_meetings_scheduled><meeting><date_iso_8601>2026-11-12</date_iso_8601><matter>No committee hearings scheduled</matter></meeting></css_meetings_scheduled>"
        with patch.object(politics, "fetch", return_value=xml):
            self.assertEqual(politics.hearings(datetime(2026, 11, 11, tzinfo=timezone.utc)), [])

    def test_bill_api_key_is_only_sent_as_a_header_argument(self):
        requests = []

        def fake_fetch(url, key=None):
            requests.append((url, key))
            if "/hr/5?" in url:
                return json.dumps({"bill": {"title": "Sample", "latestAction": {"text": "Introduced", "actionDate": "2026-01-02"}}}).encode()
            return json.dumps({"bills": [{"type": "HR", "number": "5"}]}).encode()

        with patch.object(politics, "fetch", side_effect=fake_fetch), patch.dict(politics.os.environ, {"CONGRESS_GOV_API_KEY": "test-key"}):
            records = politics.bills(datetime(2026, 11, 11, tzinfo=timezone.utc))
        self.assertEqual(records[0]["action"], "Introduced")
        self.assertEqual(records[0]["id"], "119-hr-5")
        self.assertTrue(all(key == "test-key" and "test-key" not in url for url, key in requests))
        self.assertNotIn("test-key", json.dumps(records))


if __name__ == "__main__":
    unittest.main()
