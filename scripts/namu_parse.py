"""Read positions and MBTI from Namu Wiki idol pages (namumark), shared by the dump import and the home script.

Namu Wiki text is CC BY-NC-SA 2.0 KR: credit it, keep the site non-commercial, and share these fields alike.
"""

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
IDOLS = ROOT / "data" / "idols"

# Korean position terms → English. Unknown terms are kept in Korean.
POSITION_TERMS = [
    ("메인보컬", "Main vocalist"), ("리드보컬", "Lead vocalist"), ("서브보컬", "Sub vocalist"),
    ("메인래퍼", "Main rapper"), ("리드래퍼", "Lead rapper"), ("서브래퍼", "Sub rapper"),
    ("메인댄서", "Main dancer"), ("리드댄서", "Lead dancer"), ("서브댄서", "Sub dancer"),
    ("메인 보컬", "Main vocalist"), ("리드 보컬", "Lead vocalist"), ("서브 보컬", "Sub vocalist"),
    ("메인 래퍼", "Main rapper"), ("리드 래퍼", "Lead rapper"), ("서브 래퍼", "Sub rapper"),
    ("메인 댄서", "Main dancer"), ("리드 댄서", "Lead dancer"), ("서브 댄서", "Sub dancer"),
    ("부리더", "Sub-leader"), ("리더", "Leader"), ("센터", "Center"), ("비주얼", "Visual"), ("막내", "Maknae"),
    ("보컬", "Vocalist"), ("래퍼", "Rapper"), ("랩", "Rapper"), ("댄서", "Dancer"), ("퍼포먼스", "Performance"),
    ("퍼포먼스팀 리더", "Performance unit leader"), ("보컬팀 리더", "Vocal unit leader"), ("힙합팀 리더", "Hip-hop unit leader"),
    ("베이스 기타", "Bass guitar"), ("베이스", "Bass"), ("기타", "Guitar"), ("드럼", "Drums"), ("키보드", "Keyboard"),
    ("바이올린", "Violin"), ("코러스", "Backing vocals"), ("댄스", "Dancer"),
    ("프로듀서", "Producer"), ("프로듀싱", "Producer"), ("작사", "Lyricist"), ("작곡", "Composer"), ("페이스", "Face of the group"),
]
MBTI = re.compile(r"(?<![A-Za-z])([EI][NS][TF][JP])(?:-[AT])?(?![A-Za-z])")


def strip_footnotes(text):
    """Remove [* …] footnotes, which can contain [[links]] and other brackets."""
    out = []
    index = 0
    text = text or ""
    while index < len(text):
        if text.startswith("[*", index):
            depth = 0
            while index < len(text):
                depth += {"[": 1, "]": -1}.get(text[index], 0)
                index += 1
                if depth == 0:
                    break
        else:
            out.append(text[index])
            index += 1
    return "".join(out)


def plain(cell):
    """Strip namumark from one table cell."""
    text = strip_footnotes(cell)
    text = re.sub(r"^\s*(?:<[^>]*>\s*)+", "", text)                    # cell attributes like <-2><bgcolor=…>
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)       # links
    text = re.sub(r"\{\{\{(?:#[0-9a-fA-F]{3,6}|[+-]\d|#\w+)?\s*", "", text).replace("}}}", "")  # {{{#color text}}}
    text = re.sub(r"\[br\]|<br\s*/?>", ", ", text, flags=re.I)
    text = re.sub(r"'''?|~~|__|<[^>]*>", "", text)
    return re.sub(r"\s+", " ", text).strip(" ,/")


def infobox_value(text, label):
    """The value cell next to a label cell in a namumark table, e.g. || '''포지션''' || 리더, 메인댄서 ||."""
    for line in (text or "").splitlines():
        if "||" not in line or label not in line:
            continue
        cells = line.split("||")
        for index, cell in enumerate(cells):
            if plain(cell) == label:
                for value in cells[index + 1:]:
                    value = plain(value)
                    if value:
                        return value
    return ""


def translate_positions(value):
    value = re.sub(r"\([^()]*\)", "", value or "")  # notes like "(WEi, 1THE9)" would otherwise split on the comma
    parts = [part.strip() for part in re.split(r"[,/·]|\s및\s", value) if part.strip()]
    out = []
    for part in parts:
        part = re.sub(r"\(.*?\)", "", part).strip()
        english = next((en for ko, en in POSITION_TERMS if part == ko), None)
        if english is None:
            english = next((en for ko, en in POSITION_TERMS if ko in part and len(part) <= len(ko) + 3), part)
        if english and english not in out:
            out.append(english)
    return out[:8]


def parse_page(text):
    """{'positions': [...], 'positionsKo': '…', 'mbti': 'ENFP'} from an idol page, or {} if there's nothing."""
    out = {}
    positions = infobox_value(text, "포지션")
    if positions and len(positions) <= 120:
        out["positionsKo"] = positions
        out["positions"] = translate_positions(positions)
    mbti = infobox_value(text, "MBTI")
    found = MBTI.findall(mbti or "")
    if found:
        out["mbti"] = found[-1]  # the latest when several are listed (e.g. "INFP → ENFP")
    return out


def redirect_target(text):
    match = re.match(r"\s*#(?:redirect|넘겨주기)\s+(.+)", text or "", re.I)
    return match.group(1).split("#")[0].strip() if match else ""


def birth_matches(text, birth):
    """Does the page mention this birth date (YYYY-MM-DD) the way Namu Wiki writes it?"""
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", birth or "")
    if not match:
        return False
    year, month, day = int(match[1]), int(match[2]), int(match[3])
    unlinked = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text or "")
    return bool(re.search(rf"{year}\s*년\s*0?{month}\s*월\s*0?{day}\s*일", unlinked))


def idol_candidates():
    """Namu Wiki titles to try for each idol, from the published idol directory: 카리나(aespa), 지민(방탄소년단), …"""
    groups = json.loads((IDOLS / "groups.json").read_text())["groups"]
    out = {}
    for shard in sorted((IDOLS / "people").glob("*.json")):
        for qid, person in json.loads(shard.read_text())["people"].items():
            names = [name for name in [person.get("ko"), person.get("birthName") if re.search(r"[가-힣]", person.get("birthName") or "") else ""] if name]
            if not names:
                continue
            titles = []
            for membership in person.get("groups", []):
                group = groups.get(membership["id"], {})
                for group_name in [group.get("ko"), group.get("name"), (group.get("name") or "").lower()]:
                    if group_name:
                        titles += [f"{name}({group_name})" for name in names]
            titles += names  # a bare name only counts when the birth date matches
            out[qid] = {"titles": list(dict.fromkeys(titles)), "birth": person.get("birth", ""), "name": person.get("name", ""),
                        "debut": person.get("debut", ""), "groups": [membership["id"] for membership in person.get("groups", [])]}
    return out


def accept(title, text, candidate):
    """A page counts for an idol if its birth date matches, or if it's a group-qualified title and no birth date is known."""
    if birth_matches(text, candidate["birth"]):
        return True
    return "(" in title and not re.match(r"^\d{4}-\d{2}-\d{2}$", candidate["birth"] or "")
