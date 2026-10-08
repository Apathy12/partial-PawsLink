-- Applications can begin only from a CAVD-reviewed pet match. Keep existing
-- applications and their sources intact; this changes new submissions only.
create or replace function public.submit_adoption_application(
  p_listing_id uuid, p_answers jsonb, p_source text default 'match'
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
  if p_source is distinct from 'match' then
    raise exception 'Start applications from Find My Pet Match';
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

  select * into v_pref from public.adopter_preferences where user_id = auth.uid();
  select * into v_trait from public.pet_match_traits where pet_id = v_pet.id;
  if v_pref.user_id is null then
    raise exception 'Save your Find My Pet Match preferences before applying';
  end if;
  if v_trait.pet_id is null then
    raise exception 'This pet needs CAVD-reviewed matching traits before applying';
  end if;

  -- Store the score from server-side preferences and traits, never from a
  -- client-provided score. The score informs the review but does not approve it.
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

  if v_app.id is null then
    insert into public.applications (listing_id, adopter_id, pet_name_snapshot, answers_json, application_source, compatibility_score)
      values (p_listing_id, auth.uid(), v_pet.name, p_answers, 'match', v_score) returning id into v_app.id;
  else
    update public.applications set answers_json = p_answers, application_source = 'match',
      compatibility_score = v_score where id = v_app.id;
  end if;
  return v_app.id;
end
$$;
revoke all on function public.submit_adoption_application(uuid,jsonb,text) from public, anon;
grant execute on function public.submit_adoption_application(uuid,jsonb,text) to authenticated;
