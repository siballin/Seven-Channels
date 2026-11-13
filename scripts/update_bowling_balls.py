#!/usr/bin/env python3
"""Refresh the bowling ball spec database from manufacturer websites.

Sources (manufacturer sites, plus one retailer for Motiv):
- Storm, Roto Grip and 900 Global: Storm's ball feed plus each ball's page on stormbowling.com.
- Brunswick, Radical and DV8: each site's product sitemap and ball pages.
- Hammer, Ebonite, Track and Columbia 300: each Shopify store's product feed and ball pages.
- Motiv: Bowling.com's Motiv ball listing and product pages, because Motiv's site refuses
  automated requests. Bowling.com gives release months only, and lists balls it currently sells.

Pages already processed are cached in the output file, so daily runs only fetch
new or changed pages. A brand that fails keeps its previous data and is marked stale.
"""

from datetime import datetime, timezone
import html
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import urljoin, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "bowling-balls.json"
USER_AGENT = "SevenChannelsBallSpecs/1.0 (+https://siballin.github.io/Seven-Channels/; daily)"
MIN_RELEASE_DATE = "2020-01-01"
PREFERRED_WEIGHTS = (15, 16, 14)
# Upper bound on time spent fetching pages in one run; unfinished pages are fetched next run.
MAX_FETCH_SECONDS = int(os.environ.get("BOWLING_MAX_FETCH_SECONDS", "2400"))

STORM_FEED = "https://stormproducts.nyc3.cdn.digitaloceanspaces.com/web_page_content/Ball-Data.json"
STORM_BRANDS = {"STORM": "Storm", "ROTO GRIP": "Roto Grip", "900 GLOBAL": "900 Global"}
CRAFT_SITES = {"Brunswick": "https://brunswickbowling.com", "Radical": "https://radicalbowling.com", "DV8": "https://dv8bowling.com"}
SHOPIFY_SITES = {
    "Hammer": "https://hammerbowling.com", "Ebonite": "https://ebonite.com",
    "Track": "https://trackbowling.com", "Columbia 300": "https://columbia300.com",
}
BOWLING_COM = "https://www.bowling.com"
MOTIV_LISTING = BOWLING_COM + "/shopping/motiv/bowling-balls/all"
ALL_BRANDS = [*STORM_BRANDS.values(), *CRAFT_SITES, *SHOPIFY_SITES, "Motiv"]
# Seconds between page requests per host; Storm's robots.txt asks for 10.
CRAWL_DELAY = {"www.stormbowling.com": 10.0, "www.bowling.com": 3.0}
DEFAULT_DELAY = 2.0

_last_request = {}
_fetch_started = time.monotonic()


class FetchBudgetExceeded(Exception):
    pass


def fetch(url, *, budgeted=True):
    if budgeted and time.monotonic() - _fetch_started > MAX_FETCH_SECONDS:
        raise FetchBudgetExceeded(url)
    host = urlparse(url).hostname or ""
    delay = CRAWL_DELAY.get(host, DEFAULT_DELAY)
    wait = _last_request.get(host, 0) + delay - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_request[host] = time.monotonic()
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8", "replace")


def page_text(markup):
    markup = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", markup, flags=re.S | re.I)
    markup = re.sub(r"<[^>]+>", " ", markup)
    return re.sub(r"\s+", " ", html.unescape(markup)).strip()


def meta_content(markup, prop):
    match = re.search(rf'<meta[^>]+(?:property|name)="{re.escape(prop)}"[^>]+content="([^"]*)"', markup, re.I)
    if not match:
        match = re.search(rf'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="{re.escape(prop)}"', markup, re.I)
    return html.unescape(match.group(1)).strip() if match else ""


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


MONTHS = {name: index for index, name in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}


def parse_date(value):
    value = (value or "").strip()
    match = re.match(r"(\d{4})-(\d{2})-(\d{2})", value)
    if match:
        year, month, day = map(int, match.groups())
    else:
        match = re.match(r"([A-Za-z]+)\.? (\d{1,2}),? (\d{4})", value)
        if match and match.group(1).lower() in MONTHS:
            month, day, year = MONTHS[match.group(1).lower()], int(match.group(2)), int(match.group(3))
        else:
            match = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})\b", value)
            if not match:
                return ""
            month, day, year = map(int, match.groups())
            if year < 100:
                year += 2000
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return ""


