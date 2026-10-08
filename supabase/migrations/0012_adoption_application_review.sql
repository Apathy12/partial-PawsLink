-- Detailed adopter applications and CAVD follow-up. Existing short-message
-- applications remain readable as legacy records; no answers are fabricated.
alter table public.applications alter column message drop not null;
alter table public.applications
  add column answers_json jsonb,
  add column pet_name_snapshot text,
  add column application_source text not null default 'legacy'
    check (application_source in ('legacy', 'explore', 'match')),
  add column compatibility_score numeric(5,1)
    check (compatibility_score between 0 and 100),
  add column review_stage text not null default 'pending_review'
    check (review_stage in ('pending_review', 'under_review', 'for_interview',
      'additional_requirements', 'approved', 'rejected')),
  add column cavd_remarks text,
  add column applicant_response text,
  add column response_date timestamptz,
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;

-- The pre-existing guard allows only CAVD-signed updates. Pause it for this
-- one-time backfill, then restore it before installing the new workflow.
alter table public.applications disable trigger guard_applications_update;
update public.applications set review_stage = status
  where status in ('approved', 'rejected');
update public.applications a set pet_name_snapshot = p.name
  from public.listings l join public.pets p on p.id = l.pet_id
  where a.listing_id = l.id;
alter table public.applications enable trigger guard_applications_update;

-- Applications now enter through the transaction below. This prevents an
-- adopter from creating an empty pending request with a direct table insert.
drop policy applications_insert_adopter on public.applications;
drop policy applications_update_cavd on public.applications;

create function public.validate_adoption_answers(p_answers jsonb)
returns void language plpgsql set search_path = public as $$
declare
  v_key text;
  v_value text;
  v_required text[] := array[
    'full_name','address','phone','email','birth_date','occupation',
    'alternate_contact','alternate_relationship','alternate_phone',
    'residence','housing','pets_allowed','household','children_present',
    'elderly','allergies','household_support','caregiver','financial_caregiver',
    'hours_alone','pet_space','backup_care','care_plan','introduction',
    'ownership_experience','current_pets','reason','behavior_plan','moving_plan'
  ];
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Complete the adoption questionnaire before submitting';
  end if;
  if p_answers->>'declaration' <> 'true' then
    raise exception 'Confirm the application declaration';
  end if;
  if p_answers->>'children_present' = 'Yes' then v_required := array_append(v_required, 'children'); end if;
  if p_answers->>'current_pets' = 'Yes' then v_required := array_append(v_required, 'current_details'); end if;
  if p_answers->>'ownership_experience' <> 'First-time owner' then v_required := array_append(v_required, 'previous_details'); end if;
  if p_answers->>'household_support' = 'No' then v_required := array_append(v_required, 'support_details'); end if;
  foreach v_key in array v_required loop
    if nullif(btrim(p_answers->>v_key), '') is null then
      raise exception 'Complete the required application field: %', v_key;
    end if;
  end loop;
  for v_key, v_value in select key, value from jsonb_each_text(p_answers) loop
    if length(v_value) > 3000 then raise exception 'Application answers must be 3,000 characters or fewer'; end if;
  end loop;
  if p_answers->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_answers->>'birth_date' !~ '^\d{4}-\d{2}-\d{2}$'
     or (p_answers->>'birth_date')::date > current_date then
    raise exception 'Enter a valid birth date';
  end if;
  if p_answers->>'hours_alone' !~ '^\d+(\.\d+)?$'
     or (p_answers->>'hours_alone')::numeric > 24 then
    raise exception 'Hours alone must be between 0 and 24';
  end if;
  if p_answers->>'residence' not in ('House','Apartment','Condominium','Boarding house','Other')
     or p_answers->>'housing' not in ('Own','Rent','Other arrangement')
     or p_answers->>'pets_allowed' not in ('Yes','No','Not yet confirmed','Not applicable')
     or p_answers->>'children_present' not in ('Yes','No')
     or p_answers->>'elderly' not in ('Yes','No')
     or p_answers->>'allergies' not in ('Yes','No','Unsure')
     or p_answers->>'household_support' not in ('Yes','No','Living alone')
     or p_answers->>'ownership_experience' not in ('First-time owner','Some exposure','Some experience','Experienced owner','Very experienced handler')
     or p_answers->>'current_pets' not in ('Yes','No') then
    raise exception 'Choose valid application answers';
  end if;
