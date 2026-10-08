-- Allow trusted server-side administration to issue the first CAVD account.
-- The service-role key must never be shipped to the browser. Ordinary users
-- still need an active CAVD profile to change any account role or status.
create or replace function public.guard_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_cavd() or auth.role() = 'service_role' then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'Only CAVD staff can change an account role';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Only CAVD staff can enable or disable an account';
  end if;
  return new;
end
$$;