def cover_category(*values):
    text = " ".join(value for value in values if value).lower()
    if "hybrid" in text:
        return "hybrid"
    if "pearl" in text:
        return "pearl"
    if "urethane" in text:
        return "urethane"
    if "polyester" in text or "plastic" in text or re.search(r"\bpoly\b", text):
        return "polyester"
    if "solid" in text:
        return "solid"
    return ""


SPEC_LABELS = [
    "Part Number", "Cover Type", "Coverstock", "Core Numbers", "Core", "Color", "Finish", "Weights",
    "Lane Condition", "Reaction", "Warranty", "Release Date", "Performance", "Series", "Level",
    "RG / DIFF / ASY", "Spec Table",
]
SPEC_STOPS = ["Downloads", "Performance Index", "Featuring", "Resources", "Customer Reviews", "Find a Pro Shop", "Specifications"]
_label_pattern = re.compile(
    r"(?<![A-Za-z])(" + "|".join(re.escape(label) for label in sorted(SPEC_LABELS + SPEC_STOPS, key=len, reverse=True)) + r")(?![A-Za-z])",
    re.I,
)


def spec_fields(text):
    """Read 'Label Value' pairs from a manufacturer spec block (Brunswick-family layout)."""
    anchors = [text.find(word) for word in ("Specifications", "Spec Table", "BALL SPECS", "Core Numbers")]
    anchors = [index for index in anchors if index >= 0]
    if not anchors:
        return {}
    segment = text[min(anchors):min(anchors) + 4000]
    fields = {}
    matches = list(_label_pattern.finditer(segment))
    for index, match in enumerate(matches):
        label = next((item for item in SPEC_LABELS if item.lower() == match.group(1).lower()), None)
        if not label:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(segment)
        value = segment[match.end():end].strip(" :-")
        if value and label not in fields:
            fields[label] = value[:120]
    return fields


def _numbers(value):
    return [float(item) for item in re.findall(r"\d*\.\d+", value)]


def core_numbers(text):
    """Return {weight: (rg, diff, intermediate diff or None)} from the three known table layouts."""
    found = {}
    # Hammer: "15 lb - RG (2.469) DIFF (0.034) ASY (0.013)"
    for match in re.finditer(r"(\d{2}) lb - RG \(([\d.]+)\) DIFF \(([\d.]+)\)(?: (?:ASY|MB|INT\.? DIFF|PSA) \(([\d.]+)\))?", text, re.I):
        found[int(match.group(1))] = (float(match.group(2)), float(match.group(3)), float(match.group(4)) if match.group(4) else None)
    if found:
        return found
    # Inline, one weight: "RG 2.501 (15 lb.) DIFF 0.051 (15 lb.) ASY 0.020 (15 lb.)"
    match = re.search(r"RG (\d*\.\d+) \((\d{2}) lbs?\.?\) DIFF (\d*\.\d+)(?: \(\d{2} lbs?\.?\))?"
                      r"(?: (?:ASY|MB|INT\.? DIFF|PSA) (\d*\.\d+))?", text, re.I)
    if match:
        found[int(match.group(2))] = (float(match.group(1)), float(match.group(3)), float(match.group(4)) if match.group(4) else None)
        return found
    # Columns: "16 lb 15 lb ... RG 2.517 2.568 ... DIFF 0.044 0.032 ... (ASY ...)"
    match = re.search(r"((?:\d{2} lbs? ){2,})RG ((?:\d*\.\d+ ?)+)DIFF ((?:\d*\.\d+ ?)+)(?:(?:ASY|MB|INT\.? DIFF|PSA) ((?:\d*\.\d+ ?)+))?", text, re.I)
    if match:
        weights = [int(item) for item in re.findall(r"\d{2}", match.group(1))]
        rgs, diffs = _numbers(match.group(2)), _numbers(match.group(3))
        ints = _numbers(match.group(4) or "")
        for index, weight in enumerate(weights):
            if index < len(rgs) and index < len(diffs):
                found[weight] = (rgs[index], diffs[index], ints[index] if index < len(ints) else None)
        if found:
            return found
    # Rows: "Weight RG DIFF ASY 16 lb 2.485 0.044 0.017 15 lb ..."
    header = re.search(r"Weight RG DIFF( (?:ASY|MB|INT\.? DIFF|PSA))?", text, re.I)
    if header:
        has_int = bool(header.group(1))
        row = r"(\d{2}) lbs? (\d*\.\d+) (\d*\.\d+)" + (r" (\d*\.\d+)" if has_int else "")
        tail = text[header.end():header.end() + 600]
        for match in re.finditer(row, tail):
            found[int(match.group(1))] = (float(match.group(2)), float(match.group(3)), float(match.group(4)) if has_int else None)
    return found


