# Temporary: prints how many Politics stories per outlet have a picture (after the page-image fallback). Removed before merging.
import json
from collections import Counter
import update_politics_news as n

n.main()
data = json.load(open(n.OUTPUT))
total, with_image = Counter(), Counter()
for item in data["items"]:
    total[item["source"]] += 1
    if item.get("image"):
        with_image[item["source"]] += 1
for source in total:
    sample = next((item["image"] for item in data["items"] if item["source"] == source and item.get("image")), "")
    print(f"{source}: {with_image[source]}/{total[source]} with images  {sample[:90]}")
