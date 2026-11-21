"""Temporary: what Namu Wiki dumps exist on Hugging Face, and can GitHub Actions reach namu.wiki?"""
import json, re, time
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

UA = "SevenChannels/1.0 (personal static site; K-pop idol positions)"

def get(url, binary=False):
    try:
        with urlopen(Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            body = r.read()
            return r.status, (body if binary else body.decode("utf-8", "replace")), dict(r.headers)
    except Exception as e:
        return getattr(e, "code", "ERR"), str(e)[:300], {}

status, body, _ = get("https://huggingface.co/api/datasets?search=namuwiki&limit=40&full=true")
print("HF search", status)
if status == 200:
    for d in json.loads(body):
        print(" ", d["id"], d.get("lastModified", "")[:10], "downloads", d.get("downloads"))
for ds in ["heegyu/namuwiki", "heegyu/namuwiki-extracted", "bigscience-data/roots_ko_namuwiki"]:
    status, body, _ = get(f"https://datasets-server.huggingface.co/info?dataset={quote(ds)}")
    print("\n==", ds, status)
    if status == 200:
        info = json.loads(body).get("dataset_info", {})
        for cfg, v in info.items():
            print("  config", cfg, "features", list((v.get("features") or {}).keys()), "rows", {k: s.get("num_examples") for k, s in (v.get("splits") or {}).items()}, "bytes", v.get("download_size"), v.get("description", "")[:200])
    status, body, _ = get(f"https://datasets-server.huggingface.co/search?dataset={quote(ds)}&config=default&split=train&query={quote('카리나 aespa')}&length=3")
    print("  search", status)
    if status == 200:
        for row in json.loads(body).get("rows", [])[:3]:
            r = row["row"]
            text = r.get("text", "")
            print("   title:", r.get("title"), "| len", len(text))
            for line in text.splitlines():
                if re.search(r"포지션|MBTI|생년월일|소속사", line):
                    print("     ", line[:200])
    status, body, _ = get(f"https://huggingface.co/api/datasets/{ds}/tree/main?recursive=true")
    if status == 200:
        for f in json.loads(body)[:20]:
            print("   file", f.get("path"), f.get("size"))

for path in ["raw/" + quote("카리나(aespa)"), "w/" + quote("카리나(aespa)")]:
    status, body, headers = get("https://namu.wiki/" + path)
    print("\nnamu", path, status, headers.get("Server"), headers.get("cf-mitigated"), len(body))
    print("  ", body[:300].replace("\n", " "))
    for line in body.splitlines():
        if re.search(r"포지션|MBTI", line):
            print("   >", line[:300])
            break