def choose_weight(numbers):
    for weight in PREFERRED_WEIGHTS:
        if weight in numbers:
            return weight
    return max(numbers) if numbers else None


def build_ball(*, brand, name, url, image="", release_date="", cover_type="", coverstock="", core="",
               numbers=None, symmetry="", performance="", finish="", discontinued=None,
               release_precision="day", source=""):
    numbers = numbers or {}
    weight = choose_weight(numbers)
    rg, diff, intermediate = numbers.get(weight, (None, None, None)) if weight else (None, None, None)
    if symmetry not in ("asymmetric", "symmetric"):
        if re.search(r"\basym", core or "", re.I) or (intermediate is not None and intermediate >= 0.008):
            symmetry = "asymmetric"
        elif rg is not None:
            symmetry = "symmetric"
        else:
            symmetry = ""
    category = cover_category(cover_type) or cover_category(coverstock)
    return {
        "id": f"{slug(brand)}-{slug(name)}",
        "brand": brand,
        "name": name,
        "url": url,
        "image": image if image.startswith("https://") else "",
        "releaseDate": release_date,
        **({"releaseDatePrecision": "month"} if release_precision == "month" else {}),
        **({"source": source} if source else {}),
        "coverType": category,
        "coverTypeLabel": cover_type or "",
        "coverstock": coverstock,
        "core": core,
        "symmetry": symmetry,
        "weight": weight,
        "rg": rg,
        "diff": diff,
        "intDiff": intermediate if symmetry == "asymmetric" else None,
        "performance": performance,
        "finish": finish,
        "discontinued": discontinued,
    }


def parse_brunswick_family_page(markup, *, brand, url, fallback_name=""):
    text = page_text(markup)
    fields = spec_fields(text)
    title = meta_content(markup, "og:title") or re.sub(r"\s*\|.*$", "", page_text((re.search(r"<title>(.*?)</title>", markup, re.S | re.I) or [None, ""])[1]))
    name = re.sub(r"\s*[|–-]\s*(?:%s).*$" % re.escape(brand), "", title, flags=re.I).strip() or fallback_name
    return build_ball(
        brand=brand, name=name, url=url, image=meta_content(markup, "og:image"),
        release_date=parse_date(fields.get("Release Date", "")),
        cover_type=fields.get("Cover Type", ""), coverstock=fields.get("Coverstock", ""), core=fields.get("Core", ""),
        numbers=core_numbers(text), performance=fields.get("Performance") or fields.get("Level") or fields.get("Series") or "",
        finish=fields.get("Finish", ""), discontinued="/retired/" in url or None,
    )


def storm_value(text, label, next_labels):
    match = re.search(rf"{re.escape(label)}: (.*?)(?= (?:{'|'.join(re.escape(item) for item in next_labels)}):|$)", text)
    value = match.group(1).strip() if match else ""
    return re.sub(r"_", " ", re.sub(r"^S_", "", value)).strip()


STORM_LABELS = ["Brand", "Line", "Core", "Weight Block", "Finish", "Durometer", "Symmetry", "Differential", "Flare Potential",
                "Radius of Gyration", "Weight", "Coverstock", "Color", "Release Date", "Fragrance", "Avail. for Sales Orders", "PSA",
                "Add To Compare"]


def parse_storm_page(markup, item):
    text = page_text(markup)
    start = text.find("Brand:")
    text = text[start:start + 1500] if start >= 0 else ""
    value = lambda label: storm_value(text, label, [other for other in STORM_LABELS if other != label])
    rg, diff, psa = _numbers(value("Radius of Gyration")), _numbers(value("Differential")), _numbers(value("PSA"))
    weight = int(value("Weight")) if value("Weight").isdigit() else 16
    numbers = {weight: (rg[0], diff[0], psa[0] if psa else None)} if rg and diff else {}
    symmetry_text = value("Symmetry").lower()
    symmetry = "asymmetric" if "asym" in symmetry_text else "symmetric" if "sym" in symmetry_text else ""
    coverstock = value("Coverstock")
    brand = STORM_BRANDS.get(str(item.get("brand", "")).upper(), "Storm")
    return build_ball(
        brand=brand, name=str(item.get("name", "")).strip(), url=item.get("url", ""), image=item.get("image", ""),
        release_date=parse_date(value("Release Date")) or parse_date(item.get("dateAvailable", "")),
        cover_type=coverstock, coverstock=coverstock, core=value("Weight Block") or value("Core"),
        numbers=numbers, symmetry=symmetry, performance=item.get("performanceLine", "") or value("Line"),
        finish=value("Finish"), discontinued=str(item.get("discontinued", "")).lower() == "yes",
    )


