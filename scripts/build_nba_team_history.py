#!/usr/bin/env python3
"""Build data/nba-team-history.json: each NBA team's logo and uniform history, for the team page's
"Logos & Uniforms" tab.

Source: English Wikipedia. For each team it uses the article "Logos and uniforms of the <team>" when one exists,
otherwise the "Logos and uniforms" (or "Uniforms", "Logos", "Colors") section of the team's article. It keeps the
section's text, sub-headings and images (logos and uniform pictures) with their captions, in order, and links every
image to its Wikipedia file page, which has the image's license (many team logos are non-free and used on Wikipedia
under fair use).

Runs in the Pages workflow at most every 30 days (logo history rarely changes) and keeps the previous file on errors.
"""

from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "nba-team-history.json"
API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/)"
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
# Tried in order: exact names first, then any section mentioning logos or uniforms, then branding/identity.
SECTION_NAMES = [r"logos? and uniforms?", r"uniforms? and logos?", r"logos?,? (?:colou?rs )?and uniforms?", r"uniforms?", r"uniform history",
                 r".*\b(?:logos?|uniforms?)\b.*", r"team (?:branding|identity)", r"colou?rs"]
REFRESH_DAYS = 30


def fetch_json(params):
    url = f"{API}?{urlencode({**params, 'format': 'json', 'formatversion': '2'})}"
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code == 429 and attempt < 3:
                time.sleep(15 * (attempt + 1))
                continue
            raise


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


class SectionParser(HTMLParser):
    """Wikipedia section HTML → ordered blocks: {"h": text, "level"}, {"p": text}, {"img": src, "caption", "file", "w", "h"}."""

    VOID = {"img", "br", "hr", "meta", "link", "input", "wbr", "source", "col", "area", "base", "track"}
    SKIP_TAGS = {"style", "script", "sup", "table"}  # footnote markers, navboxes and infobox-style tables
    SKIP_CLASSES = ("reference", "mw-editsection", "hatnote", "navbox", "noprint", "mw-empty-elt", "shortdescription")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.depth = 0
        self.skip_from = None  # depth where a skipped element started
        self.text = None
        self.kind = None
        self.level = 2
        self.text_from = None
        self.caption = None
        self.caption_from = None
        self.file_link = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in self.VOID:
            self.depth += 1
        if self.skip_from is not None:
            return
        classes = attrs.get("class") or ""
        if tag in self.SKIP_TAGS or any(name in classes.split() for name in self.SKIP_CLASSES):
            if tag not in self.VOID:
                self.skip_from = self.depth
            return
        if tag == "a" and str(attrs.get("href", "")).startswith("/wiki/File:"):
            self.file_link = "https://en.wikipedia.org" + attrs["href"]
        if tag == "img":
            src = attrs.get("src", "")
            width = int(attrs.get("width") or 0)
            if src.startswith("//"):
                src = "https:" + src
            src = src.split("?")[0]
            if re.match(r"https://(upload|thumb)\.wikimedia\.org/", src) and width >= 40:
                big = re.sub(r"/(\d+)px-", lambda m: f"/{max(int(m.group(1)), 300)}px-", src) if "/thumb/" in src else src
                self.blocks.append({"img": big, "file": self.file_link, "caption": "", "w": width, "h": int(attrs.get("height") or 0)})
            self.file_link = ""
            return
        if self.caption is None and (tag == "figcaption" or "thumbcaption" in classes.split() or "gallerytext" in classes.split()):
            self.caption, self.caption_from = [], self.depth
            return
        if self.caption is not None or self.text is not None:
            return
        if tag in ("h2", "h3", "h4", "h5"):
            self.kind, self.text, self.level, self.text_from = "h", [], int(tag[1]), self.depth
        elif tag == "p" or (tag == "li" and "gallerybox" not in classes.split()):
            self.kind, self.text, self.text_from = "p", [], self.depth

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        depth = self.depth
        self.depth -= 1
        if self.skip_from is not None:
            if depth <= self.skip_from:
                self.skip_from = None
            return
        if self.caption is not None and depth <= self.caption_from:
            text = clean("".join(self.caption))
            for block in reversed(self.blocks):
                if "img" in block:
                    block["caption"] = block["caption"] or text[:300]
                    break
            self.caption = self.caption_from = None
            return
        if self.text is not None and depth <= self.text_from:
            text = clean("".join(self.text))
            if self.kind == "h" and text:
                self.blocks.append({"h": text[:120], "level": self.level})
            elif self.kind == "p" and len(text) > 30:
                self.blocks.append({"p": text[:1500]})
            self.kind = self.text = self.text_from = None

    def handle_data(self, data):
        if self.skip_from is not None:
            return
        if self.caption is not None:
            self.caption.append(data)
        elif self.text is not None:
            self.text.append(data)


