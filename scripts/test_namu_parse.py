"""Tests for namu_parse.py. Run: python3 scripts/test_namu_parse.py"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import namu_parse  # noqa: E402

PAGE = """[include(틀:aespa)]
||<-2><tablealign=right><tablebordercolor=#000000> {{{#ffffff '''카리나'''}}} ||
|| '''본명''' || 유지민 ||
|| '''출생''' || [[2000년]] [[4월 11일]] ([[나이]] 25세)[br][[경기도]] [[안양시]] ||
|| '''포지션''' || [[리더]], 메인댄서, 리드래퍼, 서브보컬, [[센터]][* 데뷔 당시 기준] ||
|| '''MBTI''' || INFP → [[ENFP]]-T ||
"""


def main():
    parsed = namu_parse.parse_page(PAGE)
    assert parsed["positions"] == ["Leader", "Main dancer", "Lead rapper", "Sub vocalist", "Center"], parsed
    assert parsed["positionsKo"] == "리더, 메인댄서, 리드래퍼, 서브보컬, 센터", parsed
    assert parsed["mbti"] == "ENFP", parsed
    assert namu_parse.birth_matches(PAGE, "2000-04-11")
    assert not namu_parse.birth_matches(PAGE, "2000-04-12")
    assert namu_parse.parse_page("no table here") == {}
    assert namu_parse.redirect_target("#redirect 카리나(aespa)#s-2") == "카리나(aespa)"
    assert namu_parse.translate_positions("메인 보컬 / 비주얼 및 막내") == ["Main vocalist", "Visual", "Maknae"]
    assert namu_parse.translate_positions("올라운더") == ["올라운더"]  # unknown terms stay in Korean
    # Footnotes with links inside, notes in parentheses, band roles
    hoshi = "|| '''포지션''' || 퍼포먼스팀 리더, 서브보컬, 메인댄서[* [[Mnet]] 보이그룹 메인 댄서즈(Main Dancers) 특집에 참가했다. [[https://x|#]]] ||"
    assert namu_parse.parse_page(hoshi)["positions"] == ["Performance unit leader", "Sub vocalist", "Main dancer"], namu_parse.parse_page(hoshi)
    assert namu_parse.translate_positions("리드댄서 (WEi, 1THE9), 서브보컬") == ["Lead dancer", "Sub vocalist"]
    assert namu_parse.translate_positions("기타, 베이스 기타, 드럼") == ["Guitar", "Bass guitar", "Drums"]
    candidate = {"birth": "2000-04-11"}
    assert namu_parse.accept("카리나(aespa)", PAGE, candidate) and not namu_parse.accept("카리나", "다른 사람 1999년 1월 1일", candidate)
    assert namu_parse.accept("카리나(aespa)", "no date", {"birth": ""}) and not namu_parse.accept("카리나", "no date", {"birth": ""})
    print("namu_parse tests passed")


if __name__ == "__main__":
    main()
