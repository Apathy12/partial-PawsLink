-- Security hardening for the matching-only adoption flow.

-- Browser checks can be bypassed. Storage must enforce the same upload limits.
update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'pet-photos';

-- Every CAVD policy and privileged RPC already calls is_cavd(). Requiring an
-- aal2 JWT here protects all of them, including Storage and private ID reads.
create or replace function public.is_cavd()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.role = 'cavd'
    from public.profiles p
    where p.id = auth.uid() and p.is_active
  ), false) and coalesce(auth.jwt()->>'aal', '') = 'aal2'
$$;

-- Keep a signed-in person's own profile readable at aal1 so the UI can guide
-- a CAVD staff member through MFA enrollment. Other accounts remain hidden.

-- A per-account quota prevents a signed-in adopter from submitting dozens of
-- applications to different pets in one day. It applies to direct API writes.
create index if not exists applications_adopter_created_idx
  on public.applications (adopter_id, created_at desc);

create function public.limit_application_submissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  -- Serialize submissions from the same account so concurrent requests cannot
  -- each see the same pre-insert count and pass the quota together.
  perform 1 from public.profiles where id = new.adopter_id for update;
  if (select count(*) from public.applications a
      where a.adopter_id = new.adopter_id
        and a.created_at >= now() - interval '24 hours') >= 10 then
    raise exception 'Application limit reached. Please try again tomorrow.';
  end if;
  return new;
end
$$;

create trigger applications_daily_limit
  before insert on public.applications
  for each row execute function public.limit_application_submissions();

-- Stage and decision changes remain visible even when an application is edited
-- again. Store no questionnaire answers or ID documents in the history.
create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  actor_id uuid references public.profiles(id),
  old_status text,
  new_status text not null,
  old_stage text,
  new_stage text,
  remarks text,
  created_at timestamptz not null default now()
);
create index application_events_application_idx
  on public.application_events (application_id, created_at desc);
alter table public.application_events enable row level security;
revoke all on public.application_events from public, anon, authenticated;
grant select on public.application_events to authenticated;
create policy application_events_read on public.application_events
  for select to authenticated using (
    public.is_cavd() or exists (
      select 1 from public.applications a
      where a.id = application_id and a.adopter_id = auth.uid()
    )
  );

create function public.record_application_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (
      application_id, actor_id, new_status, new_stage, remarks
    ) values (new.id, auth.uid(), new.status, new.review_stage,
      coalesce(new.cavd_remarks, new.decision_note));
    return new;
  end if;
  if old.status is distinct from new.status
     or old.review_stage is distinct from new.review_stage
     or old.cavd_remarks is distinct from new.cavd_remarks then
    insert into public.application_events (
      application_id, actor_id, old_status, new_status, old_stage, new_stage, remarks
    ) values (new.id, auth.uid(), old.status, new.status, old.review_stage,
      new.review_stage, coalesce(new.cavd_remarks, new.decision_note));
  end if;
  return new;
end
$$;
create trigger applications_record_event
  after insert or update on public.applications
  for each row execute function public.record_application_event();

create function public.prevent_application_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Application history cannot be changed or deleted';
end
$$;
create trigger application_events_immutable
  before update or delete on public.application_events
  for each row execute function public.prevent_application_event_mutation();

-- Definer functions should not resolve unqualified application objects through
-- public. Existing function bodies use schema-qualified application references.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname = any(array[
        'accept_owner_identity_on_submit', 'approve_application',
        'audit_pet_details', 'audit_visit_correction', 'cavd_account_auth',
        'gen_qr_slug', 'guard_applications', 'guard_listings', 'guard_pets',
        'guard_profiles', 'guard_verification_request', 'guard_visit_document',
        'guard_visit_verification', 'guard_visits', 'handle_new_user',
        'identity_approved', 'is_cavd', 'is_vet', 'issue_verified_vet_role',
        'limit_application_submissions', 'listing_is_open', 'listing_pet',
        'my_role', 'owns_pet', 'pet_is_approved',
        'prevent_adoption_record_mutation', 'prevent_application_event_mutation',
        'record_application_event', 'respond_to_adoption_application',
        'review_adoption_application', 'stamp_visit_recorder',
        'stamp_visit_verification', 'submit_adoption_application',
        'sync_application_review_stage', 'touch_updated_at'
      ])
  loop
    execute format('alter function %s set search_path = %L', f.signature, '');
  end loop;
end
$$;

-- Internal trigger functions are never intended as Data API endpoints.
revoke all on function public.limit_application_submissions() from public, anon, authenticated;
revoke all on function public.record_application_event() from public, anon, authenticated;
revoke all on function public.prevent_application_event_mutation() from public, anon, authenticated;
