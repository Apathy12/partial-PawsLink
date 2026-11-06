-- A signed-in adopter can send an available pet directly to the CAVD queue.
-- Matching and questionnaire submissions continue through their existing RPC.
alter table public.applications drop constraint applications_application_source_check;
alter table public.applications add constraint applications_application_source_check
  check (application_source in ('legacy', 'explore', 'match', 'direct'));

create function public.submit_direct_adoption_application(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_pet public.pets;
  v_app public.applications;
begin
  if auth.uid() is null or public.my_role() is distinct from 'user' then
    raise exception 'Only verified, active adopters can submit applications';
  end if;
  select * into v_listing from public.listings where id = p_listing_id for update;
  if v_listing.id is null or v_listing.status <> 'approved' then
    raise exception 'This listing is no longer open';
  end if;
  select * into v_pet from public.pets where id = v_listing.pet_id for update;
  if v_pet.id is null or v_pet.registry_status <> 'approved' or v_pet.owner_id = auth.uid() then
    raise exception 'This pet is not available for your application';
  end if;
  select * into v_app from public.applications
    where listing_id = p_listing_id and adopter_id = auth.uid();
  -- Repeated clicks return the existing request without inserting duplicates
  -- or replacing completed questionnaires, decisions, or review history.
  if v_app.id is not null then return v_app.id; end if;

  insert into public.applications
    (listing_id, adopter_id, pet_name_snapshot, application_source)
    values (p_listing_id, auth.uid(), v_pet.name, 'direct') returning id into v_app.id;
  return v_app.id;
end
$$;
revoke all on function public.submit_direct_adoption_application(uuid) from public, anon;
grant execute on function public.submit_direct_adoption_application(uuid) to authenticated;

-- CAVD can approve a direct request after the same mandatory validation and
-- ownership-transfer transaction used for all other adoption applications.
create or replace function public.sync_application_review_stage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.answers_json is null and new.application_source <> 'direct' then
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
