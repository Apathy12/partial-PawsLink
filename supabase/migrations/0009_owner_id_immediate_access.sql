-- Owners and adopters receive access as soon as their government ID upload is
-- recorded. Veterinarian PRC requests still wait for CAVD review.
begin;

alter table public.profiles
  add column registration_kind text not null default 'user'
  check (registration_kind in ('user', 'vet'));

update public.profiles p set registration_kind = 'vet'
where p.role = 'vet' or exists (
  select 1 from auth.users u
  where u.id = p.id and u.raw_user_meta_data ->> 'requested_role' = 'vet'
) or exists (
  select 1 from public.verification_requests r
  where r.user_id = p.id and r.requested_role = 'vet'
);

-- Capture the chosen signup path once. Auth user metadata can later be edited
-- by its holder, so it must not be the database access-control boundary.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, name, contact, registration_kind)
  values (
    new.id,
    'user',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    nullif(btrim(new.raw_user_meta_data ->> 'contact'), ''),
    case when new.raw_user_meta_data ->> 'requested_role' = 'vet' then 'vet' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create or replace function public.guard_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.registration_kind is distinct from old.registration_kind then
    raise exception 'Registration type cannot be changed';
  end if;

  if public.is_cavd() then
    if new.role = 'vet' and old.role is distinct from 'vet'
       and not exists (
         select 1 from public.verification_requests r
         where r.user_id = new.id and r.requested_role = 'vet'
           and r.id_type = 'prc_id' and r.status = 'approved'
       ) then
      raise exception 'A veterinarian needs an approved PRC ID request';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only CAVD staff can change an account role';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Only CAVD staff can enable or disable an account';
  end if;
  if new.verification_exempt is distinct from old.verification_exempt then
    raise exception 'Only CAVD staff can change identity verification';
  end if;
  return new;
end
$$;

create or replace function public.accept_owner_identity_on_submit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted seed and migration writes have no applicant JWT. Their explicit
  -- status is preserved; only an actual applicant submission is auto accepted.
  if new.requested_role <> 'user' or auth.uid() is null then
    return new;
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'An ID can only be submitted by its account holder';
  end if;
  if new.id_path not like auth.uid()::text || '/%' then
    raise exception 'The ID file must be in the account holder folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'identity-documents' and o.name = new.id_path
  ) then
    raise exception 'Upload the government ID file before submitting the request';
  end if;
  new.status := 'approved';
  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := now();
  return new;
end
$$;

create trigger accept_owner_identity_on_submit
  before insert on public.verification_requests
  for each row execute function public.accept_owner_identity_on_submit();

drop policy verification_submit_self on public.verification_requests;
create policy verification_submit_self on public.verification_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      (requested_role = 'user' and status = 'approved' and reviewed_at is not null)
      or (requested_role = 'vet' and status = 'pending' and reviewed_at is null)
    )
    and reviewed_by is null and review_note is null
    and id_path like auth.uid()::text || '/%'
    and not public.identity_approved(auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'user'
        and p.registration_kind = requested_role
    )
  );

-- Migrate owner requests that were waiting under the old workflow. The table
-- lock prevents a concurrent review while this one-time backfill runs.
alter table public.verification_requests disable trigger guard_verification_request_update;

update public.verification_requests r
   set status = 'approved', reviewed_at = now()
 where r.requested_role = 'user' and r.status = 'pending'
   and exists (
     select 1 from public.profiles p
     where p.id = r.user_id and p.registration_kind = 'user'
   )
   and exists (
     select 1 from storage.objects o
     where o.bucket_id = 'identity-documents' and o.name = r.id_path
   );

update public.verification_requests r
   set status = 'rejected', reviewed_at = now(),
       review_note = case
         when exists (
           select 1 from public.profiles p
           where p.id = r.user_id and p.registration_kind = 'vet'
         ) then 'This account registered as a veterinarian. Please submit a PRC ID for CAVD review.'
         else 'The uploaded ID file was not found. Please submit it again.'
       end
 where r.requested_role = 'user' and r.status = 'pending';

alter table public.verification_requests enable trigger guard_verification_request_update;
commit;
