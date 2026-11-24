import sys
sys.path.insert(0, "scripts")
import build_nba_team_history as h
index, section = h.find_section("Utah Jazz")
html, _ = h.section_html("Utah Jazz", index)
open("scratch-probe/jazz.html", "w").write(html)
index, section = h.find_section("Boston Celtics")
html, _ = h.section_html("Boston Celtics", index)
open("scratch-probe/celtics.html", "w").write(html)
