# Temporary: runs every news build on GitHub Actions and prints which outlets worked. Removed before merging.
import json
import subprocess
import sys

for script in ("update_politics_news.py", "update_games_sidebar.py", "update_channel_news.py"):
    print("=====", script, flush=True)
    subprocess.run([sys.executable, script], check=False)
data = json.load(open("../data/channel-news.json"))
for key in ("sports", "kpop"):
    for item in data["channels"][key]["items"][:5]:
        print(key.upper(), "|", item["source"], "|", item["published"][:16], "|", item["title"][:90])
