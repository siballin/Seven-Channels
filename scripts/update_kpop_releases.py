#!/usr/bin/env python3
"""Build a current-month preview for the K-pop release calendar."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_BASE = "https://kpopofficial.com/wp-json/wp/v2/"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "kpop-calendar.json"
HEADERS = {"User-Agent": "SevenChannelsReleaseCalendar/1.0 (personal static calendar)"}


def fetch_page(endpoint, params):
    request = Request(f"{API_BASE}{endpoint}?{urlencode(params)}", headers=HEADERS)
    with urlopen(request, timeout=30) as response:
        data = json.load(response)
        pages = int(response.headers["X-WP-TotalPages"])
        total = int(response.headers["X-WP-Total"])
    if not isinstance(data, list) or pages < 0 or total < 0:
        raise ValueError(f"Incomplete K-pop data for {endpoint}.")
    return data, pages, total


def fetch_terms(name):
    data, pages, total = fetch_page(name, {"per_page": 100, "_fields": "id,name,slug"})
    if pages > 1 or len(data) != total:
        raise ValueError(f"Incomplete K-pop taxonomy: {name}.")
    return data


def build_snapshot():
    now = datetime.now(timezone.utc)
    with ThreadPoolExecutor(max_workers=3) as executor:
        date_terms, month_terms, year_terms = executor.map(
            fetch_terms, ("calendar-date", "calendar-month", "calendar-year")
        )
    dates = {int(term["name"]) for term in date_terms}
    months = {int(term["slug"][:2]): term["id"] for term in month_terms}
    years = {int(term["name"]): term["id"] for term in year_terms}
    if dates != set(range(1, 32)) or set(months) != set(range(1, 13)) or now.year not in years:
        raise ValueError("K-pop calendar taxonomy is incomplete for the current month.")

    params = {
        "calendar-month": months[now.month],
        "calendar-year": years[now.year],
        "per_page": 100,
        "_fields": "id,title,link,calendar-date,calendar-month,calendar-year,group,artist_solo",
    }
    releases, pages, total = fetch_page("album", {**params, "page": 1})
    if (total and pages < 1) or (not total and pages > 1):
        raise ValueError("K-pop release pagination is incomplete.")
    for page in range(2, pages + 1):
        batch, batch_pages, batch_total = fetch_page("album", {**params, "page": page})
        if batch_pages != pages or batch_total != total:
            raise ValueError("K-pop release data changed while loading.")
        releases.extend(batch)
    if len(releases) != total:
        raise ValueError("K-pop release data did not include every result.")
    return {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "year": now.year,
        "month": now.month,
        "dateTerms": date_terms,
        "monthTerms": month_terms,
        "yearTerms": year_terms,
        "releases": releases,
    }


def main():
    snapshot = build_snapshot()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(snapshot['releases'])} K-pop releases to {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
