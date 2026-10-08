-- Private identity review for new owners and partner veterinarians.
-- Keep established users and demo accounts working. Newly registered users,
-- including accounts still waiting for email confirmation, need ID review.
alter table public.profiles
  add column verification_exempt boolean not null default false;

update public.profiles p set verification_exempt = true
where p.role in ('vet', 'cavd')
   or exists (select 1 from auth.users u where u.id = p.id and u.email like '%@demo.local')
   or exists (select 1 from public.pets pet where pet.owner_id = p.id)
   or exists (select 1 from public.applications a where a.adopter_id = p.id);

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  requested_role text not null check (requested_role in ('user', 'vet')),
  id_type text not null check (id_type in ('national_id', 'drivers_license', 'passport', 'other_government_id', 'prc_id')),
  id_path text not null,
  clinic_name text,
  prc_number text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint verification_document_ck check (length(btrim(id_path)) > 0),
  constraint verification_role_document_ck check (
    (requested_role = 'vet' and id_type = 'prc_id'
      and length(btrim(coalesce(clinic_name, ''))) > 0
      and length(btrim(coalesce(prc_number, ''))) > 0)
    or (requested_role = 'user' and id_type <> 'prc_id')
  )
);

create unique index verification_one_pending_per_user
  on public.verification_requests (user_id) where status = 'pending';
create index verification_requests_status_idx
  on public.verification_requests (status, created_at);

-- SECURITY DEFINER avoids policy recursion when pet and visit rules check this.
create or replace function public.identity_approved(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select verification_exempt from public.profiles where id = p_user), false)
    or exists (
      select 1 from public.verification_requests
      where user_id = p_user and status = 'approved'
    )
$$;

revoke all on function public.identity_approved(uuid) from public, anon;
grant execute on function public.identity_approved(uuid) to authenticated, service_role;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
    and (p.role = 'cavd' or public.identity_approved(p.id))
$$;

create or replace function public.is_vet()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'vet' and public.identity_approved(p.id)
    from public.profiles p where p.id = auth.uid() and p.is_active
  ), false)
$$;

-- A user cannot mark their own identity exempt or grant themselves vet access.
create or replace function public.guard_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;

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

create or replace function public.guard_verification_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can review identity documents';
  end if;
  if old.status <> 'pending' then
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

create trigger guard_verification_request_update
  before update on public.verification_requests
  for each row execute function public.guard_verification_request();

create or replace function public.issue_verified_vet_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and new.requested_role = 'vet' then
    update public.profiles
       set role = 'vet', clinic_name = new.clinic_name
     where id = new.user_id;
  end if;
  return new;
end
$$;

create trigger issue_verified_vet_role_update
  after update of status on public.verification_requests
  for each row execute function public.issue_verified_vet_role();

alter table public.verification_requests enable row level security;

create policy verification_read_self_or_cavd on public.verification_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_cavd());

create policy verification_submit_self on public.verification_requests
  for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'pending'
    and reviewed_by is null and reviewed_at is null and review_note is null
    and id_path like auth.uid()::text || '/%'
    and not public.identity_approved(auth.uid())
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'user')
  );

create policy verification_review_cavd on public.verification_requests
  for update to authenticated
  using (public.is_cavd()) with check (public.is_cavd());

drop policy applications_insert_adopter on public.applications;
create policy applications_insert_adopter on public.applications
  for insert to authenticated
  with check (
    public.my_role() = 'user'
    and adopter_id = auth.uid()
    and status = 'pending'
    and public.listing_is_open(listing_id)
    and not public.owns_pet(public.listing_pet(listing_id))
  );

revoke all on public.verification_requests from anon;
grant select, insert, update on public.verification_requests to authenticated;

-- Identity files are never served by a public URL. Only the applicant and CAVD
-- may read them; applicants can only upload into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'identity-documents', 'identity-documents', false, 5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do nothing;

create policy "identity documents read by applicant or CAVD"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'identity-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_cavd())
  );

create policy "identity documents uploaded by applicant"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