def shopify_is_ball(product):
    tags = {tag.lower() for tag in product.get("tags", [])}
    return product.get("product_type", "").lower() in ("bowling ball", "ball") or bool(tags & {"balls", "ball", "retired ball"})


def parse_shopify_product(product, markup, *, brand, site):
    url = f"{site}/products/{product['handle']}"
    text = page_text(markup)
    fields = spec_fields(text)
    image = ((product.get("images") or [{}])[0] or {}).get("src", "")
    tags = {tag.lower() for tag in product.get("tags", [])}
    return build_ball(
        brand=brand, name=product.get("title", "").strip(), url=url, image=image,
        release_date=parse_date(fields.get("Release Date", "")),
        cover_type=fields.get("Cover Type", ""), coverstock=fields.get("Coverstock", ""), core=fields.get("Core", ""),
        numbers=core_numbers(text), performance=fields.get("Performance") or fields.get("Series") or "",
        finish=fields.get("Finish", ""), discontinued="retired ball" in tags or None,
    )


def source_key(ball):
    return ball.get("sourceKey") or ball["url"]


class Collector:
    """Tracks results for one brand group, reusing cached pages from the previous run."""

    def __init__(self, previous):
        self.previous_checked = previous.get("checked", {}) if isinstance(previous, dict) else {}
        # Balls are tracked by the page they came from; several Storm feed entries share one catalog link.
        self.previous_balls = {source_key(ball): ball for ball in (previous.get("balls", []) if isinstance(previous, dict) else [])}
        self.checked = {}
        self.balls = {}
        self.incomplete = False

    def cached(self, url, version):
        if self.previous_checked.get(url) != version:
            return False
        self.checked[url] = version
        if url in self.previous_balls:
            self.balls[url] = self.previous_balls[url]
        return True

    def record(self, url, version, ball):
        self.checked[url] = version
        if ball and ball["name"] and ball["releaseDate"] and ball["releaseDate"] >= MIN_RELEASE_DATE:
            self.balls[url] = {**ball, "sourceKey": url}


STORM_CATALOG_URL = "https://www.stormbowling.com/products/equipment/bowling-balls/"


def storm_feed_only_ball(item):
    """A ball Storm lists in its feed without a working product page: release details only, no specs."""
    brand = STORM_BRANDS.get(str(item.get("brand", "")).upper(), "Storm")
    name = str(item.get("name", "")).strip()
    return build_ball(
        brand=brand, name=name, url=STORM_CATALOG_URL, image=item.get("image", ""),
        release_date=parse_date(item.get("dateAvailable", "")), cover_type=cover_category(name),
        performance=item.get("performanceLine", ""), discontinued=str(item.get("discontinued", "")).lower() == "yes",
    )


def collect_storm(collector):
    feed = json.loads(fetch(STORM_FEED, budgeted=False))
    for item in feed:
        if not str(item.get("name", "")).strip():
            continue
        # The feed mixes absolute and site-relative links, and some entries have none.
        link = str(item.get("url") or "").strip()
        url = urljoin("https://www.stormbowling.com/", link) if link else ""
        version = f"{item.get('dateAvailable', '')}|{item.get('discontinued', '')}"
        if not url.startswith("https://www.stormbowling.com/") or url.rstrip("/") == "https://www.stormbowling.com":
            key = f"{STORM_CATALOG_URL}#{slug(str(item.get('name', '')))}"
            if not collector.cached(key, version):
                collector.record(key, version, storm_feed_only_ball(item))
            continue
        item = {**item, "url": url}
        if collector.cached(url, version):
            continue
        try:
            collector.record(url, version, parse_storm_page(fetch(url), item))
        except FetchBudgetExceeded:
            collector.incomplete = True
            return
        except HTTPError as error:
            if error.code != 404:
                print(f"Storm page failed {url}: {error}", file=sys.stderr)
                continue
            collector.record(url, version, storm_feed_only_ball(item))
        except Exception as error:  # Keep going; one bad page should not drop the brand.
            print(f"Storm page failed {url}: {error}", file=sys.stderr)


