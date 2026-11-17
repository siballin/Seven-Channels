# Seven Channels

A personal guide app hosted as a static site on GitHub Pages.

The interface uses Manrope for body text and data, with Unbounded for selected headings. Fonts are loaded from Google Fonts with system fallbacks and `font-display: swap`.

## Publish with GitHub Pages

The `main` branch workflow in `.github/workflows/pages.yml` publishes the repository root. In GitHub, open **Settings → Pages**, choose **GitHub Actions** as the build and deployment source, and wait for the workflow to finish. The site URL is:

https://siballin.github.io/Seven-Channels/

## Video Games

**My games** (`#games`) is your game log. Add a game by searching the catalog as you type; picking a result fills in its cover, platforms, release date, genres, critic score and time to beat. Then record your platform, hours played, a rating out of 10, and when you started or finished. Games you add without a catalog match keep whatever you type. Games are listed under Playing, Backlog and Finished, and the backlog can be sorted by shortest to beat or highest critic score. A dashboard totals what you're playing, your backlog with estimated hours, games finished this year, hours played and your average rating. Game entries are saved in the browser and sync to your account like other entries.

**Check price** on a playing or backlog game looks up current PC store prices on [CheapShark](https://www.cheapshark.com/), with the best deal, its discount and the lowest price on record; console prices aren't covered. The sidebar lists the Epic Games Store's current and upcoming free games, recent trailers from PlayStation, Xbox, Nintendo of America, IGN and GameSpot, and gaming news from IGN, GameSpot and Polygon, refreshed daily by `scripts/update_games_sidebar.py`. Each part refreshes on its own and keeps its last items if a source fails.

**Release calendar** (`#games/releases`) shows Game Informer's release schedules for last year, this year and next year, refreshed daily into `data/game-releases.json`, including available box art. Filter by platform, search titles, and star games to follow them. Starred games appear under **Upcoming favorites** with a countdown, and stay listed under **Released favorites** after they come out, even once that year's schedule leaves the calendar. Favorites are saved on this device.

The catalog, critic scores and time to beat come from [IGDB](https://www.igdb.com/). `scripts/update_game_catalog.py` builds `data/games-catalog/` during the daily Pages workflow from games with enough ratings, critic reviews or pre-release interest, split into a search index and detail files so the page only downloads what it needs. It needs a Twitch developer application: register one at the [Twitch developer console](https://dev.twitch.tv/console) (OAuth redirect URL `http://localhost`, category Website Integration, confidential client), then add its Client ID and Client Secret as repository secrets named `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. Until then the catalog is skipped and games are added by hand. Critic scores are IGDB's average of external critic reviews; time-to-beat figures come from IGDB player submissions.

Run `python3 -m unittest discover -s scripts -p 'test_update_games.py'` to test the Video Games collectors.

The K-Pop channel includes a monthly release calendar sourced live from [KPOP OFFICIAL](https://kpopofficial.com/kpop-comebacks/). Select a day to see its listed releases, available album covers and artist/teaser images, and links to their source pages. Images may be unavailable until announced. Click an artist image or "View artist discography" to see that artist's listed releases, newest first, in the same section. Click any album title or cover to open its track list in a panel that slides in from the right (Escape or Close dismisses it); unreleased albums may not have a track list yet. Older releases are pulled from Apple Music by exact artist-name match, so they can overlap with the listed ones or be missing for some artists. Dates are as listed by the source, can change, and may not cover every release; an internet connection is required.

For a faster initial view, the Pages workflow generates a current-month K-pop preview each day. The calendar displays a recent preview while checking for live updates; if you are interacting with the calendar, use "Show updates" to apply changes without interrupting you. Other months are loaded live and reused for up to five minutes while the calendar remains open. If the preview is missing or more than 48 hours old, the calendar loads live instead. Game release data uses normal browser caching, so repeat visits can avoid downloading it again when the cached response is still fresh.

On desktop, the K-pop calendar and discography search sit between two sidebars; on smaller screens they stack. Search KPOP OFFICIAL's artist records in **Your favorites** to follow or unfollow groups and solo artists. Favorites are saved locally and sync across signed-in devices. **Upcoming comebacks** shows dated releases for those artists from the current and next two calendar months when available; the displayed coverage and refresh time identify the snapshot used. The discovery panel links to Soompi's music news and recent music videos from 1theK's official YouTube feed. Its artist ranking counts dated releases in the calendar month, not popularity or chart performance. These sidebar feeds and calendar summaries are refreshed during the daily Pages deployment; if a refresh fails, the last available snapshot remains labeled with its refresh time. Source coverage and dates can be incomplete or change.

The featured release uses that same sidebar snapshot, prioritizing upcoming releases by followed artists and otherwise showing the next dated release. Images are loaded from the original release, Soompi article metadata, YouTube thumbnails, or Wikipedia artist images when available; missing artwork is shown as a neutral placeholder. The dashboard follows the site-wide theme and reduced-motion preferences.

## Reddit shortcuts

The K-Pop, Sports, Anime, Movies, and Video Games channels link to r/kpop, r/nba, r/anime, r/movies, and r/gaming by default. Enter another subreddit and select **Set** to change the link; **Remember on this device** saves that channel's selection in local browser storage. The shortcut opens Reddit directly and does not require Reddit API credentials or server setup.

The Sports channel's NBA and NFL scoreboards include game detail tabs for team stats, box scores, play-by-play, game flow, and YouTube highlights. Availability depends on ESPN's game data; highlights require a YouTube API key in the site's settings.

NBA featured player cards also show regular-season rebounds, assists, blocks and steals per game, plus shooting percentages for the game's season when ESPN provides them. Season averages are cached in memory for five minutes and may differ from the game-specific statistic shown on the card.

On the main Sports page, the featured matchup, selected-day upcoming games, and game leaders reuse the active scoreboard response. The featured matchup prioritizes followed NBA teams, then live, upcoming, and completed games. The matchup panel and injury report use the selected game's existing ESPN summary; pregame statistics are labeled separately from in-game statistics. Game leaders are ESPN's per-team game leaders for the selected date, so ties or players who were not a team's reported leader may be omitted. Upcoming games cover the selected scoreboard date, not a separate future schedule.

The compact standings and news use ESPN's NBA or NFL feeds, cached in memory for ten minutes. The standings link opens the existing NBA standings page or ESPN's NFL standings. The existing NBA team-follow controls and saved preferences are reused; NFL team following is not currently supported. Live scoreboards refresh every 30 seconds while Sports is visible; otherwise they refresh every five minutes. MLB, NHL, soccer, projected lineups, and statistics not provided by the existing NBA/NFL data are not displayed.

The full NBA standings page shows both conferences in separate groups within one sortable table, with home, away, division, conference, recent-game, streak, and scoring figures. Sorting applies within each conference, record columns sort by win percentage, and games behind is relative to each conference. Its optional advanced view loads ESPN regular-season team statistics on demand and calculates effective field goal percentage and true shooting percentage from season totals; unavailable team data can be retried.

Select a player portrait to open their profile and season statistics. NFL profiles include a category selector and historical regular-season stats, including team splits where available.

NBA standings, scorecards, and game details link to team pages at `#sports/nba/teams/<team-slug>`. The team pages use ESPN standings, roster, regular-season statistics, schedules and news; they include the team's full conference standings, player profile links and links back to a game's scoreboard details. The next-opponent card links to the opponent's team and ESPN's reported scoring leader when available. Team and player responses are cached in memory for five minutes. Team colors are accents only; the site's appearance settings remain in control of the theme.

The team stats view computes eFG%, true shooting percentage, turnover percentage and free throw rate from ESPN's season totals, with formulas shown on the page. Possession-based ratings, pace, opponent rebound percentage, league-wide rankings and averages, and game-window or home/away stat filters are not yet available in the team view. The depth tab groups players by ESPN roster position and does not imply a starter or depth order. Roster injury availability depends on the roster feed and is not a complete official injury report; team comparisons are not predictions.

## Politics

Politics displays the latest eight House and Senate roll-call votes from the House Clerk and Senate, with official timestamps, member votes and party breakdowns. Current seated party counts and vacancies come from the Clerk's voting-district list and the Senate's current member list, independently timestamped. Senate committee hearings are listed when published; links to the official House and Senate floor calendars are provided. The threshold calculator is illustrative.

The Pages workflow refreshes each source independently and restores the most recent snapshot from the GitHub Actions cache. A failed source retains its previous data and timestamp when a cache is available; data older than 48 hours is marked stale. On a first run with no successful snapshot, the affected section is unavailable. The cache is subject to GitHub's retention and eviction policies.

To enable Bill Watch, add a repository Actions secret named `CONGRESS_GOV_API_KEY` from Congress.gov. The key is sent only to Congress.gov during the workflow and is not included in the published snapshot. Bill Watch searches the latest 20 published bill records, not the entire Congress.gov catalog. Saved bills remain on the device even after they leave the snapshot. Full text and further details are linked on Congress.gov rather than embedded.

### Political news

The Politics overview has a **Political news** feed (next to Today in Politics, with This Week below them) with recent headlines from The Hill, Politico, Punchbowl News, Roll Call and Axios, newest first, with a filter for each outlet. `scripts/update_politics_news.py` reads each outlet's public RSS feed when the site is published and keeps the last 7 days (up to 15 stories per outlet). The Hill comes from its Senate, House, Administration and Campaign feeds; Axios has no politics-only feed, so its main feed is narrowed to political headlines; Punchbowl News items are its newsletter editions, titled with each edition's lead story. Only headlines, times and short summaries are saved, and every story links to the outlet (some need a subscription). If an outlet's feed fails, its earlier stories are kept and the feed says so. Run `python3 -m unittest scripts/test_update_politics_news.py` to test it.

### Members of Congress

The **Members of Congress** tab (`#politics/members`) lists every senator, representative and delegate. Search by name or state, and filter by chamber, party and committee. **Your delegation** shows your state's senators and your representative; pick your district (or look it up with your ZIP code on house.gov), and the choice is saved on this device only. Each member has a shareable profile at `#politics/members/<Bioguide ID>` with:

- Party, state or district, leadership roles, the year they entered Congress, and when the seat is next up for election.
- Washington office, phone, website, contact form, and social media accounts.
- Committee and subcommittee assignments, with chair, vice chair and ranking member roles. A House ranking member is the minority party's top-ranked member of the committee.
- A voting record for up to the 50 most recent roll calls in their chamber this session: votes cast and missed, and how often they voted with the Republican and Democratic majorities. This is a recent sample, not a full career record.
- Sponsored and cosponsored bill totals and their 5 most recent sponsored bills, linked to Congress.gov.

`scripts/update_congress_members.py` builds `data/congress-members.json` during the daily Pages workflow. Members, offices, committees and votes come from the House Clerk and Senate.gov; terms, leadership roles and bills come from the Congress.gov API using the `CONGRESS_GOV_API_KEY` secret (each member's bills are refreshed weekly and terms monthly, spread so each daily run updates about a seventh of members); photos come from the Biographical Directory of the U.S. Congress. Social media accounts are the one non-government source: the volunteer-maintained [@unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) list, matched by Bioguide ID. Each source refreshes independently and keeps its last data if a refresh fails. Without the API key, terms and bills keep their last saved values. Run `python3 -m unittest discover -s scripts -p 'test_update_congress_members.py'` to test the parsers.

### Election maps

The **Election maps** tab (`#politics/elections/<president|senate|house>/<year>`) maps presidential results by state for 1980–2024 and midterm results for 1982–2026: Senate races by state and House races by congressional district, drawn with the district lines used in that election. Use the slider or arrows to step through the years. States and districts are colored by winner and shaded by margin; select one, or use the results table under the map, for candidates, votes and margins. House maps can zoom to a state. Presidential years show electoral and popular votes, including split electoral votes and faithless electors. Midterm years show each chamber's party balance before and after the election (from the Senate Historical Office and the House Office of the Historian) and the Senate seats that changed party.

Historical results come from the MIT Election Data and Science Lab's datasets, which a university research lab compiles from official state results (president and Senate, 1976–2024; House, 1976–2018), and the FEC's official 2022 House results. District lines for 1982–2014 come from the UCLA congressional district boundaries project (Lewis, DeVine, Pitcher and Martis); lines for 2018, 2022 and 2026 and the state outlines come from the U.S. Census Bureau. `scripts/build_election_maps.py` built `data/elections/` from these sources once; it needs Node.js for mapshaper and is rerun only to change the historical data. It checks every year's electoral votes against the official totals. Where the House source data lists a winner's party incorrectly or not at all, the build corrects it from Congress.gov's member records, but not for members who later switched parties.

Known gaps: the 1982–1990 maps have no boundary for New York's 33rd District (its result is in the table), and Senate party changes are measured against each seat's previous election, with appointments, odd-year specials and party switches added from the Senate Historical Office.

**2026 results are preliminary.** No official or academic compilation exists until states certify, so `scripts/update_election_2026.py` reads Wikipedia's 2026 House and Senate election articles during the daily Pages workflow. The page labels these results as preliminary, credits Wikipedia (CC BY-SA 4.0), and shows races not yet called. Many called races have no vote shares on Wikipedia yet; those use the middle shade. If Wikipedia can't be read, the last saved results stay. Run `python3 -m unittest discover -s scripts -p 'test_build_election_maps.py'` to test the parsers.

The optional editorial list is `data/politics-stories.json`: an array of objects with `title`, `date`, `source`, `url`, `what`, `affected`, and `next`. Only sourced, dated stories with all three context fields are displayed. The file starts empty; the site does not generate editorial claims.

**Midterm detail:** every midterm's House and Senate page opens with a "midterm at a glance" box: the sitting president and party, how many House and Senate seats the president's party gained or lost, House votes by party with the margin and the swing since the previous midterm, and the Senate seats that changed party (special elections marked). **All midterms** (`#politics/elections/midterms`) compares every midterm since 1982 side by side, with charts of the president's party's House and Senate seat changes and a table of results. Everything comes from the same result files as the maps (`scripts/build_midterm_summary.py` writes `data/elections/midterm-summary.json` each time the site is published). House votes are summed from district results, so they're the votes counted in this data rather than an official national popular vote (some states don't report votes for unopposed candidates). 2026 stays marked preliminary: House seats are those called so far and Senate changes come from seats that flipped.

## Bowling

Bowling (`#bowling`) is a personal league-night log. Each session defaults to today's local date and three games; you can change the date, add or remove games for practice or tournaments, and record an optional league, bowling center, session type (League, Practice, Tournament), starting ball and notes. The League menu lists the leagues set up in League tracker; a new session starts with the league that bowls on today's weekday (or your last session's league), and choosing a league fills in its center. Scores must be whole numbers from 0 to 300; leave unfinished games blank. Add any number of adjustments to a game, each with an optional ball switch, a move or release change, and what happened afterward.

The arsenal stores each ball's name, layout, surface and notes as free text (for example `5 × 4.5 × 3.5` or `4000 grit + polish`). Black Venom, Motiv Nebula and C300 Pulse are offered as optional quick-add entries. Retire a ball to move it below active balls in the session form; sessions keep the ball name, layout and surface recorded that night even after the ball is edited or retired.

The dashboard's average, games bowled and high game are calculated across individual scored games, so sessions with different game counts are weighted correctly. The series trend chart and high series only include three-game sessions with all three games scored. History is newest first and can be filtered by session type, by any ball used (starting ball or switch), and by text in notes and adjustments.

### Score tracker

**Score tracker** (`#bowling/scorer`) scores a game frame by frame as you bowl. For each throw, tap the pins left standing (or press 1–9 and 0 for the 10 pin) and record it; no pins selected records a strike on a full rack or a spare on the second ball, and **Gutter**/**Missed** records a ball that hit nothing. The scoresheet shows marks, circled splits and running totals, with the highest score still possible. **Undo last throw** steps back, and the game in progress is kept on this device until you finish it. **Bowling for** picks a league from the League tracker (it starts on tonight's league), practice or a tournament, and the tracker shows that day's games and series total as you go. Each finished game saves to that day's session for the league, creating it with the league and center the first time, so games 1, 2 and 3 land in one series; **Score games** on a League tracker card opens the tracker set to that league. You can also save a game to a recent session, filling its first unscored game. Games sync with the rest of your bowling data. **Strike ball** and **Spare ball** (picked from your arsenal) are recorded with each throw from then on, so switching balls mid-game is captured and marked on the scoresheet; the spare ball defaults to your strike ball. Turn on **Track pocket hits** to mark each first ball as a pocket hit or a miss. It's optional per throw, and skipped throws don't count toward carry. Tracked games show their scoresheet in History, and the **Spares and leaves** panel adds up strike rate, spare conversion, single-pin and split conversion, first-ball average and your most common leaves. Changing a tracked game's score by hand in the session form drops its frames.

### Stats

**Stats** (`#bowling/stats`) breaks down your scores, filtered by time (all time, last 10 sessions, last 90 days or this year), session type and league. From every scored game it shows your average, high game and series, 200+ games, consistency (how far games typically land from your average), each night's average with a 5-night average, your average by game number, and how many games fell in each score range. Games kept in the Score tracker add strike and spare rates (and a chart of both by night), open frames per game, clean games, doubles, single-pin and split conversion, how often each pin is left after the first ball and how often you pick it up, and your most common leaves. **By ball** compares your balls: games, average, strike rate, pins per first ball, carry (strikes out of pocket hits) and most common leaves, plus spare conversion, single pins, 10 pins and 7 pins for each ball you shot spares with. Throw-level numbers come from Score tracker games with a ball picked; averages also count League night games under the ball you started with or switched to. Balls with under 5 games or 10 spare chances are flagged. Arsenal cards show each ball's average, strike, carry and spare rates. Every chart has a data table. Run `node tests/bowling-stats.test.js` to test the calculations.


**League tracker** (`#bowling/leagues`) is where you set up each league once: its name, bowling center, night, start time, season dates and team. Each league card shows its average, weeks bowled, high game and high series, tracked-game strike and spare rates, and a week-by-week table of scores. **Log a session** opens League night with that league selected. Renaming a league updates the name on past sessions; archiving one at the end of a season hides it from the League menu while its sessions keep it. Leagues sync with the rest of your bowling data.

### Ball database and release calendar

**Ball database** (`#bowling/balls`) lets you search balls from Storm, Roto Grip, 900 Global, Brunswick, Hammer, Ebonite, Track, Radical, DV8, Columbia 300 and Motiv released since January 2020. Filter by brand, cover type (solid, pearl, hybrid, urethane, polyester), symmetric or asymmetric core, and release year. Each ball shows its RG and differential, plus intermediate differential when the core is asymmetric. Specs are for one weight, shown with the numbers: 15 lb where the manufacturer lists it, and 16 lb for Storm, Roto Grip and 900 Global, whose pages list only 16 lb. Add a ball to your arsenal from the database, or use **Find specs** on an arsenal ball to link it. Linked specs are copied to the arsenal entry and sync with it. A ball added from the database starts with its factory finish as its surface.

**Release calendar** (`#bowling/releases`) shows release dates by month with a brand filter, alongside upcoming and recent releases. Manufacturers usually announce balls a few weeks ahead, so the calendar mostly covers recent releases.

`scripts/update_bowling_balls.py` builds `data/bowling-balls.json` from manufacturer websites: Storm's ball feed and product pages (which cover Roto Grip and 900 Global), the Brunswick, Radical and DV8 product sitemaps and pages, the Hammer, Ebonite, Track and Columbia 300 store product feeds and pages, and Motiv's ball catalog (current and retired balls) and ball pages, which give each ball's exact release date and specs for every weight. If Motiv's site can't be read, that refresh falls back to Bowling.com's Motiv listing, which is labeled as retailer data and gives release months rather than exact days. The Pages workflow refreshes it daily and keeps the last copy in the GitHub Actions cache. Each run fetches only new or changed pages, waits between requests (10 seconds on Storm's site, as its robots.txt asks, and 3 seconds on Motiv's site and Bowling.com), and caps fetching at 40 minutes per run. A brand that can't be refreshed keeps its last data and is labeled on the page.

Manufacturer listings can be incomplete. Storm's feed covers mostly 2023 and later, so older Storm, Roto Grip and 900 Global balls may be missing. Feed entries whose product page no longer exists keep their release date but have no specs and link to Storm's ball catalog. Balls whose manufacturer page doesn't list numbers, such as many spare balls, show dashes. Run `python3 -m unittest discover -s scripts -p 'test_update_bowling_balls.py'` to test the parsers.

Bowling logic lives in `bowling.js`. Sessions and arsenal entries are stored in browser storage and, when signed in, sync as part of the account state. Each session and ball has a stable ID and edit time; edits merge per record (the newest edit wins) and deleted sessions are remembered, so another device's stale copy does not bring them back.

## Music Lab

Music Lab (`#music`) is a research space for producers, songwriters and the credits behind songs, plus a personal listening library.

- **Dashboard** (`#music`): a featured producer or songwriter (rotating daily), recently released albums with documented credits, featured collaborations (pairs who share the most credited recordings), recently explored pages, people you follow, and saved albums and discoveries. The search box on every Music Lab page searches songs, albums, artists and credited people.
- **Producers & songwriters** (`#music/people`, `#music/person/<MusicBrainz artist ID>`): profiles with aliases, photo and biography when Wikidata links them, a per-role credit summary, and a chronological discography of credited songs filterable by role, performing artist, year and title. Roles are kept distinct: songwriting (writer, lyricist), composition, production, vocal production, arrangement, engineering, programming, performance and remix. Any MusicBrainz artist can be opened; people outside the tracked list load live, and **Load song details** fetches their songs' artists, dates and albums on request.
- **Collaboration network** (`#music/network/<ID>`): an ego graph of everyone who shares a credited recording with the selected person (performing artists, co-writers, co-producers, engineers), filterable by the person's role and by year, with zoom, pan, and a keyboard-accessible connection list. Selecting a connection lists the shared songs and links to profiles.
- **Song pages** (`#music/song/<recording ID>`): artwork, performing artists, release date, album, writers, composers, producers, arrangers, engineers and other credits, Spotify/Apple Music/YouTube links, and related songs that share a writer, producer or engineer.
- **Album pages** (`#music/album/<release ID>`, or `#music/group/<release-group ID>` to pick the main release): release details, the full track list with each track's credits, and your rating and review.
- **My library** (`#music/library`): 1–10 ratings, saved songs and albums, followed people, discoveries, listening notes and reviews, listening lists, and your credit additions.

### Data sources and accuracy

- **MusicBrainz** (CC0) is the backbone and supplies stable IDs for people, songs and albums. Writing credits come from the song's *work* (writer, lyricist, composer); production, arrangement, engineering and performance credits come from the *recording*. A composer is never shown as a producer. MusicBrainz has no vocal-production credit type.
- **Discogs** (official API) adds credits transcribed from album booklets and liner notes, including roles MusicBrainz lacks such as `Producer [Vocals]` (shown as vocal production) and per-track recording, mixing and mastering engineers. Releases are found through the Discogs links MusicBrainz stores on releases, release groups and people, not by searching names; tracks are matched by title within the release. Credits a tracked person has on Discogs releases MusicBrainz doesn't link appear on their profile as "Discogs only" rows linking to Discogs. Non-musical roles (A&R, management, art direction, legal) are dropped.
- **Genius** (official API) adds community-edited writer, producer and custom roles (vocal producer, mixing engineer…). A song is accepted only when its title and a performing artist match. Genius credits are labeled as community-edited.
- Every credit shows its source (MB, Discogs, Genius), and the profile and network have a Source filter. Versions of the same song (explicit and clean recordings, singles, vinyl pressings) are merged into one row per title and lead artist, and the collaboration network counts each shared song once. Discogs and Genius names are linked to a Music Lab profile only through a person's Discogs ID, a MusicBrainz credit on the same recording, or a tracked person's name or alias.
- **Cover Art Archive** supplies artwork; **Wikidata, Wikimedia Commons and Wikipedia** supply a photo (with its author and license) and biography when MusicBrainz links a Wikidata item. Otherwise the profile shows a short factual summary from the MusicBrainz record.
- **Apple's iTunes Search API** is used to find an Apple Music link for a song when MusicBrainz doesn't list one; only an exact title and artist match counts. Other listening links fall back to clearly labeled searches.
- Credit databases are incomplete. Missing roles show as "Not documented" rather than being guessed. On a song page you can add a missing credit with a required source link; additions are labeled **unverified**, kept apart from MusicBrainz data, and appear on the matching profile.

Optional repository secrets: `DISCOGS_TOKEN` (a Discogs personal access token from Settings → Developers; without it Discogs is read anonymously at 25 instead of 60 requests a minute) and `GENIUS_ACCESS_TOKEN` (a client access token from genius.com/api-clients; without it Genius credits aren't refreshed and the last saved ones stay). Both are used only by the build, never by the page. Discogs data is reused for 60 days and Genius data for 30; songs with no match are retried after 14 days.

`scripts/update_music_lab.py` builds `data/music-lab.json` during the daily Pages workflow for the people in `scripts/music_lab_people.json` (stable MusicBrainz IDs, chosen by checking each candidate's credits and links). It spaces MusicBrainz requests a second apart, retries busy (503) responses with backoff, stops at a request and time budget, and reuses song details fetched in the last 30 days, so each run only fetches new credits and a slice of stale ones. Add someone by appending their name and MusicBrainz artist ID. FVBII has no MusicBrainz record yet (the closest result, FVBIIAN, is a different artist), so the profile says so instead of borrowing a lookalike. In the browser, live lookups go through a queue of one request per second with retries and a seven-day local cache. No API keys are needed, and none are used in the page. Run `python3 -m unittest discover -s scripts -p 'test_*music_lab*.py'` to test the builder and the Discogs and Genius parsers.

Your library (ratings, saved items, follows, notes, lists, discoveries and credit additions) is stored in this browser and syncs through your Seven Channels account, merging per record so edits on different devices don't overwrite each other. Recently explored pages sync along with your next library change.

### K-Pop links

**K-pop-adjacent artists:** KPOP OFFICIAL doesn't cover every artist K-pop fans follow (XG is a Japanese group based in South Korea). Artists listed in `scripts/kpop_extra_artists.json` get their releases from MusicBrainz (`scripts/update_kpop_extra.py`, saved to `data/kpop-extra.json` each time the site is published). They appear in the K-Pop release calendar and upcoming releases, labeled as added from MusicBrainz and linked to their credits in Music Lab, and show under your followed artists. XG is also a Music Lab profile (`scripts/music_lab_people.json`).

K-Pop release calendar entries have a **Credits** link: it opens the album in Music Lab when the snapshot has a matching album by that artist, and a Music Lab search (which includes MusicBrainz) otherwise. The MusicBrainz discography browser in K-Pop links each artist and album to Music Lab by its MusicBrainz ID. Music Lab doesn't duplicate the K-Pop release calendar.

## Creator Studio

Creator Studio (`#creator`) is a production headquarters for a YouTube channel. Everything you create is saved in this browser and syncs through your Seven Channels account, merging per record so edits on two devices don't overwrite each other.

- **Dashboard** (`#creator`): subscribers and total channel views (only from a connected channel or stats you enter), recent uploads, recent performance (views, views per day since publishing, engagement), the next 14 days of planned posts, videos awaiting editing, unpublished Shorts and approved clips, the idea backlog, and recent production activity.
- **Channel** (`#creator/channel`): connect your channel by @handle, URL or channel ID. Refreshing pulls the subscriber count (unless the channel hides it), total views, and your latest 50 uploads with titles, thumbnails, publish dates, durations, views, likes and comments, and records that day's totals as a snapshot. You can also enter totals by hand.
- **Video library** (`#creator/library`): every video with thumbnail, dates, length, views, likes, comments, engagement rate ((likes + comments) ÷ views), category, production status (Idea, Planned, Recorded, Editing, Ready, Published), notes and associated Shorts. Add, edit and delete records; search, filter by status, format and category, and sort. Imported uploads of 3 minutes or less start out marked as Shorts.
- **Clip workspace** (`#creator/clips`): import a YouTube link (or add any video by hand) and watch it in YouTube's official embedded player. Mark moments (M), set in and out points (I and O), trim clips by dragging their handles on the timeline or typing exact times, and use arrow keys on a selected handle (Shift for 5 s, Alt for 0.1 s). Each clip has a label (funny reaction, musical analysis, strong opinion, surprising moment, final verdict), a 1–5 potential rating, hook, title, caption, hashtags, notes, status and destination platform. Clicking a clip, moment, chapter or transcript line seeks the player. Chapters load from the video's description (with an API key) or can be pasted; transcripts are imported by pasting or opening an SRT, WebVTT or timestamped text file. **Export CSV** writes each clip's source URL, in and out points (time, seconds and timecode at 24/25/30/60 fps), title, label, status and notes for use as a cut list or marker reference in DaVinci Resolve. Creator Studio doesn't transcribe audio, analyze faces or video, or render video files. Videos whose owners block embedding show a link to YouTube instead, and times can be entered by hand.
- **Calendar** (`#creator/calendar`): month, week and list views of YouTube uploads, Shorts, TikToks, Instagram Reels and livestreams, color-coded by type with text labels. Ideas and library videos with a planned date appear dashed. Drag items to another day to reschedule (or use the date pickers in the list view), and mark posts as draft, scheduled or published.
- **Ideas** (`#creator/ideas`): title, category, description, priority, target platform, production status, notes, an associated music release or event, and a planned publishing date, with search, filters and sorting. An idea can become a planned video or be scheduled.
- **Analytics** (`#creator/analytics`): total views and subscribers over time, subscriber changes between snapshots, views by video, engagement rate, per-video views over time, Shorts vs long-form (median views) and best-performing categories. Charts only use recorded snapshots and refreshed counts; anything without enough data says so. YouTube's public API has no historical totals, so history starts when you connect or begin entering stats.

### APIs and setup

- **Public data** uses the YouTube Data API v3 with the key saved in the page's YouTube settings (the same browser-only key the Sports channel uses for highlights). It isn't synced or committed. Restrict it to the YouTube Data API v3 and your site's address in Google Cloud. A channel refresh uses about 3 quota units.
- **Private analytics** (watch time, retention, impressions, click-through rate) need the YouTube Analytics API with Google sign-in, which requires a server to keep the OAuth client secret and refresh token out of the static site. It isn't set up; [docs/creator-studio-oauth.md](docs/creator-studio-oauth.md) describes an optional Supabase Edge Function design. Until then these metrics are labeled unavailable.
- **Embedded playback** uses YouTube's IFrame Player API (`https://www.youtube.com/iframe_api`).
- Run `node tests/creator-studio.test.js` to test the time, transcript and chapter parsing, CSV export and sync merging.

### Connections to other channels

- **Music Lab**: song and album pages have **Reaction idea → Creator Studio**, which adds an idea linked back to that page. The idea form suggests albums and songs you've saved, rated or discovered in Music Lab.
- **K-Pop**: release calendar entries have **+ Idea**, which adds a comeback reaction idea linked to the release's Music Lab credits.
- **Live Events**: concerts you're planning to attend in Live Events (Interested through Attending) appear on the calendar page as vlog ideas, linked to their event pages.

These links are optional; Creator Studio works on its own.

## Live Events

Live Events (`#live`) helps you find concerts, follow artists' tours, plan trips and keep a journal of every show you've seen. Planner entries, journal entries and followed artists save in this browser and sync through your Seven Channels account, merging per record with deletions kept so they don't come back.

- **Dashboard** (`#live`): concerts attended, upcoming plans, artists followed, the artist you've seen most, a countdown to your next concert, upcoming shows from artists you follow, recently announced shows (ticket sales that opened in the last 3 weeks or haven't opened yet), shows near your saved location, your past concerts and favorite artists.
- **Discover** (`#live/discover`): search Ticketmaster by artist, city, country, date range and genre, and filter the results by venue. List and calendar views. Cancelled, postponed and rescheduled shows are labeled.
- **Default follows:** XG is followed for you the first time Live Events opens in a browser, by MusicBrainz ID. With a Ticketmaster key, it's linked to Ticketmaster automatically when exactly one Ticketmaster artist carries the same MusicBrainz ID; otherwise the artist page asks you to pick. Unfollowing it sticks.
- **Artists** (`#live/artists`): search for an artist, pick the right match (each candidate shows its genre, number of upcoming shows and MusicBrainz link), and follow it. Follows are stored with Ticketmaster and MusicBrainz IDs, not names. **Import from K-Pop** lists the artists you follow in the K-Pop channel; for each, **Find on Ticketmaster** shows candidates to choose from, so no artist is matched automatically by name. An artist page lists upcoming shows, flags newly announced tours and shows recent setlists.
- **Event pages** (`#live/event/<id>`): poster, date and local time, lineup with follow buttons, venue with a map, ticket link, a copyable link to the page, and your private plan. **Add to concert journal** fills a journal entry from the event.
- **Planner** (`#live/planner`): each event can be Interested, Planning, Ticket Purchased, Attending, Attended or Cancelled, with ticket price, extra expenses, currency, seat, travel, hotel, friends going and notes. Statuses are color-coded and labeled with text. Planner details are private and never appear on shared event pages.
- **Concert journal** (`#live/journal`): date, artist, venue, city, country, tour, seat, price, a 1–10 rating, favorite flag, notes, photo links, opening acts and the setlist. **Find this show on setlist.fm** imports the setlist for the artist and date from the snapshot; edited setlists are labeled as edited by you. Search and filter by year.
- **Map** (`#live/map`): your journal entries on an OpenStreetMap map, grouped by venue, filterable by year and country, with a list version. Entries only appear if they have coordinates from Ticketmaster or from a venue you picked in an OpenStreetMap search. Coordinates are never guessed, and the number of entries without a location is shown.
- **Settings** (`#live/settings`): Ticketmaster key, your location (searched on OpenStreetMap or from the browser, rounded to about 1 km), search radius and data source status.

### Data sources and setup

- **Ticketmaster Discovery API** for events, venues and artists. Get a free Consumer Key at [developer.ticketmaster.com](https://developer.ticketmaster.com/) (My Apps) and paste it in Live Events settings. It is saved only in this browser (not synced or committed) and is visible to anyone using the browser, so use a key just for this site. The free tier allows 5,000 calls a day and 5 a second; results are cached for 3 hours. Event data and ticket links come from Ticketmaster and are labeled.
- **setlist.fm** doesn't allow requests from browsers, so a GitHub Actions step (`scripts/update_setlists.py`) saves recent setlists to `data/setlists.json` each time the site is published. Request an API key at [setlist.fm](https://www.setlist.fm/settings/api) (non-commercial use), add it as the `SETLISTFM_API_KEY` repository secret, and list artists by MusicBrainz ID in `scripts/live_events_artists.json` (each artist page has a line to copy). Without a key the file stays empty and the site says setlists aren't set up. Setlists link back to setlist.fm.
- **OpenStreetMap**: maps use Leaflet 1.9.4 with OpenStreetMap tiles, and venue and location searches use Nominatim (no more than one request a second, started only by you). Map data © OpenStreetMap contributors.
- Your location and planner never leave your browser except through your own sync account. Location searches send only the place name you type.
- Run `node tests/live-events.test.js` for setlist parsing, record validation and sync merging, and `python3 -m unittest scripts/test_update_setlists.py` for the setlist snapshot.

### Connections to other channels

- **K-Pop**: follows can be imported (matched by you on Ticketmaster, as above).
- **Creator Studio**: planned concerts appear as vlog ideas on the Creator Studio calendar page.

## News columns

Betting, Movies, Anime, Bowling, Music Lab, Creator Studio and Live Events each have a news column on the left (below the content on narrow screens), Sports and K-Pop have one in their left sidebars, and the Guide has **Top headlines** from every channel.

| Channel | Outlets |
| --- | --- |
| Sports (More sports news) | The Athletic, CBS Sports, Yahoo Sports, Bleacher Report (alongside ESPN's NBA/NFL news) |
| K-Pop | Allkpop, The Korea Herald, Billboard K-Pop (alongside Soompi in the right sidebar) |
| Movies | Variety, Deadline, The Hollywood Reporter, IndieWire, Collider, /Film, Screen Rant, TheWrap, Letterboxd Journal |
| Anime | Anime News Network, Crunchyroll News, Anime Corner, MyAnimeList News |
| Bowling | PBA, Bowling This Month, USBC, Storm Bowling |
| Music Lab | Billboard, Pitchfork, Stereogum, Rolling Stone, NME, Consequence, The Fader, Complex, HotNewHipHop, Hypebeast |
| Live Events | Pollstar, Consequence, Billboard Touring, JamBase, Live Nation, Soompi (tour news) |
| Betting | Covers, Action Network, VSiN, The Lines, Legal Sports Report, Sports Handle |
| Creator Studio | YouTube Official Blog, Creator Insider, Tubefilter, The Verge, Social Media Today, TechCrunch, TikTok Newsroom, Instagram, Twitch Blog, Publish Press |

Video Games' news (in its own left column) comes from IGN, GameSpot, Polygon, Kotaku, VGC, PC Gamer and Eurogamer, and Politics' feed from The Hill, Politico, Punchbowl News, Roll Call, NPR, AP, NBC News, CNN, Semafor, NOTUS, Cook Political Report, Split Ticket, Silver Bulletin and Axios.

`scripts/update_channel_news.py` reads each outlet's public RSS or Atom feed when the site is published and saves the last 10 days to `data/channel-news.json` (up to 12 stories per outlet). Outlets without a usable feed of their own come from Google News results limited to their site. Broad feeds are narrowed to the topic (betting odds and picks, tour announcements, creator news). An outlet with nothing new in that window is listed as quiet rather than unavailable. The Guide takes the newest few headlines from each channel. Only headlines, times and short summaries are kept; every story opens on the outlet's site. Considered but left out: Bowlers Journal, Motiv, Bowling.com, Rap-Up and ESPN Betting (no working feed), Otaku USA (no recent posts), and Koreaboo and KpopStarz (mostly gossip). Run `python3 -m unittest scripts/test_update_channel_news.py` to test it.

## Glass appearance

The interface uses the existing theme, background, and accent settings to tint its glass surfaces. Shared `--glass-*` CSS tokens in `index.html` control opacity, blur, border highlights, shadows, radii, and animation timing. Major panels and navigation use standard glass, nested data surfaces use a subtler opaque treatment, and dialogs and custom menus use prominent glass. Browsers without backdrop-filter support receive opaque surfaces instead.

Pointer lighting is limited to selected interactive controls on fine-pointer devices and is disabled for reduced-motion preferences. Native select menus continue to use the browser's platform rendering.

## Betting unit size

Set the dollar value of one unit in the betting dashboard (default $5). Stakes and performance remain stored in units; dollar equivalents use the current setting, including for previously recorded bets. When importing a slip, review the stake in units: extracted dollar amounts are not converted automatically.

## Enable cross-device sync

The app uses Supabase email/password authentication. Each device signs in to the same account. Existing browser entries and K-pop artist follows are merged into that account on first sign-in; subsequent entry, NBA team-follow, K-pop artist-follow, appearance, betting unit size, and Bowling session and arsenal changes are synced to the account. Local browser storage remains as a cache.

1. In the Supabase SQL Editor for the configured project, run [`supabase/schema.sql`](./supabase/schema.sql). The table has row-level security so authenticated users can only read or modify their own row.
2. In **Authentication → URL Configuration**, set the Site URL to `https://siballin.github.io/Seven-Channels/` and add it to the allowed redirect URLs.
3. Keep email/password authentication enabled. Depending on the Supabase email-confirmation setting, confirm the account from the email before signing in.
4. Sign in with the same account on each device.

The Supabase URL and publishable client key embedded in `index.html` are public browser configuration, not secrets. Never place a service-role key, database password, or other secret in this repository. Do not disable row-level security.

The first successful sign-in on a device merges local and cloud entries and K-pop follows. Later updates sync automatically while online; simultaneous edits to the same bet, unit size, or K-pop follow can resolve to the most recently timestamped value.
