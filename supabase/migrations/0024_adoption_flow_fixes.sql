-- Adoption flow fixes found by the end-to-end scenario tests.

-- 1. A listing closed or rejected by CAVD (not by an adoption) declines its open
--    applications, so no applicant is left waiting on a listing that no longer exists.
create function public.settle_closed_listing_applications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('pending', 'approved') and new.status in ('closed', 'rejected')
     -- An adoption transfer closes the listing after approving one application; it declines the rest itself.
     and not exists (select 1 from public.applications where listing_id = new.id and status = 'approved') then
    update public.applications
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = 'Closed by CAVD: ' || coalesce(nullif(btrim(new.decision_note), ''), 'this pet is no longer open for adoption.')
     where listing_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
create trigger listings_settle_applications after update on public.listings
  for each row execute function public.settle_closed_listing_applications();
revoke execute on function public.settle_closed_listing_applications() from public, anon, authenticated;

-- 2. Once a registration is decided, only CAVD changes the sterilisation flag, like the rabies flags.
create function public.protect_sterilization_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if not public.is_cavd() and old.registry_status <> 'pending' and new.sterilized is distinct from old.sterilized then
    raise exception 'Only CAVD staff can set public health flags';
  end if;
  return new;
end $$;
create trigger pets_protect_sterilization before update on public.pets
  for each row execute function public.protect_sterilization_flag();
revoke execute on function public.protect_sterilization_flag() from public, anon, authenticated;

-- 3. Same function as 0020, except an owner applying for their own pet is told so.
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
  if p.owner_id = auth.uid() then
    raise exception 'You cannot apply to adopt your own pet';
  end if;
  if not public.pet_is_adoption_eligible(p.id) then
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
