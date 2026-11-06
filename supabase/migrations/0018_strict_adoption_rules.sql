-- Strict adoption readiness, CAVD-managed recommendation weights and snapshots.
-- Existing pets start on hold. Never infer a CAVD review from old demo flags.
create table public.pet_adoption_checks (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  availability text not null default 'hold' check (availability in ('available','hold','adopted')),
  vaccination_status text not null default 'incomplete' check (vaccination_status in ('current','incomplete')),
  vaccination_valid_until date,
  behavioral_clearance text not null default 'pending' check (behavioral_clearance in ('pending','cleared','not_cleared')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  notes text not null default '' check (length(notes) <= 3000),
  updated_at timestamptz not null default now()
);
insert into public.pet_adoption_checks(pet_id) select id from public.pets;
alter table public.pet_adoption_checks enable row level security;
revoke all on public.pet_adoption_checks from public, anon, authenticated;
grant select on public.pet_adoption_checks to authenticated;
grant select on public.pet_adoption_checks to service_role;
create policy adoption_checks_read on public.pet_adoption_checks for select to authenticated
  using (public.is_cavd() or public.is_vet() or public.owns_pet(pet_id));

create function public.initialize_pet_adoption_checks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pet_adoption_checks(pet_id) values(new.id) on conflict do nothing;
  return new;
end $$;
create trigger pets_initialize_adoption_checks after insert on public.pets
  for each row execute function public.initialize_pet_adoption_checks();

create function public.invalidate_pet_adoption_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rabies_vaccinated is distinct from old.rabies_vaccinated
     or new.rabies_vaccinated_on is distinct from old.rabies_vaccinated_on
     or new.sterilized is distinct from old.sterilized then
    update public.pet_adoption_checks set verified_by = null, verified_at = null,
      updated_at = now() where pet_id = new.id;
  end if;
  return new;
end $$;
create trigger pets_invalidate_adoption_review after update on public.pets
  for each row execute function public.invalidate_pet_adoption_review();

-- Internal helper: no identity, contact or clinical notes are returned.
create function public.adoption_exclusion_reasons(p_pet_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare p public.pets; c public.pet_adoption_checks; reasons text[] := array[]::text[];
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
  return reasons;
end $$;
create function public.pet_is_adoption_eligible(p_pet_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select cardinality(public.adoption_exclusion_reasons(p_pet_id)) = 0
$$;
revoke all on function public.adoption_exclusion_reasons(uuid) from public, anon, authenticated;
revoke all on function public.pet_is_adoption_eligible(uuid) from public;
grant execute on function public.pet_is_adoption_eligible(uuid) to anon, authenticated;

create function public.save_pet_adoption_checks(
  p_pet_id uuid, p_availability text, p_vaccination_status text,
  p_vaccination_valid_until date, p_behavioral_clearance text,
  p_notes text default '', p_confirm boolean default false
)
returns public.pet_adoption_checks language plpgsql security definer set search_path = '' as $$
declare result public.pet_adoption_checks;
begin
  if not public.is_cavd() then raise exception 'Only CAVD staff can verify adoption eligibility'; end if;
  if p_confirm is distinct from true then raise exception 'Confirm the CAVD review before saving'; end if;
  if p_availability is null or p_availability not in ('available','hold') then
    raise exception 'Choose Available or Hold. Adopted status is recorded by ownership transfer';
  end if;
  if p_vaccination_status is null or p_vaccination_status not in ('current','incomplete')
     or p_behavioral_clearance is null or p_behavioral_clearance not in ('pending','cleared','not_cleared') then
    raise exception 'Choose valid eligibility conditions';
  end if;
  if p_vaccination_status = 'current' and (p_vaccination_valid_until is null or p_vaccination_valid_until < current_date) then
    raise exception 'Enter a current vaccination valid-through date from the reviewed record';
  end if;
  if length(coalesce(p_notes,'')) > 3000 then raise exception 'Keep review notes under 3,000 characters'; end if;
  perform 1 from public.pets where id = p_pet_id for update;
  if not found then raise exception 'Pet record not found'; end if;
  insert into public.pet_adoption_checks(pet_id, availability, vaccination_status,
    vaccination_valid_until, behavioral_clearance, verified_by, verified_at, notes)
  values(p_pet_id,p_availability,p_vaccination_status,p_vaccination_valid_until,
    p_behavioral_clearance,auth.uid(),now(),coalesce(btrim(p_notes),''))
  on conflict (pet_id) do update set availability = excluded.availability,
    vaccination_status = excluded.vaccination_status, vaccination_valid_until = excluded.vaccination_valid_until,
    behavioral_clearance = excluded.behavioral_clearance, verified_by = excluded.verified_by,
    verified_at = excluded.verified_at, notes = excluded.notes, updated_at = now()
  returning * into result;
  return result;
end $$;
revoke all on function public.save_pet_adoption_checks(uuid,text,text,date,text,text,boolean) from public, anon;
grant execute on function public.save_pet_adoption_checks(uuid,text,text,date,text,text,boolean) to authenticated;

create function public.cavd_eligibility_report()
returns table(pet_id uuid, name text, qr_slug text, photo_url text, registry_status text,
  availability text, eligible boolean, reasons text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_cavd() then raise exception 'Only CAVD staff can view the eligibility report'; end if;
  return query select p.id,p.name,p.qr_slug,p.photo_url,p.registry_status,
    coalesce(c.availability,'hold'),public.pet_is_adoption_eligible(p.id),public.adoption_exclusion_reasons(p.id)
    from public.pets p left join public.pet_adoption_checks c on c.pet_id = p.id order by p.name,p.id;
end $$;
revoke all on function public.cavd_eligibility_report() from public, anon;
grant execute on function public.cavd_eligibility_report() to authenticated;

create or replace view public.public_listings with (security_invoker = false) as
  select l.id as listing_id,l.notes as listing_notes,l.created_at as listed_at,
    p.qr_slug,p.name,p.species,p.breed,p.sex,p.size,p.birth_date,p.about,p.photo_url,
    p.sterilized,p.rabies_vaccinated,p.rabies_vaccinated_on,p.source,p.id as pet_id
  from public.listings l join public.pets p on p.id = l.pet_id
  where l.status = 'approved' and public.pet_is_adoption_eligible(p.id);
grant select on public.public_listings to anon, authenticated;

create or replace view public.public_pets with (security_invoker = false) as
  select p.qr_slug,p.name,p.species,p.breed,p.sex,p.size,p.birth_date,p.photo_url,
    p.sterilized,p.rabies_vaccinated,p.rabies_vaccinated_on,p.source,
    (l.id is not null) as is_listed,l.id as listing_id
  from public.pets p left join public.listings l on l.pet_id = p.id
    and l.status = 'approved' and public.pet_is_adoption_eligible(p.id)
  where p.registry_status = 'approved';
grant select on public.public_pets to anon, authenticated;

create or replace function public.listing_is_open(p_listing uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.listings l where l.id = p_listing
    and l.status = 'approved' and public.pet_is_adoption_eligible(l.pet_id))
$$;

create function public.enforce_listing_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' then
    if tg_op = 'INSERT' or old.status is distinct from 'approved' then
      perform 1 from public.pets where id = new.pet_id for update;
      if not public.pet_is_adoption_eligible(new.pet_id) then
        raise exception 'Complete all CAVD adoption eligibility checks before approving this listing';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger listings_require_eligibility before insert or update on public.listings
  for each row execute function public.enforce_listing_eligibility();

create function public.enforce_adoption_approval_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if not public.listing_is_open(new.listing_id) then
      raise exception 'The pet is on hold or no longer passes the adoption eligibility checks';
    end if;
  end if;
  return new;
end $$;
create trigger applications_require_eligibility before update on public.applications
  for each row execute function public.enforce_adoption_approval_eligibility();

create function public.mark_pet_adopted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.pet_adoption_checks set availability = 'adopted', updated_at = now() where pet_id = new.pet_id;
  return new;
end $$;
create trigger adoption_records_mark_pet_adopted after insert on public.adoption_records
  for each row execute function public.mark_pet_adopted();

create table public.match_settings (
  singleton boolean primary key default true check (singleton),
  weights jsonb not null,
  version integer not null default 1,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.match_settings(weights) values
  ('{"species":0.1,"size":0.1,"age":0.1,"activity":0.1,"temperament":0.1,"space":0.1,"time":0.1,"children":0.1,"other_pets":0.1,"experience":0.1}');
create table public.match_weight_history (
  version integer primary key, weights jsonb not null,
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.match_weight_history(version,weights) select version,weights from public.match_settings;
alter table public.match_settings enable row level security;
alter table public.match_weight_history enable row level security;
revoke all on public.match_settings, public.match_weight_history from public, anon, authenticated;
grant select on public.match_settings, public.match_weight_history to authenticated;
create policy match_settings_cavd_read on public.match_settings for select to authenticated using(public.is_cavd());
create policy weight_history_cavd_read on public.match_weight_history for select to authenticated using(public.is_cavd());
create view public.public_match_weights with (security_invoker = false) as
  select weights,version,updated_at,(updated_by is not null) as cavd_confirmed from public.match_settings;
grant select on public.public_match_weights to anon, authenticated;

create function public.set_match_weights(p_weights jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_total numeric;
begin
  if not public.is_cavd() then raise exception 'Only CAVD staff can change compatibility weights'; end if;
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then raise exception 'Provide all ten criterion weights'; end if;
  if (select count(*) from jsonb_object_keys(p_weights)) <> 10 or not (p_weights ?& array[
    'species','size','age','activity','temperament','space','time','children','other_pets','experience']) then
    raise exception 'Provide exactly the ten supported criterion weights';
  end if;
  if exists(select 1 from jsonb_each(p_weights) where jsonb_typeof(value) <> 'number') then
    raise exception 'Weights must be numeric';
  end if;
  if exists(select 1 from jsonb_each_text(p_weights) where value::numeric < 0 or value::numeric > 1) then
    raise exception 'Each weight must be between 0 and 1';
  end if;
  select sum(value::numeric) into v_total from jsonb_each_text(p_weights);
  if abs(v_total - 1) > 0.000001 then raise exception 'Weights must add up to 1.00 (100 percent)'; end if;
  update public.match_settings set weights = p_weights, version = version + 1,
    updated_by = auth.uid(), updated_at = now() where singleton returning version into v_version;
  insert into public.match_weight_history(version,weights,updated_by) values(v_version,p_weights,auth.uid());
  return v_version;
end $$;
revoke all on function public.set_match_weights(jsonb) from public, anon;
grant execute on function public.set_match_weights(jsonb) to authenticated;

alter table public.applications add column compatibility_weights_json jsonb,
  add column compatibility_weights_version integer;

create function public.match_score_with_weights(p public.pets, pref public.adopter_preferences,
  trait public.pet_match_traits, weights jsonb)
returns numeric language sql stable set search_path = '' as $$
  select round(100 * sum((weights->>criterion)::numeric * value),1) from (values
    ('species', case when pref.preferred_species = 'any' or pref.preferred_species = p.species then 1.0 else 0 end),
    ('size', case when pref.preferred_size = 'any' or pref.preferred_size = p.size then 1.0 else 0 end),
    ('age', case when pref.preferred_age = 'any' or pref.preferred_age =
      case when age(current_date,p.birth_date) < interval '1 year' then 'baby'
        when age(current_date,p.birth_date) < interval '3 years' then 'young'
        when age(current_date,p.birth_date) < interval '7 years' then 'adult' else 'senior' end then 1.0 else 0 end),
    ('activity', 1 - abs(pref.activity_preference - trait.activity_level) / 4.0),
    ('temperament', case when pref.temperament_preference = 'any' or pref.temperament_preference = trait.temperament then 1.0 else 0 end),
    ('space', case when pref.living_space >= trait.space_need then 1.0 when pref.living_space + 1 = trait.space_need then 0.5 else 0 end),
    ('time', case when pref.time_availability >= trait.time_need then 1.0 when pref.time_availability + 1 = trait.time_need then 0.5 else 0 end),
    ('children', case when not pref.children_at_home or trait.child_compatible then 1.0 else 0 end),
    ('other_pets', case when not pref.other_pets_at_home or trait.pet_compatible then 1.0 else 0 end),
    ('experience', case when pref.ownership_experience >= trait.experience_need then 1.0 when pref.ownership_experience + 1 = trait.experience_need then 0.5 else 0 end)
  ) as criteria(criterion,value)
$$;
revoke all on function public.match_score_with_weights(public.pets,public.adopter_preferences,public.pet_match_traits,jsonb) from public, anon, authenticated;

create or replace function public.submit_adoption_application(p_listing_id uuid,p_answers jsonb,p_source text default 'match')
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.applications; l public.listings; p public.pets;
  pref public.adopter_preferences; trait public.pet_match_traits; settings public.match_settings; score numeric;
begin
  if auth.uid() is null or public.my_role() is distinct from 'user' then raise exception 'Only verified, active adopters can submit applications'; end if;
  if p_source is distinct from 'match' then raise exception 'Start questionnaire applications from Find My Pet Match'; end if;
  perform public.validate_adoption_answers(p_answers);
  select * into l from public.listings where id = p_listing_id for update;
  if l.id is null or l.status <> 'approved' then raise exception 'This listing is no longer open'; end if;
  select * into p from public.pets where id = l.pet_id for update;
  if p.owner_id = auth.uid() or not public.pet_is_adoption_eligible(p.id) then raise exception 'This pet does not pass the adoption eligibility checks'; end if;
  select * into a from public.applications where listing_id = p_listing_id and adopter_id = auth.uid() for update;
  if a.id is not null and (a.status <> 'pending' or a.answers_json is not null or a.application_source = 'direct') then
    raise exception 'You have already applied for this pet';
  end if;
  select * into pref from public.adopter_preferences where user_id = auth.uid();
  select * into trait from public.pet_match_traits where pet_id = p.id;
  if pref.user_id is null then raise exception 'Save your Find My Pet Match preferences before applying'; end if;
  if trait.pet_id is null then raise exception 'This pet needs CAVD-reviewed matching traits before applying'; end if;
  select * into settings from public.match_settings where singleton for share;
  score := public.match_score_with_weights(p,pref,trait,settings.weights);
  if a.id is null then
    insert into public.applications(listing_id,adopter_id,pet_name_snapshot,answers_json,application_source,
      compatibility_score,compatibility_weights_json,compatibility_weights_version)
    values(p_listing_id,auth.uid(),p.name,p_answers,'match',score,settings.weights,settings.version) returning id into a.id;
  else
    update public.applications set answers_json = p_answers,application_source = 'match',compatibility_score = score,
      compatibility_weights_json = settings.weights,compatibility_weights_version = settings.version where id = a.id;
  end if;
  return a.id;
end $$;

create or replace function public.submit_direct_adoption_application(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.listings; p public.pets; a public.applications;
begin
  if auth.uid() is null or public.my_role() is distinct from 'user' then raise exception 'Only verified, active adopters can submit applications'; end if;
  select * into l from public.listings where id = p_listing_id for update;
  if l.id is null or l.status <> 'approved' then raise exception 'This listing is no longer open'; end if;
  select * into p from public.pets where id = l.pet_id for update;
  if p.owner_id = auth.uid() or not public.pet_is_adoption_eligible(p.id) then raise exception 'This pet does not pass the adoption eligibility checks'; end if;
  select * into a from public.applications where listing_id = p_listing_id and adopter_id = auth.uid();
  if a.id is not null then return a.id; end if;
  insert into public.applications(listing_id,adopter_id,pet_name_snapshot,application_source)
    values(p_listing_id,auth.uid(),p.name,'direct') returning id into a.id;
  return a.id;
end $$;

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
      or new.applicant_response is distinct from old.applicant_response then raise exception 'CAVD cannot rewrite adopter answers or score snapshots'; end if;
    return new;
  end if;
  if auth.uid() is distinct from old.adopter_id or old.status <> 'pending' or
    (to_jsonb(new) - array['answers_json','application_source','compatibility_score','compatibility_weights_json','compatibility_weights_version','applicant_response','response_date']) <>
    (to_jsonb(old) - array['answers_json','application_source','compatibility_score','compatibility_weights_json','compatibility_weights_version','applicant_response','response_date']) then
    raise exception 'Only CAVD staff can decide an application';
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

revoke all on function public.initialize_pet_adoption_checks(),public.invalidate_pet_adoption_review(),
  public.enforce_listing_eligibility(),public.enforce_adoption_approval_eligibility(),public.mark_pet_adopted()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
