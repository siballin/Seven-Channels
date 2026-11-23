#!/usr/bin/env python3
"""Build data/esports.json: League of Legends and Counter-Strike 2 matches (live, upcoming, recent results).

Source: PandaScore (https://pandascore.co), with the free plan's key in the PANDASCORE_KEY repository secret.
Runs in the Pages workflow; without the key it does nothing and the Esports tab says it isn't set up.

Each match: id, game, league (name, logo), event (series and tournament), status, start time, best-of,
both teams (name, short name, logo), score, winner and the official stream link.
"""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "esports.json"
API = "https://api.pandascore.co"
USER_AGENT = "SevenChannelsEsports/1.0 (+https://siballin.github.io/Seven-Channels/)"
GAMES = [("lol", "League of Legends", "lol"), ("cs2", "Counter-Strike 2", "csgo")]  # (our id, label, PandaScore path)


def fetch_json(path, params, key):
    request = Request(f"{API}/{path}?{urlencode(params)}", headers={"User-Agent": USER_AGENT, "Authorization": f"Bearer {key}", "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def https(url):
    return url if isinstance(url, str) and url.startswith("https://") else ""


def stream_of(match):
    streams = match.get("streams_list") or []
    pick = (next((s for s in streams if s.get("official") and s.get("main")), None) or next((s for s in streams if s.get("official") and s.get("language") == "en"), None)
            or next((s for s in streams if s.get("main")), None) or (streams[0] if streams else None))
    return https((pick or {}).get("raw_url"))


def match_row(match, game):
    teams = []
    scores = {result.get("team_id"): result.get("score") for result in match.get("results") or []}
    for slot in match.get("opponents") or []:
        team = slot.get("opponent") or {}
        if not team.get("id"):
            continue
        teams.append({"id": team["id"], "name": (team.get("name") or "")[:60], "short": (team.get("acronym") or "")[:12],
                      **({"logo": https(team.get("image_url"))} if https(team.get("image_url")) else {}),
                      **({"score": scores[team["id"]]} if isinstance(scores.get(team["id"]), int) else {})})
    league = match.get("league") or {}
    serie = match.get("serie") or {}
    tournament = match.get("tournament") or {}
    event = " · ".join(part for part in [(serie.get("full_name") or serie.get("name") or "").strip(), (tournament.get("name") or "").strip()] if part)
    return {
        "id": match.get("id"), "game": game, "status": match.get("status") or "", "start": match.get("begin_at") or match.get("scheduled_at") or "",
        "end": match.get("end_at") or "", "bestOf": match.get("number_of_games") if match.get("match_type") in ("best_of", None) else None,
        "league": (league.get("name") or "")[:60], **({"leagueLogo": https(league.get("image_url"))} if https(league.get("image_url")) else {}),
        "event": event[:120], **({"tier": str(tournament["tier"]).lower()} if tournament.get("tier") else {}), "teams": teams, **({"winner": match["winner_id"]} if match.get("winner_id") else {}),
        **({"stream": stream_of(match)} if stream_of(match) else {}),
    }


def build(key, fetch=fetch_json, now=None):
    now = now or datetime.now(timezone.utc).replace(microsecond=0)
    out = {"generatedAt": now.isoformat(), "source": "PandaScore", "games": [], "matches": []}
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    two_weeks = (now + timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
    now_text = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    failures = []
    for game, label, path in GAMES:
        try:
            running = fetch(f"{path}/matches/running", {"per_page": 50}, key)
            upcoming = fetch(f"{path}/matches/upcoming", {"per_page": 100, "sort": "begin_at", "range[begin_at]": f"{now_text},{two_weeks}"}, key)
            past = fetch(f"{path}/matches/past", {"per_page": 100, "sort": "-end_at", "range[end_at]": f"{week_ago},{now_text}"}, key)
        except Exception as error:
            failures.append(label)
            print(f"Esports {label} failed: {error}", file=sys.stderr)
            continue
        rows = [match_row(match, game) for match in [*running, *upcoming, *past] if match.get("status") != "canceled"]
        rows = [row for row in rows if len(row["teams"]) == 2 or row["status"] == "not_started"]
        out["games"].append({"id": game, "label": label})
        out["matches"] += rows
    if failures:
        out["unavailable"] = failures
    seen = set()
    out["matches"] = [row for row in sorted(out["matches"], key=lambda row: row["start"]) if not (row["id"] in seen or seen.add(row["id"]))]
    return out


def main():
    key = os.environ.get("PANDASCORE_KEY", "").strip()
    if not key:
        print("Esports skipped: set PANDASCORE_KEY to build it.")
        return
    try:
        data = build(key)
        if not data["matches"]:
            raise ValueError("no matches returned")
    except Exception as error:
        print(f"Esports refresh failed; keeping the previous file: {error}", file=sys.stderr)
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    counts = {game["id"]: sum(1 for row in data["matches"] if row["game"] == game["id"]) for game in data["games"]}
    print(f"Esports: {counts}" + (f" ({', '.join(data['unavailable'])} unavailable)" if data.get("unavailable") else ""))


if __name__ == "__main__":
    main()
