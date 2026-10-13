-- Run in the Supabase SQL editor after the demo, then rebuild both apps with
-- VITE_CAVD_DEMO_PASSWORD_ONLY=false. CAVD staff must enroll or verify TOTP to work.
create or replace function public.is_cavd()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.role = 'cavd'
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false) and coalesce(auth.jwt()->>'aal', '') = 'aal2'
$$;
