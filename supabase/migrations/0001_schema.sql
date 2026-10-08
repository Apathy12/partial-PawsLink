-- PawsLink - CAVD adoption bridge
-- 0001: schema, helper functions, integrity guards, public views.
-- Access control lives in 0002_rls.sql.
--
-- Ordering matters here: SQL-language functions are validated when they are
-- created, so anything that reads a table is defined after the tables. The two
-- plpgsql helpers below are exempt because plpgsql bodies are parsed lazily,
-- which is what lets gen_qr_slug() reference public.pets from a column default.

create extension if not exists pgcrypto;

-- --------------------------------------------------------- column defaults --

-- Short, unambiguous slug for the printed QR tag. Excludes 0/1/i/l/o so it stays
-- readable if someone has to type it off a collar tag.
create or replace function public.gen_qr_slug()
returns text language plpgsql as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.pets where qr_slug = candidate);
  end loop;
  return candidate;
end
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------- profiles --

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'vet', 'cavd')),
  name text not null check (length(btrim(name)) > 0),
  contact text,
  clinic_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. role is issued by CAVD and never by the signing-up client.';

-- -------------------------------------------------------------------- pets --

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  qr_slug text not null unique default public.gen_qr_slug(),
  -- A null owner means the animal sits in CAVD shelter custody.
  owner_id uuid references public.profiles (id) on delete restrict,
  source text not null default 'owner' check (source in ('owner', 'shelter')),
  registry_status text not null default 'pending' check (registry_status in ('pending', 'approved', 'rejected')),

  name text not null check (length(btrim(name)) > 0),
  species text not null check (species in ('dog', 'cat', 'other')),
  breed text,
  sex text not null check (sex in ('male', 'female')),
  size text not null check (size in ('small', 'medium', 'large')),
  birth_date date not null,
  color text,
  markings text,
  about text,
  photo_url text,
  sterilized boolean not null default false,

  -- Public health flags. Only CAVD may set these, and they are the only clinical
  -- facts the anonymous QR page exposes.
  rabies_vaccinated boolean not null default false,
  rabies_vaccinated_on date,

  registry_note text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pets_custody_ck check (owner_id is not null or source = 'shelter'),
  constraint pets_birth_date_ck check (birth_date <= current_date)
);

create index pets_owner_idx on public.pets (owner_id);
create index pets_registry_status_idx on public.pets (registry_status);

-- ------------------------------------------------------------------ visits --

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  -- Snapshot of who wrote the entry, so reading a history never requires reading
  -- anybody else's profile row.
  recorded_by_name text not null,
  clinic_name text not null check (length(btrim(clinic_name)) > 0),
  visit_date date not null,
  summary text not null check (length(btrim(summary)) > 0),
  created_at timestamptz not null default now(),

  -- A CAVD correction never rewrites history silently: it must carry a note.
  corrected_by uuid references public.profiles (id),
  corrected_at timestamptz,
  correction_note text,

  constraint visits_date_ck check (visit_date <= current_date)
);

create index visits_pet_idx on public.visits (pet_id, visit_date desc);

-- ---------------------------------------------------------------- listings --

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  listed_by uuid not null default auth.uid() references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'closed')),
  notes text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

-- A pet can only sit in one live listing at a time.
create unique index listings_one_live_per_pet
  on public.listings (pet_id)
  where status in ('pending', 'approved');

create index listings_status_idx on public.listings (status);

