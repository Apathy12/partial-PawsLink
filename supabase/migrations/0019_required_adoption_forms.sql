-- All new applications include the assessment form. Matching stays optional.
create or replace function public.submit_adoption_application(p_listing_id uuid,p_answers jsonb,p_source text default 'explore')
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.applications; l public.listings; p public.pets;
  pref public.adopter_preferences; trait public.pet_match_traits; settings public.match_settings; score numeric;
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
  end if;
  if a.id is null then
    insert into public.applications(listing_id,adopter_id,pet_name_snapshot,answers_json,application_source,
      compatibility_score,compatibility_weights_json,compatibility_weights_version)
    values(p_listing_id,auth.uid(),p.name,p_answers,p_source,score,settings.weights,settings.version) returning id into a.id;
  else
    -- Upgrade an earlier pending request without deleting its history or remarks.
    update public.applications set answers_json = p_answers,application_source = p_source,compatibility_score = score,
      compatibility_weights_json = settings.weights,compatibility_weights_version = settings.version where id = a.id;
  end if;
  return a.id;
end $$;
revoke all on function public.submit_adoption_application(uuid,jsonb,text) from public, anon;
grant execute on function public.submit_adoption_application(uuid,jsonb,text) to authenticated;

-- Keep the old endpoint as an explicit refusal for older clients.
create or replace function public.submit_direct_adoption_application(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Complete the adoption application form before sending it to CAVD';
end $$;

create or replace function public.sync_application_review_stage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.answers_json is null then
    raise exception 'Complete the adoption application form before approval';
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
end $$;

notify pgrst, 'reload schema';
