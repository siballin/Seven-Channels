# Temporary: prints the Politics news build from GitHub Actions. Removed before merging.
import json
import update_politics_news as n

raw = n.fetch("https://punchbowl.news/feed/")
first = list(n.parse_feed(raw))[0]
print("PUNCH_RAW", repr(first[3][:700]))
n.main()
data = json.load(open(n.OUTPUT))
for i in data["items"]:
    if i["source"] in ("Axios", "Punchbowl News"):
        print(i["source"], "|", i["title"][:120], "|", i["summary"][:100])
print("JSON_START")
print(json.dumps(data, ensure_ascii=False))
print("JSON_END")
