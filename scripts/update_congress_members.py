#!/usr/bin/env python3
"""Build the Capitol Hill member database used by the Politics channel.

Official sources:
- House Clerk member data (members, offices, committees) and House roll-call votes.
- Senate.gov senator contact list, committee rosters and roll-call votes.
- Congress.gov API (terms, leadership, sponsored and cosponsored legislation) when
  CONGRESS_GOV_API_KEY is set. Each member's bills are refreshed weekly (terms monthly), and
  without a key those fields keep their last saved values.
- Official member photos from the Biographical Directory of the U.S. Congress.

One volunteer-maintained source: social media accounts from the @unitedstates
congress-legislators project on GitHub, matched by Bioguide ID.

Each source refreshes independently; a source that fails keeps its last saved data.
"""

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import html
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "congress-members.json"
USER_AGENT = "SevenChannelsPolitics/1.0 (+https://siballin.github.io/Seven-Channels/)"
ROLL_CALLS_PER_CHAMBER = 50
SPONSORED_PER_MEMBER = 5
DETAIL_MAX_AGE_DAYS = 30
# Sponsored-bill lists are refreshed weekly; the daily run reuses them in between (the full refresh takes ~20 minutes).
LEGISLATION_MAX_AGE_DAYS = 7
CONGRESS_API = "https://api.congress.gov/v3"
SOCIAL_URL = "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages/legislators-social-media.json"
HOUSE_BUILDINGS = {"CHOB": "Cannon House Office Building", "LHOB": "Longworth House Office Building", "RHOB": "Rayburn House Office Building"}
PARTY_NAMES = {"R": "Republican", "D": "Democrat", "I": "Independent", "ID": "Independent", "L": "Libertarian"}
TERRITORIES = {"DC", "PR", "AS", "GU", "MP", "VI"}
STATE_NAMES = dict(item.split(":") for item in (
    "AL:Alabama AK:Alaska AZ:Arizona AR:Arkansas CA:California CO:Colorado CT:Connecticut DE:Delaware FL:Florida GA:Georgia "
    "HI:Hawaii ID:Idaho IL:Illinois IN:Indiana IA:Iowa KS:Kansas KY:Kentucky LA:Louisiana ME:Maine MD:Maryland "
    "MA:Massachusetts MI:Michigan MN:Minnesota MS:Mississippi MO:Missouri MT:Montana NE:Nebraska NV:Nevada "
    "NH:New_Hampshire NJ:New_Jersey NM:New_Mexico NY:New_York NC:North_Carolina ND:North_Dakota OH:Ohio OK:Oklahoma "
    "OR:Oregon PA:Pennsylvania RI:Rhode_Island SC:South_Carolina SD:South_Dakota TN:Tennessee TX:Texas UT:Utah "
    "VT:Vermont VA:Virginia WA:Washington WV:West_Virginia WI:Wisconsin WY:Wyoming DC:District_of_Columbia "
    "PR:Puerto_Rico AS:American_Samoa GU:Guam MP:Northern_Mariana_Islands VI:U.S._Virgin_Islands").replace("_", "~").split())
STATE_NAMES = {code: name.replace("~", " ") for code, name in STATE_NAMES.items()}


def fetch(url, key=None, delay=0.0):
    if delay:
        time.sleep(delay)
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if key:
        headers["X-Api-Key"] = key
    with urlopen(Request(url, headers=headers), timeout=45) as response:
        return response.read()


def text(node, path):
    return (node.findtext(path) or "").strip() if node is not None else ""