end
$$;
revoke all on function public.validate_adoption_answers(jsonb) from public, anon, authenticated;

-- Direct adopter UPDATEs still have no RLS policy. These narrow exceptions let
-- the trusted submission/reply functions update only that adopter's own pending
-- row, while preserving the original CAVD-only decision guard.
create or replace function public.guard_applications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.listing_id is distinct from old.listing_id or new.adopter_id is distinct from old.adopter_id then
    raise exception 'An application cannot be moved to another listing or adopter';
  end if;
  if public.is_cavd() then
    if new.answers_json is distinct from old.answers_json or
       new.application_source is distinct from old.application_source or
       new.compatibility_score is distinct from old.compatibility_score or
       new.applicant_response is distinct from old.applicant_response then
      raise exception 'CAVD cannot rewrite adopter answers';
    end if;
    return new;
  end if;
  if auth.uid() is distinct from old.adopter_id or old.status <> 'pending' or
     (to_jsonb(new) - array['answers_json','application_source','compatibility_score','applicant_response','response_date']) <>
     (to_jsonb(old) - array['answers_json','application_source','compatibility_score','applicant_response','response_date']) then
    raise exception 'Only CAVD staff can decide an application';
  end if;
  if new.answers_json is distinct from old.answers_json then
    if old.answers_json is not null then raise exception 'Application answers are already submitted'; end if;
    perform public.validate_adoption_answers(new.answers_json);
  end if;
  if new.applicant_response is distinct from old.applicant_response and
     (old.review_stage not in ('for_interview','additional_requirements') or
      nullif(btrim(new.applicant_response),'') is null or
      length(new.applicant_response) > 6000) then
    raise exception 'This application is not awaiting a response';
  end if;
  return new;
end
$$;

