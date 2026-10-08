-- PawsLink - 0003: pet photo storage.
-- One public bucket. Reads are public because the photo appears on the public QR
-- profile and on adoption listings. Writes are restricted to a signed-in user's
-- own folder, so nobody can overwrite another person's upload.

insert into storage.buckets (id, name, public)
values ('pet-photos', 'pet-photos', true)
on conflict (id) do nothing;

create policy "pet photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'pet-photos');

-- Uploads go to <auth.uid()>/<filename>.
create policy "users upload pet photos into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users replace their own pet photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "cavd manages any pet photo"
  on storage.objects for all to authenticated
  using (bucket_id = 'pet-photos' and public.is_cavd())
  with check (bucket_id = 'pet-photos' and public.is_cavd());
