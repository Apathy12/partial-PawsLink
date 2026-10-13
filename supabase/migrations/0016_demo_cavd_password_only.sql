-- Temporary demo setting: only cavd@demo.local may use an aal1 password session.
-- Restore the aal2 rule from supabase/maintenance/restore_cavd_mfa.sql after the demo.
create or replace function public.is_cavd()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.role = 'cavd'
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false) and (
    coalesce(auth.jwt()->>'aal', '') = 'aal2'
    or coalesce(auth.jwt()->>'email', '') = 'cavd@demo.local'
  )
$$;
