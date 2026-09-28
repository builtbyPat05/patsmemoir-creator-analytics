create policy social_account_credentials_service_role_all
on private.social_account_credentials
for all
to service_role
using (true)
with check (true);
