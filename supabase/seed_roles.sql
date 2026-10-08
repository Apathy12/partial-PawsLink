-- Run this in the Supabase SQL editor AFTER the four demo users exist in
-- Authentication (either created by `npm run seed` or by hand).
-- It only assigns roles. It never writes passwords.

begin;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.profiles
   set role = 'user', name = 'Ana Reyes', contact = '0917 555 0101', verification_exempt = true
 where id = (select id from auth.users where email = 'user@demo.local');

update public.profiles
   set role = 'user', name = 'Ben Santos', contact = '0918 555 0102', verification_exempt = true
 where id = (select id from auth.users where email = 'adopter@demo.local');

update public.profiles
   set role = 'vet', name = 'Dr. Liza Ramos', contact = '085 555 0200',
       clinic_name = 'Butuan Pet Clinic', is_active = true, verification_exempt = true
 where id = (select id from auth.users where email = 'vet@demo.local');

update public.profiles
   set role = 'cavd', name = 'CAVD Registry Desk', contact = '(085) 342-1111',
       clinic_name = 'CAVD Animal Health Unit', is_active = true, verification_exempt = true
 where id = (select id from auth.users where email = 'cavd@demo.local');

commit;
