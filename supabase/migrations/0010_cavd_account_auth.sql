-- Show email confirmation details on the CAVD account page without exposing
-- auth.users or keeping a second copy of email addresses in public tables.
create schema if not exists pawslink_private;
revoke all on schema pawslink_private from public;
grant usage on schema pawslink_private to authenticated;

create or replace function pawslink_private.cavd_auth_summary(p_account_id uuid)
returns table (email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can view account login details' using errcode = '42501';
  end if;

  return query
    select u.email::text, u.email_confirmed_at, u.last_sign_in_at
    from auth.users u where u.id = p_account_id;
end
$$;

revoke all on function pawslink_private.cavd_auth_summary(uuid) from public, anon;
grant execute on function pawslink_private.cavd_auth_summary(uuid) to authenticated;

-- The exposed wrapper has invoker privileges; the guarded helper stays in a
-- schema that is not exposed by Supabase's Data API.
create or replace function public.cavd_account_auth(p_account_id uuid)
returns table (email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from pawslink_private.cavd_auth_summary(p_account_id)
$$;

revoke all on function public.cavd_account_auth(uuid) from public, anon;
grant execute on function public.cavd_account_auth(uuid) to authenticated;
