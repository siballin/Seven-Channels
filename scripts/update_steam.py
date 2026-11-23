#!/usr/bin/env python3
"""Build data/steam.json: your Steam library, play time and achievements, for the Video Games channel.

Needs repository secrets STEAM_API_KEY (https://steamcommunity.com/dev/apikey) and STEAM_ID (your 64-bit SteamID,
17 digits), and a Steam profile whose game details are public. Steam's Web API can't be called from a browser, so
this runs in the Pages workflow. Without the secrets it does nothing and the page hides the Steam section.

The file is published with the site (it isn't committed): your profile name, games, hours and achievements are
visible to anyone who opens data/steam.json, just as they are on a public Steam profile.

Output:
- profile: name, avatar, profile URL
- games: every owned game [appid, name, minutes played, minutes in the last two weeks, last played (unix time)]
- achievements: for the most-played and recently played games: unlocked / total, and the rarest unlocked ones
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "steam.json"
API = "https://api.steampowered.com"
USER_AGENT = "SevenChannelsSteam/1.0 (+https://siballin.github.io/Seven-Channels/)"
ACHIEVEMENT_GAMES = 40  # most-played and recently played games to fetch achievements for


def fetch_json(path, params):
    request = Request(f"{API}/{path}?{urlencode(params)}", headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def owned_games(key, steam_id, fetch=fetch_json):
    data = fetch("IPlayerService/GetOwnedGames/v1/", {"key": key, "steamid": steam_id, "include_appinfo": 1, "include_played_free_games": 1, "format": "json"})
    games = (data.get("response") or {}).get("games") or []
    rows = []
    for game in games:
        name = (game.get("name") or "").strip()
        if not name or not isinstance(game.get("appid"), int):
            continue
        rows.append([game["appid"], name[:120], int(game.get("playtime_forever") or 0), int(game.get("playtime_2weeks") or 0), int(game.get("rtime_last_played") or 0)])
    return sorted(rows, key=lambda row: (-row[2], row[1].casefold()))


def profile(key, steam_id, fetch=fetch_json):
    data = fetch("ISteamUser/GetPlayerSummaries/v2/", {"key": key, "steamids": steam_id, "format": "json"})
    player = ((data.get("response") or {}).get("players") or [{}])[0]
    avatar = player.get("avatarfull") or ""
    url = player.get("profileurl") or ""
    return {"name": (player.get("personaname") or "")[:60], **({"avatar": avatar} if avatar.startswith("https://") else {}),
            **({"url": url} if url.startswith("https://steamcommunity.com/") else {})}


def achievements_for(key, steam_id, appid, fetch=fetch_json):
    """Unlocked/total and the rarest unlocked achievements (with global unlock rates) for one game, or None."""
    try:
        data = fetch("ISteamUserStats/GetPlayerAchievements/v1/", {"key": key, "steamid": steam_id, "appid": appid, "l": "english", "format": "json"})
    except HTTPError as error:
        if error.code in (400, 403):  # no achievements, or the game's stats are private
            return None
        raise
    stats = data.get("playerstats") or {}
    items = stats.get("achievements") or []
    if not stats.get("success", True) or not items:
        return None
    unlocked = [item for item in items if item.get("achieved")]
    rates = {}
    try:
        global_data = fetch("ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", {"gameid": appid, "format": "json"})
        rates = {item.get("name"): float(item.get("percent") or 0) for item in (global_data.get("achievementpercentages") or {}).get("achievements") or []}
    except Exception as error:  # rarity is optional
        print(f"  global rates for {appid}: {error}", file=sys.stderr)
    icons = {}
    try:
        schema = fetch("ISteamUserStats/GetSchemaForGame/v2/", {"key": key, "appid": appid, "l": "english", "format": "json"})
        icons = {item.get("name"): item.get("icon") for item in ((schema.get("game") or {}).get("availableGameStats") or {}).get("achievements") or []}
    except Exception as error:
        print(f"  schema for {appid}: {error}", file=sys.stderr)
    rare = sorted(unlocked, key=lambda item: rates.get(item.get("apiname"), 100))[:5]
    latest = max((int(item.get("unlocktime") or 0) for item in unlocked), default=0)
    return {
        "unlocked": len(unlocked), "total": len(items), **({"lastUnlock": latest} if latest else {}),
        "rare": [{"name": (item.get("name") or item.get("apiname") or "")[:80], "description": (item.get("description") or "")[:160],
                  **({"percent": round(rates[item["apiname"]], 1)} if item.get("apiname") in rates else {}),
                  **({"icon": icons[item["apiname"]]} if str(icons.get(item.get("apiname")) or "").startswith("https://") else {}),
                  "unlocked": int(item.get("unlocktime") or 0)} for item in rare],
    }


def resolve_id(key, value, fetch=fetch_json):
    """STEAM_ID may be the 17-digit SteamID64, a profile URL, or a custom profile name; return the SteamID64."""
    value = value.strip().rstrip("/")
    match = re.search(r"(7656\d{13})", value)
    if match:
        return match.group(1)
    name = re.sub(r"^https?://steamcommunity\.com/id/", "", value)
    data = fetch("ISteamUser/ResolveVanityURL/v1/", {"key": key, "vanityurl": name, "format": "json"})
    result = data.get("response") or {}
    if result.get("success") != 1 or not re.fullmatch(r"7656\d{13}", str(result.get("steamid", ""))):
        raise ValueError("STEAM_ID isn't a SteamID64 and couldn't be looked up as a profile name")
    return result["steamid"]


def build(key, steam_id, fetch=fetch_json, now=None):
    now = now or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    games = owned_games(key, steam_id, fetch)
    if not games:
        raise ValueError("no games returned (is the profile's Game details setting public?)")
    picks = [row for row in games if row[3]] + [row for row in games if row[2] >= 60]
    seen, chosen = set(), []
    for row in picks:
        if row[0] not in seen:
            seen.add(row[0])
            chosen.append(row)
        if len(chosen) >= ACHIEVEMENT_GAMES:
            break
    achievements = {}
    for appid, name, *_ in chosen:
        try:
            result = achievements_for(key, steam_id, appid, fetch)
        except Exception as error:
            print(f"  achievements for {name}: {error}", file=sys.stderr)
            continue
        if result:
            achievements[str(appid)] = result
    return {"generatedAt": now, "source": "Steam Web API", "profile": profile(key, steam_id, fetch), "games": games, "achievements": achievements}


def main():
    key = os.environ.get("STEAM_API_KEY", "").strip()
    steam_id = os.environ.get("STEAM_ID", "").strip()
    if not key or not steam_id:
        print("Steam skipped: set STEAM_API_KEY and STEAM_ID to build it.")
        return
    try:
        steam_id = resolve_id(key, steam_id)
        data = build(key, steam_id)
    except Exception as error:
        print(f"Steam refresh failed; keeping the previous file: {error}", file=sys.stderr)
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    played = sum(1 for row in data["games"] if row[2])
    print(f"Steam: {len(data['games'])} games ({played} played, {sum(row[2] for row in data['games']) // 60} hours), achievements for {len(data['achievements'])}")


if __name__ == "__main__":
    main()