def clean(value):
    # Senate vote files sometimes double-encode entities (for example "&#38;").
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def shorten(value, limit):
    value = clean(value)
    return value if len(value) <= limit else value[:limit - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def ordinal(number):
    suffix = "th" if 10 <= number % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


def current_congress(now):
    return (now.year - 1789) // 2 + 1


# ---------- House ----------

def house_members(root, minimum=400):
    committees, subcommittees = {}, {}
    for committee in root.findall("./committees/committee"):
        code = committee.get("comcode", "")
        committees[code] = clean(text(committee, "committee-fullname"))
        for sub in committee.findall("subcommittee"):
            subcommittees[sub.get("subcomcode", "")] = (code, clean(text(sub, "subcommittee-fullname")))
    raw = []
    for member in root.findall("./members/member"):
        info = member.find("member-info")
        bioguide = text(info, "bioguideID")
        if not bioguide:
            continue  # vacant seat
        raw.append((member, info, bioguide))
    seats = Counter(text(info, "party") for _, info, _ in raw if text(info, "state").upper() not in TERRITORIES)
    majority = seats.most_common(1)[0][0] if seats else ""
    members = []
    for member, info, bioguide in raw:
        state = info.find("state")
        postal = state.get("postal-code", "") if state is not None else ""
        party = text(info, "party")
        assignments = []
        for assignment in member.findall("./committee-assignments/committee"):
            code = assignment.get("comcode", "")
            if code not in committees:
                continue
            role = assignment.get("leadership", "")
            if not role and assignment.get("rank") == "1" and party and party != majority:
                role = "Ranking Member"
            assignments.append({"code": code, "name": committees[code], "role": normalize_role(role), "subcommittees": []})
        for assignment in member.findall("./committee-assignments/subcommittee"):
            code = assignment.get("subcomcode", "")
            parent_code, name = subcommittees.get(code, ("", ""))
            parent = next((item for item in assignments if item["code"] == parent_code), None)
            if parent and name:
                role = assignment.get("leadership", "")
                if not role and assignment.get("rank") == "1" and party and party != majority:
                    role = "Ranking Member"
                parent["subcommittees"].append({"name": name, "role": normalize_role(role)})
        # Seat codes look like "AL02"; "00" is an at-large seat or a delegate.
        seat = text(member, "statedistrict")
        district = str(int(seat[2:])) if re.fullmatch(r"[A-Z]{2}\d{2}", seat) and int(seat[2:]) else "At Large"
        building = text(info, "office-building")
        room = text(info, "office-room")
        sworn = (info.find("sworn-date").get("date", "") if info.find("sworn-date") is not None else "")
        members.append({
            "id": bioguide,
            "chamber": "House",
            "name": clean(text(info, "official-name")) or clean(f"{text(info, 'firstname')} {text(info, 'lastname')}"),
            "firstName": text(info, "firstname"),
            "lastName": text(info, "lastname"),
            "party": party,
            "caucus": text(info, "caucus") or party,
            "state": postal,
            "stateName": text(state, "state-fullname") if state is not None else "",
            "district": district,
            "delegate": postal in TERRITORIES,
            "office": f"{room} {HOUSE_BUILDINGS.get(building, building)}".strip(),
            "phone": text(info, "phone"),
            "swornDate": f"{sworn[:4]}-{sworn[4:6]}-{sworn[6:]}" if re.fullmatch(r"\d{8}", sworn) else "",
            "committees": sorted(assignments, key=lambda item: item["name"]),
        })
    if len([member for member in members if not member["delegate"]]) < minimum:
        raise ValueError("House member list looks incomplete")
    return members


def normalize_role(role):
    role = clean(role)
    lowered = role.lower()
    if lowered in ("chair", "chairman", "chairwoman"):
        return "Chair"
    if lowered in ("vice chair", "vice chairman", "vice chairwoman"):
        return "Vice Chair"
    if lowered in ("ranking", "ranking member"):
        return "Ranking Member"
    if lowered in ("cochair", "cochairman", "co-chair", "co-chairman", "cochairwoman", "co-chairwoman"):
        return "Co-Chair"
    if lowered == "ex officio":
        return "Ex Officio"
    return "" if lowered == "member" else role


# ---------- Senate ----------

def senate_members(contact_root, cvc_root, rosters, minimum=90):
    lis_ids, cvc_committees = {}, {}
    for senator in cvc_root.findall("senator"):
        bioguide = text(senator, "bioguideId")
        lis_ids[bioguide] = senator.get("lis_member_id", "")
        cvc_committees[bioguide] = [(item.get("code", ""), clean(item.text)) for item in senator.findall("./committees/committee")]
    members = []
    for member in contact_root.findall("member"):
        bioguide = text(member, "bioguide_id")
        if not bioguide:
            continue
        last, state = text(member, "last_name"), text(member, "state")
        committees = []
        for code, name in cvc_committees.get(bioguide, []):
            roster = rosters.get(code[:4], {})
            entry = {"code": code, "name": name or roster.get("name", ""), "role": "", "subcommittees": []}
            for person in roster.get("members", []):
                if person["last"] == last and person["state"] == state:
                    entry["role"] = normalize_role(person["position"])
            for sub in roster.get("subcommittees", []):
                for person in sub["members"]:
                    if person["last"] == last and person["state"] == state:
                        entry["subcommittees"].append({"name": sub["name"], "role": normalize_role(person["position"])})
            committees.append(entry)
        contact = text(member, "email")
        members.append({
            "id": bioguide,
            "chamber": "Senate",
            "name": clean(f"{text(member, 'first_name')} {last}"),
            "firstName": text(member, "first_name"),
            "lastName": last,
            "party": text(member, "party"),
            "caucus": text(member, "party"),
            "state": state,
            "stateName": "",
            "senateClass": text(member, "class").replace("Class ", ""),
            "lisId": lis_ids.get(bioguide, ""),
            "office": clean(text(member, "address")),
            "phone": text(member, "phone"),
            "website": text(member, "website"),
            "contactUrl": contact if contact.startswith("https://") else "",
            "committees": sorted(committees, key=lambda item: item["name"]),
        })
    if not minimum <= len(members) <= 100:
        raise ValueError("Senate member list looks incomplete")
    return members


def parse_senate_roster(xml):
    root = ET.fromstring(xml)
    committee = root.find("./committees")

    def people(node):
        return [{"last": text(item, "name/last"), "state": text(item, "state"), "position": text(item, "position")}
                for item in node.findall("./members/member")] if node is not None else []

    return {
        "name": clean(text(committee, "committee_name")),
        "members": people(committee),
        "subcommittees": [{"name": clean(text(sub, "subcommittee_name")), "members": people(sub)} for sub in committee.findall("subcommittee")]
        if committee is not None else [],
    }


# ---------- Votes ----------

VOTE_CODES = {"yea": "Y", "aye": "Y", "nay": "N", "no": "N", "present": "P", "not voting": "X", "guilty": "Y", "not guilty": "N"}


def vote_code(value):
    return VOTE_CODES.get(clean(value).lower(), "X")


def house_roll_calls(now, count):
    listing = fetch(f"https://clerk.house.gov/Votes/MemberVotes?Session={'1st' if now.year % 2 else '2nd'}").decode("utf-8")
    rolls = [int(roll) for roll in re.findall(rf"/Votes/{now.year}(\d{{1,4}})(?:[?\"'])", listing)]
    if not rolls:
        raise ValueError("No House roll calls listed")
    calls = []
    for roll in range(max(rolls), max(0, max(rolls) - count), -1):
        root = ET.fromstring(fetch(f"https://clerk.house.gov/evs/{now.year}/roll{roll:03d}.xml", delay=0.3))
        meta = root.find("vote-metadata")
        positions = {}
        for row in root.findall(".//recorded-vote"):
            person = row.find("legislator")
            if person is not None and person.get("name-id"):
                positions[person.get("name-id")] = vote_code(text(row, "vote"))
        date = datetime.strptime(text(meta, "action-date"), "%d-%b-%Y").date().isoformat()
        calls.append({"id": f"house-{now.year}-{roll}", "chamber": "House", "date": date, "question": text(meta, "vote-question"),
                      "description": clean(text(meta, "vote-desc")) or clean(text(meta, "legis-num")), "result": text(meta, "vote-result"),
                      "url": f"https://clerk.house.gov/Votes/{now.year}{roll}", "positions": positions})
    return calls


def senate_roll_calls(now, count, lis_to_bioguide):
    congress, session = current_congress(now), 1 if now.year % 2 else 2
    base = "https://www.senate.gov/legislative/LIS"
    listing = ET.fromstring(fetch(f"{base}/roll_call_lists/vote_menu_{congress}_{session}.xml"))
    numbers = [text(vote, "vote_number") for vote in listing.findall("./votes/vote")][:count]
    calls = []
    for number in numbers:
        number = number.zfill(5)
        root = ET.fromstring(fetch(f"{base}/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{number}.xml", delay=0.3))
        positions = {}
        for member in root.findall("./members/member"):
            bioguide = lis_to_bioguide.get(text(member, "lis_member_id"))
            if bioguide:
                positions[bioguide] = vote_code(text(member, "vote_cast"))
        date = datetime.strptime(" ".join(text(root, "vote_date").split()), "%B %d, %Y, %I:%M %p").date().isoformat()
        calls.append({"id": f"senate-{congress}-{session}-{int(number)}", "chamber": "Senate", "date": date,
                      "question": text(root, "vote_question_text"), "description": clean(text(root, "vote_document_text")) or clean(text(root, "vote_title")),
                      "result": text(root, "vote_result_text"),
                      "url": f"{base}/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{number}.htm", "positions": positions})
    return calls


def party_majorities(call, parties):
    """Majority yea/nay position of each party on one roll call."""
    tallies = defaultdict(Counter)
    for member_id, code in call["positions"].items():
        if code in "YN":
            tallies[parties.get(member_id, "")][code] += 1
    return {party: ("Y" if tally["Y"] > tally["N"] else "N" if tally["N"] > tally["Y"] else "") for party, tally in tallies.items()}


def voting_summary(members, calls):
    """Per member: compact votes aligned with the chamber's roll calls, and how often they voted with each party's majority."""
    parties = {member["id"]: member["party"] for member in members}
    majorities = [party_majorities(call, parties) for call in calls]
    for call, majority in zip(calls, majorities):
        call["partyMajority"] = {party: position for party, position in majority.items() if party in ("R", "D") and position}
    for member in members:
        codes = "".join(call["positions"].get(member["id"], "-") for call in calls)
        cast = sum(code in "YN" for code in codes)
        with_party = Counter()
        for code, majority in zip(codes, majorities):
            if code not in "YN":
                continue
            for party in ("R", "D"):
                if majority.get(party) == code:
                    with_party[party] += 1
        member["votes"] = {"codes": codes, "cast": cast, "missed": codes.count("X"),
                           "withR": with_party["R"], "withD": with_party["D"]}


# ---------- Congress.gov ----------

def age_days(checked, now):
    if not checked:
        return None
    try:
        return (now - datetime.fromisoformat(checked.replace("Z", "+00:00"))).days
    except ValueError:
        return None


def is_stale(checked, now, limit):
    age = age_days(checked, now)
    return age is None or age >= limit


def needs_congress_refresh(old, now):
    """True when a member's saved Congress.gov data is missing, its bills are a week old, or its terms are a month old."""
    return (old.get("detail") is None or old.get("legislation") is None
            or is_stale(old.get("legislationCheckedAt", ""), now, LEGISLATION_MAX_AGE_DAYS)
            or is_stale(old.get("detailCheckedAt", ""), now, DETAIL_MAX_AGE_DAYS))


def congress_details(member, key, previous, now):
    """Terms and leadership change rarely, so they're refetched monthly; bills are refetched whenever this is called."""
    old = previous.get(member["id"], {})
    detail = old.get("detail")
    checked = old.get("detailCheckedAt", "")
    if detail is None or is_stale(checked, now, DETAIL_MAX_AGE_DAYS):
        data = json.loads(fetch(f"{CONGRESS_API}/member/{member['id']}?format=json", key, delay=0.2)).get("member", {})
        terms = data.get("terms") if isinstance(data.get("terms"), list) else []
        first = min((term.get("startYear") for term in terms if isinstance(term.get("startYear"), int)), default=None)
        leadership = [item.get("type", "") for item in (data.get("leadership") or []) if item.get("current")]
        detail = {
            "firstYear": first,
            "chambersServed": sorted({term.get("chamber", "") for term in terms if term.get("chamber")}),
            "leadership": [item for item in leadership if item],
            "birthYear": data.get("birthYear") or "",
            "website": data.get("officialWebsiteUrl") or "",
            "stateName": data.get("state") or "",
        }
        checked = now.isoformat(timespec="seconds")
    sponsored = json.loads(fetch(f"{CONGRESS_API}/member/{member['id']}/sponsored-legislation?format=json&limit=40", key, delay=0.2))
    bills = []
    for item in sponsored.get("sponsoredLegislation", []):
        kind, number, congress = str(item.get("type") or "").lower(), str(item.get("number") or ""), item.get("congress")
        if not kind or not number.isdigit() or not isinstance(congress, int):
            continue  # amendments have no bill type
        latest = item.get("latestAction") or {}
        # The page builds the Congress.gov link from type, number and congress, which keeps the data file small.
        bills.append({"type": kind, "number": number, "congress": congress, "title": shorten(item.get("title", ""), 200),
                      "introduced": item.get("introducedDate", ""), "action": shorten(latest.get("text", ""), 140),
                      "actionDate": latest.get("actionDate", "")})
        if len(bills) >= SPONSORED_PER_MEMBER:
            break
    cosponsored = json.loads(fetch(f"{CONGRESS_API}/member/{member['id']}/cosponsored-legislation?format=json&limit=1", key, delay=0.2))
    legislation = {"sponsoredCount": (sponsored.get("pagination") or {}).get("count"),
                   "cosponsoredCount": (cosponsored.get("pagination") or {}).get("count"), "recent": bills}
    return detail, checked, legislation


def bill_kind(kind):
    return {"hr": "house-bill", "s": "senate-bill", "hres": "house-resolution", "sres": "senate-resolution",
            "hjres": "house-joint-resolution", "sjres": "senate-joint-resolution",
            "hconres": "house-concurrent-resolution", "sconres": "senate-concurrent-resolution"}.get(kind, kind)


# ---------- Assembly ----------

def load_previous():
    try:
        data = json.loads(OUTPUT.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    stamp = now.isoformat().replace("+00:00", "Z")
    previous = load_previous()
    previous_members = {member["id"]: member for member in previous.get("members", []) if isinstance(member, dict) and member.get("id")}
    previous_sources = {source.get("name"): source for source in previous.get("sources", [])}
    sources = []

    def record(name, ok, message=""):
        old = previous_sources.get(name, {})
        sources.append({"name": name, "status": "ok" if ok else ("stale" if old.get("refreshedAt") else "error"),
                        "refreshedAt": stamp if ok else old.get("refreshedAt", ""), "message": message})

    members = []
    try:
        members += house_members(ET.fromstring(fetch("https://clerk.house.gov/xml/lists/MemberData.xml")))
        record("House members", True)
    except Exception as error:
        print(f"House members failed: {error}", file=sys.stderr)
        members += [member for member in previous_members.values() if member.get("chamber") == "House"]
        record("House members", False, "Could not refresh the House Clerk member list; showing the last saved list.")
    try:
        contact = ET.fromstring(fetch("https://www.senate.gov/general/contact_information/senators_cfm.xml"))
        cvc = ET.fromstring(fetch("https://www.senate.gov/legislative/LIS_MEMBER/cvc_member_data.xml"))
        codes = sorted({item.get("code", "")[:4] for item in cvc.iter("committee") if item.get("code")})
        rosters = {}
        for code in codes:
            try:
                rosters[code] = parse_senate_roster(fetch(f"https://www.senate.gov/general/committee_membership/committee_memberships_{code}.xml", delay=0.3))
            except Exception as error:
                print(f"Senate committee {code} failed: {error}", file=sys.stderr)
        members += senate_members(contact, cvc, rosters)
        record("Senate members", True)
    except Exception as error:
        print(f"Senate members failed: {error}", file=sys.stderr)
        members += [member for member in previous_members.values() if member.get("chamber") == "Senate"]
        record("Senate members", False, "Could not refresh the Senate member list; showing the last saved list.")

    roll_calls = {}
    for chamber, loader in (("House", lambda: house_roll_calls(now, ROLL_CALLS_PER_CHAMBER)),
                            ("Senate", lambda: senate_roll_calls(now, ROLL_CALLS_PER_CHAMBER,
                                                                 {m["lisId"]: m["id"] for m in members if m.get("lisId")}))):
        chamber_members = [member for member in members if member["chamber"] == chamber]
        try:
            calls = loader()
            voting_summary(chamber_members, calls)
            roll_calls[chamber] = [{key: value for key, value in call.items() if key != "positions"} for call in calls]
            record(f"{chamber} votes", True)
        except Exception as error:
            print(f"{chamber} votes failed: {error}", file=sys.stderr)
            roll_calls[chamber] = (previous.get("rollCalls") or {}).get(chamber, [])
            for member in chamber_members:
                member["votes"] = previous_members.get(member["id"], {}).get("votes")
            record(f"{chamber} votes", False, f"Could not refresh {chamber} roll calls; showing the last saved votes.")

    print(f"{len(members)} members; roll calls: " + ", ".join(f"{chamber} {len(calls)}" for chamber, calls in roll_calls.items()), flush=True)
    key = os.environ.get("CONGRESS_GOV_API_KEY", "").strip()
    api_failures = 0
    refreshed = 0
    for position, member in enumerate(sorted(members, key=lambda item: item["id"])):
        old = previous_members.get(member["id"], {})
        if old.get("legislation") is not None and not old.get("legislationCheckedAt") and old.get("detailCheckedAt"):
            # Snapshots from before the weekly schedule: spread members over the week so each daily run does about a seventh.
            old = dict(old, legislationCheckedAt=(now - timedelta(days=position % LEGISLATION_MAX_AGE_DAYS)).isoformat(timespec="seconds"))
            member["legislationCheckedAt"] = old["legislationCheckedAt"]
        if key and needs_congress_refresh(old, now):
            refreshed += 1
            if refreshed % 100 == 0:
                print(f"Congress.gov: {refreshed} members refreshed", flush=True)
            try:
                detail, checked, legislation = congress_details(member, key, previous_members, now)
                member.update(detail=detail, detailCheckedAt=checked, legislation=legislation,
                              legislationCheckedAt=now.isoformat(timespec="seconds"))
                continue
            except Exception as error:
                api_failures += 1
                print(f"Congress.gov failed for {member['id']}: {error}", file=sys.stderr)
        for field in ("detail", "detailCheckedAt", "legislation", "legislationCheckedAt"):
            if old.get(field) is not None:
                member[field] = old[field]
    if key:
        print(f"Congress.gov: refreshed {refreshed} of {len(members)} members; the rest were checked in the last {LEGISLATION_MAX_AGE_DAYS} days", flush=True)
        record("Congress.gov", api_failures <= refreshed / 10,
               f"{api_failures} members could not be refreshed from Congress.gov." if api_failures else "")
    else:
        record("Congress.gov", False, "No Congress.gov API key is configured, so terms and bills aren't refreshed.")

    try:
        social = json.loads(fetch(SOCIAL_URL))
        accounts = {entry["id"]["bioguide"]: entry.get("social", {}) for entry in social if entry.get("id", {}).get("bioguide")}
        for member in members:
            found = accounts.get(member["id"], {})
            member["social"] = {key: found[key] for key in ("twitter", "facebook", "youtube", "youtube_id", "instagram", "mastodon") if found.get(key)}
        record("Social media", True)
    except Exception as error:
        print(f"Social media failed: {error}", file=sys.stderr)
        for member in members:
            member["social"] = previous_members.get(member["id"], {}).get("social", {})
        record("Social media", False, "Could not refresh social media accounts; showing the last saved list.")

    for member in members:
        member["photo"] = f"https://bioguide.congress.gov/photo/{member['id']}.jpg"
        member["partyName"] = PARTY_NAMES.get(member["party"], member["party"])
        detail = member.get("detail") or {}
        if not member.get("stateName"):
            member["stateName"] = STATE_NAMES.get(member["state"], "") or detail.get("stateName", "")
        if not member.get("website") and detail.get("website"):
            member["website"] = detail["website"]
    output = {
        "generatedAt": stamp,
        "congress": current_congress(now),
        "sources": sources,
        "rollCalls": roll_calls,
        "members": sorted(members, key=lambda item: (item["chamber"], item["state"], item.get("district", ""), item["lastName"])),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Saved {len(members)} members: " + ", ".join(f"{s['name']} {s['status']}" for s in sources))


if __name__ == "__main__":
    main()
