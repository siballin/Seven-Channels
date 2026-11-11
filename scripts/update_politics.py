#!/usr/bin/env python3
"""Refresh independently sourced public congressional snapshots."""

from datetime import datetime, timezone
from collections import Counter
import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "politics.json"
HEADERS = {"User-Agent": "SevenChannelsPolitics/1.0", "Accept": "*/*"}


def fetch(url, key=None):
    headers = dict(HEADERS)
    if key:
        headers["X-Api-Key"] = key
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        return response.read()


def text(node, path):
    return (node.findtext(path) or "").strip()


def date_iso(value, fmt):
    return datetime.strptime(value, fmt).date().isoformat()


def bill_url(congress, name):
    match = re.fullmatch(r"\s*(H\.?\s*R\.?|S\.?|H\.?\s*RES\.?|S\.?\s*RES\.?|H\.?\s*J\.?\s*RES\.?|S\.?\s*J\.?\s*RES\.?)\s*(\d+)\s*", name, re.I)
    if not match:
        return ""
    kinds = {"HR": "house-bill", "S": "senate-bill", "HRES": "house-resolution", "SRES": "senate-resolution", "HJRES": "house-joint-resolution", "SJRES": "senate-joint-resolution"}
    kind = kinds.get(re.sub(r"[\s.]", "", match.group(1)).upper())
    congress_number = int(congress)
    suffix = "th" if 10 <= congress_number % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(congress_number % 10, "th")
    return f"https://www.congress.gov/bill/{congress_number}{suffix}-congress/{kind}/{match.group(2)}" if kind else ""


def category(question):
    question = question.lower()
    if "amendment" in question:
        return "Amendment"
    if "passage" in question or "pass the bill" in question:
        return "Final passage"
    return "Procedural or other"


def house_vote(year, roll):
    url = f"https://clerk.house.gov/evs/{year}/roll{roll:03d}.xml"
    root = ET.fromstring(fetch(url))
    meta = root.find("vote-metadata")
    if meta is None:
        raise ValueError(f"Missing House metadata for roll {roll}")
    question = text(meta, "vote-question")
    if not question or not text(meta, "action-date"):
        raise ValueError(f"Incomplete House vote {roll}")
    members = []
    for row in root.findall(".//recorded-vote"):
        person = row.find("legislator")
        if person is not None:
            members.append({"name": (person.text or "").strip(), "party": person.get("party", ""), "state": person.get("state", ""), "vote": text(row, "vote")})
    totals = meta.find(".//totals-by-vote")
    if totals is None or not members:
        raise ValueError(f"Incomplete House totals or members for roll {roll}")
    return {"chamber": "House", "question": question, "description": text(meta, "vote-desc"),
            "date": date_iso(text(meta, "action-date"), "%d-%b-%Y"), "result": text(meta, "vote-result"),
            "category": category(question), "tally": {label: text(totals, tag) for label, tag in [
                ("Yea", "yea-total"), ("Nay", "nay-total"), ("Present", "present-total"), ("Not voting", "not-voting-total")]},
            "members": members, "url": f"https://clerk.house.gov/Votes/{year}{roll}",
            "billUrl": bill_url(text(meta, "congress"), text(meta, "legis-num"))}


def house_votes(now):
    session = "1st" if now.year % 2 else "2nd"
    html = fetch(f"https://clerk.house.gov/Votes/MemberVotes?Session={session}").decode("utf-8")
    ids = list(dict.fromkeys(re.findall(r'/Votes/(' + str(now.year) + r'(\d{1,4}))(?:[?"\'])', html)))
    if not ids:
        raise ValueError("No House vote links in official listing")
    return [house_vote(now.year, int(roll)) for _, roll in ids[:8]]


def senate_votes(now):
    congress = (now.year - 1789) // 2 + 1
    session = 1 if now.year % 2 else 2
    base = "https://www.senate.gov/legislative/LIS"
    listing = ET.fromstring(fetch(f"{base}/roll_call_lists/vote_menu_{congress}_{session}.xml"))
    numbers = [text(vote, "vote_number") for vote in listing.findall("./votes/vote")][:8]
    if not numbers:
        raise ValueError("No Senate votes in official listing")
    votes = []
    for number in numbers:
        if not number.isdigit():
            raise ValueError("Invalid Senate roll number")
        number = number.zfill(5)
        root = ET.fromstring(fetch(f"{base}/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{number}.xml"))
        question = text(root, "vote_question_text")
        members = [{"name": text(member, "member_full"), "party": text(member, "party"), "state": text(member, "state"), "vote": text(member, "vote_cast")} for member in root.findall("./members/member")]
        if not question or not members:
            raise ValueError(f"Incomplete Senate vote {number}")
        date = datetime.strptime(" ".join(text(root, "vote_date").split()), "%B %d, %Y, %I:%M %p").date().isoformat()
        votes.append({"chamber": "Senate", "question": question, "description": text(root, "vote_document_text"),
                      "date": date, "result": text(root, "vote_result_text"), "category": category(question),
                      "tally": {label: text(root, f"count/{tag}") for label, tag in [("Yea", "yeas"), ("Nay", "nays"), ("Present", "present"), ("Not voting", "absent")]},
                      "members": members, "url": f"{base}/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{number}.htm",
                      "billUrl": bill_url(congress, text(root, "document/document_name"))})
    return votes


