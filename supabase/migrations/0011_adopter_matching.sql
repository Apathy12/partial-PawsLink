-- Adopter preferences and CAVD-reviewed matching traits.
-- Only approved, open listings enter the adopter matching pool. Clinical
-- flags remain visible for context but are not new adoption requirements.

-- Append the pet ID without changing the existing view columns. Adopters use
-- it only to join a public listing to its CAVD-reviewed matching traits.
create or replace view public.public_listings with (security_invoker = false) as
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
    p.source,
    p.id as pet_id
  from public.listings l
  join public.pets p on p.id = l.pet_id
  where l.status = 'approved' and p.registry_status = 'approved';

grant select on public.public_listings to anon, authenticated;

create table public.pet_match_traits (
  pet_id uuid primary key references public.pets (id) on delete cascade,
  activity_level smallint not null check (activity_level between 1 and 5),
  temperament text not null check (temperament in ('calm', 'friendly', 'playful', 'independent', 'protective')),
  child_compatible boolean not null,
  pet_compatible boolean not null,
  space_need smallint not null check (space_need between 1 and 5),
  time_need smallint not null check (time_need between 1 and 5),
  experience_need smallint not null check (experience_need between 1 and 5),
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now()
);

create trigger pet_match_traits_updated_at
  before update on public.pet_match_traits
  for each row execute function public.touch_updated_at();

create table public.adopter_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  preferred_species text not null check (preferred_species in ('any', 'dog', 'cat')),
  preferred_size text not null check (preferred_size in ('any', 'small', 'medium', 'large')),
  preferred_age text not null check (preferred_age in ('any', 'baby', 'young', 'adult', 'senior')),
  activity_preference smallint not null check (activity_preference between 1 and 5),
  temperament_preference text not null check (temperament_preference in ('any', 'calm', 'friendly', 'playful', 'independent', 'protective')),
  living_space smallint not null check (living_space between 1 and 5),
  time_availability smallint not null check (time_availability between 1 and 5),
  children_at_home boolean not null,
  other_pets_at_home boolean not null,
  ownership_experience smallint not null check (ownership_experience between 1 and 5),
  updated_at timestamptz not null default now()
);

create trigger adopter_preferences_updated_at
  before update on public.adopter_preferences
  for each row execute function public.touch_updated_at();

create table public.saved_listings (
  adopter_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (adopter_id, listing_id)
);

create index saved_listings_listing_idx on public.saved_listings (listing_id);

alter table public.pet_match_traits enable row level security;
alter table public.adopter_preferences enable row level security;
alter table public.saved_listings enable row level security;

create policy pet_match_traits_read on public.pet_match_traits
  for select to authenticated
  using (
    public.is_cavd()
    or exists (
      select 1 from public.public_listings l
      where l.pet_id = pet_match_traits.pet_id
    )
  );

create policy pet_match_traits_insert_cavd on public.pet_match_traits
  for insert to authenticated
  with check (public.is_cavd() and updated_by = auth.uid());

create policy pet_match_traits_update_cavd on public.pet_match_traits
  for update to authenticated
  using (public.is_cavd())
  with check (public.is_cavd() and updated_by = auth.uid());

create policy adopter_preferences_read_self on public.adopter_preferences
  for select to authenticated using (user_id = auth.uid());

create policy adopter_preferences_insert_self on public.adopter_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.my_role() = 'user');

create policy adopter_preferences_update_self on public.adopter_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.my_role() = 'user')
  with check (user_id = auth.uid() and public.my_role() = 'user');

create policy saved_listings_read_self on public.saved_listings
  for select to authenticated using (adopter_id = auth.uid());

create policy saved_listings_insert_self on public.saved_listings
  for insert to authenticated
  with check (
    adopter_id = auth.uid()
    and public.my_role() = 'user'
    and public.listing_is_open(listing_id)
  );

create policy saved_listings_delete_self on public.saved_listings
  for delete to authenticated using (adopter_id = auth.uid());

revoke all on public.pet_match_traits, public.adopter_preferences, public.saved_listings from anon;
grant select, insert, update on public.pet_match_traits, public.adopter_preferences to authenticated;
grant select, insert, delete on public.saved_listings to authenticated;
