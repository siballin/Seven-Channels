# Seven Channels

A personal guide app hosted as a static site on GitHub Pages.

## Publish with GitHub Pages

The `main` branch workflow in `.github/workflows/pages.yml` publishes the repository root. In GitHub, open **Settings → Pages**, choose **GitHub Actions** as the build and deployment source, and wait for the workflow to finish. The site URL is:

https://siballin.github.io/Seven-Channels/

The Video Games channel uses a native monthly release calendar populated from [Game Informer's 2026 release schedule](https://gameinformer.com/2026). The Pages workflow refreshes `data/game-releases.json` daily before deploying, including available game-box art. Calendar entries link to Game Informer and the page displays when the data was refreshed.

Use the release-calendar search to find a game's listed date. The month and year selectors jump directly to a calendar view, and selecting a month starts on its first listed release date. Star a game in search results or on its calendar day to save it as a browser-local favorite; favorites are highlighted and sorted before other games on their release date.

## Enable cross-device sync

The app uses Supabase email/password authentication. Each device signs in to the same account. Existing browser entries are merged into that account on first sign-in; subsequent entry, NBA team-follow, and appearance changes are synced to the account. Local browser storage remains as a cache.

1. In the Supabase SQL Editor for the configured project, run [`supabase/schema.sql`](./supabase/schema.sql). The table has row-level security so authenticated users can only read or modify their own row.
2. In **Authentication → URL Configuration**, set the Site URL to `https://siballin.github.io/Seven-Channels/` and add it to the allowed redirect URLs.
3. Keep email/password authentication enabled. Depending on the Supabase email-confirmation setting, confirm the account from the email before signing in.
4. Sign in with the same account on each device.

The Supabase URL and publishable client key embedded in `index.html` are public browser configuration, not secrets. Never place a service-role key, database password, or other secret in this repository. Do not disable row-level security.

The first successful sign-in on a device merges local and cloud entries. Later updates sync automatically while online; simultaneous edits to the same bet can resolve to the most recently timestamped entry.
