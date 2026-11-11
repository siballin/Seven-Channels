# Seven Channels

A personal guide app hosted as a static site on GitHub Pages.

## Publish with GitHub Pages

The `main` branch workflow in `.github/workflows/pages.yml` publishes the repository root. In GitHub, open **Settings → Pages**, choose **GitHub Actions** as the build and deployment source, and wait for the workflow to finish. The site URL is:

https://siballin.github.io/Seven-Channels/

The Video Games channel uses a native monthly release calendar populated from [Game Informer's 2026 release schedule](https://gameinformer.com/2026). The Pages workflow refreshes `data/game-releases.json` daily before deploying, including available game-box art. Calendar entries link to Game Informer and the page displays when the data was refreshed.

Use the release-calendar search to find a game's listed date. The month and year selectors jump directly to a calendar view, and selecting a month starts on its first listed release date. Star a game in search results or on its calendar day to save it as a browser-local favorite; favorites are highlighted and sorted before other games on their release date.

The K-Pop channel includes a monthly release calendar sourced live from [KPOP OFFICIAL](https://kpopofficial.com/kpop-comebacks/). Select a day to see its listed releases, available album covers and artist/teaser images, and links to their source pages. Images may be unavailable until announced. Click an artist image or "View artist discography" to see that artist's listed releases, newest first, in the same section. Click any album title or cover to open its track list in a panel that slides in from the right (Escape or Close dismisses it); unreleased albums may not have a track list yet. Older releases are pulled from Apple Music by exact artist-name match, so they can overlap with the listed ones or be missing for some artists. Dates are as listed by the source, can change, and may not cover every release; an internet connection is required.

The Sports channel's NBA and NFL scoreboards include game detail tabs for team stats, players, box scores, play-by-play, game flow, and YouTube highlights. Availability depends on ESPN's game data; highlights require a YouTube API key in the site's settings.

Select a player portrait to open their profile and season statistics. NFL profiles include a category selector and historical regular-season stats, including team splits where available.

## Glass appearance

The interface uses the existing theme, background, and accent settings to tint its glass surfaces. Shared `--glass-*` CSS tokens in `index.html` control opacity, blur, border highlights, shadows, radii, and animation timing. Major panels and navigation use standard glass, nested data surfaces use a subtler opaque treatment, and dialogs and custom menus use prominent glass. Browsers without backdrop-filter support receive opaque surfaces instead.

Pointer lighting is limited to selected interactive controls on fine-pointer devices and is disabled for reduced-motion preferences. Native select menus continue to use the browser's platform rendering.

## Betting unit size

Set the dollar value of one unit in the betting dashboard (default $5). Stakes and performance remain stored in units; dollar equivalents use the current setting, including for previously recorded bets. When importing a slip, review the stake in units: extracted dollar amounts are not converted automatically.

## Enable cross-device sync

The app uses Supabase email/password authentication. Each device signs in to the same account. Existing browser entries are merged into that account on first sign-in; subsequent entry, NBA team-follow, appearance, and betting unit size changes are synced to the account. Local browser storage remains as a cache.

1. In the Supabase SQL Editor for the configured project, run [`supabase/schema.sql`](./supabase/schema.sql). The table has row-level security so authenticated users can only read or modify their own row.
2. In **Authentication → URL Configuration**, set the Site URL to `https://siballin.github.io/Seven-Channels/` and add it to the allowed redirect URLs.
3. Keep email/password authentication enabled. Depending on the Supabase email-confirmation setting, confirm the account from the email before signing in.
4. Sign in with the same account on each device.

The Supabase URL and publishable client key embedded in `index.html` are public browser configuration, not secrets. Never place a service-role key, database password, or other secret in this repository. Do not disable row-level security.

The first successful sign-in on a device merges local and cloud entries. Later updates sync automatically while online; simultaneous edits to the same bet or unit size can resolve to the most recently timestamped value.
