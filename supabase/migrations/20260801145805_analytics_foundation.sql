create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to service_role;

create type public.social_platform as enum (
  'youtube',
  'instagram',
  'facebook',
  'tiktok'
);

create type public.social_account_status as enum (
  'pending',
  'connected',
  'expired',
  'error',
  'disconnected'
);

create type public.analytics_sync_status as enum (
  'pending',
  'running',
  'succeeded',
  'partial',
  'failed'
);

create type public.analytics_sync_trigger as enum (
  'oauth',
  'manual',
  'scheduled',
  'webhook',
  'backfill'
);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.set_updated_at() from anon;
revoke all on function private.set_updated_at() from authenticated;
grant execute on function private.set_updated_at() to service_role;

create table public.creator_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 120),
  constraint creator_profiles_timezone_length
    check (char_length(timezone) between 1 and 100)
);

create trigger creator_profiles_set_updated_at
before update on public.creator_profiles
for each row execute function private.set_updated_at();

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  platform public.social_platform not null,
  external_account_id text not null,
  handle text,
  display_name text,
  profile_url text,
  avatar_url text,
  status public.social_account_status not null default 'pending',
  scopes text[] not null default '{}'::text[],
  connected_at timestamptz,
  last_synced_at timestamptz,
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_accounts_owner_platform_external_key
    unique (owner_id, platform, external_account_id),
  constraint social_accounts_external_account_id_length
    check (char_length(external_account_id) between 1 and 500),
  constraint social_accounts_handle_length
    check (handle is null or char_length(handle) between 1 and 255),
  constraint social_accounts_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index social_accounts_owner_platform_idx
  on public.social_accounts (owner_id, platform);

create trigger social_accounts_set_updated_at
before update on public.social_accounts
for each row execute function private.set_updated_at();

