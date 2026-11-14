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

## Bowling

Bowling (`#bowling`) is a personal league-night log. Each session defaults to today's local date and three games; you can change the date, add or remove games for practice or tournaments, and record an optional league, bowling center, session type (League, Practice, Tournament), starting ball and notes. The League menu lists the leagues set up in League tracker; a new session starts with the league that bowls on today's weekday (or your last session's league), and choosing a league fills in its center. Scores must be whole numbers from 0 to 300; leave unfinished games blank. Add any number of adjustments to a game, each with an optional ball switch, a move or release change, and what happened afterward.

The arsenal stores each ball's name, layout, surface and notes as free text (for example `5 × 4.5 × 3.5` or `4000 grit + polish`). Black Venom, Motiv Nebula and C300 Pulse are offered as optional quick-add entries. Retire a ball to move it below active balls in the session form; sessions keep the ball name, layout and surface recorded that night even after the ball is edited or retired.

The dashboard's average, games bowled and high game are calculated across individual scored games, so sessions with different game counts are weighted correctly. The series trend chart and high series only include three-game sessions with all three games scored. History is newest first and can be filtered by session type, by any ball used (starting ball or switch), and by text in notes and adjustments.

### Score tracker

**Score tracker** (`#bowling/scorer`) scores a game frame by frame as you bowl. For each throw, tap the pins left standing (or press 1–9 and 0 for the 10 pin) and record it; no pins selected records a strike on a full rack or a spare on the second ball, and **Gutter**/**Missed** records a ball that hit nothing. The scoresheet shows marks, circled splits and running totals, with the highest score still possible. **Undo last throw** steps back, and the game in progress is kept on this device until you finish it. A finished game saves to a new session for today or to a recent session, filling its first unscored game; it then syncs with the rest of your bowling data. Tracked games show their scoresheet in History, and the **Spares and leaves** panel adds up strike rate, spare conversion, single-pin and split conversion, first-ball average and your most common leaves. Changing a tracked game's score by hand in the session form drops its frames.

### League tracker

**League tracker** (`#bowling/leagues`) is where you set up each league once: its name, bowling center, night, start time, season dates and team. Each league card shows its average, weeks bowled, high game and high series, tracked-game strike and spare rates, and a week-by-week table of scores. **Log a session** opens League night with that league selected. Renaming a league updates the name on past sessions; archiving one at the end of a season hides it from the League menu while its sessions keep it. Leagues sync with the rest of your bowling data.

### Ball database and release calendar

**Ball database** (`#bowling/balls`) lets you search balls from Storm, Roto Grip, 900 Global, Brunswick, Hammer, Ebonite, Track, Radical, DV8, Columbia 300 and Motiv released since January 2020. Filter by brand, cover type (solid, pearl, hybrid, urethane, polyester), symmetric or asymmetric core, and release year. Each ball shows its RG and differential, plus intermediate differential when the core is asymmetric. Specs are for one weight, shown with the numbers: 15 lb where the manufacturer lists it, and 16 lb for Storm, Roto Grip and 900 Global, whose pages list only 16 lb. Add a ball to your arsenal from the database, or use **Find specs** on an arsenal ball to link it. Linked specs are copied to the arsenal entry and sync with it. A ball added from the database starts with its factory finish as its surface.

**Release calendar** (`#bowling/releases`) shows release dates by month with a brand filter, alongside upcoming and recent releases. Manufacturers usually announce balls a few weeks ahead, so the calendar mostly covers recent releases.

`scripts/update_bowling_balls.py` builds `data/bowling-balls.json` from manufacturer websites, plus one retailer for Motiv: Storm's ball feed and product pages (which cover Roto Grip and 900 Global), the Brunswick, Radical and DV8 product sitemaps and pages, and the Hammer, Ebonite, Track and Columbia 300 store product feeds and pages. Motiv's website refuses automated requests, so Motiv balls come from Bowling.com's Motiv listing and product pages and are labeled as retailer data. Bowling.com gives release months rather than exact days, so those balls appear on the calendar under their month, and it lists only the Motiv balls it currently sells; balls stay in the database after they leave the store. The Pages workflow refreshes it daily and keeps the last copy in the GitHub Actions cache. Each run fetches only new or changed pages, waits between requests (10 seconds on Storm's site, as its robots.txt asks, and 3 seconds on Bowling.com), and caps fetching at 40 minutes per run. A brand that can't be refreshed keeps its last data and is labeled on the page.

Manufacturer listings can be incomplete. Storm's feed covers mostly 2023 and later, so older Storm, Roto Grip and 900 Global balls may be missing. Feed entries whose product page no longer exists keep their release date but have no specs and link to Storm's ball catalog. Balls whose manufacturer page doesn't list numbers, such as many spare balls, show dashes. Run `python3 -m unittest discover -s scripts -p 'test_update_bowling_balls.py'` to test the parsers.

Bowling logic lives in `bowling.js`. Sessions and arsenal entries are stored in browser storage and, when signed in, sync as part of the account state. Each session and ball has a stable ID and edit time; edits merge per record (the newest edit wins) and deleted sessions are remembered, so another device's stale copy does not bring them back.

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
