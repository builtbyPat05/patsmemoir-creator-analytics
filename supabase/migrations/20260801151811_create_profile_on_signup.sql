create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');

  insert into public.creator_profiles (id, display_name)
  values (
    new.id,
    coalesce(
      profile_name,
      nullif(split_part(new.email, '@', 1), ''),
      'Creator'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;
revoke all on function private.handle_new_user() from anon;
revoke all on function private.handle_new_user() from authenticated;
revoke all on function private.handle_new_user() from service_role;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();
