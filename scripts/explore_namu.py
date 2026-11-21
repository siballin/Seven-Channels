"""Temporary: inspect the newer Namu Wiki dumps on Hugging Face."""
import json, re
from urllib.parse import quote
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; K-pop idol positions)"

def get(url):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:300]

for ds in ["butabutta/namuwiki-dumps", "wseo/namuwiki", "wseo/namuwiki_no_redirects"]:
    print("\n==", ds)
    status, body = get(f"https://huggingface.co/api/datasets/{ds}")
    if status == 200:
        meta = json.loads(body)
        print("  modified", meta.get("lastModified"), "gated", meta.get("gated"), "license", (meta.get("cardData") or {}).get("license"))
    status, body = get(f"https://huggingface.co/api/datasets/{ds}/tree/main?recursive=true")
    print("  tree", status)
    if status == 200:
        for f in json.loads(body)[:40]:
            print("   ", f.get("type"), f.get("path"), f.get("size"))
    status, body = get(f"https://huggingface.co/datasets/{ds}/raw/main/README.md")
    print("  README", status, body[:1200].replace("\n", " | "))
    status, body = get(f"https://datasets-server.huggingface.co/first-rows?dataset={quote(ds)}&config=default&split=train")
    print("  first-rows", status)
    if status == 200:
        data = json.loads(body)
        print("   features", [f["name"] for f in data.get("features", [])])
        for row in data.get("rows", [])[:2]:
            print("   row", {k: (str(v)[:160]) for k, v in row["row"].items()})
