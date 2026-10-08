-- Structured veterinary encounters and carefully scoped clinic biodata updates.
-- Run after 0006. Existing summaries remain readable as legacy records.

alter table public.pets
  add column weight_kg numeric(6,2) check (weight_kg > 0 and weight_kg <= 500);

alter table public.visits
  add column visit_type text not null default 'checkup'
    check (visit_type in ('checkup', 'vaccination', 'illness', 'emergency', 'follow_up', 'other')),
  add column reason text,
  add column history text,
  add column weight_kg numeric(6,2) check (weight_kg > 0 and weight_kg <= 500),
  add column exam_findings text,
  add column assessment text,
  add column diagnostics text,
  add column procedures text,
  add column medications text,
  add column owner_instructions text,
  add column follow_up_on date,
  add column vaccine_name text,
  add column vaccine_manufacturer text,
  add column vaccine_lot text,
  add column vaccine_expires_on date,
  add column vaccine_route text,
  add column vaccine_site text,
  add column vaccine_administered_by text,
  add column vaccine_next_due_on date,
  add column vaccine_adverse_event text,
  add column evidence_path text,
  add column verification_status text not null default 'legacy_summary'
    check (verification_status in ('legacy_summary', 'vet_confirmed', 'cavd_confirmed')),
  add constraint visits_follow_up_after_visit check (follow_up_on is null or follow_up_on >= visit_date),
  add constraint visits_vaccine_dates check (
    vaccine_expires_on is null or vaccine_expires_on >= visit_date
  ),
  add constraint visits_vaccine_due check (
    vaccine_next_due_on is null or vaccine_next_due_on >= visit_date
  ),
  add constraint visits_vaccine_core check (
    vaccine_name is null or
    (nullif(btrim(vaccine_lot), '') is not null and
     vaccine_expires_on is not null and
     nullif(btrim(vaccine_administered_by), '') is not null)
  ),
  add constraint visits_vaccine_name_required check (
    vaccine_name is not null or
    (vaccine_manufacturer is null and vaccine_lot is null and
     vaccine_expires_on is null and vaccine_route is null and
     vaccine_site is null and vaccine_administered_by is null and
     vaccine_next_due_on is null and vaccine_adverse_event is null)
  ),
  add constraint visits_vaccination_has_product check (
    visit_type <> 'vaccination' or vaccine_name is not null
  );

create index visits_follow_up_idx on public.visits (follow_up_on)
  where follow_up_on is not null;
create unique index visits_evidence_path_unique on public.visits (evidence_path)
  where evidence_path is not null;

-- A clinician can attach only a document uploaded to their own private folder.
-- This prevents reattaching another pet's document to disclose it to that owner.
create or replace function public.guard_visit_document()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.evidence_path is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.evidence_path is not distinct from old.evidence_path then return new; end if;
  end if;
  if split_part(new.evidence_path, '/', 1) is distinct from auth.uid()::text then
    raise exception 'Visit document must be uploaded by the current clinician';
  end if;
  return new;
end
$$;
create trigger guard_visit_document_insert
  before insert on public.visits
  for each row execute function public.guard_visit_document();
create trigger guard_visit_document_update
  before update on public.visits
  for each row execute function public.guard_visit_document();

create table public.visit_corrections (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id),
  corrected_by uuid references public.profiles (id),
  corrected_at timestamptz not null default now(),
  correction_note text not null,
  previous_record jsonb not null,
  corrected_record jsonb not null
);
alter table public.visit_corrections enable row level security;
create policy visit_corrections_select on public.visit_corrections
  for select to authenticated
  using (exists (
    select 1 from public.visits v where v.id = visit_id and
      (public.is_cavd() or public.is_vet() or public.owns_pet(v.pet_id))
  ));
revoke all on public.visit_corrections from anon;
grant select on public.visit_corrections to authenticated;

create or replace function public.audit_visit_correction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.visit_corrections
    (visit_id, corrected_by, corrected_at, correction_note, previous_record, corrected_record)
  values (new.id, new.corrected_by, new.corrected_at, new.correction_note,
          to_jsonb(old), to_jsonb(new));
  return new;
end
$$;
create trigger visits_audit_correction
  after update on public.visits
  for each row execute function public.audit_visit_correction();

-- A CAVD correction cannot turn a legacy or office note into a confirmed
-- veterinary visit or replace the visit's identity.
create or replace function public.guard_visit_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id or
     new.verification_status is distinct from old.verification_status then
    raise exception 'Visit identity and verification cannot be changed';
  end if;
  return new;
end
$$;
create trigger guard_visit_verification_update
  before update on public.visits
  for each row execute function public.guard_visit_verification();

