"""Temporary: can GitHub Actions read the Kpop Wiki (Fandom) API, and what do idol infoboxes hold?"""
import json, re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; K-pop idol positions)"

def get(url):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:300]

api = "https://kpop.fandom.com/api.php"
status, body = get(api + "?" + urlencode({"action": "query", "meta": "siteinfo", "siprop": "rightsinfo|statistics", "format": "json"}))
print("siteinfo", status, body[:400])
for title in ["Karina", "Wonyoung", "Hanni", "Wonhee", "Ahyeon", "Jurin", "Felix", "Jimin"]:
    status, body = get(api + "?" + urlencode({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "titles": title, "redirects": "1", "format": "json", "formatversion": "2"}))
    if status != 200:
        print(title, status, body[:200]); continue
    pages = json.loads(body).get("query", {}).get("pages", [])
    text = pages[0].get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "") if pages else ""
    print("\n==", title, "->", pages[0].get("title") if pages else None, "len", len(text))
    for line in text.splitlines():
        if re.match(r"\s*\|\s*(position|mbti|group|label|agency|birth_?date|height)", line, re.I):
            print("   ", line[:200])
    if "mbti" in text.lower():
        i = text.lower().index("mbti"); print("    mbti context:", text[max(0, i-80):i+120].replace("\n", " "))
