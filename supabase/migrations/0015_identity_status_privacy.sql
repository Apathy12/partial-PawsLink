-- A signed-in user may call public RPC functions directly. Identity approval
-- checks inside policies only need the caller's own status; CAVD can inspect
-- another person's status after completing MFA.
create or replace function public.identity_approved(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (p_user = auth.uid() or public.is_cavd() or auth.role() = 'service_role')
    and (
      (select p.verification_exempt from public.profiles p where p.id = p_user)
      or exists (
        select 1 from public.verification_requests r
        where r.user_id = p_user and r.status = 'approved'
      )
    ), false)
$$;