-- ------------------------------------------------------------ applications --

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  adopter_id uuid not null default auth.uid() references public.profiles (id),
  message text not null check (length(btrim(message)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (listing_id, adopter_id)
);

create index applications_listing_idx on public.applications (listing_id);
create index applications_adopter_idx on public.applications (adopter_id);

-- ----------------------------------------------------------------- helpers --
-- SECURITY DEFINER so that a policy on profiles or pets can call these without
-- recursing into the very policy being evaluated.

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_cavd()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'cavd' from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;

-- A disabled account (is_active = false) stops satisfying this, which is how
-- "CAVD can disable vet accounts" is enforced.
create or replace function public.is_vet()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'vet' from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;

create or replace function public.owns_pet(p_pet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid())
$$;

create or replace function public.pet_is_approved(p_pet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pets where id = p_pet and registry_status = 'approved')
$$;

create or replace function public.listing_pet(p_listing uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select pet_id from public.listings where id = p_listing
$$;

create or replace function public.listing_is_open(p_listing uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.listings where id = p_listing and status = 'approved')
$$;

-- ---------------------------------------------------------------- new users --

-- Signup always lands as a plain user. Vet and CAVD accounts are issued by CAVD,
-- so client-supplied metadata cannot elevate a role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, name, contact)
  values (
    new.id,
    'user',
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    nullif(btrim(new.raw_user_meta_data ->> 'contact'), '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ guards --
-- RLS decides which rows a role may touch. These triggers decide which columns,
-- which is the part RLS cannot express.

create or replace function public.guard_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_cavd() then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'Only CAVD staff can change an account role';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Only CAVD staff can enable or disable an account';
  end if;
  return new;
end
$$;

create trigger guard_profiles_update
  before update on public.profiles
  for each row execute function public.guard_profiles();

-- An owner may correct their pet's biodata. Registry status, ownership, custody
-- and the public health flags are CAVD's to write. The QR slug is immutable for
-- everyone, because it is printed on a physical tag.
create or replace function public.guard_pets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
  return new;
end
$$;

create trigger guard_pets_update
  before update on public.pets
  for each row execute function public.guard_pets();

create trigger pets_touch
  before update on public.pets
  for each row execute function public.touch_updated_at();

create or replace function public.stamp_visit_recorder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.recorded_by_name is null or btrim(new.recorded_by_name) = '' then
    select coalesce(p.clinic_name, p.name) into new.recorded_by_name
      from public.profiles p where p.id = new.recorded_by;
  end if;
  if new.recorded_by_name is null then
    raise exception 'Cannot record a visit without a recorder name';
  end if;
  return new;
end
$$;

create trigger visits_stamp_recorder
  before insert on public.visits
  for each row execute function public.stamp_visit_recorder();

-- Append-only. Nobody deletes a visit, including anything running with the
-- service key, which is why this is a trigger and not only a policy. Only CAVD
-- may edit one, and only with an audit note; the pet, the recorder and the
-- creation time stay as originally written.
create or replace function public.guard_visits()
returns trigger language plpgsql security definer set search_path = public as $$
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

create trigger guard_visits_update
  before update on public.visits
  for each row execute function public.guard_visits();

create trigger guard_visits_delete
  before delete on public.visits
  for each row execute function public.guard_visits();

create or replace function public.guard_listings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pet_id is distinct from old.pet_id or new.listed_by is distinct from old.listed_by then
    raise exception 'A listing cannot be moved to another pet or requester';
  end if;
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can decide a listing';
  end if;
  return new;
end
$$;

create trigger guard_listings_update
  before update on public.listings
  for each row execute function public.guard_listings();

create or replace function public.guard_applications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.listing_id is distinct from old.listing_id or new.adopter_id is distinct from old.adopter_id then
    raise exception 'An application cannot be moved to another listing or adopter';
  end if;
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can decide an application';
  end if;
  return new;
end
$$;

create trigger guard_applications_update
  before update on public.applications
  for each row execute function public.guard_applications();

-- ---------------------------------------------------- the transfer, atomic --
-- Approving an adoption touches three tables and closes the rival applications.
-- It runs as one function so the registry can never end up half-transferred, and
-- so the whole rule sits in one auditable place.

create or replace function public.approve_application(p_application_id uuid, p_note text default null)
returns public.applications
language plpgsql security definer set search_path = public as $$
declare
  v_app public.applications;
  v_listing public.listings;
  v_pet_id uuid;
begin
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can approve an adoption';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'Application not found';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'This application has already been decided';
  end if;

  select * into v_listing from public.listings where id = v_app.listing_id for update;
  if v_listing.status <> 'approved' then
    raise exception 'The listing is not open, so the adoption cannot be approved';
  end if;
  v_pet_id := v_listing.pet_id;

  update public.applications
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = v_app.id
   returning * into v_app;

  -- Ownership moves to the adopter and the animal leaves shelter custody.
  update public.pets
     set owner_id = v_app.adopter_id, source = 'owner'
   where id = v_pet_id;

  update public.listings
     set status = 'closed', decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(decision_note, 'Closed on adoption transfer')
   where id = v_listing.id;

  -- Everyone else queued on this pet is closed out with a stated reason.
  update public.applications
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = 'Closed automatically: this pet was adopted by another applicant.'
   where listing_id = v_listing.id and id <> v_app.id and status = 'pending';

  return v_app;
end
$$;

-- -------------------------------------------------------------- public read --
-- These views deliberately run with the definer's rights (security_invoker off)
-- so an anonymous visitor can read approved records through them while having no
-- access at all to the base tables. Columns are listed explicitly: owner
-- identity, contact details and clinical notes are not among them.

create view public.public_pets with (security_invoker = false) as
  select
    p.qr_slug,
    p.name,
    p.species,
    p.breed,
    p.sex,
    p.size,
    p.birth_date,
    p.photo_url,
    p.sterilized,
    p.rabies_vaccinated,
    p.rabies_vaccinated_on,
    p.source,
    (l.id is not null) as is_listed,
    l.id as listing_id
  from public.pets p
  left join public.listings l on l.pet_id = p.id and l.status = 'approved'
  where p.registry_status = 'approved';

comment on view public.public_pets is
  'Anonymous QR profile: identity plus CAVD-marked health flags. No owner, no contact, no clinical notes.';

create view public.public_listings with (security_invoker = false) as
  select
    l.id as listing_id,
    l.notes as listing_notes,
    l.created_at as listed_at,
    p.qr_slug,
    p.name,
    p.species,
    p.breed,
    p.sex,
    p.size,
    p.birth_date,
    p.about,
    p.photo_url,
    p.sterilized,
    p.rabies_vaccinated,
    p.rabies_vaccinated_on,
    p.source
  from public.listings l
  join public.pets p on p.id = l.pet_id
  where l.status = 'approved' and p.registry_status = 'approved';

comment on view public.public_listings is
  'The public adoption bridge: CAVD-approved listings only.';

-- ------------------------------------------------------------------ grants --

revoke all on public.profiles, public.pets, public.visits, public.listings, public.applications from anon;

grant select, insert, update on public.profiles, public.pets, public.visits, public.listings, public.applications
  to authenticated;

grant select on public.public_pets, public.public_listings to anon, authenticated;
grant execute on function public.approve_application(uuid, text) to authenticated;
