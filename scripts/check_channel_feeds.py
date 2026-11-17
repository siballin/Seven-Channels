# Temporary: runs the channel news build on GitHub Actions and prints a sample. Removed before merging.
import json
import update_channel_news as news

news.main()
data = json.load(open(news.OUTPUT))
for key, channel in [("bowling", data["channels"]["bowling"])]:
    for item in channel["items"][:15]:
        print(key.upper(), "|", item["source"], "|", item["published"][:16], "|", item["title"][:100])
for item in []:
    print("GUIDE |", item["channelName"], "|", item["source"], "|", item["title"][:90])
