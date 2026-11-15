# Creator Studio: optional private YouTube Analytics (design)

Creator Studio works without this. It shows public channel data (from the YouTube Data API, using the API key
saved in the browser's YouTube settings) and anything you enter yourself. This document describes how to add
**private** metrics (watch time, average view duration, audience retention, impressions and impression
click-through rate), which only the YouTube Analytics API provides and only after the channel owner signs in
with Google (OAuth 2.0).

**Status: not implemented.** Nothing below is deployed, and the page labels these metrics as unavailable.

## Why it needs a server

The site is static on GitHub Pages, so everything in it is public. An OAuth integration that can fetch analytics
day after day needs:

- an **OAuth client secret** (to exchange the authorization code), and
- a long-lived **refresh token** (to get new access tokens without signing in every hour).

Neither may be shipped to the browser or committed to the repository. They have to live on a server the browser
talks to. The site already uses Supabase for accounts, so a Supabase Edge Function is the natural place.

## Proposed architecture

1. **Google Cloud setup** (one time): create an OAuth client of type *Web application*, enable the *YouTube
   Analytics API* and *YouTube Data API v3*, and add the Edge Function's callback URL as an authorized redirect URI.
   Scopes: `https://www.googleapis.com/auth/yt-analytics.readonly` and `https://www.googleapis.com/auth/youtube.readonly`
   (read-only).
2. **Secrets**: store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Supabase function secrets
   (`supabase secrets set`), never in this repository.
3. **Table** `youtube_tokens` (user_id uuid primary key references auth.users, refresh_token text, channel_id text,
   scope text, updated_at timestamptz) with row-level security enabled and **no** policies for the `anon` or
   `authenticated` roles, so only the service role used inside the function can read it. The browser never sees
   a token.
4. **Edge Function `youtube-oauth`**:
   - `GET /start`: requires the signed-in user's Supabase JWT; creates a random `state` tied to the user (stored
     server-side with a short expiry), and redirects to Google's consent screen with `access_type=offline`,
     `prompt=consent` and PKCE.
   - `GET /callback`: checks `state`, exchanges the code with the client secret, stores the refresh token for that
     user, and redirects back to `#creator/channel`.
   - `POST /disconnect`: revokes the token at Google and deletes the row.
5. **Edge Function `youtube-analytics`**: requires the user's JWT; loads that user's refresh token, gets an access
   token, calls `https://youtubeanalytics.googleapis.com/v2/reports` (e.g. `ids=channel==MINE`,
   `metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,impressions,impressionClickThroughRate`,
   `dimensions=day` or `video`), and returns only the numbers. Cache responses for a few hours to stay inside quota.
6. **Front end**: a "Connect private analytics" button on the Channel page that opens `/start`, and analytics
   charts that call `youtube-analytics` with the Supabase session. If the function isn't configured or returns an
   error, the page keeps showing these metrics as unavailable.

## Notes

- Impressions and impression CTR are reported by the Analytics API for the channel owner only, and may lag by a
  day or two.
- Google requires apps using sensitive scopes to be verified before other people can use them; for a single
  personal channel, keeping the OAuth app in "testing" with your own account as a test user is enough.
- Revoke access any time at https://myaccount.google.com/permissions.
