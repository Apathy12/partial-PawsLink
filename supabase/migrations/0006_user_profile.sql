-- Owner profile details. Auth owns the email address; the public profile row
-- stores only optional details and a path to a public avatar image.
alter table public.profiles
  add column location text,
  add column birth_date date,
  add column avatar_path text,
  add constraint profiles_birth_date_ck check (birth_date is null or birth_date <= current_date),
  add constraint profiles_avatar_path_ck check (avatar_path is null or avatar_path like id::text || '/%');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "profile photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

create policy "users upload their own profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users remove their own profile photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