def collect_craft(collector, brand, site):
    sitemap = fetch(f"{site}/sitemaps-1-section-bowlerProducts-1-sitemap.xml", budgeted=False)
    entries = re.findall(r"<url>\s*<loc>([^<]+)</loc>(?:\s*<lastmod>([^<]+)</lastmod>)?", sitemap)
    for url, lastmod in entries:
        url = html.unescape(url.strip())
        if not re.search(r"/products/balls/(current|retired)/[^/]+/?$", url):
            continue
        if collector.cached(url, lastmod):
            continue
        try:
            collector.record(url, lastmod, parse_brunswick_family_page(fetch(url), brand=brand, url=url))
        except FetchBudgetExceeded:
            collector.incomplete = True
            return
        except Exception as error:
            print(f"{brand} page failed {url}: {error}", file=sys.stderr)


def collect_shopify(collector, brand, site):
    page = 1
    while page <= 10:
        products = json.loads(fetch(f"{site}/products.json?limit=250&page={page}", budgeted=False)).get("products", [])
        if not products:
            break
        for product in products:
            if not shopify_is_ball(product):
                continue
            url = f"{site}/products/{product['handle']}"
            version = product.get("updated_at", "")
            if collector.cached(url, version):
                continue
            body = product.get("body_html") or ""
            try:
                # Hammer publishes specs in the product description; others need the product page.
                markup = body if "release date" in page_text(body).lower() else fetch(url)
                collector.record(url, version, parse_shopify_product(product, markup, brand=brand, site=site))
            except FetchBudgetExceeded:
                collector.incomplete = True
                return
            except Exception as error:
                print(f"{brand} page failed {url}: {error}", file=sys.stderr)
        if len(products) < 250:
            break
        page += 1


MOTIV_LABELS = ["Color", "Core", "Coverstock", "Finish", "RG", "Differential", "Hook Potential", "Length",
                "Recommended Lane Condition", "Mass Bias Diff", "SKU", "Product ID", "Brand", "Category",
                "Ball Performance", "Release Date"]
_motiv_label_pattern = re.compile(r"(?<![A-Za-z])(" + "|".join(re.escape(label) for label in sorted(MOTIV_LABELS, key=len, reverse=True)) + r")(?![A-Za-z#])")


def parse_month_year(value):
    match = re.match(r"([A-Za-z]+)\.? (\d{4})\b", (value or "").strip())
    if match and match.group(1).lower() in MONTHS:
        return f"{int(match.group(2)):04d}-{MONTHS[match.group(1).lower()]:02d}-01"
    return ""


def parse_bowling_com_page(markup, url):
    """Read a Bowling.com product page's 'Details & Specs' block."""
    text = page_text(markup)
    # "Details & Specs" is also a tab label above the description, which mentions RG in prose.
    start = text.rfind("Details & Specs")
    if start < 0:
        return None
    segment = text[start:start + 2500]
    fields = {}
    matches = list(_motiv_label_pattern.finditer(segment))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(segment)
        value = segment[match.end():end].strip(" :")
        fields.setdefault(match.group(1), value[:120])
    if fields.get("Brand", "").strip().lower() != "motiv":
        return None
    weight_numbers = {}
    rg = re.match(r"(\d*\.\d+) \((\d{2})# ball\)", fields.get("RG", ""))
    diff = re.match(r"(\d*\.\d+)", fields.get("Differential", ""))
    mass_bias = re.match(r"(\d*\.\d+)", fields.get("Mass Bias Diff", ""))
    if rg and diff:
        weight_numbers[int(rg.group(2))] = (float(rg.group(1)), float(diff.group(1)), float(mass_bias.group(1)) if mass_bias else None)
    title = meta_content(markup, "og:title") or page_text((re.search(r"<h1[^>]*>(.*?)</h1>", markup, re.S | re.I) or [None, ""])[1])
    name = re.sub(r"^\s*Motiv\s+", "", re.sub(r"\s*[|–-]\s*Bowling\.com.*$", "", title, flags=re.I), flags=re.I)
    name = re.sub(r"\s+Bowling Ball\s*$", "", name, flags=re.I).strip()
    release = parse_date(fields.get("Release Date", ""))
    precision = "day"
    if not release:
        release, precision = parse_month_year(fields.get("Release Date", "")), "month"
    coverstock = re.sub(r"\s*A few tiny pit holes.*$", "", fields.get("Coverstock", ""), flags=re.I).strip()
    image = meta_content(markup, "og:image")
    if image.startswith("//"):
        image = "https:" + image
    return build_ball(
        brand="Motiv", name=name, url=url, image=image, release_date=release, release_precision=precision,
        cover_type=coverstock, coverstock=coverstock, core=fields.get("Core", ""), numbers=weight_numbers,
        performance=fields.get("Ball Performance", ""), finish=fields.get("Finish", ""), source="Bowling.com",
    )