create function public.submit_adoption_application(
  p_listing_id uuid, p_answers jsonb, p_source text default 'explore'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_app public.applications;
  v_listing public.listings;
  v_pet public.pets;
  v_pref public.adopter_preferences;
  v_trait public.pet_match_traits;
  v_age text;
  v_score numeric(5,1);
begin
  if auth.uid() is null or public.my_role() <> 'user' then
    raise exception 'Only adopters can submit applications';
  end if;
  if p_source not in ('explore','match') or p_source is null then
    raise exception 'Choose a valid application source';
  end if;
  perform public.validate_adoption_answers(p_answers);
  select * into v_listing from public.listings where id = p_listing_id for update;
  if v_listing.id is null or v_listing.status <> 'approved' then
    raise exception 'This listing is no longer open';
  end if;
  select * into v_pet from public.pets where id = v_listing.pet_id for update;
  if v_pet.registry_status <> 'approved' or v_pet.owner_id = auth.uid() then
    raise exception 'This pet is not available for your application';
  end if;
  select * into v_app from public.applications
    where listing_id = p_listing_id and adopter_id = auth.uid() for update;
  if v_app.id is not null and (v_app.status <> 'pending' or v_app.answers_json is not null) then
    raise exception 'You have already applied for this pet';
  end if;

  -- The score is calculated from stored CAVD traits and adopter preferences;
  -- clients cannot supply it. It remains context, never an approval rule.
  if p_source = 'match' then
    select * into v_pref from public.adopter_preferences where user_id = auth.uid();
    select * into v_trait from public.pet_match_traits where pet_id = v_pet.id;
    if v_pref.user_id is not null and v_trait.pet_id is not null then
      v_age := case when age(current_date, v_pet.birth_date) < interval '1 year' then 'baby'
        when age(current_date, v_pet.birth_date) < interval '3 years' then 'young'
        when age(current_date, v_pet.birth_date) < interval '7 years' then 'adult'
        else 'senior' end;
      v_score := round(10 * (
        (case when v_pref.preferred_species = 'any' or v_pref.preferred_species = v_pet.species then 1 else 0 end) +
        (case when v_pref.preferred_size = 'any' or v_pref.preferred_size = v_pet.size then 1 else 0 end) +
        (case when v_pref.preferred_age = 'any' or v_pref.preferred_age = v_age then 1 else 0 end) +
        (1 - abs(v_pref.activity_preference - v_trait.activity_level) / 4.0) +
        (case when v_pref.temperament_preference = 'any' or v_pref.temperament_preference = v_trait.temperament then 1 else 0 end) +
        (case when v_pref.living_space >= v_trait.space_need then 1 when v_pref.living_space + 1 = v_trait.space_need then 0.5 else 0 end) +
        (case when v_pref.time_availability >= v_trait.time_need then 1 when v_pref.time_availability + 1 = v_trait.time_need then 0.5 else 0 end) +
        (case when not v_pref.children_at_home or v_trait.child_compatible then 1 else 0 end) +
        (case when not v_pref.other_pets_at_home or v_trait.pet_compatible then 1 else 0 end) +
        (case when v_pref.ownership_experience >= v_trait.experience_need then 1 when v_pref.ownership_experience + 1 = v_trait.experience_need then 0.5 else 0 end)
      ), 1);
    end if;
  end if;

  if v_app.id is null then
    insert into public.applications (listing_id, adopter_id, pet_name_snapshot, answers_json, application_source, compatibility_score)
      values (p_listing_id, auth.uid(), v_pet.name, p_answers, p_source, v_score) returning id into v_app.id;
  else
    update public.applications set answers_json = p_answers, application_source = p_source,
      compatibility_score = v_score where id = v_app.id;
  end if;
  return v_app.id;
end
$$;
revoke all on function public.submit_adoption_application(uuid,jsonb,text) from public, anon;
grant execute on function public.submit_adoption_application(uuid,jsonb,text) to authenticated;

create function public.review_adoption_application(
  p_application_id uuid, p_stage text, p_remarks text default null
)
returns public.applications language plpgsql security definer set search_path = public as $$
declare v_app public.applications;
begin
  if not public.is_cavd() then raise exception 'Only CAVD staff can review applications'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' then raise exception 'This application has already been decided'; end if;
  if p_stage not in ('pending_review','under_review','for_interview','additional_requirements','rejected')
     or p_stage is null then raise exception 'Choose a valid review stage'; end if;
  if length(coalesce(p_remarks,'')) > 6000 then raise exception 'Keep remarks under 6,000 characters'; end if;
  if p_stage in ('for_interview','additional_requirements','rejected') and nullif(btrim(p_remarks),'') is null then
    raise exception 'Add interview instructions, requirements, or a rejection reason';
  end if;
  update public.applications set review_stage = p_stage, cavd_remarks = nullif(btrim(p_remarks),''),
    reviewed_by = auth.uid(), reviewed_at = now(),
    status = case when p_stage = 'rejected' then 'rejected' else 'pending' end,
    decided_by = case when p_stage = 'rejected' then auth.uid() else null end,
    decided_at = case when p_stage = 'rejected' then now() else null end,
    decision_note = case when p_stage = 'rejected' then btrim(p_remarks) else null end
    where id = p_application_id returning * into v_app;
  return v_app;
end
$$;
revoke all on function public.review_adoption_application(uuid,text,text) from public, anon;
grant execute on function public.review_adoption_application(uuid,text,text) to authenticated;

create function public.respond_to_adoption_application(p_application_id uuid, p_response text)
returns public.applications language plpgsql security definer set search_path = public as $$
declare v_app public.applications;
begin
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.id is null or v_app.adopter_id <> auth.uid() then raise exception 'Application not found'; end if;
  if v_app.status <> 'pending' or v_app.review_stage not in ('for_interview','additional_requirements') then
    raise exception 'This application is not awaiting a response';
  end if;
  if nullif(btrim(p_response),'') is null or length(p_response) > 6000 then
    raise exception 'Enter a response of up to 6,000 characters';
  end if;
  update public.applications set applicant_response = btrim(p_response), response_date = now()
    where id = p_application_id returning * into v_app;
  return v_app;
end
$$;
revoke all on function public.respond_to_adoption_application(uuid,text) from public, anon;
grant execute on function public.respond_to_adoption_application(uuid,text) to authenticated;

-- The existing approval RPC also closes competing applications. Keep their
-- detailed stage consistent with that established ownership transfer.
create function public.sync_application_review_stage()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.answers_json is null then
    raise exception 'Complete the adoption questionnaire before approval';
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.review_stage := 'approved';
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    new.review_stage := 'rejected';
  end if;
  if new.status in ('approved','rejected') and old.status is distinct from new.status then
    new.cavd_remarks := coalesce(new.decision_note, new.cavd_remarks);
    new.reviewed_by := coalesce(new.decided_by, auth.uid());
    new.reviewed_at := now();
  end if;
  return new;
end
$$;
create trigger applications_sync_review_stage before update on public.applications
  for each row execute function public.sync_application_review_stage();
