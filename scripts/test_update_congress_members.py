import unittest
import xml.etree.ElementTree as ET

import update_congress_members as members

HOUSE_XML = """<MemberData><members>
<member><statedistrict>AK00</statedistrict><member-info><bioguideID>B001323</bioguideID><lastname>Begich</lastname>
<firstname>Nicholas</firstname><official-name>Nicholas J. Begich III</official-name><party>R</party><caucus>R</caucus>
<state postal-code="AK"><state-fullname>Alaska</state-fullname></state><district>At Large</district>
<office-building>CHOB</office-building><office-room>153</office-room><phone>(202) 225-5765</phone><sworn-date date="20250103"/></member-info>
<committee-assignments><committee comcode="AG00" rank="1" leadership="Chairman"/><subcommittee subcomcode="AG03" rank="2" leadership="Vice Chair"/></committee-assignments></member>
<member><statedistrict>CA12</statedistrict><member-info><bioguideID>X000001</bioguideID><lastname>Example</lastname>
<firstname>Pat</firstname><official-name>Pat Example</official-name><party>D</party>
<state postal-code="CA"><state-fullname>California</state-fullname></state><district>12th</district>
<office-building>RHOB</office-building><office-room>2400</office-room><phone>(202) 225-0000</phone></member-info>
<committee-assignments><committee comcode="AG00" rank="1"/></committee-assignments></member>
<member><statedistrict>CA13</statedistrict><member-info><bioguideID></bioguideID><party></party>
<state postal-code="CA"><state-fullname>California</state-fullname></state><district>13th</district></member-info></member>
<member><statedistrict>DC00</statedistrict><member-info><bioguideID>N000147</bioguideID><lastname>Norton</lastname>
<firstname>Eleanor</firstname><official-name>Eleanor Holmes Norton</official-name><party>D</party>
<state postal-code="DC"><state-fullname>District of Columbia</state-fullname></state><district>Delegate</district></member-info></member>
<member><statedistrict>TX01</statedistrict><member-info><bioguideID>Y000001</bioguideID><lastname>Why</lastname><firstname>Sam</firstname>
<official-name>Sam Why</official-name><party>R</party><state postal-code="TX"><state-fullname>Texas</state-fullname></state><district>1st</district></member-info></member>
</members><committees><committee comcode="AG00"><committee-fullname>Committee on Agriculture</committee-fullname>
<subcommittee subcomcode="AG03"><subcommittee-fullname>Nutrition and Foreign Agriculture</subcommittee-fullname></subcommittee></committee></committees></MemberData>"""

SENATE_ROSTER = b"""<committee_membership><committees><majority_party>R</majority_party><committee_name>Committee on Banking</committee_name>
<members><member><name><first>Tim</first><last>Scott</last></name><state>SC</state><party>R</party><position>Chairman</position></member>
<member><name><first>Elizabeth</first><last>Warren</last></name><state>MA</state><party>D</party><position>Ranking</position></member></members>
<subcommittee><subcommittee_name>Subcommittee on Digital Assets</subcommittee_name><members>
<member><name><first>Elizabeth</first><last>Warren</last></name><state>MA</state><party>D</party><position>Member</position></member></members></subcommittee>
</committees></committee_membership>"""


