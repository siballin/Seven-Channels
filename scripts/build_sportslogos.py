#!/usr/bin/env python3
"""Build data/sportslogos.json and data/sportslogos/img/: each NBA team's logo and uniform history from
Chris Creamer's SportsLogos.Net (https://www.sportslogos.net), for the team page's Logos & Uniforms tab.

SportsLogos.Net makes its images available for fair use and personal, non-commercial reference, grants no commercial
rights (the logos belong to the teams and the NBA), and requires a visible credit with a link back:
"Credit: Chris Creamer's SportsLogos.Net — https://www.sportslogos.net". The page shows that credit and links every
image to its SportsLogos.Net page. Seven Channels is a personal, non-commercial site; if that changes, these images
must come off.

Being a good guest: it follows robots.txt (team pages are allowed), identifies itself, waits between requests,
downloads each thumbnail once and serves it from this site (no hotlinking), and refreshes at most every 30 days.
Images live in the Pages workflow's cache, not in git.
"""

from datetime import datetime, timedelta, timezone
import html
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "sportslogos.json"
IMAGES = ROOT / "data" / "sportslogos" / "img"
SITE = "https://www.sportslogos.net"
LEAGUE = f"{SITE}/teams/list_by_league/6/National_Basketball_Association/NBA/logos/"
USER_AGENT = "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/; personal non-commercial fan site)"
CREDIT = "Chris Creamer's SportsLogos.Net"
PAGE_GAP = 3.0  # seconds between page requests
IMAGE_GAP = 0.4  # seconds between image downloads
REFRESH_DAYS = 30
TEAMS = {
    "atlanta-hawks": "Atlanta Hawks", "boston-celtics": "Boston Celtics", "brooklyn-nets": "Brooklyn Nets",
    "charlotte-hornets": "Charlotte Hornets", "chicago-bulls": "Chicago Bulls", "cleveland-cavaliers": "Cleveland Cavaliers",
    "dallas-mavericks": "Dallas Mavericks", "denver-nuggets": "Denver Nuggets", "detroit-pistons": "Detroit Pistons",
    "golden-state-warriors": "Golden State Warriors", "houston-rockets": "Houston Rockets", "indiana-pacers": "Indiana Pacers",
    "la-clippers": "Los Angeles Clippers", "los-angeles-lakers": "Los Angeles Lakers", "memphis-grizzlies": "Memphis Grizzlies",
    "miami-heat": "Miami Heat", "milwaukee-bucks": "Milwaukee Bucks", "minnesota-timberwolves": "Minnesota Timberwolves",
    "new-orleans-pelicans": "New Orleans Pelicans", "new-york-knicks": "New York Knicks", "oklahoma-city-thunder": "Oklahoma City Thunder",
    "orlando-magic": "Orlando Magic", "philadelphia-76ers": "Philadelphia 76ers", "phoenix-suns": "Phoenix Suns",
    "portland-trail-blazers": "Portland Trail Blazers", "sacramento-kings": "Sacramento Kings", "san-antonio-spurs": "San Antonio Spurs",
    "toronto-raptors": "Toronto Raptors", "utah-jazz": "Utah Jazz", "washington-wizards": "Washington Wizards",
}
# Sections worth showing (SportsLogos.Net also has pennants, pocket schedules, media guides, stadiums…).
KEEP = re.compile(r"(logos?|uniforms?)$", re.I)
SKIP = re.compile(r"player|gear|stadium|court|surface|schedule|pennant|media guide|ticket|on dark|primary dark|special event", re.I)
_last_request = 0.0


def fetch(url, gap=PAGE_GAP, binary=False):
    global _last_request
    wait = _last_request + gap - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                data = response.read()
                return data if binary else data.decode("utf-8", "replace")
        except HTTPError as error:
            if error.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(20 * (attempt + 1))
                continue
            raise


def key(text):
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def team_links(league_html):
    """Team name → absolute logo-history URL, from the NBA listing."""
    links = {}
    for href, label in re.findall(r'<a[^>]+href="(/logos/list_by_team/\d+/[^"]+)"[^>]*>(.*?)</a>', league_html, re.S):
        name = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(label))).strip()
        slug_name = re.sub(r"-Logos/?$|/$", "", href.split("/", 4)[-1]).replace("-", " ").replace("_", " ")
        for candidate in (name, slug_name):
            if candidate and key(candidate) not in links:
                links[key(candidate)] = urljoin(SITE, href)
    return links


def seasons(text):
    """ "1979/80 - 1983/84" → ("1979/80", "1983/84"); "2017/18 - Pres" → ("2017/18", "present")."""
    parts = [part.strip() for part in re.split(r"\s+-\s+", html.unescape(text).strip()) if part.strip()]
    if not parts:
        return "", ""
    end = parts[-1] if len(parts) > 1 else parts[0]
    return parts[0], "present" if re.fullmatch(r"pres(ent)?", end, re.I) else end


