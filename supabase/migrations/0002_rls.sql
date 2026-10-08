-- PawsLink - 0002: row level security.
-- Every table denies by default. Hiding a menu in the UI is not security; these
-- policies are what actually stop a role from doing someone else's job.
--
-- Note on omissions: there is intentionally no DELETE policy on any table. A
-- municipal registry keeps its records, and visits are append-only by design.

alter table public.profiles enable row level security;
alter table public.pets enable row level security;
alter table public.visits enable row level security;
alter table public.listings enable row level security;
alter table public.applications enable row level security;

-- ---------------------------------------------------------------- profiles --

create policy profiles_select_self_or_cavd on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_cavd());

-- Signup normally creates the row through the auth trigger; this covers a client
-- that upserts its own profile. role is pinned so nobody can self-elevate.
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'user');

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- CAVD issues and disables vet accounts.
create policy profiles_insert_cavd on public.profiles
  for insert to authenticated
  with check (public.is_cavd());

create policy profiles_update_cavd on public.profiles
  for update to authenticated
  using (public.is_cavd())
  with check (public.is_cavd());

-- -------------------------------------------------------------------- pets --

-- Owners see their own pets. Vets see any approved pet (that is what lookup is).
-- CAVD sees everything.
create policy pets_select on public.pets
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_cavd()
    or (public.is_vet() and registry_status = 'approved')
  );

-- A user registers their own pet, and it always starts pending.
create policy pets_insert_owner on public.pets
  for insert to authenticated
  with check (
    public.my_role() = 'user'
    and owner_id = auth.uid()
    and created_by = auth.uid()
    and source = 'owner'
    and registry_status = 'pending'
  );

-- Shelter intake: CAVD creates a record already under city custody.
create policy pets_insert_cavd on public.pets
  for insert to authenticated
  with check (public.is_cavd());

-- Biodata corrections by the owner. guard_pets() blocks the columns that are
-- CAVD's to write, so this policy does not have to enumerate them.
create policy pets_update_owner on public.pets
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy pets_update_cavd on public.pets
  for update to authenticated
  using (public.is_cavd())
  with check (public.is_cavd());

-- ------------------------------------------------------------------ visits --

create policy visits_select on public.visits
  for select to authenticated
  using (public.is_cavd() or public.is_vet() or public.owns_pet(pet_id));

-- A vet appends to an approved pet, as themselves.
create policy visits_insert_vet on public.visits
  for insert to authenticated
  with check (public.is_vet() and recorded_by = auth.uid() and public.pet_is_approved(pet_id));

create policy visits_insert_cavd on public.visits
  for insert to authenticated
  with check (public.is_cavd() and recorded_by = auth.uid());

-- Corrections only, and guard_visits() additionally demands a correction note.
create policy visits_update_cavd on public.visits
  for update to authenticated
  using (public.is_cavd())
  with check (public.is_cavd());

-- ---------------------------------------------------------------- listings --

-- Approved listings are readable by any signed-in user; a requester can always
-- see their own pending or rejected request.
create policy listings_select on public.listings
  for select to authenticated
  using (
    status = 'approved'
    or public.is_cavd()
    or listed_by = auth.uid()
    or public.owns_pet(pet_id)
  );

-- An owner may request a listing only for their own, already approved pet, and
-- the request always starts pending.
create policy listings_insert_owner on public.listings
  for insert to authenticated
  with check (
    public.my_role() = 'user'
    and listed_by = auth.uid()
    and status = 'pending'
    and public.owns_pet(pet_id)
    and public.pet_is_approved(pet_id)
  );

-- CAVD lists a shelter animal, which may be published immediately.
create policy listings_insert_cavd on public.listings
  for insert to authenticated
  with check (public.is_cavd() and public.pet_is_approved(pet_id));

create policy listings_update_cavd on public.listings
  for update to authenticated
  using (public.is_cavd())
  with check (public.is_cavd());

-- ------------------------------------------------------------ applications --

-- An adopter sees their own applications. CAVD sees all of them. A rehoming
-- owner deliberately does not see who applied: the adopter's message and
-- identity stay with CAVD until CAVD decides.
create policy applications_select on public.applications
  for select to authenticated
  using (adopter_id = auth.uid() or public.is_cavd());

create policy applications_insert_adopter on public.applications
  for insert to authenticated
  with check (
    adopter_id = auth.uid()
    and status = 'pending'
    and public.listing_is_open(listing_id)
    and not public.owns_pet(public.listing_pet(listing_id))
  );

create policy applications_update_cavd on public.applications
  for update to authenticated
  using (public.is_cavd())
  with check (public.is_cavd());
