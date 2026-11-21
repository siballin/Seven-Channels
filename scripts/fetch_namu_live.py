#!/usr/bin/env python3
"""Fill idol positions and MBTI from live Namu Wiki pages. Run this on your own computer: Namu Wiki refuses
GitHub's servers, but usually answers home connections.

It only asks for idols the 2021 dump doesn't cover (or that you name), one page every few seconds, and
remembers every page it checked for 30 days, so repeat runs pick up where the last one stopped. Results go to
data/idols/namu-live.json; commit and push it, and the next site build uses it.

Usage (from the repository folder):
  python3 scripts/fetch_namu_live.py                       # up to 150 idols, newest groups first
  python3 scripts/fetch_namu_live.py --group IVE --group XG  # only these groups (English or Korean name)
  python3 scripts/fetch_namu_live.py --limit 400 --delay 5
  python3 scripts/fetch_namu_live.py --refresh               # re-check idols already filled (positions change)

Namu Wiki text is CC BY-NC-SA 2.0 KR; the site credits it on each profile.
"""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
import namu_parse  # noqa: E402

OUTPUT = namu_parse.IDOLS / "namu-live.json"
DUMP = namu_parse.IDOLS / "namu-positions.json"
USER_AGENT = "SevenChannels/1.0 (personal non-commercial K-pop site; slow position lookups)"
RECHECK_DAYS = 30


class Blocked(Exception):
    pass


def fetch_raw(title):
    """Raw namumark for a page, None if it doesn't exist. Raises Blocked when Namu Wiki refuses or rate-limits."""
    request = Request(f"https://namu.wiki/raw/{quote(title)}", headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8", "replace")
    except HTTPError as error:
        if error.code == 404:
            return None
        if error.code in (403, 429, 503):
            raise Blocked(f"Namu Wiki answered {error.code}") from error
        raise


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=int, default=150, help="most idols to look up this run (default 150)")
    parser.add_argument("--delay", type=float, default=4.0, help="seconds between requests (default 4)")
    parser.add_argument("--group", action="append", default=[], help="only idols in this group; repeatable")
    parser.add_argument("--refresh", action="store_true", help="also re-check idols that already have positions")
    args = parser.parse_args()

    candidates = namu_parse.idol_candidates()
    groups = json.loads((namu_parse.IDOLS / "groups.json").read_text())["groups"]
    dump = load(DUMP).get("people", {})
    live = load(OUTPUT)
    people = live.get("people", {})
    checked = live.get("checked", {})
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(days=RECHECK_DAYS)).isoformat()

    wanted_groups = {name.lower() for name in args.group}
    def in_wanted(candidate):
        if not wanted_groups:
            return True
        return any(name and name.lower() in wanted_groups for group in candidate["groups"] for name in (groups.get(group, {}).get("name"), groups.get(group, {}).get("ko")))

    def group_debut(candidate):
        return max([groups.get(group, {}).get("debut", "") or "" for group in candidate["groups"]] or [""])

    queue = [qid for qid, candidate in candidates.items()
             if in_wanted(candidate) and candidate["groups"]
             and (args.refresh or not (people.get(qid, {}).get("positions") or dump.get(qid, {}).get("positions")))
             and checked.get(qid, "") < recent]
    # Newest groups first: the 2021 dump can't know them.
    queue.sort(key=lambda qid: group_debut(candidates[qid]), reverse=True)
    queue = queue[:args.limit]
    print(f"Looking up {len(queue)} idols on Namu Wiki, {args.delay:g}s apart (about {len(queue) * args.delay * 1.5 / 60:.0f} min).")

    found = 0
    def save():
        OUTPUT.write_text(json.dumps({
            "source": "Namu Wiki (namu.wiki), fetched by scripts/fetch_namu_live.py", "license": "CC BY-NC-SA 2.0 KR",
            "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/2.0/kr/", "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "people": dict(sorted(people.items())), "checked": dict(sorted(checked.items())),
        }, ensure_ascii=False, indent=1) + "\n")

    try:
        for number, qid in enumerate(queue, 1):
            candidate = candidates[qid]
            result = None
            for title in candidate["titles"]:
                text = fetch_raw(title)
                time.sleep(args.delay)
                target = namu_parse.redirect_target(text) if text else ""
                if target:
                    text = fetch_raw(target)
                    time.sleep(args.delay)
                    title = target
                if text and namu_parse.accept(title, text, candidate):
                    parsed = namu_parse.parse_page(text)
                    result = {**parsed, "title": title, "fetchedAt": now.isoformat(timespec="seconds")} if parsed else None
                    break
            checked[qid] = now.isoformat(timespec="seconds")
            if result:
                people[qid] = result
                found += 1
            summary = f"{', '.join(result.get('positions', [])) or '-'} {result.get('mbti', '')}".strip() if result else "not found"
            print(f"[{number}/{len(queue)}] {candidate['name']}: {summary}")
            if number % 10 == 0:
                save()
    except Blocked as error:
        print(f"\nStopped: {error}. Namu Wiki is limiting requests; try again later with a longer --delay.")
    except KeyboardInterrupt:
        print("\nStopped.")
    save()
    print(f"\nFound positions or MBTI for {found} idols. Saved to {OUTPUT.relative_to(namu_parse.ROOT)}.")
    print("Commit and push that file; the next site build adds it to the profiles.")


if __name__ == "__main__":
    main()
