# Temporary: prints the Politics news build and Axios categories from GitHub Actions. Removed before merging.
import json
import update_politics_news as n

n.main()
data = json.load(open(n.OUTPUT))
for i in data["items"][:60]:
    print(i["source"], "|", i["published"][:16], "|", i["title"][:110], "|", i["summary"][:80])
for item in list(n.parse_feed(n.fetch("https://api.axios.com/feed/")))[:25]:
    print("AXIOS", item[4], "|", item[0][:70])
