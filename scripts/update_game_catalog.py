#!/usr/bin/env python3
"""Build the game catalog used by Video Games lookup, time to beat and critic scores.

Source: IGDB (owned by Twitch). Requires a Twitch application's credentials in TWITCH_CLIENT_ID and
TWITCH_CLIENT_SECRET (repository secrets in GitHub Actions). Without them the script exits without
changing anything, and the page offers manual entry only.

Output (data/games-catalog/):
- index.json: compact rows [id, name, release year, cover image id] for search-as-you-type.
- details-NN.json: per-game details (platforms, genres, release date, critic score, time to beat),
  split into shards by id so the page only downloads what it needs.

Games are included when people have rated or anticipated them (enough ratings, critic reviews or
pre-release hype), which keeps the catalog to games people are likely to look up.
"""

from collections import defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "games-catalog"
API = "https://api.igdb.com/v4"
USER_AGENT = "SevenChannelsGames/1.0 (+https://siballin.github.io/Seven-Channels/)"
SHARDS = 64
PAGE = 500
# IGDB allows 4 requests per second.
REQUEST_GAP = 0.3
# Main games, remakes, remasters, expanded games and ports; skips DLC, bundles, mods and episodes.
GAME_TYPES = "(0,8,9,10,11)"


def token(client_id, secret):
    query = urlencode({"client_id": client_id, "client_secret": secret, "grant_type": "client_credentials"})
    request = Request(f"https://id.twitch.tv/oauth2/token?{query}", data=b"", headers={"User-Agent": USER_AGENT}, method="POST")
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read())["access_token"]


class Igdb:
    def __init__(self, client_id, access_token):
        self.headers = {"Client-ID": client_id, "Authorization": f"Bearer {access_token}", "User-Agent": USER_AGENT,
                        "Accept": "application/json"}
        self.last = 0.0

    def query(self, endpoint, body):
        wait = self.last + REQUEST_GAP - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        request = Request(f"{API}/{endpoint}", data=body.encode("utf-8"), headers=self.headers, method="POST")
        with urlopen(request, timeout=90) as response:
            return json.loads(response.read())


def fetch_games(igdb):
    fields = ("id,name,first_release_date,cover.image_id,platforms.abbreviation,platforms.name,genres.name,"
              "aggregated_rating,aggregated_rating_count,total_rating,total_rating_count,hypes,url")
    where = f"(total_rating_count >= 5 | aggregated_rating_count >= 2 | hypes >= 5) & game_type = {GAME_TYPES}"
    games, offset = [], 0
    while True:
        batch = igdb.query("games", f"fields {fields}; where {where}; sort id asc; limit {PAGE}; offset {offset};")
        games += batch
        if len(batch) < PAGE:
            return games
        offset += PAGE


def fetch_time_to_beat(igdb, ids):
    """Seconds to finish: hastily (main story), normally (main plus extras), completely (completionist)."""
    times = {}
    ids = sorted(ids)
    for start in range(0, len(ids), PAGE):
        chunk = ",".join(str(game_id) for game_id in ids[start:start + PAGE])
        for row in igdb.query("game_time_to_beats", f"fields game_id,hastily,normally,completely,count; where game_id = ({chunk}); limit {PAGE};"):
            times[row["game_id"]] = row
    return times


def hours(seconds):
    return round(seconds / 3600, 1) if isinstance(seconds, (int, float)) and seconds > 0 else None


def build(games, times):
    index, shards = [], defaultdict(dict)
    for game in games:
        name = (game.get("name") or "").strip()
        if not name:
            continue
        released = game.get("first_release_date")
        date = datetime.fromtimestamp(released, timezone.utc).strftime("%Y-%m-%d") if isinstance(released, int) else ""
        cover = (game.get("cover") or {}).get("image_id", "")
        index.append([game["id"], name, int(date[:4]) if date else None, cover])
        ttb = times.get(game["id"]) or {}
        detail = {
            "name": name, "released": date, "cover": cover,
            "platforms": sorted({p.get("abbreviation") or p.get("name") for p in game.get("platforms") or [] if p.get("abbreviation") or p.get("name")}),
            "genres": sorted({g["name"] for g in game.get("genres") or [] if g.get("name")}),
            "url": game.get("url", ""),
        }
        if isinstance(game.get("aggregated_rating"), (int, float)) and game.get("aggregated_rating_count"):
            detail["criticScore"] = round(game["aggregated_rating"])
            detail["criticCount"] = game["aggregated_rating_count"]
        if isinstance(game.get("total_rating"), (int, float)) and game.get("total_rating_count"):
            detail["rating"] = round(game["total_rating"])
            detail["ratingCount"] = game["total_rating_count"]
        beat = {key: hours(ttb.get(field)) for key, field in (("main", "hastily"), ("extra", "normally"), ("complete", "completely"))}
        if any(beat.values()):
            detail["timeToBeat"] = {key: value for key, value in beat.items() if value} | {"submissions": ttb.get("count", 0)}
        shards[game["id"] % SHARDS][str(game["id"])] = detail
    index.sort(key=lambda row: row[1].casefold())
    return index, shards


def write(index, shards, now):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    meta = {"generatedAt": now, "count": len(index), "shards": SHARDS, "source": "IGDB", "sourceUrl": "https://www.igdb.com/"}
    (OUTPUT / "index.json").write_text(json.dumps({**meta, "games": index}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for shard in range(SHARDS):
        (OUTPUT / f"details-{shard:02d}.json").write_text(json.dumps(shards.get(shard, {}), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    client_id = os.environ.get("TWITCH_CLIENT_ID", "").strip()
    secret = os.environ.get("TWITCH_CLIENT_SECRET", "").strip()
    access_token = os.environ.get("IGDB_ACCESS_TOKEN", "").strip()  # optional: a ready-made app token instead of the secret
    if not client_id or not (secret or access_token):
        print("Game catalog skipped: set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to build it.")
        return
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    try:
        igdb = Igdb(client_id, access_token or token(client_id, secret))
        games = fetch_games(igdb)
        if len(games) < 1000:
            raise ValueError(f"only {len(games)} games returned")
        times = fetch_time_to_beat(igdb, [game["id"] for game in games])
        index, shards = build(games, times)
    except Exception as error:
        print(f"Game catalog refresh failed; keeping the previous catalog: {error}", file=sys.stderr)
        return
    write(index, shards, now)
    print(f"Game catalog: {len(index)} games, {sum(1 for shard in shards.values() for game in shard.values() if 'timeToBeat' in game)} with time to beat")


if __name__ == "__main__":
    main()
