-- Account controls and API clean-up. CAVD staff remain one role.

-- A registration decision records the staff member who made it.
create function public.stamp_pet_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_cavd() and (new.registry_status is distinct from old.registry_status
     or new.registry_note is distinct from old.registry_note) then
    new.decided_by := auth.uid();
  end if;
  return new;
end $$;
create trigger pets_stamp_decision before update on public.pets
  for each row execute function public.stamp_pet_decision();

-- Staff can disable accounts and change roles, but never their own, so the office cannot lock itself out.
create function public.protect_own_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_cavd() and new.id = auth.uid()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own account type or disable your own account';
  end if;
  return new;
end $$;
create trigger profiles_protect_own_access before update on public.profiles
  for each row execute function public.protect_own_access();

-- Owner IDs are accepted on upload, so CAVD must be able to reject one afterwards.
-- Same guard as 0008, except an approved request may now move to rejected.
create or replace function public.guard_verification_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can review identity documents';
  end if;

  if old.status = 'rejected' then
    if old.id_path is null or new.id_path is not null
       or new.status is distinct from old.status
       or new.user_id is distinct from old.user_id
       or new.requested_role is distinct from old.requested_role
       or new.id_type is distinct from old.id_type
       or new.review_note is distinct from old.review_note
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.created_at is distinct from old.created_at
       or new.clinic_name is not null or new.prc_number is not null then
      raise exception 'Only rejected ID document details may be cleared';
    end if;
    if exists (
      select 1 from storage.objects
      where bucket_id = 'identity-documents' and name = old.id_path
    ) then
      raise exception 'Delete the rejected ID with the Storage API first';
    end if;
    return new;
  end if;

  if old.status = 'approved' and new.status <> 'rejected' then
    raise exception 'This request has already been reviewed';
  end if;
  if new.status not in ('approved', 'rejected') then
    raise exception 'Review must approve or reject the request';
  end if;
  if new.user_id is distinct from old.user_id
     or new.requested_role is distinct from old.requested_role
     or new.id_type is distinct from old.id_type
     or new.id_path is distinct from old.id_path
     or new.clinic_name is distinct from old.clinic_name
     or new.prc_number is distinct from old.prc_number
     or new.created_at is distinct from old.created_at then
    raise exception 'Submitted identity details cannot be changed';
  end if;
  if new.status = 'rejected' and length(btrim(coalesce(new.review_note, ''))) = 0 then
    raise exception 'A rejection needs a reason';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end
$$;

-- Internal functions should not be callable through the API.
-- Triggers still fire: PostgreSQL checks EXECUTE on a trigger function only when the trigger is created.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Permission helpers are used by policies for signed-in users only.
-- pet_is_adoption_eligible stays open: the public pet views call it for visitors.
revoke execute on function public.is_cavd(), public.is_vet(), public.my_role(), public.owns_pet(uuid),
  public.pet_is_approved(uuid), public.listing_is_open(uuid), public.listing_pet(uuid) from public, anon;
grant execute on function public.is_cavd(), public.is_vet(), public.my_role(), public.owns_pet(uuid),
  public.pet_is_approved(uuid), public.listing_is_open(uuid), public.listing_pet(uuid) to authenticated;
