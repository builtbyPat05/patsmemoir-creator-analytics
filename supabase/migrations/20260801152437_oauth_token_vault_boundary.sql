create table public.oauth_connection_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  platform public.social_platform not null,
  state_hash text not null unique,
  return_path text not null default '/settings/connections',
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  constraint oauth_connection_states_hash_length check (char_length(state_hash) = 64),
  constraint oauth_connection_states_return_path
    check (
      char_length(return_path) between 1 and 500
      and left(return_path, 1) = '/'
      and left(return_path, 2) <> '//'
    ),
  constraint oauth_connection_states_expiry check (expires_at > created_at)
);

create index oauth_connection_states_expiry_idx
  on public.oauth_connection_states (expires_at);

alter table public.oauth_connection_states enable row level security;

create policy oauth_connection_states_service_role_all
on public.oauth_connection_states
for all
to service_role
using (true)
with check (true);

revoke all on table public.oauth_connection_states from public, anon, authenticated;
grant select, insert, update, delete on table public.oauth_connection_states to service_role;

comment on table public.oauth_connection_states is
  'Short-lived, hashed CSRF state for social-platform OAuth callbacks. Server role only.';

create function public.store_social_account_tokens(
  p_account_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_token_type text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_provider_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_access_secret_id uuid;
  old_refresh_secret_id uuid;
  new_access_secret_id uuid;
  new_refresh_secret_id uuid;
begin
  if p_access_token is null or btrim(p_access_token) = '' then
    raise exception 'An access token is required.';
  end if;

  select
    access_token_secret_id,
    refresh_token_secret_id
  into
    old_access_secret_id,
    old_refresh_secret_id
  from private.social_account_credentials
  where account_id = p_account_id;

  new_access_secret_id := vault.create_secret(
    p_access_token,
    'social-account-' || p_account_id::text || '-access-' || gen_random_uuid()::text,
    'Social platform access token'
  );

  if p_refresh_token is not null and btrim(p_refresh_token) <> '' then
    new_refresh_secret_id := vault.create_secret(
      p_refresh_token,
      'social-account-' || p_account_id::text || '-refresh-' || gen_random_uuid()::text,
      'Social platform refresh token'
    );
  else
    new_refresh_secret_id := old_refresh_secret_id;
  end if;

  insert into private.social_account_credentials (
    account_id,
    access_token_secret_id,
    refresh_token_secret_id,
    token_type,
    scopes,
    expires_at,
    provider_metadata
  )
  values (
    p_account_id,
    new_access_secret_id,
    new_refresh_secret_id,
    p_token_type,
    coalesce(p_scopes, '{}'::text[]),
    p_expires_at,
    coalesce(p_provider_metadata, '{}'::jsonb)
  )
  on conflict (account_id) do update
  set
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    token_type = excluded.token_type,
    scopes = excluded.scopes,
    expires_at = excluded.expires_at,
    provider_metadata = excluded.provider_metadata,
    updated_at = now();

  if old_access_secret_id is not null then
    delete from vault.secrets where id = old_access_secret_id;
  end if;

  if old_refresh_secret_id is not null
    and old_refresh_secret_id is distinct from new_refresh_secret_id then
    delete from vault.secrets where id = old_refresh_secret_id;
  end if;
end;
$$;

create function public.get_social_account_tokens(p_account_id uuid)
returns table (
  access_token text,
  refresh_token text,
  token_type text,
  scopes text[],
  expires_at timestamptz,
  provider_metadata jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    credentials.token_type,
    credentials.scopes,
    credentials.expires_at,
    credentials.provider_metadata
  from private.social_account_credentials as credentials
  join vault.decrypted_secrets as access_secret
    on access_secret.id = credentials.access_token_secret_id
  left join vault.decrypted_secrets as refresh_secret
    on refresh_secret.id = credentials.refresh_token_secret_id
  where credentials.account_id = p_account_id;
$$;

create function public.delete_social_account_tokens(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_access_secret_id uuid;
  old_refresh_secret_id uuid;
begin
  delete from private.social_account_credentials
  where account_id = p_account_id
  returning access_token_secret_id, refresh_token_secret_id
  into old_access_secret_id, old_refresh_secret_id;

  if old_access_secret_id is not null then
    delete from vault.secrets where id = old_access_secret_id;
  end if;

  if old_refresh_secret_id is not null then
    delete from vault.secrets where id = old_refresh_secret_id;
  end if;
end;
$$;

revoke all on function public.store_social_account_tokens(uuid, text, text, text, text[], timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.get_social_account_tokens(uuid) from public, anon, authenticated;
revoke all on function public.delete_social_account_tokens(uuid) from public, anon, authenticated;

grant execute on function public.store_social_account_tokens(uuid, text, text, text, text[], timestamptz, jsonb) to service_role;
grant execute on function public.get_social_account_tokens(uuid) to service_role;
grant execute on function public.delete_social_account_tokens(uuid) to service_role;