create table public.content_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  external_post_id text not null,
  content_type text,
  title text,
  caption text,
  permalink text,
  thumbnail_url text,
  pillar text,
  published_at timestamptz not null,
  duration_seconds numeric(12, 3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_posts_account_external_key
    unique (account_id, external_post_id),
  constraint content_posts_external_post_id_length
    check (char_length(external_post_id) between 1 and 500),
  constraint content_posts_duration_nonnegative
    check (duration_seconds is null or duration_seconds >= 0),
  constraint content_posts_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index content_posts_account_published_idx
  on public.content_posts (account_id, published_at desc);

create trigger content_posts_set_updated_at
before update on public.content_posts
for each row execute function private.set_updated_at();

create table public.account_daily_metrics (
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  metric_date date not null,
  views bigint not null default 0,
  follower_count bigint not null default 0,
  follower_delta bigint not null default 0,
  engagements bigint not null default 0,
  reach bigint not null default 0,
  impressions bigint not null default 0,
  profile_views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  watch_time_seconds bigint not null default 0,
  posts_published integer not null default 0,
  engagement_rate_percent numeric(12, 6)
    generated always as (
      case
        when views = 0 then 0::numeric
        else (engagements::numeric / views::numeric) * 100
      end
    ) stored,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  primary key (account_id, metric_date),
  constraint account_daily_metrics_views_nonnegative check (views >= 0),
  constraint account_daily_metrics_follower_count_nonnegative check (follower_count >= 0),
  constraint account_daily_metrics_engagements_nonnegative check (engagements >= 0),
  constraint account_daily_metrics_reach_nonnegative check (reach >= 0),
  constraint account_daily_metrics_impressions_nonnegative check (impressions >= 0),
  constraint account_daily_metrics_profile_views_nonnegative check (profile_views >= 0),
  constraint account_daily_metrics_likes_nonnegative check (likes >= 0),
  constraint account_daily_metrics_comments_nonnegative check (comments >= 0),
  constraint account_daily_metrics_shares_nonnegative check (shares >= 0),
  constraint account_daily_metrics_saves_nonnegative check (saves >= 0),
  constraint account_daily_metrics_watch_time_nonnegative check (watch_time_seconds >= 0),
  constraint account_daily_metrics_posts_published_nonnegative check (posts_published >= 0),
  constraint account_daily_metrics_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index account_daily_metrics_date_account_idx
  on public.account_daily_metrics (metric_date desc, account_id);

create table public.post_daily_metrics (
  post_id uuid not null references public.content_posts (id) on delete cascade,
  metric_date date not null,
  views bigint not null default 0,
  engagements bigint not null default 0,
  reach bigint not null default 0,
  impressions bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  watch_time_seconds bigint not null default 0,
  average_watch_time_seconds numeric(12, 3),
  completion_rate_percent numeric(7, 4),
  engagement_rate_percent numeric(12, 6)
    generated always as (
      case
        when views = 0 then 0::numeric
        else (engagements::numeric / views::numeric) * 100
      end
    ) stored,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  primary key (post_id, metric_date),
  constraint post_daily_metrics_views_nonnegative check (views >= 0),
  constraint post_daily_metrics_engagements_nonnegative check (engagements >= 0),
  constraint post_daily_metrics_reach_nonnegative check (reach >= 0),
  constraint post_daily_metrics_impressions_nonnegative check (impressions >= 0),
  constraint post_daily_metrics_likes_nonnegative check (likes >= 0),
  constraint post_daily_metrics_comments_nonnegative check (comments >= 0),
  constraint post_daily_metrics_shares_nonnegative check (shares >= 0),
  constraint post_daily_metrics_saves_nonnegative check (saves >= 0),
  constraint post_daily_metrics_watch_time_nonnegative check (watch_time_seconds >= 0),
  constraint post_daily_metrics_average_watch_time_nonnegative
    check (average_watch_time_seconds is null or average_watch_time_seconds >= 0),
  constraint post_daily_metrics_completion_rate_range
    check (
      completion_rate_percent is null
      or completion_rate_percent between 0 and 100
    ),
  constraint post_daily_metrics_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index post_daily_metrics_date_post_idx
  on public.post_daily_metrics (metric_date desc, post_id);

create table public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  status public.analytics_sync_status not null default 'pending',
  trigger public.analytics_sync_trigger not null default 'manual',
  range_start date,
  range_end date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_upserted integer not null default 0,
  next_cursor text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_sync_runs_records_nonnegative check (records_upserted >= 0),
  constraint analytics_sync_runs_range_valid
    check (range_start is null or range_end is null or range_end >= range_start),
  constraint analytics_sync_runs_finished_valid
    check (finished_at is null or finished_at >= started_at),
  constraint analytics_sync_runs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index analytics_sync_runs_account_started_idx
  on public.analytics_sync_runs (account_id, started_at desc);

create index analytics_sync_runs_status_started_idx
  on public.analytics_sync_runs (status, started_at desc);

create table private.social_account_credentials (
  account_id uuid primary key references public.social_accounts (id) on delete cascade,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid,
  token_type text,
  scopes text[] not null default '{}'::text[],
  expires_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_account_credentials_metadata_object
    check (jsonb_typeof(provider_metadata) = 'object')
);

comment on column private.social_account_credentials.access_token_secret_id is
  'Identifier returned by vault.create_secret; never store the plaintext provider token here.';

comment on column private.social_account_credentials.refresh_token_secret_id is
  'Identifier returned by vault.create_secret; null when a provider does not issue refresh tokens.';

create trigger social_account_credentials_set_updated_at
before update on private.social_account_credentials
for each row execute function private.set_updated_at();

alter table public.creator_profiles enable row level security;
alter table public.social_accounts enable row level security;
alter table public.content_posts enable row level security;
alter table public.account_daily_metrics enable row level security;
alter table public.post_daily_metrics enable row level security;
alter table public.analytics_sync_runs enable row level security;
alter table private.social_account_credentials enable row level security;

create policy creator_profiles_select_own
on public.creator_profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy creator_profiles_insert_own
on public.creator_profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy creator_profiles_update_own
on public.creator_profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy social_accounts_select_own
on public.social_accounts
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy content_posts_select_own
on public.content_posts
for select
to authenticated
using (
  exists (
    select 1
    from public.social_accounts
    where social_accounts.id = content_posts.account_id
      and social_accounts.owner_id = (select auth.uid())
  )
);

create policy account_daily_metrics_select_own
on public.account_daily_metrics
for select
to authenticated
using (
  exists (
    select 1
    from public.social_accounts
    where social_accounts.id = account_daily_metrics.account_id
      and social_accounts.owner_id = (select auth.uid())
  )
);

create policy post_daily_metrics_select_own
on public.post_daily_metrics
for select
to authenticated
using (
  exists (
    select 1
    from public.content_posts
    join public.social_accounts
      on social_accounts.id = content_posts.account_id
    where content_posts.id = post_daily_metrics.post_id
      and social_accounts.owner_id = (select auth.uid())
  )
);

create policy analytics_sync_runs_select_own
on public.analytics_sync_runs
for select
to authenticated
using (
  exists (
    select 1
    from public.social_accounts
    where social_accounts.id = analytics_sync_runs.account_id
      and social_accounts.owner_id = (select auth.uid())
  )
);

revoke all on table public.creator_profiles from anon, authenticated;
revoke all on table public.social_accounts from anon, authenticated;
revoke all on table public.content_posts from anon, authenticated;
revoke all on table public.account_daily_metrics from anon, authenticated;
revoke all on table public.post_daily_metrics from anon, authenticated;
revoke all on table public.analytics_sync_runs from anon, authenticated;

grant select, insert, update on table public.creator_profiles to authenticated;
grant select on table public.social_accounts to authenticated;
grant select on table public.content_posts to authenticated;
grant select on table public.account_daily_metrics to authenticated;
grant select on table public.post_daily_metrics to authenticated;
grant select on table public.analytics_sync_runs to authenticated;

grant select, insert, update, delete on table public.creator_profiles to service_role;
grant select, insert, update, delete on table public.social_accounts to service_role;
grant select, insert, update, delete on table public.content_posts to service_role;
grant select, insert, update, delete on table public.account_daily_metrics to service_role;
grant select, insert, update, delete on table public.post_daily_metrics to service_role;
grant select, insert, update, delete on table public.analytics_sync_runs to service_role;

revoke all on table private.social_account_credentials from public, anon, authenticated;
grant select, insert, update, delete on table private.social_account_credentials to service_role;

revoke all on type public.social_platform from public, anon;
revoke all on type public.social_account_status from public, anon;
revoke all on type public.analytics_sync_status from public, anon;
revoke all on type public.analytics_sync_trigger from public, anon;

grant usage on type public.social_platform to authenticated, service_role;
grant usage on type public.social_account_status to authenticated, service_role;
grant usage on type public.analytics_sync_status to authenticated, service_role;
grant usage on type public.analytics_sync_trigger to authenticated, service_role;

comment on table public.creator_profiles is
  'Creator preferences owned one-to-one by a Supabase Auth user.';

comment on table public.social_accounts is
  'Connected YouTube, Instagram, Facebook, and TikTok accounts. OAuth tokens are stored separately in Vault.';

comment on table public.content_posts is
  'Normalized content metadata imported from connected social platforms.';

comment on table public.account_daily_metrics is
  'One daily analytics snapshot per connected account. Engagement rate is derived consistently from engagements divided by views.';

comment on table public.post_daily_metrics is
  'Daily analytics for individual posts, videos, reels, and shorts.';

comment on table public.analytics_sync_runs is
  'Audit trail for manual, scheduled, webhook, and backfill analytics imports.';
