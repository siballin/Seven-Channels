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
# Tried in order: exact names, then branding/identity, then any section mentioning logos or uniforms, then colors.
SECTION_NAMES = [r"logos? and uniforms?", r"uniforms? and logos?", r"logos?,? (?:colou?rs )?and uniforms?", r"uniforms?", r"uniform history",
                 r"team (?:branding|identity)", r".*\b(?:logos?|uniforms?)\b.*", r"colou?rs"]
REFRESH_DAYS = 30
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Former names, so older logos on Wikimedia Commons are found too.
FORMER_NAMES = {
    "atlanta-hawks": ["St. Louis Hawks", "Milwaukee Hawks", "Tri-Cities Blackhawks"], "brooklyn-nets": ["New Jersey Nets", "New York Nets"],
    "charlotte-hornets": ["Charlotte Bobcats"], "detroit-pistons": ["Fort Wayne Pistons"], "golden-state-warriors": ["San Francisco Warriors", "Philadelphia Warriors"],
    "houston-rockets": ["San Diego Rockets"], "la-clippers": ["San Diego Clippers", "Buffalo Braves"], "los-angeles-lakers": ["Minneapolis Lakers"],
    "memphis-grizzlies": ["Vancouver Grizzlies"], "new-orleans-pelicans": ["New Orleans Hornets"], "oklahoma-city-thunder": ["Seattle SuperSonics"],
    "philadelphia-76ers": ["Syracuse Nationals"], "sacramento-kings": ["Kansas City Kings", "Cincinnati Royals", "Rochester Royals"],
    "utah-jazz": ["New Orleans Jazz"], "washington-wizards": ["Washington Bullets", "Capital Bullets", "Baltimore Bullets", "Chicago Zephyrs"],
}
LOGO_WORDS = re.compile(r"\b(logo|logos|wordmark|emblem|crest|monogram)\b", re.I)
# Other things that share a team's name (a jazz museum, a college team…).
NOT_THE_TEAM = re.compile(r"\b(museum|band|festival|orchestra|club|records?|radio|fm|tv|university|college|school|academy|hockey|football|baseball|"
                          r"soccer|rugby|cricket|volleyball|wnba|g league|summer league|esports|gaming|foundation|arena|stadium)\b", re.I)


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
    """Wikipedia section HTML → ordered blocks: {"h": text, "level"}, {"p": text}, {"img": src, "caption", "file", "width", "height"}."""

    VOID = {"img", "br", "hr", "meta", "link", "input", "wbr", "source", "col", "area", "base", "track"}
    SKIP_TAGS = {"style", "script", "sup", "table"}  # footnote markers, navboxes and infobox-style tables
    SKIP_CLASSES = ("reference", "mw-editsection", "hatnote", "navbox", "noprint", "mw-empty-elt", "shortdescription", "toc", "toclimit-3", "toclimit-4",
                    "references", "reflist", "mw-references-wrap", "refbegin", "citation")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.stack = []  # open tags; an end tag closes back to its matching start (Wikipedia HTML isn't always tidy)
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
            self.stack.append(tag)
        self.depth = len(self.stack)
        if self.skip_from is not None:
            return
        classes = attrs.get("class") or ""
        if tag in self.SKIP_TAGS or any(name in classes.split() for name in self.SKIP_CLASSES) or attrs.get("id") == "toc":
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
                self.blocks.append({"img": big, "file": self.file_link, "caption": "", "width": width, "height": int(attrs.get("height") or 0)})
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
        if tag in self.VOID or tag not in self.stack:
            return
        while self.stack and self.stack[-1] != tag:
            self.stack.pop()
        depth = len(self.stack)
        self.stack.pop()
        self.depth = len(self.stack)
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


def commons_json(params):
    url = f"{COMMONS_API}?{urlencode({**params, 'format': 'json', 'formatversion': '2'})}"
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code == 429 and attempt < 3:
                time.sleep(15 * (attempt + 1))
                continue
            raise


def logo_years(text):
    """(start, end) years from a file name like "Utah Jazz Logo, 1980-1996" ("current"/"present" → None end)."""
    match = re.search(r"\b(1[89]\d\d|20\d\d)\b(?:\s*[-–_]\s*(1[89]\d\d|20\d\d|present|current|now)\b)?", text, re.I)
    if not match:
        return None, None
    end = match.group(2)
    return int(match.group(1)), (int(end) if end and end.isdigit() else ("present" if end else None))