-- Do not trust the client to claim a visit was recorded by a veterinarian.
create or replace function public.stamp_visit_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_vet() then
    new.verification_status := 'vet_confirmed';
  elsif public.is_cavd() then
    new.verification_status := 'cavd_confirmed';
  else
    -- RLS provides the denial for ordinary users. Service imports remain legacy.
    new.verification_status := 'legacy_summary';
  end if;
  return new;
end
$$;

create trigger visits_stamp_verification
  before insert on public.visits
  for each row execute function public.stamp_visit_verification();

-- Existing owner edits remain allowed; vets may now correct only approved-pet
-- biodata and photographs. The existing guard keeps custody and decisions locked.
create policy pets_update_vet on public.pets
  for update to authenticated
  using (public.is_vet() and registry_status = 'approved')
  with check (public.is_vet() and registry_status = 'approved');

create or replace function public.guard_pets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id then
    raise exception 'pet id is immutable';
  end if;
  if new.qr_slug is distinct from old.qr_slug then
    raise exception 'qr_slug is immutable once issued';
  end if;
  if public.is_cavd() then
    return new;
  end if;
  if new.registry_status is distinct from old.registry_status then
    raise exception 'Only CAVD staff can change registry status';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Only CAVD staff can transfer ownership';
  end if;
  if new.source is distinct from old.source then
    raise exception 'Only CAVD staff can change custody source';
  end if;
  if new.rabies_vaccinated is distinct from old.rabies_vaccinated
     or new.rabies_vaccinated_on is distinct from old.rabies_vaccinated_on then
    raise exception 'Only CAVD staff can set public health flags';
  end if;
  if new.registry_note is distinct from old.registry_note
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at then
    raise exception 'Only CAVD staff can write the registry decision';
  end if;
  if public.is_vet() and (
    old.registry_status <> 'approved' or
    new.created_by is distinct from old.created_by or
    new.created_at is distinct from old.created_at or
    new.updated_at is distinct from old.updated_at
  ) then
    raise exception 'Clinic users may only correct approved pet details';
  end if;
  return new;
end
$$;

-- A server-written history makes profile changes reviewable after adoption.
create table public.pet_detail_changes (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  old_details jsonb not null,
  new_details jsonb not null
);
alter table public.pet_detail_changes enable row level security;
create policy pet_detail_changes_select on public.pet_detail_changes
  for select to authenticated
  using (public.is_cavd() or public.owns_pet(pet_id) or
         (public.is_vet() and public.pet_is_approved(pet_id)));
revoke all on public.pet_detail_changes from anon;
grant select on public.pet_detail_changes to authenticated;

create or replace function public.audit_pet_details()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  before_details jsonb;
  after_details jsonb;
begin
  before_details := jsonb_build_object('name', old.name, 'species', old.species,
    'breed', old.breed, 'sex', old.sex, 'size', old.size,
    'birth_date', old.birth_date, 'weight_kg', old.weight_kg,
    'color', old.color, 'markings', old.markings, 'about', old.about,
    'photo_url', old.photo_url, 'sterilized', old.sterilized);
  after_details := jsonb_build_object('name', new.name, 'species', new.species,
    'breed', new.breed, 'sex', new.sex, 'size', new.size,
    'birth_date', new.birth_date, 'weight_kg', new.weight_kg,
    'color', new.color, 'markings', new.markings, 'about', new.about,
    'photo_url', new.photo_url, 'sterilized', new.sterilized);
  if before_details is distinct from after_details then
    insert into public.pet_detail_changes (pet_id, changed_by, old_details, new_details)
    values (new.id, auth.uid(), before_details, after_details);
  end if;
  return new;
end
$$;
create trigger audit_pet_details_update
  after update on public.pets
  for each row execute function public.audit_pet_details();

-- Visit documents are private, even though pet profile photos are public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-documents', 'visit-documents', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "clinicians upload visit documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'visit-documents' and
    (storage.foldername(name))[1] = auth.uid()::text and
    (public.is_vet() or public.is_cavd())
  );

create policy "authorized people read visit documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-documents' and exists (
      select 1 from public.visits v
      where v.evidence_path = name and
        (public.is_cavd() or public.owns_pet(v.pet_id) or
         (public.is_vet() and public.pet_is_approved(v.pet_id)))
    )
  );

create policy "clinicians read their own pending visit documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-documents' and
    (storage.foldername(name))[1] = auth.uid()::text and
    (public.is_vet() or public.is_cavd())
  );

create policy "clinicians remove unused visit documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'visit-documents' and
    (storage.foldername(name))[1] = auth.uid()::text and
    (public.is_vet() or public.is_cavd()) and
    not exists (select 1 from public.visits v where v.evidence_path = name)
  );

