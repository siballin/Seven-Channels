# Seven Channels

A personal guide app hosted as a static site on GitHub Pages.

The interface uses Manrope for body text and data, with Unbounded for selected headings. Fonts are loaded from Google Fonts with system fallbacks and `font-display: swap`.

## Publish with GitHub Pages

The `main` branch workflow in `.github/workflows/pages.yml` publishes the repository root. In GitHub, open **Settings → Pages**, choose **GitHub Actions** as the build and deployment source, and wait for the workflow to finish. The site URL is:

https://siballin.github.io/Seven-Channels/

The Video Games channel uses a native monthly release calendar populated from [Game Informer's 2026 release schedule](https://gameinformer.com/2026). The Pages workflow refreshes `data/game-releases.json` daily before deploying, including available game-box art. Calendar entries link to Game Informer and the page displays when the data was refreshed.

Use the release-calendar search to find a game's listed date. The month and year selectors jump directly to a calendar view, and selecting a month starts on its first listed release date. Star a game in search results or on its calendar day to save it as a browser-local favorite; favorites are highlighted and sorted before other games on their release date.

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

The optional editorial list is `data/politics-stories.json`: an array of objects with `title`, `date`, `source`, `url`, `what`, `affected`, and `next`. Only sourced, dated stories with all three context fields are displayed. The file starts empty; the site does not generate editorial claims.

## Glass appearance

The interface uses the existing theme, background, and accent settings to tint its glass surfaces. Shared `--glass-*` CSS tokens in `index.html` control opacity, blur, border highlights, shadows, radii, and animation timing. Major panels and navigation use standard glass, nested data surfaces use a subtler opaque treatment, and dialogs and custom menus use prominent glass. Browsers without backdrop-filter support receive opaque surfaces instead.

Pointer lighting is limited to selected interactive controls on fine-pointer devices and is disabled for reduced-motion preferences. Native select menus continue to use the browser's platform rendering.

## Betting unit size

Set the dollar value of one unit in the betting dashboard (default $5). Stakes and performance remain stored in units; dollar equivalents use the current setting, including for previously recorded bets. When importing a slip, review the stake in units: extracted dollar amounts are not converted automatically.

## Enable cross-device sync

The app uses Supabase email/password authentication. Each device signs in to the same account. Existing browser entries and K-pop artist follows are merged into that account on first sign-in; subsequent entry, NBA team-follow, K-pop artist-follow, appearance, and betting unit size changes are synced to the account. Local browser storage remains as a cache.

1. In the Supabase SQL Editor for the configured project, run [`supabase/schema.sql`](./supabase/schema.sql). The table has row-level security so authenticated users can only read or modify their own row.
2. In **Authentication → URL Configuration**, set the Site URL to `https://siballin.github.io/Seven-Channels/` and add it to the allowed redirect URLs.
3. Keep email/password authentication enabled. Depending on the Supabase email-confirmation setting, confirm the account from the email before signing in.
4. Sign in with the same account on each device.

The Supabase URL and publishable client key embedded in `index.html` are public browser configuration, not secrets. Never place a service-role key, database password, or other secret in this repository. Do not disable row-level security.

The first successful sign-in on a device merges local and cloud entries and K-pop follows. Later updates sync automatically while online; simultaneous edits to the same bet, unit size, or K-pop follow can resolve to the most recently timestamped value.
