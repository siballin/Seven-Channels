import urllib.request
UA = {"User-Agent": "SevenChannelsNBA/1.0 (+https://siballin.github.io/Seven-Channels/; personal non-commercial fan site)"}
body = urllib.request.urlopen(urllib.request.Request("https://www.sportslogos.net/logos/list_by_team/234/Utah-Jazz-Logos/", headers=UA), timeout=60).read()
open("scratch-probe/jazz.html", "wb").write(body)
