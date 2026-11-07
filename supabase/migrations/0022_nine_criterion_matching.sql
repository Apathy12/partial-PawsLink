-- Align compatibility scoring with the study's documented model.
--
-- Stage 1 excludes an animal-type mismatch before scoring, so animal type is no
-- longer a weighted criterion. Stage 2 scores nine criteria: size, age, activity,
-- temperament, space, care time, children, other pets and ownership experience.
-- The prototype configuration gives each criterion an equal 1/9 weight.
--
-- Applications submitted earlier keep their captured score, weights and version.

-- Nine-criterion scoring used when a matched application is submitted.
create or replace function public.match_score_with_weights(p public.pets, pref public.adopter_preferences,
  trait public.pet_match_traits, weights jsonb)
returns numeric language sql stable set search_path = '' as $$
  select round(100 * sum((weights->>criterion)::numeric * value),1) from (values
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

-- CAVD weight changes must cover exactly the nine scored criteria.
create or replace function public.set_match_weights(p_weights jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_total numeric;
begin
  if not public.is_cavd() then raise exception 'Only CAVD staff can change compatibility weights'; end if;
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then raise exception 'Provide all nine criterion weights'; end if;
  if (select count(*) from jsonb_object_keys(p_weights)) <> 9 or not (p_weights ?& array[
    'size','age','activity','temperament','space','time','children','other_pets','experience']) then
    raise exception 'Provide exactly the nine supported criterion weights';
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

-- Replace the ten-criterion configuration with equal nine-criterion weights as a
-- new, unconfirmed version. Earlier versions stay in the history.
with updated as (
  update public.match_settings set
    weights = '{"size":0.111111111111111111,"age":0.111111111111111111,"activity":0.111111111111111111,"temperament":0.111111111111111111,"space":0.111111111111111111,"time":0.111111111111111111,"children":0.111111111111111111,"other_pets":0.111111111111111111,"experience":0.111111111111111111}'::jsonb,
    version = version + 1, updated_by = null, updated_at = now()
  where singleton returning version, weights
)
insert into public.match_weight_history(version,weights) select version,weights from updated;