class CongressMemberTests(unittest.TestCase):
    def test_house_members_require_a_full_list(self):
        with self.assertRaises(ValueError):
            members.house_members(ET.fromstring(HOUSE_XML))

    def test_house_member_details(self):
        parsed = members.house_members(ET.fromstring(HOUSE_XML), minimum=0)
        by_id = {member["id"]: member for member in parsed}
        self.assertEqual(sorted(by_id), ["B001323", "N000147", "X000001", "Y000001"])  # the vacant seat is skipped
        begich = by_id["B001323"]
        self.assertEqual((begich["district"], begich["office"], begich["swornDate"]), ("At Large", "153 Cannon House Office Building", "2025-01-03"))
        self.assertEqual(begich["committees"][0]["role"], "Chair")
        self.assertEqual(begich["committees"][0]["subcommittees"], [{"name": "Nutrition and Foreign Agriculture", "role": "Vice Chair"}])
        # Rank 1 in the minority party is the ranking member.
        self.assertEqual(by_id["X000001"]["committees"][0]["role"], "Ranking Member")
        self.assertEqual((by_id["X000001"]["district"], by_id["Y000001"]["district"]), ("12", "1"))
        self.assertTrue(by_id["N000147"]["delegate"])
        self.assertEqual(by_id["N000147"]["district"], "At Large")

    def test_senate_roster_roles(self):
        roster = members.parse_senate_roster(SENATE_ROSTER)
        contact = ET.fromstring("""<contact_information><member><last_name>Warren</last_name><first_name>Elizabeth</first_name><party>D</party>
        <state>MA</state><address>311 Hart</address><phone>(202) 224-4543</phone><email>https://www.warren.senate.gov/contact</email>
        <website>https://www.warren.senate.gov</website><class>Class I</class><bioguide_id>W000817</bioguide_id></member></contact_information>""")
        cvc = ET.fromstring("""<senators><senator lis_member_id="S366"><bioguideId>W000817</bioguideId><committees>
        <committee code="SSBK00">Committee on Banking, Housing, and Urban Affairs</committee></committees></senator></senators>""")
        with self.assertRaises(ValueError):
            members.senate_members(contact, cvc, {"SSBK": roster})  # one senator is an incomplete Senate
        senator = members.senate_members(contact, cvc, {"SSBK": roster}, minimum=0)[0]
        self.assertEqual((senator["senateClass"], senator["lisId"], senator["contactUrl"]), ("I", "S366", "https://www.warren.senate.gov/contact"))
        banking = senator["committees"][0]
        self.assertEqual((banking["role"], banking["subcommittees"]), ("Ranking Member", [{"name": "Subcommittee on Digital Assets", "role": ""}]))

    def test_vote_codes_and_party_summary(self):
        self.assertEqual([members.vote_code(value) for value in ("Yea", "Aye", "Nay", "No", "Present", "Not Voting", "Guilty")],
                         ["Y", "Y", "N", "N", "P", "X", "Y"])
        roster = [{"id": "R1", "party": "R"}, {"id": "R2", "party": "R"}, {"id": "D1", "party": "D"}, {"id": "I1", "party": "I"}]
        calls = [
            {"positions": {"R1": "Y", "R2": "Y", "D1": "N", "I1": "N"}},
            {"positions": {"R1": "N", "R2": "Y", "D1": "Y", "I1": "X"}},
            {"positions": {"R1": "Y", "D1": "N", "I1": "Y"}},  # R2 not yet seated
        ]
        members.voting_summary(roster, calls)
        by_id = {member["id"]: member["votes"] for member in roster}
        self.assertEqual(by_id["R2"]["codes"], "YY-")
        self.assertEqual(by_id["I1"], {"codes": "NXY", "cast": 2, "missed": 1, "withR": 1, "withD": 1})
        self.assertEqual(calls[0]["partyMajority"], {"R": "Y", "D": "N"})
        self.assertEqual(calls[1]["partyMajority"], {"D": "Y"})  # Republicans split evenly
        self.assertEqual(by_id["R1"]["withR"], 2)

    def test_roles_and_bill_links(self):
        self.assertEqual([members.normalize_role(role) for role in ("Chairman", "Chairwoman", "Ranking", "Vice Chairman", "Member", "Ex Officio")],
                         ["Chair", "Chair", "Ranking Member", "Vice Chair", "", "Ex Officio"])
        self.assertEqual(members.bill_kind("hjres"), "house-joint-resolution")
        self.assertEqual(members.ordinal(119), "119th")
        self.assertEqual(members.ordinal(112), "112th")
        self.assertEqual(members.STATE_NAMES["NH"], "New Hampshire")


if __name__ == "__main__":
    unittest.main()
