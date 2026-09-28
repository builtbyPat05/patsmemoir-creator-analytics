# PatsMemoir Creator Dashboard

A responsive Next.js analytics dashboard for YouTube, Instagram, Facebook, and TikTok. The UI works in two modes:

- **Demo mode:** deterministic sample analytics when no creator is signed in or no imported metrics exist.
- **Supabase mode:** authenticated, owner-scoped analytics loaded from the normalized database tables.

## Run locally

Use Node.js 24 LTS.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

When the lockfile has not changed and `node_modules` already exists, only `npm run dev` is needed.

### macOS and iCloud

If this repository is stored in an iCloud-managed `Documents` folder, mark the project folder **Keep Downloaded**. Offloaded dependency files can make `npm run check` appear frozen even while the dev server still works. A long-term alternative is to keep code under a non-iCloud path such as `~/Developer`.

## Environment

Create the local file once:

```bash
cp .env.example .env.local
```

Required for public Supabase access and authentication:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Required only for privileged connector routes and sync jobs:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key
```

Never prefix a secret or provider client secret with `NEXT_PUBLIC_`. Restart `npm run dev` after changing `.env.local`.

Check the public connection at [http://localhost:3000/api/health/supabase](http://localhost:3000/api/health/supabase). A successful result includes `"connected": true`.

## Authentication

Open [http://localhost:3000/login](http://localhost:3000/login) to create the private creator account or sign in. Supabase Auth owns the session; a database trigger creates the matching `creator_profiles` row.

The public dashboard is intentionally left available in demo mode while integrations are being configured. Real rows are protected with Row Level Security and are loaded only for their authenticated owner.

## YouTube connector

The first real connector is implemented. It supports:

- Google OAuth with hashed, expiring state validation.
- Offline access and refresh-token rotation.
- Access and refresh tokens encrypted through Supabase Vault.
- Channel metadata, one year of daily channel analytics, uploads, and daily video analytics.
- Normalized post and metric upserts plus sync audit records.
- Manual refresh from the Connections page.

To activate it:

1. Create or select a project in Google Cloud Console.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 **Web application** client.
5. Add this exact local redirect URI:

```text
http://localhost:3000/api/connect/youtube/callback
```

6. Add the credentials to `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
```

7. Restart the dev server, sign in, and open [http://localhost:3000/settings/connections](http://localhost:3000/settings/connections).

## TikTok connector

The TikTok adapter is implemented with Login Kit and the Display API. It imports the authorized creator profile and complete public-video catalog, stores current cumulative counters as daily snapshots, and derives views, follower changes, and engagement gained between snapshots.

TikTok's Display API does not provide historical daily analytics. The first sync therefore creates an honest baseline; subsequent syncs build the trend lines from real changes. Existing lifetime totals are never mislabeled as one day's performance.

To activate it:

1. Create an app at [TikTok for Developers](https://developers.tiktok.com/).
2. Add **Login Kit** and request approval for `user.info.basic`, `user.info.stats`, and `video.list`.
3. Register this callback path on your deployed HTTPS domain:

```text
https://your-domain.example/api/connect/tiktok/callback
```

TikTok requires an HTTPS redirect URI. For local development, use an HTTPS tunnel and set `NEXT_PUBLIC_SITE_URL` to that tunnel origin.

4. Add the credentials to `.env.local`:

```bash
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

5. Restart the dev server, sign in, and open the Connections page.

## Instagram connector

The Instagram adapter uses Business Login for Instagram and the Instagram Graph API. It supports professional Creator and Business accounts without requiring a linked Facebook Page. It imports current profile totals, up to 90 days of available account insights, one year of media, media-level insights, encrypted long-lived tokens, daily snapshots, and manual refreshes.

Instagram reports `follower_count` as daily new followers and `followers_count` as the current total. Historical totals are therefore reconstructed as estimates and labeled that way in stored metadata; exact totals accumulate from this dashboard's daily snapshots after connection.

To activate it:

1. Create a Meta Business app and add the Instagram product.
2. Configure Business Login for Instagram.
3. Request `instagram_business_basic` and `instagram_business_manage_insights`.
4. Add this callback on your deployed HTTPS domain:

```text
https://your-domain.example/api/connect/instagram/callback
```

Use an HTTPS tunnel for local OAuth and set `NEXT_PUBLIC_SITE_URL` to the tunnel origin.

5. Add the credentials to `.env.local`:

```bash
META_GRAPH_API_VERSION=v25.0
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
```

6. Restart the dev server, sign in, and open the Connections page.

## Facebook connector

The Facebook adapter connects the Pages the signed-in person is allowed to analyze. It exchanges the login token for a long-lived token, stores Page and user tokens in Supabase Vault, imports one year of Page Insights and published posts, records post-level snapshots, and refreshes every connected Page from one Sync action.

To activate it:

1. Add Facebook Login for Business to the Meta app that will own this connector.
2. Request `pages_show_list`, `pages_read_engagement`, and `read_insights`.
3. Confirm your Facebook account has the **Analyze** task on the Page.
4. Add the callback to the app's valid OAuth redirect URIs:

```text
https://your-domain.example/api/connect/facebook/callback
```

Use an HTTPS tunnel for local OAuth and set `NEXT_PUBLIC_SITE_URL` to the tunnel origin.

5. Add the credentials to `.env.local`:

```bash
META_GRAPH_API_VERSION=v25.0
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
```

6. Restart the dev server, sign in, and open the Connections page.

## Database

Versioned SQL is stored in `supabase/migrations`.

Core tables:

- `creator_profiles`: creator settings linked one-to-one with Supabase Auth.
- `social_accounts`: connected platform identities and sync status.
- `content_posts`: normalized videos, reels, posts, and shorts.
- `account_daily_metrics`: daily views, followers, engagement primitives, and publishing counts.
- `post_daily_metrics`: daily performance for individual content.
- `account_metric_snapshots`: cumulative account baselines for APIs without daily history.
- `post_metric_snapshots`: cumulative post baselines used to derive real deltas.
- `analytics_sync_runs`: import history, counts, and failures.
- `oauth_connection_states`: short-lived hashed OAuth CSRF state, server role only.
- `private.social_account_credentials`: references to encrypted Vault secrets, server role only.

Generated TypeScript definitions live in `src/lib/supabase/database.types.ts`.

## Quality checks

```bash
npm run check
npm run build
```

`npm run check` runs ESLint followed by the TypeScript compiler. The current hosted database passes Supabase's security advisor with no findings.

## Code structure

- `src/app`: routes, auth callbacks, health checks, and connector endpoints.
- `src/components/dashboard`: interactive dashboard UI.
- `src/lib/analytics/repository.ts`: Supabase aggregation with explicit demo fallback.
- `src/lib/integrations/youtube`: YouTube OAuth, API parsing, token refresh, and data sync.
- `src/lib/integrations/tiktok`: TikTok OAuth, Display API parsing, token refresh, snapshots, and data sync.
- `src/lib/integrations/instagram`: Instagram OAuth, Graph API parsing, token refresh, insights, snapshots, and data sync.
- `src/lib/integrations/facebook`: Facebook Page OAuth, Page/post insights, encrypted tokens, snapshots, and multi-Page sync.
- `src/lib/supabase`: typed browser, server, proxy, and admin clients.
- `src/lib/dashboard-data.ts`: presentation contracts, formatters, and deterministic demo data.
- `supabase/migrations`: hosted schema history mirrored in source control.