-- Keep an immutable receipt for every CAVD-approved ownership transfer.
create table public.adoption_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications (id),
  listing_id uuid not null references public.listings (id),
  pet_id uuid not null references public.pets (id),
  previous_owner_id uuid references public.profiles (id),
  adopter_id uuid not null references public.profiles (id),
  approved_by uuid not null references public.profiles (id),
  approved_at timestamptz not null default now(),
  validation_method text not null check (validation_method in ('owner_conversation', 'cavd_visit')),
  validation_date date not null check (validation_date <= current_date),
  validated_with text not null check (length(btrim(validated_with)) > 0),
  decision_note text,
  pet_snapshot jsonb not null,
  last_visit_on date
);
create index adoption_records_pet_idx on public.adoption_records (pet_id, approved_at desc);
alter table public.adoption_records enable row level security;
create policy adoption_records_select on public.adoption_records
  for select to authenticated
  using (public.is_cavd() or adopter_id = auth.uid() or previous_owner_id = auth.uid());
revoke all on public.adoption_records from anon;
grant select on public.adoption_records to authenticated;

create or replace function public.prevent_adoption_record_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Adoption transfer records cannot be changed or deleted';
end
$$;
create trigger adoption_records_immutable
  before update or delete on public.adoption_records
  for each row execute function public.prevent_adoption_record_mutation();

-- Replace the earlier two-argument RPC so callers cannot skip CAVD validation.
drop function public.approve_application(uuid, text);
create function public.approve_application(
  p_application_id uuid, p_validation_method text, p_validation_date date,
  p_validated_with text, p_note text
)
returns public.applications
language plpgsql security definer set search_path = public as $$
declare
  v_app public.applications;
  v_listing public.listings;
  v_pet public.pets;
begin
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can approve an adoption';
  end if;
  if p_validation_method not in ('owner_conversation', 'cavd_visit') or
     p_validation_method is null then
    raise exception 'Choose how CAVD validated the adoption request';
  end if;
  if p_validation_date is null or p_validation_date > current_date then
    raise exception 'Record a valid CAVD validation date';
  end if;
  if nullif(btrim(p_validated_with), '') is null then
    raise exception 'Record who CAVD spoke with or visited';
  end if;
  if p_note is null or nullif(btrim(p_note), '') is null then
    raise exception 'Record the CAVD validation outcome before transfer';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then
    raise exception 'This application has already been decided';
  end if;

  select * into v_listing from public.listings where id = v_app.listing_id for update;
  if v_listing.status <> 'approved' then
    raise exception 'The listing is not open, so the adoption cannot be approved';
  end if;
  select * into v_pet from public.pets where id = v_listing.pet_id for update;
  if v_pet.registry_status <> 'approved' then
    raise exception 'The pet registry record must be approved before adoption';
  end if;
  if v_pet.owner_id = v_app.adopter_id then
    raise exception 'The applicant already owns this pet';
  end if;

  update public.applications
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = v_app.id returning * into v_app;

  insert into public.adoption_records (
    application_id, listing_id, pet_id, previous_owner_id, adopter_id,
    approved_by, approved_at, validation_method, validation_date,
    validated_with, decision_note, pet_snapshot, last_visit_on
  ) values (
    v_app.id, v_listing.id, v_pet.id, v_pet.owner_id, v_app.adopter_id,
    auth.uid(), now(), p_validation_method, p_validation_date,
    btrim(p_validated_with), p_note,
    jsonb_build_object('name', v_pet.name, 'species', v_pet.species,
      'breed', v_pet.breed, 'sex', v_pet.sex, 'size', v_pet.size,
      'birth_date', v_pet.birth_date, 'weight_kg', v_pet.weight_kg,
      'color', v_pet.color, 'markings', v_pet.markings,
      'photo_url', v_pet.photo_url, 'sterilized', v_pet.sterilized,
      'rabies_vaccinated', v_pet.rabies_vaccinated,
      'rabies_vaccinated_on', v_pet.rabies_vaccinated_on),
    (select max(visit_date) from public.visits where pet_id = v_pet.id)
  );

  update public.pets set owner_id = v_app.adopter_id, source = 'owner'
   where id = v_pet.id;
  update public.listings
     set status = 'closed', decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(decision_note, 'Closed on adoption transfer')
   where id = v_listing.id;
  update public.applications
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = 'Closed automatically: this pet was adopted by another applicant.'
   where listing_id = v_listing.id and id <> v_app.id and status = 'pending';
  return v_app;
end
$$;
revoke all on function public.approve_application(uuid, text, date, text, text) from public, anon;
grant execute on function public.approve_application(uuid, text, date, text, text) to authenticated;
