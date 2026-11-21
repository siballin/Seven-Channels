#!/usr/bin/env python3
"""Import idol positions and MBTI from the Namu Wiki database dump (March 2021) into data/idols/namu-positions.json.

The dump is static, so this runs once (the "Import Namu Wiki dump" workflow, run by hand). It reads only the
title and text columns of the parquet file in batches, keeps pages whose title is a candidate for an idol in the
directory (see namu_parse.idol_candidates), follows redirects, and accepts a page only when the birth date matches
(or for a group-qualified title when no birth date is known).

Source: https://huggingface.co/datasets/heegyu/namuwiki (namu.wiki dump of 2021-03-01, CC BY-NC-SA 2.0 KR).

Usage: python3 scripts/import_namu_dump.py path/to/namuwiki_20210301.parquet
"""

from datetime import datetime, timezone
import json
import sys

import pyarrow.parquet as pq

import namu_parse

OUTPUT = namu_parse.IDOLS / "namu-positions.json"


def scan(path, wanted):
    """{title: text} for the wanted titles, in one pass over the file."""
    found = {}
    reader = pq.ParquetFile(path)
    for batch in reader.iter_batches(columns=["title", "text"], batch_size=4000):
        titles = batch.column(0).to_pylist()
        hits = [index for index, title in enumerate(titles) if title in wanted]
        if hits:
            texts = batch.column(1).to_pylist()
            for index in hits:
                found[titles[index]] = texts[index]
    return found


def main():
    path = sys.argv[1]
    candidates = namu_parse.idol_candidates()
    wanted = {title for candidate in candidates.values() for title in candidate["titles"]}
    print(f"{len(candidates)} idols, {len(wanted)} candidate titles", flush=True)
    pages = scan(path, wanted)
    redirects = {title: namu_parse.redirect_target(text) for title, text in pages.items() if namu_parse.redirect_target(text)}
    print(f"{len(pages)} pages found, {len(redirects)} redirects", flush=True)
    targets = set(redirects.values()) - set(pages)
    if targets:
        pages.update(scan(path, targets))
    people = {}
    for qid, candidate in candidates.items():
        for title in candidate["titles"]:
            text = pages.get(redirects.get(title, title)) or pages.get(title)
            if not text or namu_parse.redirect_target(text) or not namu_parse.accept(title, text, candidate):
                continue
            parsed = namu_parse.parse_page(text)
            if parsed:
                people[qid] = {**parsed, "title": redirects.get(title, title)}
            break
    OUTPUT.write_text(json.dumps({
        "source": "Namu Wiki database dump of 2021-03-01", "sourceUrl": "https://huggingface.co/datasets/heegyu/namuwiki",
        "license": "CC BY-NC-SA 2.0 KR", "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/2.0/kr/",
        "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "people": dict(sorted(people.items())),
    }, ensure_ascii=False, indent=1) + "\n")
    with_positions = sum(1 for item in people.values() if item.get("positions"))
    with_mbti = sum(1 for item in people.values() if item.get("mbti"))
    print(f"Wrote {len(people)} idols: {with_positions} with positions, {with_mbti} with MBTI.")
    for qid, item in list(people.items())[:15]:
        print(" ", qid, candidates[qid]["name"], item)


if __name__ == "__main__":
    main()