def parse_team_page(page):
    """→ {"franchises": [{"name", "years", "url"}], "sections": [{"name", "items": [{"title", "from", "to", "thumb", "view"}]}]}"""
    # Franchise line (former names), before the two-column body.
    top = page.split('class="sln-two-col"', 1)[0]
    franchises = []
    for href, label, years in re.findall(r'<a[^>]+href="(/logos/list_by_team/\d+/[^"]+)"[^>]*>\s*([^<]+?)\s*</a>\s*\(([^)]+)\)', top):
        franchises.append({"name": html.unescape(label).strip(), "years": years.strip(), "url": urljoin(SITE, href)})
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    page_name = re.sub(r"\s+Logos$", "", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(h1.group(1)))).strip()) if h1 else ""
    sections = []
    pieces = re.split(r"<h3[^>]*>", page)[1:]
    for piece in pieces:
        heading = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(piece.split("</h3>", 1)[0]))).strip()
        name = re.sub(r"\s+History$", "", heading)
        kind = name[len(page_name):].strip() if page_name and name.lower().startswith(page_name.lower()) else name
        if not KEEP.search(kind) or SKIP.search(name):
            continue
        body = piece.split("</h3>", 1)[1] if "</h3>" in piece else piece
        items = []
        for card in re.findall(r'<div class="team-card".*?</a>\s*</div>', body, re.S):
            view = re.search(r'href="(/logos/view/[^"]+)"', card)
            thumb = re.search(r'<img[^>]+src="(https://content\.sportslogos\.net/logos/[^"]+)"', card)
            title = re.search(r'<a[^>]+title="([^"]+)"', card)
            years = re.search(r'card-text.*?<span[^>]*>([^<]+)</span>', card, re.S)
            if not (view and thumb):
                continue
            start, end = seasons(years.group(1)) if years else ("", "")
            items.append({"title": html.unescape(title.group(1)) if title else name, "from": start, "to": end,
                          "thumb": thumb.group(1), "view": urljoin(SITE, view.group(1))})
        if items:
            sections.append({"name": kind, "items": items})
    return {"franchises": franchises, "sections": sections}


def local_name(url):
    """https://content.sportslogos.net/logos/6/234/thumbs/abc.gif → 6-234-abc.gif"""
    match = re.search(r"/logos/(\d+)/(\d+)/thumbs/([^/?#]+)$", url)
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else re.sub(r"[^A-Za-z0-9._-]+", "-", url.rsplit("/", 1)[-1])


def download_images(teams):
    """Downloads thumbnails not already saved; returns how many were fetched."""
    IMAGES.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for team in teams.values():
        for page in [team, *team.get("former", [])]:
            for section in page["sections"]:
                for item in section["items"]:
                    name = local_name(item["thumb"])
                    item["img"] = f"data/sportslogos/img/{name}"
                    path = IMAGES / name
                    if path.exists() and path.stat().st_size > 0:
                        continue
                    try:
                        path.write_bytes(fetch(item["thumb"], gap=IMAGE_GAP, binary=True))
                        fetched += 1
                    except Exception as error:
                        print(f"  image {item['thumb']}: {error}", file=sys.stderr)
    return fetched


def main():
    now = datetime.now(timezone.utc)
    previous = {}
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    built = previous.get("generatedAt", "")
    fresh = built and now - datetime.fromisoformat(built) < timedelta(days=REFRESH_DAYS) and len(previous.get("teams", {})) >= 25
    if fresh and "--force" not in sys.argv:
        # Still make sure every image is on disk (the workflow cache can be evicted).
        missing = download_images(previous["teams"])
        print(f"SportsLogos.Net data is from {built[:10]}; refreshing every {REFRESH_DAYS} days ({missing} missing images fetched).")
        return
    try:
        links = team_links(fetch(LEAGUE))
    except Exception as error:
        print(f"SportsLogos.Net listing failed; keeping the previous data: {error}", file=sys.stderr)
        if previous.get("teams"):
            download_images(previous["teams"])
        return
    teams = {}
    for slug, name in TEAMS.items():
        url = links.get(key(name))
        if not url:
            print(f"  {name}: not found in the NBA listing", file=sys.stderr)
            if slug in previous.get("teams", {}):
                teams[slug] = previous["teams"][slug]
            continue
        try:
            team = {"name": name, "url": url, **parse_team_page(fetch(url))}
            # Former names have their own pages (New Orleans Jazz, Seattle SuperSonics…).
            team["former"] = []
            for franchise in team["franchises"]:
                if franchise["url"].rstrip("/") == url.rstrip("/") or key(franchise["name"]) == key(name):
                    continue
                parsed = parse_team_page(fetch(franchise["url"]))
                if parsed["sections"]:
                    team["former"].append({"name": franchise["name"], "years": franchise["years"], "url": franchise["url"], "sections": parsed["sections"]})
            teams[slug] = team
        except Exception as error:
            print(f"  {name}: {error}", file=sys.stderr)
            if slug in previous.get("teams", {}):
                teams[slug] = previous["teams"][slug]
    if len(teams) < 20:
        print(f"SportsLogos.Net: only {len(teams)} teams parsed; keeping the previous data.", file=sys.stderr)
        return
    fetched = download_images(teams)
    OUTPUT.write_text(json.dumps({"generatedAt": now.replace(microsecond=0).isoformat(), "source": CREDIT, "sourceUrl": SITE,
                                  "credit": f"Credit: {CREDIT} — {SITE}", "teams": teams}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    items = sum(len(section["items"]) for team in teams.values() for page in [team, *team["former"]] for section in page["sections"])
    print(f"SportsLogos.Net: {len(teams)} teams, {items} logos and uniforms ({fetched} images downloaded)")


if __name__ == "__main__":
    main()