def section_html(title, index=None):
    params = {"action": "parse", "page": title, "prop": "text", "redirects": 1, "disableeditsection": 1, "disablelimitreport": 1}
    if index is not None:
        params["section"] = index
    data = fetch_json(params)
    if "error" in data:
        raise LookupError(data["error"].get("info", "parse error"))
    return data["parse"]["text"], data["parse"]["title"]


def find_section(title):
    """The index of the team article's logo/uniform section (top-level preferred)."""
    data = fetch_json({"action": "parse", "page": title, "prop": "sections", "redirects": 1})
    sections = (data.get("parse") or {}).get("sections") or []
    for pattern in SECTION_NAMES:
        for section in sorted(sections, key=lambda item: int(item.get("toclevel", 9))):
            if re.fullmatch(pattern, clean(re.sub(r"<[^>]+>", "", section.get("line", ""))).lower()):
                return section["index"], clean(re.sub(r"<[^>]+>", "", section["line"]))
    return None, None


def team_history(name):
    """{"article", "url", "section", "blocks"} for one team, or None."""
    try:
        html, article = section_html(f"Logos and uniforms of the {name}")
        section = ""
    except LookupError:
        index, section = find_section(name)
        if index is None:
            return None
        html, article = section_html(name, index)
    parser = SectionParser()
    parser.feed(html)
    blocks = [block for block in parser.blocks if not ("h" in block and re.fullmatch(r"(see also|references|notes|external links|further reading)", block["h"].lower()))]
    # Drop a repeat of the section's own heading at the top.
    if blocks and "h" in blocks[0] and section and blocks[0]["h"].lower() == section.lower():
        blocks = blocks[1:]
    if not any("img" in block for block in blocks) and not any("p" in block for block in blocks):
        return None
    url = f"https://en.wikipedia.org/wiki/{quote(article.replace(' ', '_'))}" + (f"#{quote(section.replace(' ', '_'))}" if section else "")
    return {"article": article, "url": url, "section": section, "blocks": blocks[:80]}


def main():
    now = datetime.now(timezone.utc)
    previous = {}
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    built = previous.get("generatedAt", "")
    if built and "--force" not in sys.argv and now - datetime.fromisoformat(built) < timedelta(days=REFRESH_DAYS) and len(previous.get("teams", {})) >= 25:
        print(f"NBA team history is from {built[:10]}; refreshing every {REFRESH_DAYS} days.")
        return
    teams = {}
    for slug, name in TEAMS.items():
        try:
            history = team_history(name)
        except Exception as error:
            print(f"  {name}: {error}", file=sys.stderr)
            history = (previous.get("teams") or {}).get(slug)
        if history:
            teams[slug] = history
        time.sleep(1)
    if len(teams) < 20:
        print(f"NBA team history: only {len(teams)} teams found; keeping the previous file.", file=sys.stderr)
        return
    OUTPUT.write_text(json.dumps({"generatedAt": now.replace(microsecond=0).isoformat(), "source": "Wikipedia", "teams": teams},
                                 ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    images = sum(1 for team in teams.values() for block in team["blocks"] if "img" in block)
    print(f"NBA team history: {len(teams)} teams, {images} images")


if __name__ == "__main__":
    main()
