# Temporary: runs the news builds on GitHub Actions and prints picture coverage per channel. Removed before merging.
import json
import subprocess
import sys
import time

for script in ("update_politics_news.py", "update_games_sidebar.py", "update_channel_news.py"):
    start = time.time()
    subprocess.run([sys.executable, script], check=False, stdout=subprocess.DEVNULL)
    print(f"{script}: {time.time() - start:.0f}s", flush=True)
data = json.load(open("../data/channel-news.json"))
for key, channel in data["channels"].items():
    items = channel["items"]
    print(f"{key}: {sum(1 for i in items if i.get('image'))}/{len(items)} with pictures")
guide = data["guide"]["items"]
print(f"guide: {sum(1 for i in guide if i.get('image'))}/{len(guide)} with pictures")
