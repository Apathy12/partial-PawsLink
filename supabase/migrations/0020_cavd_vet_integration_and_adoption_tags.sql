-- CAVD veterinary integration, medical clearance, and adoption tracking tags.
--
-- WARNING: adoption eligibility now needs a Cleared latest veterinary visit.
-- Existing visits start as Pending and many pets have no visit at all, so every
-- pet currently in the public feed leaves it (public_listings, public_pets.is_listed,
-- Find My Pet Match) until CAVD records a Cleared visit. No listing, application or
-- visit is deleted; the pets return as soon as they pass again.
--
-- Run this before deploying the frontend that reads these columns.
begin;

-- ------------------------------------------------- retire outside veterinarians --
-- CAVD is the veterinary clinic. 'vet' stays in the role check so earlier rows
-- remain valid, and recorded visits keep pointing at those accounts.
comment on column public.profiles.role is
  'user or cavd. vet is no longer used: it remains only for deactivated accounts whose visits stay on record.';

drop trigger issue_verified_vet_role_update on public.verification_requests;
drop function public.issue_verified_vet_role();

-- These one-time updates have no CAVD session, so pause the guards as 0009 and 0012 did.
alter table public.verification_requests disable trigger guard_verification_request_update;
update public.verification_requests
   set status = 'rejected', reviewed_at = now(),
       review_note = 'CAVD no longer registers outside veterinarians. Submit a government ID to use PawsLink as a pet owner or adopter.'
 where requested_role = 'vet' and status = 'pending';
alter table public.verification_requests enable trigger guard_verification_request_update;

alter table public.profiles disable trigger guard_profiles_update;
update public.profiles set is_active = false where role = 'vet';
-- Applicants who never became vets continue on the owner path.
update public.profiles set registration_kind = 'user' where role = 'user' and registration_kind = 'vet';
alter table public.profiles enable trigger guard_profiles_update;

-- Signup metadata cannot choose an account type any more.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, name, contact, registration_kind)
  values (
    new.id,
    'user',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    nullif(btrim(new.raw_user_meta_data ->> 'contact'), ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create or replace function public.guard_profiles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.registration_kind is distinct from old.registration_kind then
    raise exception 'Registration type cannot be changed';
  end if;
  if new.role = 'vet' and (old.role is distinct from 'vet' or (new.is_active and not old.is_active)) then
    raise exception 'Outside veterinarian accounts are retired. CAVD staff handle veterinary work.';
  end if;

  if public.is_cavd() then
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
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.requested_role <> 'user' then
    raise exception 'CAVD no longer registers outside veterinarians. Only pet owners and adopters can submit an ID.';
  end if;
  -- Trusted seed and migration writes have no applicant JWT. Their explicit
  -- status is preserved; only an actual applicant submission is auto accepted.
  if auth.uid() is null then
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

drop policy verification_submit_self on public.verification_requests;
create policy verification_submit_self on public.verification_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and requested_role = 'user' and status = 'approved' and reviewed_at is not null
    and reviewed_by is null and review_note is null
    and id_path like auth.uid()::text || '/%'
    and not public.identity_approved(auth.uid())
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'user')
  );

-- ------------------------------------------------- stage 1 medical clearance --
alter table public.visits
  add column clearance_status text not null default 'pending'
    check (clearance_status in ('cleared', 'hold', 'pending'));

-- The recorder is always the signed-in staff member, never a client-supplied name.
create or replace function public.stamp_visit_recorder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    select p.name into new.recorded_by_name from public.profiles p where p.id = auth.uid();
  elsif new.recorded_by_name is null or btrim(new.recorded_by_name) = '' then
    select coalesce(p.clinic_name, p.name) into new.recorded_by_name
      from public.profiles p where p.id = new.recorded_by;
  end if;
  if new.recorded_by_name is null then
    raise exception 'Cannot record a visit without a recorder name';
  end if;
  return new;
end
$$;