def collect_motiv(collector):
    links, page = [], 1
    while page <= 10:
        listing = fetch(MOTIV_LISTING + (f"?page={page}" if page > 1 else ""), budgeted=False)
        found = [link for link in dict.fromkeys(re.findall(r'href="(/products/motiv-[^"?#]+\.htm)', listing)) if link not in links]
        if not found:
            break
        links.extend(found)
        if f"?page={page + 1}" not in listing:
            break
        page += 1
    if not links:
        raise ValueError("No Motiv balls were listed on Bowling.com.")
    for link in links:
        url = BOWLING_COM + link
        if collector.cached(url, "1"):
            continue
        try:
            collector.record(url, "1", parse_bowling_com_page(fetch(url), url))
        except FetchBudgetExceeded:
            collector.incomplete = True
            return
        except Exception as error:
            print(f"Motiv (Bowling.com) page failed {url}: {error}", file=sys.stderr)


def load_previous():
    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    previous = load_previous()
    previous_sources = {source.get("brand"): source for source in previous.get("sources", [])}
    previous_by_brand = {}
    for ball in previous.get("balls", []):
        previous_by_brand.setdefault(ball.get("brand"), []).append(ball)
    jobs = [("Storm group", list(STORM_BRANDS.values()), {"www.stormbowling.com"}, collect_storm, ())]
    jobs += [(brand, [brand], {urlparse(site).hostname}, collect_craft, (brand, site)) for brand, site in CRAFT_SITES.items()]
    jobs += [(brand, [brand], {urlparse(site).hostname}, collect_shopify, (brand, site)) for brand, site in SHOPIFY_SITES.items()]
    jobs += [("Motiv", ["Motiv"], {"www.bowling.com"}, collect_motiv, ())]
    balls, checked, sources = [], {}, []
    for label, brands, hosts, collect, args in jobs:
        collector = Collector(previous)
        previous_checked = {url: version for url, version in previous.get("checked", {}).items() if urlparse(url).hostname in hosts}
        try:
            collect(collector, *args)
        except Exception as error:
            print(f"{label} refresh failed: {error}", file=sys.stderr)
            kept = [ball for brand in brands for ball in previous_by_brand.get(brand, [])]
            balls.extend(kept)
            checked.update(previous_checked)
            for brand in brands:
                count = len(previous_by_brand.get(brand, []))
                old = previous_sources.get(brand, {})
                sources.append({
                    "brand": brand, "status": "stale" if count else "error",
                    "refreshedAt": old.get("refreshedAt", ""), "count": count,
                    "message": "Could not refresh from the manufacturer site; showing the last saved data." if count
                    else "Could not load from the manufacturer site.",
                })
            continue
        # Keep balls from earlier runs that were not re-checked (removed from the site or not reached yet).
        found = dict(collector.balls)
        for brand in brands:
            for ball in previous_by_brand.get(brand, []):
                if source_key(ball) not in collector.checked:
                    found.setdefault(source_key(ball), ball)
        if collector.incomplete:
            checked.update({url: version for url, version in previous_checked.items() if url not in collector.checked})
        checked.update(collector.checked)
        balls.extend(found.values())
        status, message = ("partial", "Some pages will be fetched on the next refresh.") if collector.incomplete else ("ok", "")
        for brand in brands:
            count = sum(1 for ball in found.values() if ball["brand"] == brand)
            sources.append({"brand": brand, "status": status, "refreshedAt": now, "count": count, "message": message})
    unique = {}
    for ball in sorted(balls, key=lambda item: (item["releaseDate"], item["url"]), reverse=True):
        unique.setdefault(ball["id"], ball)
    output = {
        "generatedAt": now,
        "minimumReleaseDate": MIN_RELEASE_DATE,
        "missingBrands": [],
        "notes": ["Motiv specs come from Bowling.com, a retailer, because Motiv's website refuses automated requests. "
                  "Bowling.com lists release months rather than exact dates, and only the Motiv balls it sells; "
                  "balls stay in this database after they leave the store."],
        "sources": sources,
        "balls": sorted(unique.values(), key=lambda item: (item["releaseDate"], item["brand"], item["name"]), reverse=True),
        "checked": dict(sorted(checked.items())),
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved {len(output['balls'])} balls: " + ", ".join(f"{s['brand']} {s['count']} ({s['status']})" for s in sources))


if __name__ == "__main__":
    main()
