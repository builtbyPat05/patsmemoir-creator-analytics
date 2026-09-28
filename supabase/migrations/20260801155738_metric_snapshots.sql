create table public.account_metric_snapshots (
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  snapshot_date date not null,
  captured_at timestamptz not null default now(),
  follower_count bigint not null default 0,
  following_count bigint not null default 0,
  total_views bigint not null default 0,
  total_likes bigint not null default 0,
  total_comments bigint not null default 0,
  total_shares bigint not null default 0,
  post_count bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  primary key (account_id, snapshot_date),
  constraint account_metric_snapshots_follower_count_nonnegative check (follower_count >= 0),
  constraint account_metric_snapshots_following_count_nonnegative check (following_count >= 0),
  constraint account_metric_snapshots_total_views_nonnegative check (total_views >= 0),
  constraint account_metric_snapshots_total_likes_nonnegative check (total_likes >= 0),
  constraint account_metric_snapshots_total_comments_nonnegative check (total_comments >= 0),
  constraint account_metric_snapshots_total_shares_nonnegative check (total_shares >= 0),
  constraint account_metric_snapshots_post_count_nonnegative check (post_count >= 0),
  constraint account_metric_snapshots_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index account_metric_snapshots_account_captured_idx
  on public.account_metric_snapshots (account_id, captured_at desc);

create table public.post_metric_snapshots (
  post_id uuid not null references public.content_posts (id) on delete cascade,
  snapshot_date date not null,
  captured_at timestamptz not null default now(),
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  reach bigint not null default 0,
  impressions bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  primary key (post_id, snapshot_date),
  constraint post_metric_snapshots_views_nonnegative check (views >= 0),
  constraint post_metric_snapshots_likes_nonnegative check (likes >= 0),
  constraint post_metric_snapshots_comments_nonnegative check (comments >= 0),
  constraint post_metric_snapshots_shares_nonnegative check (shares >= 0),
  constraint post_metric_snapshots_saves_nonnegative check (saves >= 0),
  constraint post_metric_snapshots_reach_nonnegative check (reach >= 0),
  constraint post_metric_snapshots_impressions_nonnegative check (impressions >= 0),
  constraint post_metric_snapshots_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index post_metric_snapshots_post_captured_idx
  on public.post_metric_snapshots (post_id, captured_at desc);

alter table public.account_metric_snapshots enable row level security;
alter table public.post_metric_snapshots enable row level security;

create policy account_metric_snapshots_select_own
on public.account_metric_snapshots
for select
to authenticated
using (
  exists (
    select 1
    from public.social_accounts
    where social_accounts.id = account_metric_snapshots.account_id
      and social_accounts.owner_id = (select auth.uid())
  )
);

create policy account_metric_snapshots_service_role_all
on public.account_metric_snapshots
for all
to service_role
using (true)
with check (true);

create policy post_metric_snapshots_select_own
on public.post_metric_snapshots
for select
to authenticated
using (
  exists (
    select 1
    from public.content_posts
    join public.social_accounts
      on social_accounts.id = content_posts.account_id
    where content_posts.id = post_metric_snapshots.post_id
      and social_accounts.owner_id = (select auth.uid())
  )
);

create policy post_metric_snapshots_service_role_all
on public.post_metric_snapshots
for all
to service_role
using (true)
with check (true);

revoke all on table public.account_metric_snapshots from public, anon, authenticated;
revoke all on table public.post_metric_snapshots from public, anon, authenticated;

grant select on table public.account_metric_snapshots to authenticated;
grant select on table public.post_metric_snapshots to authenticated;

grant select, insert, update, delete on table public.account_metric_snapshots to service_role;
grant select, insert, update, delete on table public.post_metric_snapshots to service_role;

comment on table public.account_metric_snapshots is
  'Daily cumulative provider snapshots used to derive honest period deltas when an API does not expose historical daily analytics.';

comment on table public.post_metric_snapshots is
  'Daily cumulative post snapshots used to derive views and engagement gained since the prior provider sync.';