-- Do not trust the client to claim a visit was recorded by a veterinarian, or to
-- clear a pet: only CAVD decides clearance.
create or replace function public.stamp_visit_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_vet() then
    new.verification_status := 'vet_confirmed';
  elsif public.is_cavd() then
    new.verification_status := 'cavd_confirmed';
  else
    -- RLS provides the denial for ordinary users. Service imports remain legacy.
    new.verification_status := 'legacy_summary';
  end if;
  if not public.is_cavd() and auth.role() is distinct from 'service_role' then
    new.clearance_status := 'pending';
  end if;
  return new;
end
$$;

-- The correction note stays on the row, so a clearance change must bring its own
-- note. audit_visit_correction then records it in visit_corrections as usual.
create or replace function public.guard_visits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Visit entries are append-only and cannot be deleted';
  end if;
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can correct a visit entry';
  end if;
  if new.correction_note is null or btrim(new.correction_note) = '' then
    raise exception 'A visit correction requires a correction_note for the audit trail';
  end if;
  if new.clearance_status is distinct from old.clearance_status
     and new.correction_note is not distinct from old.correction_note then
    raise exception 'Changing adoption clearance requires a new correction_note for the audit trail';
  end if;
  if new.pet_id is distinct from old.pet_id
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_by_name is distinct from old.recorded_by_name
     or new.created_at is distinct from old.created_at then
    raise exception 'A correction cannot rewrite the pet, the recorder or the creation time';
  end if;
  new.corrected_by := auth.uid();
  new.corrected_at := now();
  return new;
end
$$;