def hearings(now):
    url = "https://www.senate.gov/general/committee_schedules/hearings.xml"
    root = ET.fromstring(fetch(url))
    events = []
    for meeting in root.findall("meeting"):
        date, title = text(meeting, "date_iso_8601"), text(meeting, "matter")
        if date >= now.date().isoformat() and title and text(meeting, "committee"):
            events.append({"date": date, "title": title, "detail": text(meeting, "committee") + " · " + text(meeting, "time"), "url": "https://www.senate.gov/committees/committee_hearings.htm", "source": "U.S. Senate"})
    return events


def house_seats(_now):
    root = ET.fromstring(fetch("https://clerk.house.gov/xml/lists/MemberData.xml"))
    members = []
    for member in root.findall("./members/member"):
        info = member.find("member-info")
        if info is None:
            raise ValueError("House member record has no information")
        state = info.find("state")
        if state is None:
            raise ValueError("House member record has no state")
        if state.get("postal-code") not in {"DC", "PR", "AS", "GU", "MP", "VI"}:
            members.append(member)
    if len(members) != 435 or len({text(member, "statedistrict") for member in members}) != 435:
        raise ValueError("House district list is incomplete")
    counts = Counter(text(member, "member-info/party") or "Vacant" for member in members)
    return [{"counts": dict(counts), "seated": 435 - counts.get("Vacant", 0), "vacancies": counts.get("Vacant", 0), "url": "https://clerk.house.gov/Members"}]


def senate_seats(_now):
    root = ET.fromstring(fetch("https://www.senate.gov/general/contact_information/senators_cfm.xml"))
    members = root.findall("member")
    ids = [text(member, "bioguide_id") for member in members]
    if not members or len(members) > 100 or any(not item for item in ids) or len(set(ids)) != len(ids):
        raise ValueError("Senate member list is incomplete")
    counts = Counter(text(member, "party") or "Unspecified" for member in members)
    return [{"counts": dict(counts), "seated": len(members), "vacancies": 100 - len(members), "url": "https://www.senate.gov/senators/index.htm"}]


def bills(now):
    key = os.environ.get("CONGRESS_GOV_API_KEY", "").strip()
    if not key:
        raise ValueError("CONGRESS_GOV_API_KEY is not configured")
    congress = (now.year - 1789) // 2 + 1
    data = json.loads(fetch(f"https://api.congress.gov/v3/bill/{congress}?format=json&limit=20&sort=updateDate+desc", key))
    items = data.get("bills")
    if not isinstance(items, list):
        raise ValueError("Congress.gov bill listing is incomplete")
    output = []
    for item in items:
        kind, number = str(item.get("type", "")).lower(), str(item.get("number", ""))
        if not re.fullmatch(r"(hr|s|hjres|sjres|hres|sres)", kind) or not number.isdigit():
            continue
        detail = json.loads(fetch(f"https://api.congress.gov/v3/bill/{congress}/{kind}/{number}?format=json", key)).get("bill", {})
        latest = detail.get("latestAction", {})
        output.append({"id": f"{congress}-{kind}-{number}", "number": f"{kind.upper()} {number}", "title": detail.get("title", item.get("title", "")),
                       "action": latest.get("text", ""), "date": latest.get("actionDate", ""),
                       "url": bill_url(congress, f"{kind} {number}")})
    return output


def main():
    now = datetime.now(timezone.utc)
    if OUTPUT.exists():
        try:
            snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
            if not isinstance(snapshot, dict):
                raise ValueError("snapshot is not an object")
        except (ValueError, OSError) as exc:
            raise SystemExit(f"Cannot safely read prior politics snapshot: {exc}") from exc
    else:
        snapshot = {}
    for name, loader in [("house", house_votes), ("senate", senate_votes), ("hearings", hearings), ("houseSeats", house_seats), ("senateSeats", senate_seats), ("bills", bills)]:
        try:
            items = loader(now)
            snapshot[name] = {"fetchedAt": now.isoformat(timespec="seconds"), "items": items}
            print(f"{name}: refreshed {len(items)} records")
        except Exception as exc:
            print(f"{name}: refresh failed; retaining prior data if available: {type(exc).__name__}: {exc}", file=sys.stderr)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)


if __name__ == "__main__":
    main()