def commons_logos(names, known_files=(), fetch=commons_json, limit=24):
    """Logo files on Wikimedia Commons whose names mention the team (or a former name): the team's logo category,
    then a file-name search. Photos and other teams with the same nickname are left out."""
    titles = []
    keys = [re.sub(r"[^a-z0-9]+", " ", name.lower()).strip() for name in names]
    def wanted(title):
        plain = re.sub(r"[^a-z0-9]+", " ", title.lower())
        return (any(f" {key} " in f" {plain} " for key in keys) and LOGO_WORDS.search(title.replace("_", " ")) and not NOT_THE_TEAM.search(title.replace("_", " "))
                and re.search(r"\.(svg|png|gif)$", title, re.I))
    for name in names[:1]:
        data = fetch({"action": "query", "list": "categorymembers", "cmtitle": f"Category:{name} logos", "cmtype": "file", "cmlimit": 50})
        titles += [item["title"] for item in (data.get("query") or {}).get("categorymembers", [])
                   if re.search(r"\.(svg|png|gif)$", item["title"], re.I) and not NOT_THE_TEAM.search(item["title"])]
    for name in names:
        data = fetch({"action": "query", "list": "search", "srsearch": f'intitle:"{name}" logo', "srnamespace": 6, "srlimit": 30})
        titles += [item["title"] for item in (data.get("query") or {}).get("search", []) if wanted(item["title"])]
        time.sleep(0.5)
    known = {re.sub(r"[ _]+", "_", unquote_title(url)) for url in known_files}
    unique = []
    for title in titles:
        if title not in unique and re.sub(r"[ _]+", "_", title.removeprefix("File:")) not in known:
            unique.append(title)
    out = []
    for start in range(0, len(unique), 40):
        data = fetch({"action": "query", "titles": "|".join(unique[start:start + 40]), "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 300})
        for page in (data.get("query") or {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            thumb = (info.get("thumburl") or "").split("?")[0]
            if not re.match(r"https://(upload|thumb)\.wikimedia\.org/", thumb):
                continue
            meta = info.get("extmetadata") or {}
            caption = re.sub(r"\.(svg|png|gif)$", "", page["title"].removeprefix("File:"), flags=re.I).replace("_", " ").strip()
            first, last = logo_years(caption)
            out.append({"img": thumb, "file": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{quote(page['title'].replace(' ', '_'))}",
                        "caption": caption[:140], **({"from": first} if first else {}), **({"to": last} if last else {}),
                        "license": re.sub(r"<[^>]+>", "", (meta.get("LicenseShortName") or {}).get("value", ""))[:60],
                        "width": info.get("thumbwidth") or 0, "height": info.get("thumbheight") or 0})
    out.sort(key=lambda item: (item.get("from") or 9999, item["caption"].lower()))
    # The same logo is often uploaded as both SVG and PNG; keep one per name.
    seen, unique_out = set(), []
    for item in out:
        key = re.sub(r"[^a-z0-9]+", "", item["caption"].lower())
        if key not in seen:
            seen.add(key)
            unique_out.append(item)
    return unique_out[:limit]


def unquote_title(url):
    from urllib.parse import unquote
    return unquote(url.rsplit("/wiki/", 1)[-1]).removeprefix("File:")


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
        try:
            known = [block["file"] for block in (history or {}).get("blocks", []) if block.get("file")]
            extra = commons_logos([name, *FORMER_NAMES.get(slug, [])], known)
        except Exception as error:
            print(f"  {name} (Commons): {error}", file=sys.stderr)
            extra = ((previous.get("teams") or {}).get(slug) or {}).get("commons", [])
        if history or extra:
            teams[slug] = {**(history or {"article": name, "url": f"https://en.wikipedia.org/wiki/{quote(name.replace(' ', '_'))}", "section": "", "blocks": []}),
                           **({"commons": extra} if extra else {})}
        time.sleep(1)
    if len(teams) < 20:
        print(f"NBA team history: only {len(teams)} teams found; keeping the previous file.", file=sys.stderr)
        return
    OUTPUT.write_text(json.dumps({"generatedAt": now.replace(microsecond=0).isoformat(), "source": "Wikipedia", "teams": teams},
                                 ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    images = sum(1 for team in teams.values() for block in team["blocks"] if "img" in block)
    extra = sum(len(team.get("commons", [])) for team in teams.values())
    print(f"NBA team history: {len(teams)} teams, {images} Wikipedia images, {extra} more logos from Commons")


if __name__ == "__main__":
    main()