create function public.latest_visit_clearance(p_pet_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select v.clearance_status from public.visits v
  where v.pet_id = p_pet_id
  order by v.visit_date desc, v.created_at desc
  limit 1
$$;
-- Eligibility calls this with definer rights; clients read clearance from their visits.
revoke all on function public.latest_visit_clearance(uuid) from public, anon, authenticated;

create or replace function public.adoption_exclusion_reasons(p_pet_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare p public.pets; c public.pet_adoption_checks; clearance text; reasons text[] := array[]::text[];
begin
  select * into p from public.pets where id = p_pet_id;
  if p.id is null then return array['Pet record not found']; end if;
  select * into c from public.pet_adoption_checks where pet_id = p_pet_id;
  if p.registry_status <> 'approved' then reasons := array_append(reasons,'Registration is not approved'); end if;
  if c.availability is distinct from 'available' then reasons := array_append(reasons,'Adoption availability is not Available'); end if;
  if not p.rabies_vaccinated or p.rabies_vaccinated_on is null or p.rabies_vaccinated_on > current_date
     or c.vaccination_status is distinct from 'current' or c.vaccination_valid_until is null
     or c.vaccination_valid_until < current_date then
    reasons := array_append(reasons,'Current vaccination and its valid-through date must be recorded');
  end if;
  if not p.sterilized then reasons := array_append(reasons,'Spay/neuter is not completed'); end if;
  if c.behavioral_clearance is distinct from 'cleared' then reasons := array_append(reasons,'Behavioral clearance is not Cleared'); end if;
  if c.verified_by is null or c.verified_at is null or c.verified_at > now() then
    reasons := array_append(reasons,'CAVD eligibility verification is not recorded or needs renewal');
  end if;
  clearance := public.latest_visit_clearance(p_pet_id);
  if clearance is distinct from 'cleared' then
    reasons := array_append(reasons, 'Latest veterinary visit is not Cleared (' ||
      case clearance when 'hold' then 'Hold' when 'pending' then 'Pending' else 'no visit recorded' end || ')');
  end if;
  return reasons;
end $$;

-- The return type changes, so this function is dropped rather than replaced.
drop function public.cavd_eligibility_report();
create function public.cavd_eligibility_report()
returns table(pet_id uuid, name text, qr_slug text, photo_url text, registry_status text,
  availability text, eligible boolean, reasons text[], latest_clearance text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_cavd() then raise exception 'Only CAVD staff can view the eligibility report'; end if;
  return query select p.id,p.name,p.qr_slug,p.photo_url,p.registry_status,
    coalesce(c.availability,'hold'),public.pet_is_adoption_eligible(p.id),public.adoption_exclusion_reasons(p.id),
    public.latest_visit_clearance(p.id)
    from public.pets p left join public.pet_adoption_checks c on c.pet_id = p.id order by p.name,p.id;
end $$;
revoke all on function public.cavd_eligibility_report() from public, anon;
grant execute on function public.cavd_eligibility_report() to authenticated;

-- --------------------------------------------------- application and origin tags --
-- Generated columns cannot disagree with the source columns they are built from.
alter table public.applications
  add column discovery_path text generated always as
    (case when application_source = 'match' then 'match' else 'direct' end) stored,
  add column preference_snapshot_json jsonb,
  add column preference_snapshot_at timestamptz;
create index applications_discovery_path_idx on public.applications (discovery_path);

alter table public.pets
  add column custody_source text generated always as
    (case when source = 'shelter' then 'shelter' else 'private' end) stored;

create or replace view public.public_listings with (security_invoker = false) as
  select l.id as listing_id,l.notes as listing_notes,l.created_at as listed_at,
    p.qr_slug,p.name,p.species,p.breed,p.sex,p.size,p.birth_date,p.about,p.photo_url,
    p.sterilized,p.rabies_vaccinated,p.rabies_vaccinated_on,p.source,p.id as pet_id,p.custody_source
  from public.listings l join public.pets p on p.id = l.pet_id
  where l.status = 'approved' and public.pet_is_adoption_eligible(p.id);
grant select on public.public_listings to anon, authenticated;

create or replace view public.public_pets with (security_invoker = false) as
  select p.qr_slug,p.name,p.species,p.breed,p.sex,p.size,p.birth_date,p.photo_url,
    p.sterilized,p.rabies_vaccinated,p.rabies_vaccinated_on,p.source,
    (l.id is not null) as is_listed,l.id as listing_id,p.custody_source
  from public.pets p left join public.listings l on l.pet_id = p.id
    and l.status = 'approved' and public.pet_is_adoption_eligible(p.id)
  where p.registry_status = 'approved';
grant select on public.public_pets to anon, authenticated;

-- ------------------------------------------------------ self-adoption blocker --
create function public.block_self_adoption()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.listings l join public.pets p on p.id = l.pet_id
    where l.id = new.listing_id and p.owner_id = new.adopter_id
  ) then
    raise exception 'You cannot apply to adopt your own pet';
  end if;
  return new;
end $$;
create trigger applications_block_self_adoption before insert on public.applications
  for each row execute function public.block_self_adoption();
revoke all on function public.block_self_adoption() from public, anon, authenticated;

-- --------------------------------------------- Find My Match answers snapshot --
create or replace function public.submit_adoption_application(p_listing_id uuid,p_answers jsonb,p_source text default 'explore')
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.applications; l public.listings; p public.pets;
  pref public.adopter_preferences; trait public.pet_match_traits; settings public.match_settings; score numeric;
  snapshot jsonb; snapshot_at timestamptz;
begin
  if auth.uid() is null or public.my_role() is distinct from 'user' then
    raise exception 'Only verified, active adopters can submit applications';
  end if;
  if p_source is null or p_source not in ('explore','match') then
    raise exception 'Choose a valid application source';
  end if;
  perform public.validate_adoption_answers(p_answers);
  select * into l from public.listings where id = p_listing_id for update;
  if l.id is null or l.status <> 'approved' then raise exception 'This listing is no longer open'; end if;
  select * into p from public.pets where id = l.pet_id for update;
  if p.owner_id = auth.uid() or not public.pet_is_adoption_eligible(p.id) then
    raise exception 'This pet does not pass the adoption eligibility checks';
  end if;
  select * into a from public.applications where listing_id = p_listing_id and adopter_id = auth.uid() for update;
  -- Preserve earlier decisions and submitted answers, including on repeated clicks.
  if a.id is not null and (a.status <> 'pending' or a.answers_json is not null) then return a.id; end if;
  if p_source = 'match' then
    select * into pref from public.adopter_preferences where user_id = auth.uid();
    select * into trait from public.pet_match_traits where pet_id = p.id;
    if pref.user_id is null then raise exception 'Save your Find My Pet Match preferences before applying'; end if;
    if trait.pet_id is null then raise exception 'This pet needs CAVD-reviewed matching traits before applying'; end if;
    select * into settings from public.match_settings where singleton for share;
    score := public.match_score_with_weights(p,pref,trait,settings.weights);
    snapshot := to_jsonb(pref) - 'user_id' - 'updated_at';
    snapshot_at := now();
  end if;
  if a.id is null then
    insert into public.applications(listing_id,adopter_id,pet_name_snapshot,answers_json,application_source,
      compatibility_score,compatibility_weights_json,compatibility_weights_version,
      preference_snapshot_json,preference_snapshot_at)
    values(p_listing_id,auth.uid(),p.name,p_answers,p_source,score,settings.weights,settings.version,
      snapshot,snapshot_at) returning id into a.id;
  else
    -- Upgrade an earlier pending request without deleting its history or remarks.
    update public.applications set answers_json = p_answers,application_source = p_source,compatibility_score = score,
      compatibility_weights_json = settings.weights,compatibility_weights_version = settings.version,
      preference_snapshot_json = snapshot,preference_snapshot_at = snapshot_at where id = a.id;
  end if;
  return a.id;
end $$;
revoke all on function public.submit_adoption_application(uuid,jsonb,text) from public, anon;
grant execute on function public.submit_adoption_application(uuid,jsonb,text) to authenticated;

-- discovery_path is excluded from the row comparison because Postgres leaves
-- generated columns null in BEFORE triggers.
create or replace function public.guard_applications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.listing_id is distinct from old.listing_id or new.adopter_id is distinct from old.adopter_id then
    raise exception 'An application cannot be moved to another listing or adopter';
  end if;
  if public.is_cavd() then
    if new.answers_json is distinct from old.answers_json or new.application_source is distinct from old.application_source
      or new.compatibility_score is distinct from old.compatibility_score
      or new.compatibility_weights_json is distinct from old.compatibility_weights_json
      or new.compatibility_weights_version is distinct from old.compatibility_weights_version
      or new.preference_snapshot_json is distinct from old.preference_snapshot_json
      or new.preference_snapshot_at is distinct from old.preference_snapshot_at
      or new.applicant_response is distinct from old.applicant_response then raise exception 'CAVD cannot rewrite adopter answers or score snapshots'; end if;
    return new;
  end if;
  if auth.uid() is distinct from old.adopter_id or old.status <> 'pending' or
    (to_jsonb(new) - array['answers_json','application_source','discovery_path','compatibility_score','compatibility_weights_json','compatibility_weights_version','preference_snapshot_json','preference_snapshot_at','applicant_response','response_date']) <>
    (to_jsonb(old) - array['answers_json','application_source','discovery_path','compatibility_score','compatibility_weights_json','compatibility_weights_version','preference_snapshot_json','preference_snapshot_at','applicant_response','response_date']) then
    raise exception 'Only CAVD staff can decide an application';
  end if;
  if (new.preference_snapshot_json is distinct from old.preference_snapshot_json
      or new.preference_snapshot_at is distinct from old.preference_snapshot_at)
     and (old.preference_snapshot_json is not null or old.answers_json is not null) then
    raise exception 'Stamped Find My Match answers cannot be changed';
  end if;
  if new.answers_json is distinct from old.answers_json then
    if old.answers_json is not null then raise exception 'Application answers are already submitted'; end if;
    perform public.validate_adoption_answers(new.answers_json);
  end if;
  if new.applicant_response is distinct from old.applicant_response and
    (old.review_stage not in ('for_interview','additional_requirements') or nullif(btrim(new.applicant_response),'') is null
      or length(new.applicant_response) > 6000) then raise exception 'This application is not awaiting a response'; end if;
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
