/**
 * Executes supabase/migrations against a throwaway Postgres and asserts the
 * permission matrix from the spec: what each role can and cannot do.
 *
 *   npm run test:rls
 *
 * This proves the RLS policies instead of trusting them. It needs no Docker and
 * no Supabase project: embedded-postgres supplies the server and
 * supabase/tests/_supabase_shim.sql stands in for the auth and storage schemas.
 *
 * Two kinds of refusal are distinguished on purpose:
 *   denied()   - the database raises (a WITH CHECK violation, or a guard trigger)
 *   noEffect() - the policy's USING clause hides the row, so the write matches
 *                nothing and silently affects 0 rows
 * Both are safe; they just fail differently, and the UI has to handle each.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dataDir = join(tmpdir(), 'pawslink-pgtest');
const PORT = 54329;

const ID = {
  cavd: 'aaaaaaaa-0000-4000-8000-000000000001',
  vet: 'aaaaaaaa-0000-4000-8000-000000000002',
  vetOff: 'aaaaaaaa-0000-4000-8000-000000000003',
  owner: 'bbbbbbbb-0000-4000-8000-000000000001',
  adopter: 'bbbbbbbb-0000-4000-8000-000000000002',
  other: 'bbbbbbbb-0000-4000-8000-000000000003',
  freshOwner: 'cccccccc-0000-4000-8000-000000000001',
  freshVet: 'cccccccc-0000-4000-8000-000000000002',
  freshRejected: 'cccccccc-0000-4000-8000-000000000003',
  legacyOwner: 'cccccccc-0000-4000-8000-000000000004',
  legacyMissing: 'cccccccc-0000-4000-8000-000000000005',
  legacyVet: 'cccccccc-0000-4000-8000-000000000006',
  upgrade: 'dddddddd-0000-4000-8000-000000000001'
};

let pass = 0;
const applicationAnswers = {
  full_name: 'Adopter Ben', address: 'Butuan City', phone: '09170000000',
  email: 'adopter@demo.local', birth_date: '1995-01-01', occupation: 'Teacher',
  alternate_contact: 'Maria', alternate_relationship: 'Sister', alternate_phone: '09171111111',
  residence: 'House', housing: 'Own', pets_allowed: 'Yes', household: 'Lives with family',
  children_present: 'No', children: 'Not applicable', elderly: 'No', allergies: 'No',
  household_support: 'Yes', support_details: 'Not applicable',
  caregiver: 'I will care for the pet', financial_caregiver: 'I will pay expenses',
  hours_alone: '3', pet_space: 'Inside the house', backup_care: 'My sister',
  care_plan: 'Food, vaccinations, vet visits, exercise, and shelter',
  introduction: 'Gradual introductions and a quiet first week',
  ownership_experience: 'First-time owner', previous_details: 'Not applicable',
  current_pets: 'No', current_details: 'Not applicable',
  reason: 'Looking for a companion', behavior_plan: 'Seek help and use patient training',
  moving_plan: 'The pet moves with us', declaration: true
};

let fail = 0;
const failures = [];

function ok(name) { pass++; console.log('  PASS  ' + name); }
function bad(name, detail) {
  fail++;
  failures.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : ''));
}
function section(t) { console.log('\n' + t); }

let client;

/** Run fn inside a transaction acting as a signed-in user, then always roll back. */
async function act(userId, fn) {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId ?? '']);
    await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ aal: userId === ID.cavd ? 'aal2' : 'aal1' })]);
    return await fn();
  } finally {
    await client.query('rollback').catch(() => {});
  }
}

/** Persist a reviewed request so later checks can act as other users. */
async function commitAs(userId, fn) {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);
    await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ aal: userId === ID.cavd ? 'aal2' : 'aal1' })]);
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function asRole(role, fn) {
  await client.query('begin');
  try {
    await client.query('set local role ' + role);
    return await fn();
  } finally {
    await client.query('rollback').catch(() => {});
  }
}

async function allowed(name, userId, sql, params = []) {
  try {
    const r = await act(userId, () => client.query(sql, params));
    if (r.rowCount === 0 && /^\s*(update|delete)/i.test(sql)) {
      bad(name, 'the statement was permitted but matched 0 rows');
      return null;
    }
    ok(name);
    return r;
  } catch (e) {
    bad(name, 'expected success, got: ' + e.message);
    return null;
  }
}

async function denied(name, userId, sql, params = [], expect = null) {
  try {
    await act(userId, () => client.query(sql, params));
    bad(name, 'expected the database to raise, but the statement succeeded');
  } catch (e) {
    if (expect && !new RegExp(expect, 'i').test(e.message)) bad(name, 'refused for the wrong reason: ' + e.message);
    else ok(name);
  }
}

/** The write is invisible to this role: it matches no rows rather than raising. */
async function noEffect(name, userId, sql, params = []) {
  try {
    const r = await act(userId, () => client.query(sql, params));
    if (r.rowCount === 0) ok(name);
    else bad(name, 'the statement changed ' + r.rowCount + ' row(s)');
  } catch (e) {
    ok(name + ' (raised: ' + e.code + ')');
  }
}

async function rows(name, userId, sql, predicate, params = []) {
  try {
    const r = await act(userId, () => client.query(sql, params));
    const verdict = predicate(r.rows);
    if (verdict === true) ok(name);
    else bad(name, typeof verdict === 'string' ? verdict : 'unexpected rows: ' + JSON.stringify(r.rows));
  } catch (e) {
    bad(name, 'query failed: ' + e.message);
  }
}

async function main() {
  await rm(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false
  });

  console.log('Starting a throwaway Postgres on port ' + PORT + ' ...');
  await pg.initialise();
  await pg.start();
  client = pg.getPgClient();
  await client.connect();

  try {
    section('Migrations');
    let upgradeFixture = null;
    for (const [rel, label] of [
      ['supabase/tests/_supabase_shim.sql', 'test shim (auth + storage stand-ins)'],
      ['supabase/migrations/0001_schema.sql', '0001_schema.sql'],
      ['supabase/migrations/0002_rls.sql', '0002_rls.sql'],
      ['supabase/migrations/0003_storage.sql', '0003_storage.sql'],
      ['supabase/migrations/0004_service_role_bootstrap.sql', '0004_service_role_bootstrap.sql'],
      ['supabase/migrations/0005_identity_verification.sql', '0005_identity_verification.sql'],
      ['supabase/migrations/0006_user_profile.sql', '0006_user_profile.sql'],
      ['supabase/migrations/0007_pet_health_records.sql', '0007_pet_health_records.sql'],
      ['supabase/migrations/0008_rejected_identity_cleanup.sql', '0008_rejected_identity_cleanup.sql'],
      ['supabase/migrations/0009_owner_id_immediate_access.sql', '0009_owner_id_immediate_access.sql'],
      ['supabase/migrations/0010_cavd_account_auth.sql', '0010_cavd_account_auth.sql'],
      ['supabase/migrations/0011_adopter_matching.sql', '0011_adopter_matching.sql'],
      ['supabase/migrations/0012_adoption_application_review.sql', '0012_adoption_application_review.sql']
    ]) {
      if (label === '0012_adoption_application_review.sql') {
        await client.query(`insert into auth.users (id, email, raw_user_meta_data)
          values ($1, 'upgrade@demo.local', '{"name":"Upgrade Fixture"}')`, [ID.upgrade]);
        const pet = (await client.query(`insert into public.pets
          (created_by, source, registry_status, name, species, sex, size, birth_date)
          values ($1, 'shelter', 'approved', 'Legacy Pet', 'dog', 'male', 'small', '2022-01-01') returning id`,
          [ID.upgrade])).rows[0];
        const listing = (await client.query(`insert into public.listings
          (pet_id, listed_by, status, decided_by, decided_at)
          values ($1, $2, 'approved', $2, now()) returning id`, [pet.id, ID.upgrade])).rows[0];
        const app = (await client.query(`insert into public.applications
          (listing_id, adopter_id, message, status, decision_note)
          values ($1, $2, 'Earlier message', 'approved', 'Earlier decision') returning id`,
          [listing.id, ID.upgrade])).rows[0];
        upgradeFixture = { petId: pet.id, listingId: listing.id, appId: app.id };
      }
      const sql = await readFile(join(root, rel), 'utf8');
      try {
        await client.query(sql);
        ok('applied ' + label);
        if (label === '0012_adoption_application_review.sql' && upgradeFixture) {
          const row = (await client.query(`select review_stage, pet_name_snapshot, answers_json, message
            from public.applications where id = $1`, [upgradeFixture.appId])).rows[0];
          if (row?.review_stage === 'approved' && row?.pet_name_snapshot === 'Legacy Pet' &&
              row?.answers_json === null && row?.message === 'Earlier message') {
            ok('upgrade preserves earlier application and decision without invented answers');
          } else bad('upgrade preserves earlier application and decision without invented answers', JSON.stringify(row));
          await client.query('delete from public.applications where id = $1', [upgradeFixture.appId]);
          await client.query('delete from public.listings where id = $1', [upgradeFixture.listingId]);
          await client.query('delete from public.pets where id = $1', [upgradeFixture.petId]);
          await client.query('delete from auth.users where id = $1', [ID.upgrade]);
        }
        if (label === '0008_rejected_identity_cleanup.sql') {
          await client.query(`insert into auth.users (id, email, raw_user_meta_data) values
            ($1, 'legacy-owner@example.com', '{"name":"Legacy Owner"}'),
            ($2, 'legacy-missing@example.com', '{"name":"Legacy Missing"}'),
            ($3, 'legacy-vet@example.com', '{"name":"Legacy Vet","requested_role":"vet"}')`,
            [ID.legacyOwner, ID.legacyMissing, ID.legacyVet]);
          await client.query(`insert into storage.objects (bucket_id, name, owner) values
            ('identity-documents', $1, $2), ('identity-documents', $3, $4)`,
            [ID.legacyOwner + '/id.jpg', ID.legacyOwner, ID.legacyVet + '/prc.jpg', ID.legacyVet]);
          await client.query(`insert into public.verification_requests
            (user_id, requested_role, id_type, id_path, clinic_name, prc_number) values
            ($1, 'user', 'national_id', $2, null, null),
            ($3, 'user', 'passport', $4, null, null),
            ($5, 'vet', 'prc_id', $6, 'Legacy Clinic', 'PRC-OLD')`,
            [ID.legacyOwner, ID.legacyOwner + '/id.jpg', ID.legacyMissing, ID.legacyMissing + '/missing.jpg',
              ID.legacyVet, ID.legacyVet + '/prc.jpg']);
        }
        if (label === '0009_owner_id_immediate_access.sql') {
          const migrated = await client.query(`select user_id, status, review_note
            from public.verification_requests where user_id in ($1, $2, $3)`,
            [ID.legacyOwner, ID.legacyMissing, ID.legacyVet]);
          const present = migrated.rows.find(r => r.user_id === ID.legacyOwner);
          const missing = migrated.rows.find(r => r.user_id === ID.legacyMissing);
          const vet = migrated.rows.find(r => r.user_id === ID.legacyVet);
          if (present?.status === 'approved' && missing?.status === 'rejected'
              && /not found/i.test(missing.review_note) && vet?.status === 'pending') {
            ok('legacy owner is activated; missing upload can be resubmitted; vet still waits');
          } else {
            bad('legacy owner ID backfill', JSON.stringify(migrated.rows));
          }
          await client.query(`delete from storage.objects where bucket_id = 'identity-documents' and name in ($1, $2)`,
            [ID.legacyOwner + '/id.jpg', ID.legacyVet + '/prc.jpg']);
          await client.query('delete from auth.users where id in ($1, $2, $3)',
            [ID.legacyOwner, ID.legacyMissing, ID.legacyVet]);
        }
      } catch (e) {
        bad('applied ' + label, e.message + (e.position ? ' (at character ' + e.position + ')' : ''));
        throw e;
      }
    }

    // Seeded as superuser, which bypasses RLS, so the checks start from a known
    // state without depending on the policies under test.
    section('Seed');
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data) values
         ($1, 'cavd@demo.local',   '{"name":"CAVD Office"}'),
         ($2, 'vet@demo.local',    '{"name":"Dr. Reyes"}'),
         ($3, 'vetoff@demo.local', '{"name":"Dr. Disabled"}'),
         ($4, 'user@demo.local',   '{"name":"Owner Ana"}'),
         ($5, 'adopter@demo.local','{"name":"Adopter Ben"}'),
         ($6, 'other@demo.local',  '{"name":"Other Carl"}')`,
      [ID.cavd, ID.vet, ID.vetOff, ID.owner, ID.adopter, ID.other]
    );

    const profs = await client.query('select role from public.profiles');
    if (profs.rows.length === 6 && profs.rows.every(r => r.role === 'user')) {
      ok('the auth trigger created one profile per user, every one a plain user');
    } else {
      bad('the auth trigger created one profile per user, every one a plain user', JSON.stringify(profs.rows));
    }

    try {
      await asRole('service_role', async () => {
        await client.query("select set_config('request.jwt.claim.role', 'service_role', true)");
        await client.query("update public.profiles set role = 'cavd' where id = $1", [ID.cavd]);
        const r = await client.query('select role from public.profiles where id = $1', [ID.cavd]);
        if (r.rows[0]?.role !== 'cavd') throw new Error('service-role bootstrap did not set CAVD role');
      });
      ok('service role can issue the first CAVD account');
    } catch (e) {
      bad('service role can issue the first CAVD account', e.message);
    }

    await client.query("select set_config('session_replication_role', 'replica', false)")
    await client.query('update public.profiles set verification_exempt = true');
    await client.query(`update public.profiles set role = 'cavd' where id = $1`, [ID.cavd]);
    await client.query(`update public.profiles set role = 'vet', clinic_name = 'Butuan Pet Clinic' where id = $1`, [ID.vet]);
    await client.query(`update public.profiles set role = 'vet', clinic_name = 'Closed Clinic', is_active = false where id = $1`, [ID.vetOff]);

    section('CAVD account details');
    await rows('CAVD can read an account email through the guarded function', ID.cavd,
      'select email from public.cavd_account_auth($1)',
      result => result.length === 1 && result[0].email === 'user@demo.local', [ID.owner]);
    await denied('owner cannot read another account email', ID.owner,
      'select email from public.cavd_account_auth($1)', [ID.adopter], 'only CAVD');
    await denied('vet cannot read account email', ID.vet,
      'select email from public.cavd_account_auth($1)', [ID.owner], 'only CAVD');
    try {
      await asRole('anon', () => client.query('select email from public.cavd_account_auth($1)', [ID.owner]));
      bad('anonymous visitors cannot call CAVD account details');
    } catch { ok('anonymous visitors cannot call CAVD account details'); }

    const mkPet = async (owner, creator, source, status, name, species, sex, size, dob, extra = '') =>
      (await client.query(
        `insert into public.pets (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date ${extra ? ', ' + extra.split('=')[0] : ''})
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9 ${extra ? ', ' + extra.split('=')[1] : ''}) returning id, qr_slug`,
        [owner, creator, source, status, name, species, sex, size, dob]
      )).rows[0];

    // Owner Ana: one approved pet with a pending listing, one approved pet that is
    // free to be listed, and one still awaiting registration approval.
    const petListed = await mkPet(ID.owner, ID.owner, 'owner', 'approved', 'Bantay', 'dog', 'male', 'medium', '2022-03-01');
    const petFree = await mkPet(ID.owner, ID.owner, 'owner', 'approved', 'Tala', 'dog', 'female', 'small', '2023-07-15');
    const petPending = await mkPet(ID.owner, ID.owner, 'owner', 'pending', 'Muning', 'cat', 'female', 'small', '2025-01-10');
    const petSpare = await mkPet(ID.owner, ID.owner, 'owner', 'approved', 'Kiko', 'dog', 'male', 'medium', '2020-01-01');
    const petShelter = await mkPet(null, ID.cavd, 'shelter', 'approved', 'Kidlat', 'dog', 'female', 'small', '2024-06-01');
    await client.query(`update public.pets set rabies_vaccinated = true, rabies_vaccinated_on = '2026-02-02' where id = $1`, [petShelter.id]);

    const listingOpen = (await client.query(
      `insert into public.listings (pet_id, listed_by, status, notes, decided_by, decided_at)
       values ($1, $2, 'approved', 'Friendly shelter dog', $2, now()) returning id`,
      [petShelter.id, ID.cavd]
    )).rows[0];

    const listingPending = (await client.query(
      `insert into public.listings (pet_id, listed_by, status, notes)
       values ($1, $2, 'pending', 'Rehoming, moving house') returning id`,
      [petListed.id, ID.owner]
    )).rows[0];

    const listingOwnLive = (await client.query(
      `insert into public.listings (pet_id, listed_by, status, notes, decided_by, decided_at)
       values ($1, $2, 'approved', 'Owner-led, already approved by CAVD', $3, now()) returning id`,
      [petSpare.id, ID.owner, ID.cavd]
    )).rows[0];

    const appAdopter = (await client.query(
      `insert into public.applications (listing_id, adopter_id, message)
       values ($1, $2, 'We have a fenced yard.') returning id`,
      [listingOpen.id, ID.adopter]
    )).rows[0];

    const appOther = (await client.query(
      `insert into public.applications (listing_id, adopter_id, message)
       values ($1, $2, 'I work from home.') returning id`,
      [listingOpen.id, ID.other]
    )).rows[0];

    const visitProofPath = ID.vet + '/booster.pdf';
    await client.query(
      `insert into public.visits (pet_id, recorded_by, recorded_by_name, clinic_name, visit_date, summary, evidence_path)
       values ($1, $2, 'Dr. Reyes', 'Butuan Pet Clinic', '2026-05-04', 'Annual booster given.', $3)`,
      [petListed.id, ID.vet, visitProofPath]
    );
    await client.query(`insert into storage.objects (bucket_id, name, owner)
      values ('visit-documents', $1, $2)`, [visitProofPath, ID.vet]);
    await client.query("select set_config('session_replication_role', 'origin', false)");
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [ID.vet]);
    for (const pet of [petListed, petFree, petSpare, petShelter]) {
      await client.query(`insert into public.visits
        (pet_id, recorded_by, clinic_name, visit_date, visit_type, reason, summary)
        values ($1, $2, 'Butuan Pet Clinic', current_date, 'checkup',
                'Adoption health review', 'Veterinarian examination recorded.')`,
        [pet.id, ID.vet]);
    }
    await client.query("select set_config('request.jwt.claim.sub', '', false)");
    ok('seed data in place')

    // --------------------------------------------- adopter matching and saves --
    section('Adopter matching');
    await client.query(`insert into public.pet_match_traits
      (pet_id,activity_level,temperament,child_compatible,pet_compatible,space_need,time_need,experience_need,updated_by)
      values ($1,3,'friendly',true,true,2,3,2,$3),
             ($2,2,'calm',true,false,1,2,1,$3)`, [petShelter.id, petPending.id, ID.cavd]);
    await rows('adopter sees traits of an open approved pet', ID.adopter,
      'select pet_id from public.pet_match_traits',
      r => r.length === 1 && r[0].pet_id === petShelter.id);
    await rows('public listing exposes its pet ID for trait matching', ID.adopter,
      'select pet_id from public.public_listings where listing_id = $1',
      r => r.length === 1 && r[0].pet_id === petShelter.id, [listingOpen.id]);
    await denied('adopter cannot invent pet matching traits', ID.adopter,
      `insert into public.pet_match_traits
       (pet_id,activity_level,temperament,child_compatible,pet_compatible,space_need,time_need,experience_need,updated_by)
       values ($1,3,'playful',true,true,2,3,2,$2)`, [petFree.id, ID.adopter], 'row-level security');
    await allowed('CAVD can revise matching traits', ID.cavd,
      'update public.pet_match_traits set activity_level = 4, updated_by = $2 where pet_id = $1',
      [petShelter.id, ID.cavd]);
    const preferenceSql = `insert into public.adopter_preferences
      (user_id,preferred_species,preferred_size,preferred_age,activity_preference,
       temperament_preference,living_space,time_availability,children_at_home,other_pets_at_home,ownership_experience)
      values ($1,'dog','small','young',3,'friendly',3,3,false,false,2)`;
    await allowed('adopter can save their preferences', ID.adopter, preferenceSql, [ID.adopter]);
    await denied('adopter cannot save preferences for someone else', ID.adopter,
      preferenceSql, [ID.owner], 'row-level security');
    await commitAs(ID.adopter, () => client.query(preferenceSql, [ID.adopter]));
    await rows('preferences remain private to the adopter', ID.owner,
      'select user_id from public.adopter_preferences', r => r.length === 0);
    await allowed('adopter can save an open listing', ID.adopter,
      'insert into public.saved_listings (adopter_id, listing_id) values ($1, $2)',
      [ID.adopter, listingOpen.id]);
    await denied('adopter cannot save a pending listing', ID.adopter,
      'insert into public.saved_listings (adopter_id, listing_id) values ($1, $2)',
      [ID.adopter, listingPending.id], 'row-level security');
    await denied('adopter cannot save for another user', ID.adopter,
      'insert into public.saved_listings (adopter_id, listing_id) values ($1, $2)',
      [ID.owner, listingOpen.id], 'row-level security');
    await commitAs(ID.adopter, () => client.query(
      'insert into public.saved_listings (adopter_id, listing_id) values ($1, $2)',
      [ID.adopter, listingOpen.id]));
    await rows('another user cannot read saved listings', ID.owner,
      'select listing_id from public.saved_listings', r => r.length === 0);
    await allowed('adopter can remove their saved listing', ID.adopter,
      'delete from public.saved_listings where adopter_id = $1 and listing_id = $2',
      [ID.adopter, listingOpen.id]);
    try {
      await asRole('anon', () => client.query('select * from public.adopter_preferences'));
      bad('anonymous visitors cannot read adopter preferences');
    } catch { ok('anonymous visitors cannot read adopter preferences'); }

    // ------------------------------------------------------------- profiles --
    section('Profiles and role issuance');
    await rows('a user reads only their own profile', ID.owner,
      'select id from public.profiles', r => (r.length === 1 && r[0].id === ID.owner) || 'saw ' + r.length);

    await rows('CAVD reads every profile', ID.cavd,
      'select id from public.profiles', r => r.length === 6 || 'saw ' + r.length);

    await rows('a vet reads only their own profile', ID.vet,
      'select id from public.profiles', r => (r.length === 1 && r[0].id === ID.vet) || 'saw ' + r.length);

    await denied('a user cannot promote themselves to CAVD', ID.owner,
      `update public.profiles set role = 'cavd' where id = $1`, [ID.owner],
      'only cavd staff can change an account role');

    await noEffect('a user cannot disable another account', ID.owner,
      `update public.profiles set is_active = false where id = $1`, [ID.vet]);

    await allowed('a user can edit their own name and contact', ID.owner,
      `update public.profiles set name = 'Ana Reyes', contact = '0917 000 0000' where id = $1`, [ID.owner]);

    await allowed('CAVD can disable a vet account', ID.cavd,
      `update public.profiles set is_active = false where id = $1`, [ID.vet]);

    await denied('CAVD cannot issue vet access without an approved PRC ID', ID.cavd,
      `update public.profiles set role = 'vet', clinic_name = 'New Clinic' where id = $1`, [ID.other],
      'approved PRC ID');

    // ----------------------------------------------------------------- pets --
    section('Pet registration');
    await allowed('a user registers their own pet', ID.owner,
      `insert into public.pets (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date)
       values ($1, $1, 'owner', 'pending', 'Bagel', 'dog', 'male', 'large', '2021-08-08')`, [ID.owner]);

    await denied('a user cannot register a pet as already approved', ID.owner,
      `insert into public.pets (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date)
       values ($1, $1, 'owner', 'approved', 'Sneaky', 'dog', 'male', 'large', '2021-08-08')`, [ID.owner],
      'row-level security');

    await denied('a user cannot register a pet under another account', ID.owner,
      `insert into public.pets (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date)
       values ($2, $1, 'owner', 'pending', 'NotMine', 'dog', 'male', 'large', '2021-08-08')`, [ID.owner, ID.adopter],
      'row-level security');

    await denied('a user cannot claim CAVD shelter custody', ID.owner,
      `insert into public.pets (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date)
       values (null, $1, 'shelter', 'pending', 'Fake Intake', 'dog', 'male', 'large', '2021-08-08')`, [ID.owner],
      'row-level security');

    await denied('an owner cannot approve their own pet', ID.owner,
      `update public.pets set registry_status = 'approved' where id = $1`, [petPending.id],
      'only cavd staff can change registry status');

    await denied('an owner cannot set the public rabies flag', ID.owner,
      `update public.pets set rabies_vaccinated = true where id = $1`, [petListed.id],
      'only cavd staff can set public health flags');

    await denied('an owner cannot hand their pet to another account', ID.owner,
      `update public.pets set owner_id = $2 where id = $1`, [petListed.id, ID.adopter],
      'only cavd staff can transfer ownership');

    await denied('an owner cannot write the registry decision note', ID.owner,
      `update public.pets set registry_note = 'approved by me' where id = $1`, [petListed.id],
      'only cavd staff can write the registry decision');

    await allowed('an owner can correct their pet biodata', ID.owner,
      `update public.pets set breed = 'Aspin (mixed)', markings = 'White chest' where id = $1`, [petListed.id]);

    await allowed('CAVD approves a registration', ID.cavd,
      `update public.pets set registry_status = 'approved', decided_by = $2, decided_at = now() where id = $1`,
      [petPending.id, ID.cavd]);

    await allowed('CAVD rejects a registration with a reason', ID.cavd,
      `update public.pets set registry_status = 'rejected', registry_note = 'Photo unreadable', decided_by = $2, decided_at = now() where id = $1`,
      [petPending.id, ID.cavd]);

    await denied('not even CAVD can change an issued QR slug', ID.cavd,
      `update public.pets set qr_slug = 'hacked01' where id = $1`, [petListed.id], 'immutable');

    await rows('every approved pet already carries a QR slug', ID.cavd,
      `select count(*)::int as n from public.pets where registry_status = 'approved' and (qr_slug is null or length(qr_slug) <> 8)`,
      r => r[0].n === 0 || 'found ' + r[0].n + ' without a usable slug');

    await rows('an owner sees only their own pets', ID.owner,
      'select owner_id from public.pets',
      r => (r.length === 4 && r.every(x => x.owner_id === ID.owner)) || 'saw ' + JSON.stringify(r));

    await rows('a vet sees approved pets and no pending ones', ID.vet,
      'select registry_status from public.pets',
      r => (r.length === 4 && r.every(x => x.registry_status === 'approved')) || 'saw ' + JSON.stringify(r));

    await allowed('a vet can update approved pet biodata, weight and photo', ID.vet,
      `update public.pets set birth_date = '2021-04-02', weight_kg = 14.25,
       color = 'Brown', photo_url = 'https://example.test/pet.jpg' where id = $1`, [petListed.id]);
    try {
      await act(ID.cavd, async () => {
        await client.query(`update public.pets set weight_kg = 14.25 where id = $1`, [petListed.id]);
        const history = await client.query(
          `select old_details, new_details from public.pet_detail_changes where pet_id = $1`, [petListed.id]);
        if (!history.rows.some(x => x.new_details?.weight_kg === 14.25)) throw new Error('no weight change logged');
      });
      ok('CAVD can review the pet detail change history');
    } catch (e) { bad('CAVD can review the pet detail change history', e.message); }
    await noEffect('a vet cannot edit an unapproved pet', ID.vet,
      `update public.pets set color = 'White' where id = $1`, [petPending.id]);
    await denied('a vet still cannot change a public rabies flag', ID.vet,
      `update public.pets set rabies_vaccinated = true where id = $1`, [petListed.id], 'Only CAVD');

    await rows('an adopter sees no pets through the table', ID.adopter,
      'select id from public.pets', r => r.length === 0 || 'saw ' + r.length);

    await denied('a vet cannot register a pet', ID.vet,
      `insert into public.pets (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date)
       values ($1, $1, 'owner', 'pending', 'VetPet', 'dog', 'male', 'large', '2021-08-08')`, [ID.vet],
      'row-level security');

    await noEffect('a vet cannot transfer ownership', ID.vet,
      `update public.pets set owner_id = $2 where id = $1`, [petListed.id, ID.vet]);

    await asRole('anon', async () => {
      try {
        await client.query('select * from public.pets');
        bad('an anonymous visitor cannot read the pets table', 'the select succeeded');
      } catch (e) {
        ok('an anonymous visitor cannot read the pets table (' + e.code + ')');
      }
    });

    // --------------------------------------------------------------- visits --
    section('Visit log, append-only');
    await allowed('a vet appends a visit to an approved pet', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Butuan Pet Clinic', current_date, 'Deworming, 18 kg.')`, [petListed.id, ID.vet]);

    await rows('the recorder name is stamped from the clinic profile', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Butuan Pet Clinic', current_date, 'Check-up.') returning recorded_by_name`,
      r => r[0].recorded_by_name === 'Butuan Pet Clinic' || 'got ' + r[0].recorded_by_name,
      [petListed.id, ID.vet]);

    await rows('a structured vaccine visit is marked vet-confirmed', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date,
       summary, visit_type, reason, vaccine_name, vaccine_lot,
       vaccine_expires_on, vaccine_administered_by)
       values ($1, $2, 'Butuan Pet Clinic', current_date, 'Rabies vaccination',
       'vaccination', 'Booster due', 'Rabies', 'LOT-123', current_date + 180, 'Dr. Reyes')
       returning verification_status`,
      r => r[0]?.verification_status === 'vet_confirmed' || JSON.stringify(r),
      [petListed.id, ID.vet]);
    await denied('a vaccine entry requires a product lot', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date,
       summary, vaccine_name, vaccine_expires_on, vaccine_administered_by)
       values ($1, $2, 'Butuan Pet Clinic', current_date,
       'Rabies vaccination', 'Rabies', current_date + 180, 'Dr. Reyes')`,
      [petListed.id, ID.vet], 'visits_vaccine_core');

    await denied('a vaccination visit requires vaccine details', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date,
       summary, visit_type) values ($1, $2, 'Butuan Pet Clinic', current_date,
       'Vaccinated', 'vaccination')`, [petListed.id, ID.vet],
      'visits_vaccination_has_product');

    await denied('a vet cannot attach another clinician’s private document', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date,
       summary, evidence_path) values ($1, $2, 'Butuan Pet Clinic', current_date,
       'Check-up', $3)`, [petListed.id, ID.vet, `${ID.cavd}/other-pet.pdf`],
      'document must be uploaded by the current clinician');

    await denied('a vet cannot append to a pet still awaiting approval', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Butuan Pet Clinic', current_date, 'Should not land.')`, [petPending.id, ID.vet],
      'row-level security');

    await denied('a vet cannot file a visit under another account', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Butuan Pet Clinic', current_date, 'Impersonation.')`, [petListed.id, ID.cavd],
      'row-level security');

    await denied('a visit cannot be dated in the future', ID.vet,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Butuan Pet Clinic', current_date + 30, 'Time travel.')`, [petListed.id, ID.vet],
      'date');

    await noEffect('a vet cannot edit a saved visit', ID.vet,
      `update public.visits set summary = 'rewritten' where pet_id = $1`, [petListed.id]);

    await noEffect('a vet cannot delete a visit', ID.vet,
      `delete from public.visits where pet_id = $1`, [petListed.id]);

    await noEffect('CAVD has no delete path for visits either', ID.cavd,
      `delete from public.visits where pet_id = $1`, [petListed.id]);

    // service_role bypasses RLS, so the append-only trigger is the last line of
    // defence for anything running with the service key.
    await asRole('service_role', async () => {
      try {
        await client.query('delete from public.visits');
        bad('the trigger blocks a delete even when RLS is bypassed', 'the delete succeeded');
      } catch (e) {
        if (/append-only/i.test(e.message)) ok('the trigger blocks a delete even when RLS is bypassed');
        else bad('the trigger blocks a delete even when RLS is bypassed', e.message);
      }
    });

    await denied('a CAVD correction without an audit note is refused', ID.cavd,
      `update public.visits set summary = 'corrected' where pet_id = $1`, [petListed.id], 'correction_note');

    await allowed('a CAVD correction with an audit note is accepted', ID.cavd,
      `update public.visits set summary = 'Annual booster given (lot corrected).',
              correction_note = 'Wrong vaccine lot typed on 4 May.' where pet_id = $1`, [petListed.id]);

    try {
      await act(ID.cavd, async () => {
        await client.query(`update public.visits set summary = 'Corrected summary',
          correction_note = 'Corrected after chart review' where pet_id = $1`, [petListed.id]);
        const history = await client.query(`select previous_record, corrected_record
          from public.visit_corrections where visit_id in
          (select id from public.visits where pet_id = $1)`, [petListed.id]);
        if (!history.rows.some(x => x.corrected_record?.summary === 'Corrected summary' &&
                                  x.previous_record?.summary !== 'Corrected summary'))
          throw new Error('previous and corrected values were not preserved');
      });
      ok('the original visit value remains in correction history');
    } catch (e) { bad('the original visit value remains in correction history', e.message); }

    await rows('a correction stamps who corrected it and when', ID.cavd,
      `update public.visits set summary = 'x', correction_note = 'note' where pet_id = $1
       returning corrected_by, corrected_at`,
      r => (r[0].corrected_by === ID.cavd && !!r[0].corrected_at) || JSON.stringify(r[0]), [petListed.id]);

    await denied('a correction cannot rewrite who recorded the visit', ID.cavd,
      `update public.visits set recorded_by_name = 'Someone else', correction_note = 'note' where pet_id = $1`,
      [petListed.id], 'cannot rewrite the pet, the recorder');

    try {
      await act(ID.cavd, async () => {
        const office = await client.query(`insert into public.visits
          (pet_id, recorded_by, clinic_name, visit_date, summary)
          values ($1, $2, 'CAVD desk', current_date, 'Intake note')
          returning id, verification_status`, [petListed.id, ID.cavd]);
        if (office.rows[0]?.verification_status !== 'cavd_confirmed')
          throw new Error('office visit was not stamped');
        await client.query(`update public.visits set verification_status = 'vet_confirmed',
          correction_note = 'note' where id = $1`, [office.rows[0].id]);
        throw new Error('verification status was changed');
      });
      bad('CAVD cannot relabel an office note as vet-confirmed', 'update succeeded');
    } catch (e) {
      if (/verification cannot be changed/i.test(e.message))
        ok('CAVD cannot relabel an office note as vet-confirmed');
      else bad('CAVD cannot relabel an office note as vet-confirmed', e.message);
    }

    await rows('an owner reads their own pet history', ID.owner,
      'select id from public.visits where pet_id = $1', r => r.length >= 1 || 'saw 0', [petListed.id]);

    await rows('an unrelated user reads no visit history at all', ID.adopter,
      'select id from public.visits', r => r.length === 0 || 'saw ' + r.length);

    await denied('a plain user cannot write a visit', ID.owner,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Home', current_date, 'Self-reported.')`, [petListed.id, ID.owner],
      'row-level security');

    await denied('a disabled vet account loses append access', ID.vetOff,
      `insert into public.visits (pet_id, recorded_by, clinic_name, visit_date, summary)
       values ($1, $2, 'Closed Clinic', current_date, 'Should not land.')`, [petListed.id, ID.vetOff],
      'row-level security');

    await rows('a disabled vet account loses read access too', ID.vetOff,
      'select id from public.visits', r => r.length === 0 || 'saw ' + r.length);

    // ------------------------------------------------------------- listings --
    section('Listings');
    await act(ID.cavd, async () => {
      const unexamined = (await client.query(`insert into public.pets
        (created_by, source, registry_status, name, species, sex, size, birth_date)
        values ($1, 'shelter', 'approved', 'No Vet Visit', 'dog', 'female',
                'small', '2024-01-01') returning id`, [ID.cavd])).rows[0];
      const listing = (await client.query(`insert into public.listings
        (pet_id, listed_by, status, decided_by, decided_at)
        values ($1, $2, 'approved', $2, now()) returning id`,
        [unexamined.id, ID.cavd])).rows[0];
      const visible = await client.query(`select listing_id from public.public_listings
        where listing_id = $1`, [listing.id]);
      if (visible.rows.length === 1) ok('CAVD can publish a pet without a vet visit');
      else bad('CAVD can publish a pet without a vet visit', 'public listing was hidden');
    });
    await allowed('an owner requests a listing for their approved pet', ID.owner,
      `insert into public.listings (pet_id, listed_by, status, notes)
       values ($1, $2, 'pending', 'Moving abroad')`, [petFree.id, ID.owner]);

    await denied('an owner cannot list a pet still awaiting registration approval', ID.owner,
      `insert into public.listings (pet_id, listed_by, status, notes)
       values ($1, $2, 'pending', 'Too early')`, [petPending.id, ID.owner], 'row-level security');

    await denied('a user cannot list a pet they do not own', ID.adopter,
      `insert into public.listings (pet_id, listed_by, status, notes)
       values ($1, $2, 'pending', 'Not mine')`, [petFree.id, ID.adopter], 'row-level security');

    await denied('an owner cannot publish a listing directly', ID.owner,
      `insert into public.listings (pet_id, listed_by, status, notes)
       values ($1, $2, 'approved', 'Self published')`, [petFree.id, ID.owner], 'row-level security');

    await noEffect('an owner cannot approve their own listing request', ID.owner,
      `update public.listings set status = 'approved' where id = $1`, [listingPending.id]);

    await noEffect('a vet cannot approve a listing', ID.vet,
      `update public.listings set status = 'approved' where id = $1`, [listingPending.id]);

    await allowed('CAVD approves a listing request', ID.cavd,
      `update public.listings set status = 'approved', decided_by = $2, decided_at = now() where id = $1`,
      [listingPending.id, ID.cavd]);

    await allowed('CAVD rejects a listing request with a note', ID.cavd,
      `update public.listings set status = 'rejected', decision_note = 'Vaccination record incomplete', decided_by = $2, decided_at = now() where id = $1`,
      [listingPending.id, ID.cavd]);

    await allowed('CAVD publishes a shelter listing immediately', ID.cavd,
      `insert into public.listings (pet_id, listed_by, status, decided_by, decided_at)
       values ($1, $2, 'approved', $2, now())`, [petFree.id, ID.cavd]);

    await denied('a pet cannot hold two live listings at once', ID.cavd,
      `insert into public.listings (pet_id, listed_by, status) values ($1, $2, 'pending')`,
      [petShelter.id, ID.cavd], 'listings_one_live_per_pet');

    await rows('an adopter sees approved listings only', ID.adopter,
      'select status from public.listings',
      r => (r.length === 2 && r.every(x => x.status === 'approved')) || 'saw ' + JSON.stringify(r));

    await rows('the requester still sees their own pending request', ID.owner,
      'select status from public.listings where id = $1', r => r.length === 1 || 'saw ' + r.length, [listingPending.id]);

    // --------------------------------------------------------- applications --
    section('Adoption applications');
    await allowed('an adopter submits a complete questionnaire to an approved listing', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOwnLive.id, JSON.stringify(applicationAnswers)]);

    await denied('an adopter cannot bypass the questionnaire with a short message', ID.other,
      `insert into public.applications (listing_id, adopter_id, message)
       values ($1, $2, 'Old short message')`, [listingOwnLive.id, ID.other], 'row-level security');

    await denied('an adopter cannot omit a required care plan', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOwnLive.id, JSON.stringify({ ...applicationAnswers, care_plan: '' })], 'care_plan');

    await denied('an adopter cannot submit an invalid birth date', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOwnLive.id, JSON.stringify({ ...applicationAnswers, birth_date: '2024-02-31' })], 'date');

    await denied('an adopter cannot claim more than 24 hours alone', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOwnLive.id, JSON.stringify({ ...applicationAnswers, hours_alone: '25' })], 'between 0 and 24');

    await denied('an adopter cannot apply to a listing that is not approved', ID.adopter,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingPending.id, JSON.stringify(applicationAnswers)], 'no longer open');

    await denied('an owner cannot apply to adopt their own pet', ID.owner,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOwnLive.id, JSON.stringify(applicationAnswers)], 'not available');

    await allowed('a pending legacy applicant can complete the questionnaire', ID.adopter,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOpen.id, JSON.stringify(applicationAnswers)]);

    try {
      await act(ID.adopter, async () => {
        await client.query(`insert into public.adopter_preferences
          (user_id, preferred_species, preferred_size, preferred_age, activity_preference,
           temperament_preference, living_space, time_availability, children_at_home,
           other_pets_at_home, ownership_experience)
          values ($1, 'dog', 'small', 'young', 3, 'friendly', 3, 3, false, false, 3)
          on conflict (user_id) do update set preferred_species = excluded.preferred_species,
          preferred_size = excluded.preferred_size, preferred_age = excluded.preferred_age,
          activity_preference = excluded.activity_preference,
          temperament_preference = excluded.temperament_preference,
          living_space = excluded.living_space,
          time_availability = excluded.time_availability,
          children_at_home = excluded.children_at_home,
          other_pets_at_home = excluded.other_pets_at_home,
          ownership_experience = excluded.ownership_experience`, [ID.adopter]);
        await client.query(`select public.submit_adoption_application($1, $2::jsonb, 'match')`,
          [listingOpen.id, JSON.stringify(applicationAnswers)]);
        const row = (await client.query(`select application_source, compatibility_score
          from public.applications where id = $1`, [appAdopter.id])).rows[0];
        if (row?.application_source !== 'match' || Number(row.compatibility_score) !== 100) {
          throw new Error('expected a server-calculated 100% match, got ' + JSON.stringify(row));
        }
      });
      ok('match applications store a server-calculated score');
    } catch (e) { bad('match applications store a server-calculated score', e.message); }

    try {
      await act(ID.adopter, async () => {
        await client.query(`select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
          [listingOpen.id, JSON.stringify(applicationAnswers)]);
        await client.query(`select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
          [listingOpen.id, JSON.stringify(applicationAnswers)]);
      });
      bad('an adopter cannot submit the same completed questionnaire twice');
    } catch (e) {
      if (/already applied/i.test(e.message)) ok('an adopter cannot submit the same completed questionnaire twice');
      else bad('an adopter cannot submit the same completed questionnaire twice', e.message);
    }

    await denied('an adopter cannot submit an application pre-approved', ID.adopter,
      `insert into public.applications (listing_id, adopter_id, message, status)
       values ($1, $2, 'Pre-approved', 'approved')`, [listingOpen.id, ID.adopter], 'row-level security');

    await denied('an adopter cannot file an application as somebody else', ID.adopter,
      `insert into public.applications (listing_id, adopter_id, message)
       values ($1, $2, 'Not me')`, [listingOpen.id, ID.other], 'row-level security');

    await denied('a vet cannot submit an adoption questionnaire', ID.vet,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOwnLive.id, JSON.stringify(applicationAnswers)], 'only adopters');

    await denied('an adopter cannot move an application to interview', ID.adopter,
      `select public.review_adoption_application($1, 'for_interview', 'Visit CAVD')`,
      [appAdopter.id], 'only cavd');

    await denied('CAVD must provide interview instructions', ID.cavd,
      `select public.review_adoption_application($1, 'for_interview', '')`,
      [appAdopter.id], 'instructions');

    await allowed('CAVD can request an interview', ID.cavd,
      `select public.review_adoption_application($1, 'for_interview', 'Visit CAVD')`,
      [appAdopter.id]);

    await denied('review stage cannot pretend approval without transfer', ID.cavd,
      `select public.review_adoption_application($1, 'approved', 'Approved')`,
      [appAdopter.id], 'valid review stage');

    await denied('adopter cannot respond before a request from CAVD', ID.adopter,
      `select public.respond_to_adoption_application($1, 'I can visit tomorrow')`,
      [appAdopter.id], 'not awaiting');

    try {
      await act(ID.cavd, async () => {
        await client.query(`select public.review_adoption_application($1, 'for_interview', 'Visit CAVD')`, [appAdopter.id]);
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ID.adopter]);
        await client.query(`select public.respond_to_adoption_application($1, 'I can visit tomorrow')`, [appAdopter.id]);
        const result = (await client.query(`select applicant_response from public.applications where id = $1`, [appAdopter.id])).rows[0];
        if (result?.applicant_response !== 'I can visit tomorrow') throw new Error('response was not saved');
      });
      ok('adopter response reaches CAVD review');
    } catch (e) { bad('adopter response reaches CAVD review', e.message); }

    try {
      await act(ID.cavd, async () => {
        await client.query(`select public.review_adoption_application($1, 'rejected', 'Home is not suitable')`, [appOther.id]);
        const row = (await client.query(`select status, review_stage, cavd_remarks from public.applications where id = $1`, [appOther.id])).rows[0];
        if (row?.status !== 'rejected' || row?.review_stage !== 'rejected' || row?.cavd_remarks !== 'Home is not suitable') {
          throw new Error('review state did not map to a rejection');
        }
      });
      ok('CAVD rejection records stage and applicant-visible reason');
    } catch (e) { bad('CAVD rejection records stage and applicant-visible reason', e.message); }

    await noEffect('an adopter cannot approve their own application', ID.adopter,
      `update public.applications set status = 'approved' where id = $1`, [appAdopter.id]);

    await noEffect('CAVD cannot bypass validation with a direct status update', ID.cavd,
      `update public.applications set status = 'approved' where id = $1`, [appAdopter.id]);

    await rows('an adopter sees only their own application', ID.adopter,
      'select id from public.applications',
      r => (r.length === 1 && r[0].id === appAdopter.id) || 'saw ' + JSON.stringify(r));

    await rows('CAVD sees every application', ID.cavd,
      'select id from public.applications', r => r.length === 2 || 'saw ' + r.length);

    await rows('the rehoming owner does not see who applied', ID.owner,
      'select id from public.applications', r => r.length === 0 || 'saw ' + r.length);

    await rows('a vet sees no applications', ID.vet,
      'select id from public.applications', r => r.length === 0 || 'saw ' + r.length);

    // ------------------------------------------------------- the transfer --
    section('Adoption transfer through approve_application()');
    await denied('a legacy request without questionnaire cannot be approved', ID.cavd,
      `select public.approve_application($1, 'cavd_visit', current_date, 'Owner', 'validated')`,
      [appAdopter.id], 'complete the adoption questionnaire');

    await commitAs(ID.adopter, () => client.query(
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [listingOpen.id, JSON.stringify(applicationAnswers)]));

    await denied('an adopter cannot call approve_application', ID.adopter,
      `select public.approve_application($1, 'cavd_visit', current_date, 'Owner', 'trying')`, [appAdopter.id], 'only cavd staff');

    await denied('a vet cannot call approve_application', ID.vet,
      `select public.approve_application($1, 'cavd_visit', current_date, 'Owner', 'trying')`, [appAdopter.id], 'only cavd staff');

    await denied('CAVD must choose a validation method', ID.cavd,
      `select public.approve_application($1, 'unknown', current_date, 'Owner', 'Talked with owner')`,
      [appAdopter.id], 'choose how cavd validated');
    await denied('CAVD must name the person contacted or visited', ID.cavd,
      `select public.approve_application($1, 'owner_conversation', current_date, ' ', 'Talked with owner')`,
      [appAdopter.id], 'record who cavd spoke with');
    await denied('CAVD must record a validation outcome', ID.cavd,
      `select public.approve_application($1, 'owner_conversation', current_date, 'Owner', '   ')`,
      [appAdopter.id], 'record the cavd validation outcome');

    await act(ID.cavd, async () => {
      await client.query(`select public.approve_application($1, 'cavd_visit', current_date,
        'Ana Reyes', 'Home visit passed.')`, [appAdopter.id]);
      const pet = (await client.query('select owner_id, source from public.pets where id = $1', [petShelter.id])).rows[0];
      const listing = (await client.query('select status from public.listings where id = $1', [listingOpen.id])).rows[0];
      const mine = (await client.query('select status, review_stage, decision_note from public.applications where id = $1', [appAdopter.id])).rows[0];
      const rival = (await client.query('select status, review_stage, decision_note from public.applications where id = $1', [appOther.id])).rows[0];
      const transfer = (await client.query(
        'select previous_owner_id, adopter_id, approved_by, validation_method, validation_date, validated_with, pet_snapshot, last_visit_on from public.adoption_records where application_id = $1',
        [appAdopter.id])).rows[0];

      if (pet.owner_id === ID.adopter && pet.source === 'owner') ok('ownership moved to the adopter and custody left the shelter');
      else bad('ownership moved to the adopter and custody left the shelter', JSON.stringify(pet));

      if (listing.status === 'closed') ok('the listing closed on transfer');
      else bad('the listing closed on transfer', listing.status);

      if (transfer?.adopter_id === ID.adopter && transfer?.approved_by === ID.cavd &&
          transfer?.previous_owner_id === null && transfer?.pet_snapshot?.name === 'Kidlat' &&
          transfer?.validation_method === 'cavd_visit' && transfer?.validated_with === 'Ana Reyes' &&
          !!transfer?.validation_date)
        ok('the adoption leaves an immutable pet and transfer record');
      else bad('the adoption leaves an immutable pet and transfer record', JSON.stringify(transfer));

      if (mine.status === 'approved' && mine.review_stage === 'approved' && /home visit/i.test(mine.decision_note)) ok('the approved application keeps the decision note');
      else bad('the approved application keeps the decision note', JSON.stringify(mine));

      if (rival.status === 'rejected' && rival.review_stage === 'rejected' && /another applicant/i.test(rival.decision_note)) ok('competing applications close with a stated reason');
      else bad('competing applications close with a stated reason', JSON.stringify(rival));

      let twice = false;
      try {
        await client.query(`select public.approve_application($1, 'cavd_visit', current_date,
          'Ana Reyes', 'again')`, [appAdopter.id]);
        twice = true;
      } catch (e) {
        if (/already been decided/i.test(e.message)) ok('the same application cannot be approved twice');
        else bad('the same application cannot be approved twice', e.message);
      }
      if (twice) bad('the same application cannot be approved twice', 'the second call succeeded');
    });

    await act(ID.cavd, async () => {
      await client.query(`update public.listings set status = 'closed' where id = $1`, [listingOpen.id]);
      try {
        await client.query(`select public.approve_application($1, 'cavd_visit', current_date,
          'Ana Reyes', 'listing already closed')`, [appOther.id]);
        bad('an adoption cannot be approved on a closed listing', 'the call succeeded');
      } catch (e) {
        if (/listing is not open/i.test(e.message)) ok('an adoption cannot be approved on a closed listing');
        else bad('an adoption cannot be approved on a closed listing', e.message);
      }
    });

    try {
      await act(ID.cavd, async () => {
        const pet = (await client.query(`insert into public.pets
          (created_by, source, registry_status, name, species, sex, size, birth_date)
          values ($1, 'shelter', 'approved', 'Visit Optional', 'cat', 'female',
                  'small', '2024-01-01') returning id`, [ID.cavd])).rows[0];
        const listing = (await client.query(`insert into public.listings
          (pet_id, listed_by, status, decided_by, decided_at)
          values ($1, $2, 'approved', $2, now()) returning id`,
          [pet.id, ID.cavd])).rows[0];
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ID.adopter]);
        const app = { id: (await client.query(
          `select public.submit_adoption_application($1, $2::jsonb, 'explore') as id`,
          [listing.id, JSON.stringify(applicationAnswers)])).rows[0].id };
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ID.cavd]);
        await client.query(`select public.approve_application($1, 'owner_conversation',
          current_date, 'CAVD caretaker',
          'Spoke with caretaker and confirmed adopter details')`, [app.id]);
        const result = (await client.query(`select owner_id from public.pets where id = $1`,
          [pet.id])).rows[0];
        if (result?.owner_id !== ID.adopter) throw new Error('ownership did not transfer');
        const visits = (await client.query(`select count(*)::int as n from public.visits
          where pet_id = $1`, [pet.id])).rows[0];
        if (visits.n !== 0) throw new Error('fixture unexpectedly has a visit');
        await client.query('savepoint before_record_mutation');
        await client.query('set local role service_role');
        try {
          await client.query(`update public.adoption_records set validated_with = 'Rewritten'
            where application_id = $1`, [app.id]);
          throw new Error('adoption record could be rewritten');
        } catch (error) {
          if (!/cannot be changed or deleted/i.test(error.message)) throw error;
          await client.query('rollback to savepoint before_record_mutation');
        }
      });
      ok('CAVD can approve an adoption with documented validation and no vet visit');
      ok('the adoption record resists later changes, including service writes');
    } catch (e) {
      bad('CAVD can approve an adoption with documented validation and no vet visit', e.message);
    }

    // -------------------------------------------------------- public views --
    section('Anonymous public read');
    await asRole('anon', async () => {
      const r = await client.query('select * from public.public_pets order by name');
      const names = r.rows.map(x => x.name);
      if (names.includes('Bantay') && names.includes('Kidlat') && !names.includes('Muning')) {
        ok('public_pets exposes approved pets only');
      } else {
        bad('public_pets exposes approved pets only', JSON.stringify(names));
      }

      const cols = Object.keys(r.rows[0]);
      const leaky = ['owner_id', 'created_by', 'contact', 'registry_note', 'about', 'id'].filter(c => cols.includes(c));
      if (leaky.length === 0) ok('the QR view exposes no owner, contact, note or internal id column');
      else bad('the QR view exposes no owner, contact, note or internal id column', 'exposed: ' + leaky.join(', '));

      const listed = r.rows.find(x => x.name === 'Kidlat');
      if (listed.is_listed === true && listed.rabies_vaccinated === true) ok('the QR view carries listing status and the CAVD rabies flag');
      else bad('the QR view carries listing status and the CAVD rabies flag', JSON.stringify(listed));

      const l = await client.query('select name from public.public_listings order by name');
      const listingNames = l.rows.map(x => x.name).sort();
      if (listingNames.join(',') === 'Kidlat,Kiko') ok('public_listings shows CAVD-approved listings only');
      else bad('public_listings shows CAVD-approved listings only', JSON.stringify(l.rows));

      for (const t of ['profiles', 'visits', 'listings', 'applications']) {
        await client.query('savepoint anon_table');
        try {
          await client.query('select * from public.' + t);
          bad('anonymous read of public.' + t + ' is refused', 'the select succeeded');
        } catch {
          ok('anonymous read of public.' + t + ' is refused');
        }
        await client.query('rollback to savepoint anon_table');
      }
    });

    await rows('an owner can read a document attached to their pet visit', ID.owner,
      `select name from storage.objects where bucket_id = 'visit-documents'`,
      r => r.length === 1 && r[0].name === visitProofPath || JSON.stringify(r));
    await rows('an unrelated adopter cannot read the private visit document', ID.adopter,
      `select name from storage.objects where bucket_id = 'visit-documents'`,
      r => r.length === 0 || JSON.stringify(r));
    await denied('an owner cannot upload a clinician document', ID.owner,
      `insert into storage.objects (bucket_id, name, owner)
       values ('visit-documents', $1, $2)`, [ID.owner + '/fake.pdf', ID.owner], 'row-level security');

    // ------------------------------------------------------------- storage --
    section('Pet photo storage');
    await allowed('a user uploads into their own folder', ID.owner,
      `insert into storage.objects (bucket_id, name, owner) values ('pet-photos', $1, $2)`,
      [ID.owner + '/bantay.jpg', ID.owner]);

    await denied('a user cannot upload into another user folder', ID.owner,
      `insert into storage.objects (bucket_id, name, owner) values ('pet-photos', $1, $2)`,
      [ID.adopter + '/sneaky.jpg', ID.owner], 'row-level security');

    await asRole('anon', async () => {
      try {
        await client.query(`select 1 from storage.objects where bucket_id = 'pet-photos'`);
        ok('pet photos are publicly readable');
      } catch (e) {
        bad('pet photos are publicly readable', e.message);
      }
    });

    // New signups have a plain user row but no portal permissions until CAVD
    // approves their ID. Neither the client nor CAVD can skip the PRC review.
    section('New signup identity review');
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'new-owner@example.com', '{"name":"New Owner"}'),
       ($2, 'new-vet@example.com', '{"name":"New Vet","requested_role":"vet"}')`,
      [ID.freshOwner, ID.freshVet]
    );
    await rows('new owners start without portal access', ID.freshOwner,
      'select public.my_role() as role, public.identity_approved($1) as approved',
      r => r[0]?.role === null && r[0]?.approved === false, [ID.freshOwner]);
    await denied('unverified owner cannot register a pet', ID.freshOwner,
      `insert into public.pets (owner_id, created_by, name, species, sex, size, birth_date)
       values ($1, $1, 'Early', 'dog', 'male', 'small', '2024-01-01')`,
      [ID.freshOwner], 'row-level security');
    await denied('owner cannot exempt themselves from ID review', ID.freshOwner,
      `update public.profiles set verification_exempt = true where id = $1`,
      [ID.freshOwner], 'only cavd staff can change identity verification');
    await denied('vet applicant cannot switch their protected registration type', ID.freshVet,
      `update public.profiles set registration_kind = 'user' where id = $1`,
      [ID.freshVet], 'Registration type cannot be changed');
    await denied('owner cannot submit an ID record without an uploaded file', ID.freshOwner,
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'national_id', $2)`,
      [ID.freshOwner, ID.freshOwner + '/id.jpg'], 'Upload the government ID file');
    await commitAs(ID.freshOwner, () => client.query(
      `insert into storage.objects (bucket_id, name, owner)
       values ('identity-documents', $1, $2)`, [ID.freshOwner + '/id.jpg', ID.freshOwner]));
    try {
      await act(ID.freshOwner, async () => {
        const submitted = await client.query(
          `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
           values ($1, 'user', 'national_id', $2) returning status, reviewed_by`,
          [ID.freshOwner, ID.freshOwner + '/id.jpg']);
        const access = await client.query('select public.my_role() as role');
        if (submitted.rows[0]?.status !== 'approved' || submitted.rows[0]?.reviewed_by !== null
            || access.rows[0]?.role !== 'user') throw new Error('owner was not activated automatically');
        await client.query(
          `insert into public.pets (owner_id, created_by, name, species, sex, size, birth_date)
           values ($1, $1, 'After ID', 'dog', 'female', 'small', '2024-01-01')`,
          [ID.freshOwner]);
      });
      ok('uploaded owner ID immediately unlocks pet registration without CAVD review');
    } catch (e) { bad('uploaded owner ID activates the account without CAVD review', e.message); }
    await denied('owner cannot claim a PRC ID as a government ID', ID.freshOwner,
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'prc_id', $2)`, [ID.freshOwner, ID.freshOwner + '/id.jpg'],
      'verification_role_document_ck');
    await denied('owner cannot submit another user ID path', ID.freshOwner,
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'national_id', $2)`, [ID.freshOwner, ID.freshVet + '/id.jpg'],
      'account holder folder');
    await denied('owner signup cannot submit a PRC request instead', ID.freshOwner,
      `insert into public.verification_requests
       (user_id, requested_role, id_type, id_path, clinic_name, prc_number)
       values ($1, 'vet', 'prc_id', $2, 'New Clinic', 'PRC-123')`,
      [ID.freshOwner, ID.freshOwner + '/prc.jpg'], 'row-level security');
    await commitAs(ID.freshVet, () => client.query(
      `insert into storage.objects (bucket_id, name, owner)
       values ('identity-documents', $1, $2)`, [ID.freshVet + '/owner.jpg', ID.freshVet]));
    await denied('vet signup cannot use owner auto activation', ID.freshVet,
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'national_id', $2)`,
      [ID.freshVet, ID.freshVet + '/owner.jpg'], 'row-level security');
    await commitAs(ID.freshVet, () => client.query(
      `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
      [ID.freshVet + '/owner.jpg']));
    try {
      await act(ID.freshVet, async () => {
        const submitted = await client.query(
          `insert into public.verification_requests
           (user_id, requested_role, id_type, id_path, clinic_name, prc_number)
           values ($1, 'vet', 'prc_id', $2, 'New Clinic', 'PRC-123') returning status`,
          [ID.freshVet, ID.freshVet + '/prc.jpg']);
        const access = await client.query('select public.my_role() as role');
        if (submitted.rows[0]?.status !== 'pending' || access.rows[0]?.role !== null) {
          throw new Error('vet access was granted before CAVD approval');
        }
      });
      ok('vet PRC request stays pending without portal access');
    } catch (e) { bad('vet PRC request stays pending without portal access', e.message); }
    await denied('vet applicant cannot mark their own PRC request approved', ID.freshVet,
      `insert into public.verification_requests
       (user_id, requested_role, id_type, id_path, clinic_name, prc_number, status)
       values ($1, 'vet', 'prc_id', $2, 'New Clinic', 'PRC-123', 'approved')`,
      [ID.freshVet, ID.freshVet + '/prc.jpg'], 'row-level security');
    await denied('vet request without a PRC ID is refused', ID.freshVet,
      `insert into public.verification_requests
       (user_id, requested_role, id_type, id_path, clinic_name, prc_number)
       values ($1, 'vet', 'passport', $2, 'New Clinic', 'PRC-123')`,
      [ID.freshVet, ID.freshVet + '/prc.jpg'], 'verification_role_document_ck');

    const ownerReview = (await client.query(
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'national_id', $2) returning id`,
      [ID.freshOwner, ID.freshOwner + '/id.jpg']
    )).rows[0].id;
    const vetReview = (await client.query(
      `insert into public.verification_requests
       (user_id, requested_role, id_type, id_path, clinic_name, prc_number)
       values ($1, 'vet', 'prc_id', $2, 'New Clinic', 'PRC-123') returning id`,
      [ID.freshVet, ID.freshVet + '/prc.jpg']
    )).rows[0].id;
    await rows('owner sees only their own ID request', ID.freshOwner,
      'select id from public.verification_requests',
      r => r.length === 1 && r[0].id === ownerReview);
    await noEffect('applicant cannot approve their own ID', ID.freshOwner,
      `update public.verification_requests set status = 'approved' where id = $1`, [ownerReview]);
    await denied('CAVD must explain an ID rejection', ID.cavd,
      `update public.verification_requests set status = 'rejected' where id = $1`,
      [ownerReview], 'rejection needs a reason');
    try {
      await act(ID.cavd, async () => {
        await client.query(`update public.verification_requests set status = 'approved' where id = $1`, [ownerReview]);
        const r = await client.query('select public.identity_approved($1) as approved', [ID.freshOwner]);
        if (!r.rows[0]?.approved) throw new Error('owner access was not granted');
      });
      ok('CAVD approval unlocks owner access');
    } catch (e) { bad('CAVD approval unlocks owner access', e.message); }
    try {
      await act(ID.cavd, async () => {
        await client.query(`update public.verification_requests set status = 'approved' where id = $1`, [vetReview]);
        const r = await client.query('select role, clinic_name from public.profiles where id = $1', [ID.freshVet]);
        if (r.rows[0]?.role !== 'vet' || r.rows[0]?.clinic_name !== 'New Clinic') {
          throw new Error('vet role or clinic was not granted');
        }
      });
      ok('CAVD PRC approval grants the vet role');
    } catch (e) { bad('CAVD PRC approval grants the vet role', e.message); }

    section('Private IDs and owner profile photos');
    await rows('another applicant cannot see a private ID', ID.freshVet,
      `select name from storage.objects where bucket_id = 'identity-documents'`, r => r.length === 0);
    await rows('CAVD can see a submitted private ID', ID.cavd,
      `select name from storage.objects where bucket_id = 'identity-documents'`,
      r => r.length === 1 && r[0].name === ID.freshOwner + '/id.jpg');
    await denied('applicant cannot upload an ID into another folder', ID.freshOwner,
      `insert into storage.objects (bucket_id, name, owner) values ('identity-documents', $1, $2)`,
      [ID.freshVet + '/wrong.jpg', ID.freshOwner], 'row-level security');
    await noEffect('CAVD cannot delete an approved ID', ID.cavd,
      `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
      [ID.freshOwner + '/id.jpg']);

    section('Rejected ID cleanup');
    await client.query(`insert into auth.users (id, email, raw_user_meta_data)
      values ($1, 'rejected-owner@example.com', '{"name":"Rejected Owner"}')`, [ID.freshRejected]);
    const rejectedPath = ID.freshRejected + '/rejected.jpg';
    const rejectedId = (await client.query(
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'national_id', $2) returning id`,
      [ID.freshRejected, rejectedPath]
    )).rows[0].id;
    await client.query(`insert into storage.objects (bucket_id, name, owner)
      values ('identity-documents', $1, $2)`, [rejectedPath, ID.freshRejected]);
    await noEffect('applicant cannot delete a submitted ID', ID.freshRejected,
      `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
      [rejectedPath]);
    await noEffect('CAVD cannot delete an ID before rejection', ID.cavd,
      `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
      [rejectedPath]);
    try {
      await commitAs(ID.cavd, () => client.query(
        `update public.verification_requests set status = 'rejected', review_note = 'ID is unreadable'
         where id = $1`, [rejectedId]));
      ok('CAVD rejection records the applicant-facing reason');
    } catch (e) { bad('CAVD rejection records the applicant-facing reason', e.message); }
    await denied('CAVD cannot clear an ID path before Storage deletes the file', ID.cavd,
      `update public.verification_requests set id_path = null where id = $1`,
      [rejectedId], 'Delete the rejected ID with the Storage API first');
    try {
      const removed = await commitAs(ID.cavd, () => client.query(
        `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
        [rejectedPath]));
      if (removed.rowCount !== 1) throw new Error('file was not removed');
      ok('CAVD can remove the rejected file through Storage permissions');
    } catch (e) { bad('CAVD can remove the rejected file through Storage permissions', e.message); }
    try {
      const cleared = await commitAs(ID.cavd, () => client.query(
        `update public.verification_requests
         set id_path = null, prc_number = null, clinic_name = null where id = $1`,
        [rejectedId]));
      if (cleared.rowCount !== 1) throw new Error('review details were not cleared');
      ok('CAVD clears rejected ID details after file removal');
    } catch (e) { bad('CAVD clears rejected ID details after file removal', e.message); }
    await rows('applicant retains rejection reason without the ID file path', ID.freshRejected,
      `select status, review_note, id_path from public.verification_requests where id = $1`,
      r => r[0]?.status === 'rejected' && r[0]?.review_note === 'ID is unreadable' && r[0]?.id_path === null,
      [rejectedId]);
    await client.query(`insert into storage.objects (bucket_id, name, owner)
      values ('identity-documents', $1, $2)`, [ID.freshRejected + '/replacement.jpg', ID.freshRejected]);
    await allowed('applicant can submit a replacement ID', ID.freshRejected,
      `insert into public.verification_requests (user_id, requested_role, id_type, id_path)
       values ($1, 'user', 'passport', $2)`,
      [ID.freshRejected, ID.freshRejected + '/replacement.jpg']);
    const rejectedPrcPath = ID.freshRejected + '/prc.jpg';
    const rejectedPrcId = (await client.query(
      `insert into public.verification_requests
       (user_id, requested_role, id_type, id_path, clinic_name, prc_number)
       values ($1, 'vet', 'prc_id', $2, 'Rejected Clinic', 'PRC-PRIVATE') returning id`,
      [ID.freshRejected, rejectedPrcPath]
    )).rows[0].id;
    await client.query(`insert into storage.objects (bucket_id, name, owner)
      values ('identity-documents', $1, $2)`, [rejectedPrcPath, ID.freshRejected]);
    try {
      await commitAs(ID.cavd, () => client.query(
        `update public.verification_requests set status = 'rejected', review_note = 'PRC ID is unreadable'
         where id = $1`, [rejectedPrcId]));
      await commitAs(ID.cavd, () => client.query(
        `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
        [rejectedPrcPath]));
      await commitAs(ID.cavd, () => client.query(
        `update public.verification_requests
         set id_path = null, prc_number = null, clinic_name = null where id = $1`,
        [rejectedPrcId]));
      ok('rejected PRC file and license details can be cleared');
    } catch (e) { bad('rejected PRC file and license details can be cleared', e.message); }
    await rows('rejected PRC review retains only its outcome and reason', ID.freshRejected,
      `select status, review_note, id_path, prc_number, clinic_name
       from public.verification_requests where id = $1`,
      r => r[0]?.status === 'rejected' && r[0]?.review_note === 'PRC ID is unreadable'
        && r[0]?.id_path === null && r[0]?.prc_number === null && r[0]?.clinic_name === null,
      [rejectedPrcId]);
    const orphanPath = ID.freshRejected + '/unsubmitted.jpg';
    await client.query(`insert into storage.objects (bucket_id, name, owner)
      values ('identity-documents', $1, $2)`, [orphanPath, ID.freshRejected]);
    await allowed('applicant can remove an unsubmitted ID upload', ID.freshRejected,
      `delete from storage.objects where bucket_id = 'identity-documents' and name = $1`,
      [orphanPath]);

    await allowed('owner can upload their own profile photo', ID.freshOwner,
      `insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`,
      [ID.freshOwner + '/me.jpg', ID.freshOwner]);
    try {
      await act(ID.freshOwner, async () => {
        await client.query(`insert into storage.objects (bucket_id, name, owner)
          values ('profile-photos', $1, $2)`, [ID.freshOwner + '/unused.jpg', ID.freshOwner]);
        const removed = await client.query(`delete from storage.objects
          where bucket_id = 'profile-photos' and name = $1`, [ID.freshOwner + '/unused.jpg']);
        if (removed.rowCount !== 1) throw new Error('unused photo was not removed');
      });
      ok('owner can clean up their own unused profile photo');
    } catch (e) { bad('owner can clean up their own unused profile photo', e.message); }
    await denied('owner cannot upload another profile photo', ID.freshOwner,
      `insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`,
      [ID.freshVet + '/wrong.jpg', ID.freshOwner], 'row-level security');
    await allowed('owner can edit name, birthday, phone and location', ID.freshOwner,
      `update public.profiles set name = 'New Name', birth_date = '2000-01-01',
       contact = '0917 123 4567', location = 'Ampayon, Butuan City', avatar_path = $2 where id = $1`,
      [ID.freshOwner, ID.freshOwner + '/me.jpg']);
    await denied('owner cannot point their avatar at another folder', ID.freshOwner,
      `update public.profiles set avatar_path = $2 where id = $1`,
      [ID.freshOwner, ID.freshVet + '/wrong.jpg'], 'profiles_avatar_path_ck');

    section('Match-only application upgrade');
    await client.query(await readFile(join(root, 'supabase/migrations/0013_match_only_applications.sql'), 'utf8'));
    ok('applied 0013_match_only_applications.sql');
    const matchPet = await mkPet(null, ID.cavd, 'shelter', 'approved', 'Match Only',
      'dog', 'female', 'small', '2025-01-01');
    const matchListing = (await client.query(`insert into public.listings
      (pet_id, listed_by, status, decided_by, decided_at)
      values ($1, $2, 'approved', $2, now()) returning id`, [matchPet.id, ID.cavd])).rows[0];
    await denied('direct Explore application is refused', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'explore')`,
      [matchListing.id, JSON.stringify(applicationAnswers)], 'find my pet match');
    await denied('matching requires saved adopter preferences', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'match')`,
      [matchListing.id, JSON.stringify(applicationAnswers)], 'save your');
    await commitAs(ID.other, () => client.query(preferenceSql, [ID.other]));
    await denied('matching requires CAVD-reviewed pet traits', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'match')`,
      [matchListing.id, JSON.stringify(applicationAnswers)], 'matching traits');
    await client.query(`insert into public.pet_match_traits
      (pet_id, activity_level, temperament, child_compatible, pet_compatible,
       space_need, time_need, experience_need, updated_by)
      values ($1, 3, 'friendly', true, true, 2, 3, 2, $2)`, [matchPet.id, ID.cavd]);
    await allowed('an adopter can apply from a ranked match', ID.other,
      `select public.submit_adoption_application($1, $2::jsonb, 'match')`,
      [matchListing.id, JSON.stringify(applicationAnswers)]);
    await commitAs(ID.other, () => client.query(
      `select public.submit_adoption_application($1, $2::jsonb, 'match')`,
      [matchListing.id, JSON.stringify(applicationAnswers)]));
    await rows('a matched application stores a server-calculated score', ID.other,
      `select application_source, compatibility_score from public.applications
       where adopter_id = $1 and listing_id = $2`,
      r => r.length === 1 && r[0].application_source === 'match' && Number(r[0].compatibility_score) === 100,
      [ID.other, matchListing.id]);

    section('Backend security upgrade');
    await client.query(await readFile(join(root, 'supabase/migrations/0014_backend_security.sql'), 'utf8'));
    ok('applied 0014_backend_security.sql');
    const bucket = (await client.query(`select file_size_limit, allowed_mime_types
      from storage.buckets where id = 'pet-photos'`)).rows[0];
    if (Number(bucket.file_size_limit) === 8388608 &&
        ['image/jpeg', 'image/png', 'image/webp'].every(type => bucket.allowed_mime_types.includes(type)))
      ok('pet photo limits are enforced by Storage configuration');
    else bad('pet photo limits are enforced by Storage configuration');
    await rows('CAVD retains access after MFA', ID.cavd,
      `select public.is_cavd() as allowed`, r => r[0]?.allowed === true);
    try {
      const result = await act(ID.cavd, async () => {
        await client.query(`select set_config('request.jwt.claims', '{"aal":"aal1"}', true)`);
        return client.query(`select public.is_cavd() as allowed`);
      });
      if (result.rows[0]?.allowed === false) ok('CAVD privileges require MFA in the database');
      else bad('CAVD privileges require MFA in the database');
    } catch (e) { bad('CAVD privileges require MFA in the database', e.message); }
    await rows('application history records existing submission', ID.other,
      `select new_status, new_stage from public.application_events
       where application_id in (select id from public.applications where adopter_id = $1 and listing_id = $2)`,
      r => r.length === 0, [ID.other, matchListing.id]);
    await commitAs(ID.cavd, () => client.query(
      `select public.review_adoption_application(a.id, 'under_review', 'Checking application')
       from public.applications a where a.adopter_id = $1 and a.listing_id = $2`,
      [ID.other, matchListing.id]));
    await rows('CAVD review creates a history event', ID.other,
      `select old_stage, new_stage, remarks from public.application_events
       where application_id in (select id from public.applications where adopter_id = $1 and listing_id = $2)`,
      r => r.length === 1 && r[0].old_stage === 'pending_review' &&
        r[0].new_stage === 'under_review' && r[0].remarks === 'Checking application',
      [ID.other, matchListing.id]);
    const reviewedApplicationId = (await client.query(`select id from public.applications
      where adopter_id = $1 and listing_id = $2`, [ID.other, matchListing.id])).rows[0].id;
    try {
      await act(ID.cavd, async () => {
        await client.query(`select set_config('request.jwt.claims', '{"aal":"aal1"}', true)`);
        return client.query(`select public.review_adoption_application($1, 'rejected', 'Denied')`,
          [reviewedApplicationId]);
      });
      bad('CAVD review RPC rejects a session without MFA');
    } catch (e) {
      if (/only CAVD staff/i.test(e.message)) ok('CAVD review RPC rejects a session without MFA');
      else bad('CAVD review RPC rejects a session without MFA', e.message);
    }
    await commitAs(ID.cavd, () => client.query(
      `select public.approve_application($1, 'owner_conversation', current_date,
        'CAVD desk', 'Validated after owner conversation')`, [reviewedApplicationId]));
    await rows('final approval remains possible after function hardening', ID.other,
      `select status from public.applications where id = $1`,
      r => r[0]?.status === 'approved', [reviewedApplicationId]);
    await rows('final approval adds an immutable history event', ID.other,
      `select new_status from public.application_events where application_id = $1
       order by created_at`, r => r.length === 2 && r[1].new_status === 'approved',
      [reviewedApplicationId]);
    await denied('applicant cannot change application history', ID.other,
      `update public.application_events set remarks = 'changed'`, [], 'permission denied');
    const existingApplications = Number((await client.query(
      `select count(*) as total from public.applications where adopter_id = $1
       and created_at >= now() - interval '24 hours'`, [ID.other])).rows[0].total);
    const remaining = 10 - existingApplications;
    for (let number = 1; number <= remaining + 1; number++) {
      const pet = await mkPet(null, ID.cavd, 'shelter', 'approved', `Quota pet ${number}`,
        'dog', 'female', 'small', '2025-01-01');
      const listing = (await client.query(`insert into public.listings
        (pet_id, listed_by, status, decided_by, decided_at)
        values ($1, $2, 'approved', $2, now()) returning id`, [pet.id, ID.cavd])).rows[0];
      try {
        await client.query(`insert into public.applications (listing_id, adopter_id, message)
          values ($1, $2, 'Quota test')`, [listing.id, ID.other]);
        if (number === remaining + 1) bad('daily application quota rejects the eleventh submission');
      } catch (e) {
        if (number === remaining + 1 && /application limit reached/i.test(e.message))
          ok('daily application quota rejects the eleventh submission');
        else bad('daily application quota', e.message);
      }
    }
    const unsafeDefiners = (await client.query(`select count(*)::int as total from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c
        where c in ('search_path=', 'search_path=""'))`)).rows[0].total;
    if (unsafeDefiners === 0) ok('public definer functions use an empty search path');
    else bad('public definer functions use an empty search path', `${unsafeDefiners} remain`);
    await client.query(await readFile(join(root, 'supabase/migrations/0015_identity_status_privacy.sql'), 'utf8'));
    ok('applied 0015_identity_status_privacy.sql');
    await rows('a user cannot probe someone else\'s identity status', ID.other,
      `select public.identity_approved($1) as approved`, r => r[0]?.approved === false,
      [ID.owner]);
    await rows('the verified owner can still check their identity status', ID.owner,
      `select public.identity_approved($1) as approved`, r => r[0]?.approved === true,
      [ID.owner]);
    await rows('MFA-verified CAVD can check an account identity status', ID.cavd,
      `select public.identity_approved($1) as approved`, r => r[0]?.approved === true,
      [ID.owner]);
    section('Temporary CAVD demo access');
    await client.query(await readFile(join(root, 'supabase/migrations/0016_demo_cavd_password_only.sql'), 'utf8'));
    const demoAccess = await act(ID.cavd, async () => {
      await client.query(`select set_config('request.jwt.claims', '{"aal":"aal1","email":"cavd@demo.local"}', true)`);
      return client.query('select public.is_cavd() as allowed, public.identity_approved($1) as approved', [ID.owner]);
    });
    if (demoAccess.rows[0]?.allowed === true && demoAccess.rows[0]?.approved === true)
      ok('password-only CAVD can use the office during the demo');
    else bad('password-only CAVD can use the office during the demo');
    const otherCavdAccess = await act(ID.cavd, async () => {
      await client.query(`select set_config('request.jwt.claims', '{"aal":"aal1","email":"staff@example.com"}', true)`);
      return client.query('select public.is_cavd() as allowed');
    });
    if (otherCavdAccess.rows[0]?.allowed === false) ok('other CAVD accounts still need MFA');
    else bad('other CAVD accounts still need MFA');
    await rows('ordinary users do not gain CAVD access in demo mode', ID.other,
      'select public.is_cavd() as allowed', r => r[0]?.allowed === false);
    await client.query(await readFile(join(root, 'supabase/maintenance/restore_cavd_mfa.sql'), 'utf8'));
    const restoredAccess = await act(ID.cavd, async () => {
      await client.query(`select set_config('request.jwt.claims', '{"aal":"aal1","email":"cavd@demo.local"}', true)`);
      return client.query('select public.is_cavd() as allowed');
    });
    if (restoredAccess.rows[0]?.allowed === false) ok('restoration requires CAVD MFA again');
    else bad('restoration requires CAVD MFA again');

    section('Direct adoption requests');
    await client.query(await readFile(join(root, 'supabase/migrations/0017_direct_adoption_requests.sql'), 'utf8'));
    ok('applied 0017_direct_adoption_requests.sql');
    const directPet = await mkPet(null, ID.cavd, 'shelter', 'approved', 'Direct Request Pet', 'cat', 'female', 'small', '2024-01-01');
    const directListing = (await client.query(`insert into public.listings
      (pet_id, listed_by, status, decided_by, decided_at)
      values ($1, $2, 'approved', $2, now()) returning id`, [directPet.id, ID.cavd])).rows[0];
    await client.query('delete from public.adopter_preferences where user_id = $1', [ID.owner]);
    const directId = (await commitAs(ID.owner, () => client.query(
      'select public.submit_direct_adoption_application($1) as id', [directListing.id]))).rows[0].id;
    await rows('direct request needs no preferences, traits or questionnaire and enters CAVD review', ID.owner,
      `select application_source, answers_json, compatibility_score, status, review_stage
       from public.applications where id = $1`, r => r.length === 1 &&
       r[0].application_source === 'direct' && r[0].answers_json === null &&
       r[0].compatibility_score === null && r[0].status === 'pending' && r[0].review_stage === 'pending_review', [directId]);
    await rows('repeated direct submission returns the same request', ID.owner,
      'select public.submit_direct_adoption_application($1) as id', r => r[0]?.id === directId, [directListing.id]);
    await rows('CAVD sees the direct request in its queue', ID.cavd,
      'select id from public.applications where id = $1', r => r.length === 1, [directId]);
    await rows('direct submission creates an application history event', ID.owner,
      'select new_stage from public.application_events where application_id = $1',
      r => r.length === 1 && r[0].new_stage === 'pending_review', [directId]);
    await rows('another adopter cannot see this direct request', ID.adopter,
      'select id from public.applications where id = $1', r => r.length === 0, [directId]);
    await denied('a vet cannot submit a direct adoption request', ID.vet,
      'select public.submit_direct_adoption_application($1)', [directListing.id], 'only verified');
    await denied('a signed-out account cannot submit a direct adoption request', null,
      'select public.submit_direct_adoption_application($1)', [directListing.id], 'only verified');
    const ownListing = (await client.query(`insert into public.listings
      (pet_id, listed_by, status, decided_by, decided_at)
      values ($1, $2, 'approved', $3, now()) returning id`, [petFree.id, ID.owner, ID.cavd])).rows[0];
    await denied('an owner cannot directly apply for their own pet', ID.owner,
      'select public.submit_direct_adoption_application($1)', [ownListing.id], 'not available');
    await denied('an unavailable listing refuses a direct request', ID.owner,
      'select public.submit_direct_adoption_application($1)', ['ffffffff-0000-4000-8000-000000000001'], 'no longer open');
    await noEffect('an adopter cannot approve their direct request', ID.owner,
      `update public.applications set status = 'approved' where id = $1`, [directId]);
    await denied('direct request still needs CAVD validation before transfer', ID.cavd,
      `select public.approve_application($1, 'unknown', current_date, 'Applicant', 'Reviewed request')`,
      [directId], 'choose how cavd validated');
    await act(ID.cavd, async () => {
      await client.query(`select public.approve_application($1, 'cavd_visit', current_date,
        'Applicant', 'Direct request validated at CAVD.')`, [directId]);
      const pet = (await client.query('select owner_id from public.pets where id = $1', [directPet.id])).rows[0];
      const listing = (await client.query('select status from public.listings where id = $1', [directListing.id])).rows[0];
      const application = (await client.query('select status, review_stage from public.applications where id = $1', [directId])).rows[0];
      if (pet.owner_id === ID.owner && listing.status === 'closed' && application.status === 'approved' && application.review_stage === 'approved')
        ok('validated direct request transfers ownership and closes the listing');
      else bad('validated direct request transfers ownership and closes the listing');
    });

    section('Strict adoption eligibility and configurable weights');
    await client.query(await readFile(join(root, 'supabase/migrations/0018_strict_adoption_rules.sql'), 'utf8'));
    ok('applied 0018_strict_adoption_rules.sql');
    await rows('old records start on hold without invented verification', ID.cavd,
      'select availability,verified_by,verified_at from public.pet_adoption_checks where pet_id = $1',
      r => r[0]?.availability === 'hold' && r[0].verified_by === null && r[0].verified_at === null, [directPet.id]);
    const strictPet = (await client.query(`insert into public.pets
      (created_by,source,registry_status,name,species,sex,size,birth_date,sterilized,rabies_vaccinated,rabies_vaccinated_on)
      values ($1,'shelter','approved','Strict adoption sample','dog','female','small','2025-01-01',true,true,current_date) returning id,qr_slug`, [ID.cavd])).rows[0];
    const strictListing = (await client.query(`insert into public.listings(pet_id,listed_by,status)
      values($1,$2,'pending') returning id`, [strictPet.id, ID.cavd])).rows[0];
    await rows('new pets automatically start on hold', ID.cavd,
      'select availability from public.pet_adoption_checks where pet_id = $1', r => r[0]?.availability === 'hold', [strictPet.id]);
    await denied('listing approval is blocked until every eligibility check passes', ID.cavd,
      `update public.listings set status = 'approved' where id = $1`, [strictListing.id], 'eligibility checks');
    const saveChecks = `select public.save_pet_adoption_checks($1,$2,$3,current_date + 30,$4,'Reviewed for demonstration',true)`;
    await denied('owners cannot certify adoption eligibility', ID.owner, saveChecks,
      [strictPet.id, 'available', 'current', 'cleared'], 'only cavd');
    await denied('vets cannot certify adoption eligibility', ID.vet, saveChecks,
      [strictPet.id, 'available', 'current', 'cleared'], 'only cavd');
    await denied('eligibility cannot be changed through a direct table write', ID.cavd,
      `update public.pet_adoption_checks set availability = 'available' where pet_id = $1`, [strictPet.id], 'permission denied');
    await denied('CAVD must explicitly confirm the eligibility review', ID.cavd,
      `select public.save_pet_adoption_checks($1,'available','current',current_date + 30,'cleared','',false)`, [strictPet.id], 'confirm');
    await denied('expired vaccination cannot be certified Current', ID.cavd,
      `select public.save_pet_adoption_checks($1,'available','current',current_date - 1,'cleared','',true)`, [strictPet.id], 'valid-through');
    await denied('Adopted cannot be assigned without an ownership transfer', ID.cavd,
      saveChecks, [strictPet.id, 'adopted', 'current', 'cleared'], 'ownership transfer');
    await denied('adopters cannot read the CAVD eligibility report', ID.owner,
      'select * from public.cavd_eligibility_report()', [], 'only cavd');
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'available', 'current', 'not_cleared']));
    await rows('unmet behavioral clearance provides an exclusion reason', ID.cavd,
      'select eligible,reasons from public.cavd_eligibility_report() where pet_id = $1',
      r => r[0]?.eligible === false && r[0].reasons.some(reason => /behavioral/i.test(reason)), [strictPet.id]);
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'available', 'current', 'cleared']));
    await rows('all required conditions pass after a CAVD review', ID.cavd,
      'select eligible,reasons from public.cavd_eligibility_report() where pet_id = $1',
      r => r[0]?.eligible === true && r[0].reasons.length === 0, [strictPet.id]);
    await commitAs(ID.cavd, () => client.query(`update public.listings set status = 'approved',decided_by = $2,decided_at = now() where id = $1`, [strictListing.id, ID.cavd]));
    const anonEligible = await asRole('anon', () => client.query('select listing_id from public.public_listings where listing_id = $1', [strictListing.id]));
    if (anonEligible.rowCount === 1) ok('anonymous public browsing exposes the eligible listing');
    else bad('anonymous public browsing exposes the eligible listing');
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'hold', 'current', 'cleared']));
    const anonHold = await asRole('anon', () => client.query('select listing_id from public.public_listings where listing_id = $1', [strictListing.id]));
    if (anonHold.rowCount === 0) ok('placing a pet on Hold immediately hides its listing');
    else bad('placing a pet on Hold immediately hides its listing');
    await rows('public PET ID lookup does not advertise an on-hold adoption listing', ID.owner,
      'select is_listed,listing_id from public.public_pets where qr_slug = $1',
      r => r[0]?.is_listed === false && r[0].listing_id === null, [strictPet.qr_slug]);
    await denied('direct application cannot bypass Hold', ID.owner,
      'select public.submit_direct_adoption_application($1)', [strictListing.id], 'eligibility checks');
    await denied('matching application cannot bypass Hold', ID.owner,
      `select public.submit_adoption_application($1,$2::jsonb,'match')`, [strictListing.id, JSON.stringify(applicationAnswers)], 'eligibility checks');
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'available', 'current', 'cleared']));
    const strictDirectId = (await commitAs(ID.owner, () => client.query('select public.submit_direct_adoption_application($1) as id', [strictListing.id]))).rows[0].id;
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'hold', 'current', 'cleared']));
    await denied('an earlier request cannot be approved after the pet goes on Hold', ID.cavd,
      `select public.approve_application($1,'cavd_visit',current_date,'Applicant','Validated at CAVD')`, [strictDirectId], 'eligibility checks');
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'available', 'current', 'cleared']));
    await commitAs(ID.cavd, () => client.query('update public.pets set sterilized = false where id = $1', [strictPet.id]));
    await rows('health flag changes invalidate the earlier CAVD review', ID.cavd,
      'select verified_by,verified_at from public.pet_adoption_checks where pet_id = $1', r => r[0]?.verified_by === null && r[0].verified_at === null, [strictPet.id]);
    await denied('a changed health record cannot use stale approval', ID.owner,
      'select public.submit_direct_adoption_application($1)', [strictListing.id], 'eligibility checks');
    await commitAs(ID.cavd, () => client.query('update public.pets set sterilized = true where id = $1', [strictPet.id]));
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'available', 'current', 'cleared']));

    const equalWeights = { species: .1,size: .1,age: .1,activity: .1,temperament: .1,space: .1,time: .1,children: .1,other_pets: .1,experience: .1 };
    await denied('ordinary users cannot change weights', ID.owner,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify(equalWeights)], 'only cavd');
    await denied('weight totals other than 1.00 are rejected', ID.cavd,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify({ ...equalWeights, species: .2 })], 'add up');
    await denied('negative weights are rejected even when their total is 1.00', ID.cavd,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify({ ...equalWeights, species: -.1, size: .3 })], 'between 0 and 1');
    await denied('missing or unsupported weight keys are rejected', ID.cavd,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify({ species: 1 })], 'ten supported');
    await denied('numeric strings cannot bypass weight validation', ID.cavd,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify({ ...equalWeights, species: '0.1' })], 'numeric');
    const focusedWeights = Object.fromEntries(Object.keys(equalWeights).map(key => [key, key === 'species' ? 1 : 0]));
    await commitAs(ID.cavd, () => client.query('select public.set_match_weights($1::jsonb)', [JSON.stringify(focusedWeights)]));
    await commitAs(ID.owner, () => client.query(preferenceSql, [ID.owner]));
    await client.query(`insert into public.pet_match_traits
      (pet_id,activity_level,temperament,child_compatible,pet_compatible,space_need,time_need,experience_need,updated_by)
      values($1,5,'protective',false,false,5,5,5,$2)`, [strictPet.id, ID.cavd]);
    const weightedId = (await commitAs(ID.adopter, () => client.query(
      `select public.submit_adoption_application($1,$2::jsonb,'match') as id`, [strictListing.id, JSON.stringify(applicationAnswers)]))).rows[0].id;
    await rows('server scoring uses CAVD weights and records their version', ID.adopter,
      'select compatibility_score,compatibility_weights_json,compatibility_weights_version from public.applications where id = $1',
      r => Number(r[0]?.compatibility_score) === 100 && r[0].compatibility_weights_json.species === 1 && r[0].compatibility_weights_version === 2, [weightedId]);
    await commitAs(ID.cavd, () => client.query('select public.set_match_weights($1::jsonb)', [JSON.stringify(equalWeights)]));
    await rows('later weight changes do not rewrite earlier application scores', ID.adopter,
      'select compatibility_score,compatibility_weights_version from public.applications where id = $1',
      r => Number(r[0]?.compatibility_score) === 100 && r[0].compatibility_weights_version === 2, [weightedId]);
    await rows('weight changes retain an auditable history', ID.cavd,
      'select version from public.match_weight_history order by version', r => r.length === 3, []);
    await noEffect('CAVD cannot rewrite the captured application score', ID.cavd,
      'update public.applications set compatibility_weights_version = 3 where id = $1', [weightedId]);
    await client.query('update public.pet_adoption_checks set vaccination_valid_until = current_date - 1 where pet_id = $1', [strictPet.id]);
    await rows('expired vaccination immediately removes adoption eligibility', ID.cavd,
      'select eligible,reasons from public.cavd_eligibility_report() where pet_id = $1',
      r => r[0]?.eligible === false && r[0].reasons.some(reason => /vaccination/.test(reason)), [strictPet.id]);
    await denied('expired vaccination blocks direct application through the API', ID.other,
      'select public.submit_direct_adoption_application($1)', [strictListing.id], 'eligibility checks');
    await commitAs(ID.cavd, () => client.query(saveChecks, [strictPet.id, 'available', 'current', 'cleared']));
    await act(ID.cavd, async () => {
      await client.query(`select public.approve_application($1,'cavd_visit',current_date,'Applicant','Strict checks passed')`, [strictDirectId]);
      const status = (await client.query('select availability from public.pet_adoption_checks where pet_id = $1', [strictPet.id])).rows[0];
      const visible = await client.query('select listing_id from public.public_listings where listing_id = $1', [strictListing.id]);
      if (status.availability === 'adopted' && visible.rowCount === 0) ok('validated transfer marks Adopted and removes the pet from browsing');
      else bad('validated transfer marks Adopted and removes the pet from browsing');
    });

    section('Required forms without preference matching');
    const formAdopter = 'eeeeeeee-0000-4000-8000-000000000019';
    await client.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'form-adopter@demo.local','{"name":"Form Adopter"}')`, [formAdopter]);
    await commitAs(ID.cavd, () => client.query(`update public.profiles set role = 'user',is_active = true,verification_exempt = true where id = $1`, [formAdopter]));
    const formPet = (await client.query(`insert into public.pets
      (created_by,source,registry_status,name,species,sex,size,birth_date,sterilized,rabies_vaccinated,rabies_vaccinated_on)
      values($1,'shelter','approved','Form-only sample','cat','female','small','2024-01-01',true,true,current_date) returning id`, [ID.cavd])).rows[0];
    await commitAs(ID.cavd, () => client.query(saveChecks, [formPet.id, 'available', 'current', 'cleared']));
    const formListing = (await client.query(`insert into public.listings(pet_id,listed_by,status)
      values($1,$2,'approved') returning id`, [formPet.id, ID.cavd])).rows[0];
    const earlierRequest = (await commitAs(ID.owner, () => client.query(
      'select public.submit_direct_adoption_application($1) as id', [formListing.id]))).rows[0].id;
    await commitAs(ID.cavd, () => client.query(`select public.review_adoption_application($1,'additional_requirements','Please complete the form')`, [earlierRequest]));
    await client.query('delete from public.adopter_preferences where user_id in ($1,$2)', [ID.owner, formAdopter]);
    await client.query(await readFile(join(root, 'supabase/migrations/0019_required_adoption_forms.sql'), 'utf8'));
    ok('applied 0019_required_adoption_forms.sql');
    await denied('old direct endpoint cannot submit a form-free request', formAdopter,
      'select public.submit_direct_adoption_application($1)', [formListing.id], 'application form');
    await denied('application forms reject an empty questionnaire', formAdopter,
      `select public.submit_adoption_application($1,'{}'::jsonb,'explore')`, [formListing.id], 'required');
    await denied('form submission requires the accuracy declaration', formAdopter,
      `select public.submit_adoption_application($1,$2::jsonb,'explore')`,
      [formListing.id, JSON.stringify({ ...applicationAnswers, declaration: false })], 'declaration');
    await denied('arbitrary source names cannot create applications', formAdopter,
      `select public.submit_adoption_application($1,$2::jsonb,'direct')`, [formListing.id, JSON.stringify(applicationAnswers)], 'valid application source');
    await denied('vets cannot submit the adopter form', ID.vet,
      `select public.submit_adoption_application($1,$2::jsonb,'explore')`, [formListing.id, JSON.stringify(applicationAnswers)], 'only verified');
    await denied('matched applications still require saved preferences', ID.owner,
      `select public.submit_adoption_application($1,$2::jsonb,'match')`, [formListing.id, JSON.stringify(applicationAnswers)], 'save your');
    await denied('CAVD cannot approve an earlier form-free request', ID.cavd,
      `select public.approve_application($1,'cavd_visit',current_date,'Applicant','Reviewed in office')`, [earlierRequest], 'application form');
    const formId = (await commitAs(formAdopter, () => client.query(
      `select public.submit_adoption_application($1,$2::jsonb,'explore') as id`, [formListing.id, JSON.stringify(applicationAnswers)]))).rows[0].id;
    await rows('listed-pet application saves answers without preferences or pet matching traits', formAdopter,
      `select application_source,answers_json,compatibility_score,compatibility_weights_json,compatibility_weights_version,status
       from public.applications where id = $1`,
      r => r[0]?.application_source === 'explore' && r[0].answers_json.full_name === applicationAnswers.full_name &&
        r[0].compatibility_score === null && r[0].compatibility_weights_json === null && r[0].compatibility_weights_version === null && r[0].status === 'pending', [formId]);
    await rows('repeated form submission returns the existing application', formAdopter,
      `select public.submit_adoption_application($1,$2::jsonb,'explore') as id`,
      r => r[0]?.id === formId, [formListing.id, JSON.stringify({ ...applicationAnswers, full_name: 'Changed name' })]);
    await rows('repeated submissions never replace the original answers', formAdopter,
      'select answers_json from public.applications where id = $1', r => r[0]?.answers_json.full_name === applicationAnswers.full_name, [formId]);
    await rows('CAVD receives completed form answers for assessment', ID.cavd,
      'select answers_json from public.applications where id = $1', r => r[0]?.answers_json.care_plan === applicationAnswers.care_plan, [formId]);
    await rows('another adopter cannot read the submitted answers', ID.adopter,
      'select answers_json from public.applications where id = $1', r => r.length === 0, [formId]);
    await commitAs(ID.cavd, () => client.query(saveChecks, [formPet.id, 'hold', 'current', 'cleared']));
    await denied('form submission cannot bypass adoption Hold', ID.adopter,
      `select public.submit_adoption_application($1,$2::jsonb,'explore')`, [formListing.id, JSON.stringify(applicationAnswers)], 'eligibility checks');
    await commitAs(ID.cavd, () => client.query(saveChecks, [formPet.id, 'available', 'current', 'cleared']));
    await commitAs(ID.owner, () => client.query(`select public.submit_adoption_application($1,$2::jsonb,'explore')`, [formListing.id, JSON.stringify(applicationAnswers)]));
    await rows('an earlier direct request gains its form without losing CAVD remarks', ID.owner,
      'select application_source,answers_json,cavd_remarks from public.applications where id = $1',
      r => r[0]?.application_source === 'explore' && r[0].answers_json.full_name === applicationAnswers.full_name && r[0].cavd_remarks === 'Please complete the form', [earlierRequest]);
    await act(ID.cavd, async () => {
      await client.query(`select public.approve_application($1,'cavd_visit',current_date,'Applicant','Reviewed completed form')`, [formId]);
      const record = (await client.query('select owner_id from public.pets where id = $1', [formPet.id])).rows[0];
      if (record.owner_id === formAdopter) ok('reviewed form still requires and supports the normal validated transfer');
      else bad('reviewed form still requires and supports the normal validated transfer');
    });

    section('CAVD veterinary integration and adoption tags');
    // The accounts above are the legacy rows this migration has to retire safely.
    const pendingVet = 'eeeeeeee-0000-4000-8000-000000000020';
    const tagAdopter = 'eeeeeeee-0000-4000-8000-000000000021';
    const signupVet = 'eeeeeeee-0000-4000-8000-000000000022';
    await client.query(`insert into auth.users(id,email,raw_user_meta_data) values
      ($1,'pending-vet@example.com','{"name":"Pending Vet","requested_role":"vet"}'),
      ($2,'tag-adopter@example.com','{"name":"Tag Adopter"}')`, [pendingVet, tagAdopter]);
    await client.query(`insert into public.verification_requests(user_id,requested_role,id_type,id_path,clinic_name,prc_number)
      values($1,'vet','prc_id',$2,'Waiting Clinic','PRC-WAIT')`, [pendingVet, pendingVet + '/prc.jpg']);
    await commitAs(ID.cavd, () => client.query('update public.profiles set verification_exempt = true where id = $1', [tagAdopter]));
    const visitsBefore = (await client.query('select count(*)::int as n from public.visits')).rows[0].n;
    await client.query(await readFile(join(root, 'supabase/migrations/0020_cavd_vet_integration_and_adoption_tags.sql'), 'utf8'));
    ok('applied 0020_cavd_vet_integration_and_adoption_tags.sql');

    const retired = (await client.query(`select count(*)::int as total, count(*) filter (where is_active)::int as active from public.profiles where role = 'vet'`)).rows[0];
    if (retired.total > 0 && retired.active === 0) ok('every vet account is deactivated but kept');
    else bad('every vet account is deactivated but kept', JSON.stringify(retired));
    const visitsAfter = (await client.query('select count(*)::int as n, count(*) filter (where clearance_status <> $1)::int as cleared from public.visits', ['pending'])).rows[0];
    if (visitsAfter.n === visitsBefore && visitsAfter.cleared === 0) ok('every earlier visit stays on record, starting as Pending');
    else bad('every earlier visit stays on record, starting as Pending', JSON.stringify({ visitsBefore, visitsAfter }));
    const waiting = (await client.query(`select r.status, r.review_note, p.registration_kind from public.verification_requests r
      join public.profiles p on p.id = r.user_id where r.user_id = $1`, [pendingVet])).rows[0];
    if (waiting.status === 'rejected' && /no longer registers/.test(waiting.review_note) && waiting.registration_kind === 'user') ok('a waiting vet applicant moves to the owner path with a reason');
    else bad('a waiting vet applicant moves to the owner path with a reason', JSON.stringify(waiting));
    await client.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'signup-vet@example.com','{"name":"Signup Vet","requested_role":"vet"}')`, [signupVet]);
    const signedUp = (await client.query('select role, registration_kind from public.profiles where id = $1', [signupVet])).rows[0];
    if (signedUp.role === 'user' && signedUp.registration_kind === 'user') ok('signup metadata can no longer choose a vet account');
    else bad('signup metadata can no longer choose a vet account', JSON.stringify(signedUp));
    await denied('a vet ID request is refused with a clear message', signupVet,
      `insert into public.verification_requests(user_id,requested_role,id_type,id_path,clinic_name,prc_number)
       values($1,'vet','prc_id',$2,'New Clinic','PRC-1')`, [signupVet, signupVet + '/prc.jpg'], 'no longer registers');
    await denied('CAVD cannot reactivate an outside vet', ID.cavd,
      'update public.profiles set is_active = true where id = $1', [ID.vet], 'retired');
    await denied('CAVD cannot issue the vet role', ID.cavd,
      `update public.profiles set role = 'vet' where id = $1`, [signupVet], 'retired');
    await rows('a deactivated vet can read no visits', ID.vet, 'select id from public.visits', r => r.length === 0 || 'saw ' + r.length);
    await denied('a deactivated vet cannot write a visit', ID.vet,
      `insert into public.visits(pet_id,recorded_by,clinic_name,visit_date,summary) values($1,$2,'Closed',current_date,'No')`,
      [formPet.id, ID.vet], 'row-level security');
    await noEffect('a deactivated vet cannot edit a pet', ID.vet, `update public.pets set color = 'Red' where id = $1`, [formPet.id]);
    await allowed('CAVD can edit pet details a vet used to edit', ID.cavd,
      `update public.pets set weight_kg = 12.5, color = 'Brown', photo_url = 'https://example.test/cavd.jpg' where id = $1`, [formPet.id]);

    const addVisit = `insert into public.visits(pet_id,recorded_by,recorded_by_name,clinic_name,visit_date,summary,clearance_status)
      values($1,$2,'Forged name','CAVD Veterinary Clinic',$3,'Checked',$4) returning id,recorded_by_name,verification_status,clearance_status`;
    const tagPet = (await client.query(`insert into public.pets
      (created_by,source,registry_status,name,species,sex,size,birth_date,sterilized,rabies_vaccinated,rabies_vaccinated_on)
      values($1,'shelter','approved','Clearance Pet','dog','male','small','2024-01-01',true,true,current_date) returning id,qr_slug`, [ID.cavd])).rows[0];
    await commitAs(ID.cavd, () => client.query(saveChecks, [tagPet.id, 'available', 'current', 'cleared']));
    const listingRequest = `insert into public.listings(pet_id,listed_by,status,decided_by,decided_at) values($1,$2,'approved',$2,now()) returning id`;
    await denied('a listing cannot be approved before a Cleared visit', ID.cavd, listingRequest, [tagPet.id, ID.cavd], 'eligibility');
    await rows('a pet with no visit reports that reason', ID.cavd, 'select reasons, latest_clearance from public.cavd_eligibility_report() where pet_id = $1',
      r => (r[0]?.latest_clearance === null && r[0].reasons.join().includes('Latest veterinary visit is not Cleared (no visit recorded)')) || JSON.stringify(r), [tagPet.id]);
    await denied('an ordinary user cannot record a visit', tagAdopter,
      addVisit, [tagPet.id, tagAdopter, new Date().toISOString().slice(0, 10), 'cleared'], 'row-level security');
    const oldVisit = (await commitAs(ID.cavd, () => client.query(addVisit, [tagPet.id, ID.cavd, '2026-01-10', 'cleared']))).rows[0];
    if (oldVisit.clearance_status === 'cleared' && oldVisit.verification_status === 'cavd_confirmed' && oldVisit.recorded_by_name === 'CAVD Office') ok('CAVD saves clearance and the recorder is always the signed-in staff member');
    else bad('CAVD saves clearance and the recorder is always the signed-in staff member', JSON.stringify(oldVisit));
    const tagListing = (await commitAs(ID.cavd, () => client.query(listingRequest, [tagPet.id, ID.cavd]))).rows[0];
    const listed = async () => (await asRole('anon', () => client.query('select l.custody_source from public.public_listings l where l.listing_id = $1', [tagListing.id]))).rows;
    const publicListed = async () => (await asRole('anon', () => client.query('select is_listed, custody_source from public.public_pets where qr_slug = $1', [tagPet.qr_slug]))).rows[0];
    const expectFeed = async (name, visible) => {
      const inFeed = (await listed()).length === 1; const pet = await publicListed();
      if (inFeed === visible && pet.is_listed === visible) ok(name);
      else bad(name, JSON.stringify({ inFeed, pet }));
    };
    await expectFeed('a Cleared latest visit keeps a passing pet in the public feed', true);
    const shelterTag = await publicListed();
    if (shelterTag.custody_source === 'shelter' && (await listed())[0].custody_source === 'shelter') ok('shelter pets are tagged shelter in both public views');
    else bad('shelter pets are tagged shelter in both public views', JSON.stringify(shelterTag));
    const latestVisit = (await commitAs(ID.cavd, () => client.query(addVisit, [tagPet.id, ID.cavd, '2026-02-10', 'hold']))).rows[0];
    await expectFeed('a Hold latest visit removes the pet from the feed, even after an earlier Cleared visit', false);
    await denied('a Hold pet cannot receive an application', tagAdopter,
      `select public.submit_adoption_application($1,$2::jsonb,'explore')`, [tagListing.id, JSON.stringify(applicationAnswers)], 'eligibility checks');
    await denied('clearance cannot change without a correction note', ID.cavd,
      `update public.visits set clearance_status = 'cleared' where id = $1`, [latestVisit.id], 'correction_note');
    await commitAs(ID.cavd, () => client.query(`update public.visits set clearance_status = 'pending', correction_note = 'Awaiting lab result' where id = $1`, [latestVisit.id]));
    await expectFeed('a Pending latest visit also keeps the pet out of the feed', false);
    await denied('a later clearance change cannot reuse the old note', ID.cavd,
      `update public.visits set clearance_status = 'cleared' where id = $1`, [latestVisit.id], 'new correction_note');
    await commitAs(ID.cavd, () => client.query(`update public.visits set clearance_status = 'cleared', correction_note = 'Lab result normal' where id = $1`, [latestVisit.id]));
    await expectFeed('correcting the latest visit to Cleared returns the pet to the feed', true);
    await rows('each clearance change is written to the correction audit', ID.cavd,
      `select previous_record->>'clearance_status' as before, corrected_record->>'clearance_status' as after, correction_note
       from public.visit_corrections where visit_id = $1 order by corrected_at, correction_note`,
      r => (r.length === 2 && r.some(x => x.before === 'hold' && x.after === 'pending') && r.some(x => x.before === 'pending' && x.after === 'cleared')) || JSON.stringify(r), [latestVisit.id]);
    await asRole('anon', async () => {
      try { await client.query('select public.latest_visit_clearance($1)', [tagPet.id]); bad('clearance lookup is not exposed publicly'); }
      catch { ok('clearance lookup is not exposed publicly'); }
    });

    const ownerPet = (await client.query(`insert into public.pets
      (owner_id,created_by,source,registry_status,name,species,sex,size,birth_date,sterilized,rabies_vaccinated,rabies_vaccinated_on)
      values($1,$1,'owner','approved','Private Tag Pet','cat','female','small','2024-01-01',true,true,current_date) returning id,custody_source`, [ID.owner])).rows[0];
    if (ownerPet.custody_source === 'private') ok('owner pets are tagged private');
    else bad('owner pets are tagged private', JSON.stringify(ownerPet));
    await commitAs(ID.cavd, () => client.query(saveChecks, [ownerPet.id, 'available', 'current', 'cleared']));
    await commitAs(ID.cavd, () => client.query(addVisit, [ownerPet.id, ID.cavd, '2026-03-10', 'cleared']));
    const ownerListing = (await commitAs(ID.cavd, () => client.query(listingRequest, [ownerPet.id, ID.cavd]))).rows[0];
    try {
      await client.query(`insert into public.applications(listing_id,adopter_id,answers_json) values($1,$2,'{}')`, [ownerListing.id, ID.owner]);
      bad('the database blocks self-adoption even outside the RPC functions', 'insert succeeded');
    } catch (e) {
      if (/cannot apply to adopt your own pet/.test(e.message)) ok('the database blocks self-adoption even outside the RPC functions');
      else bad('the database blocks self-adoption even outside the RPC functions', e.message);
    }
    await denied('the submit function still refuses a person’s own pet', ID.owner,
      `select public.submit_adoption_application($1,$2::jsonb,'explore')`, [ownerListing.id, JSON.stringify(applicationAnswers)], 'eligibility checks');

    await commitAs(ID.cavd, () => client.query(`insert into public.pet_match_traits
      (pet_id,activity_level,temperament,child_compatible,pet_compatible,space_need,time_need,experience_need,updated_by)
      values($1,3,'calm',true,true,2,2,2,$2)`, [tagPet.id, ID.cavd]));
    await commitAs(tagAdopter, () => client.query(`insert into public.adopter_preferences
      (user_id,preferred_species,preferred_size,preferred_age,activity_preference,temperament_preference,living_space,time_availability,children_at_home,other_pets_at_home,ownership_experience)
      values($1,'dog','small','young',3,'calm',3,3,false,false,2)`, [tagAdopter]));
    const stamped = (await commitAs(tagAdopter, () => client.query(`select public.submit_adoption_application($1,$2::jsonb,'match') as id`, [tagListing.id, JSON.stringify(applicationAnswers)]))).rows[0].id;
    const stampedRow = async () => (await client.query('select discovery_path, preference_snapshot_json, preference_snapshot_at from public.applications where id = $1', [stamped])).rows[0];
    const firstStamp = await stampedRow();
    if (firstStamp.discovery_path === 'match' && Object.keys(firstStamp.preference_snapshot_json).length === 10 && firstStamp.preference_snapshot_at && !('user_id' in firstStamp.preference_snapshot_json)) ok('a match application stamps all 10 answers and is tagged Match');
    else bad('a match application stamps all 10 answers and is tagged Match', JSON.stringify(firstStamp));
    await commitAs(tagAdopter, () => client.query(`update public.adopter_preferences set preferred_species = 'cat' where user_id = $1`, [tagAdopter]));
    if ((await stampedRow()).preference_snapshot_json.preferred_species === 'dog') ok('changing preferences later leaves the stamped answers alone');
    else bad('changing preferences later leaves the stamped answers alone');
    await noEffect('CAVD cannot rewrite stamped answers', ID.cavd,
      `update public.applications set preference_snapshot_json = '{}' where id = $1`, [stamped]);
    await noEffect('an adopter cannot edit stamped answers directly', tagAdopter,
      `update public.applications set preference_snapshot_json = '{}' where id = $1`, [stamped]);
    await commitAs(ID.cavd, () => client.query(`select public.review_adoption_application($1,'for_interview','Please call us')`, [stamped]));
    await commitAs(tagAdopter, () => client.query(`select public.respond_to_adoption_application($1,'I can come on Monday')`, [stamped]));
    await rows('an adopter can still reply to CAVD after the new generated column', tagAdopter,
      'select applicant_response, discovery_path from public.applications where id = $1',
      r => r[0]?.applicant_response === 'I can come on Monday' && r[0].discovery_path === 'match', [stamped]);
    await rows('explore applications are tagged Direct and stamp no answers', formAdopter,
      'select discovery_path, preference_snapshot_json, preference_snapshot_at from public.applications where id = $1',
      r => r[0]?.discovery_path === 'direct' && r[0].preference_snapshot_json === null && r[0].preference_snapshot_at === null, [formId]);
    await rows('legacy and direct requests count as Direct', ID.owner,
      `select discovery_path from public.applications where id = $1`, r => r[0]?.discovery_path === 'direct', [earlierRequest]);

    section('Migration 0021: helper search path');
    await client.query(await readFile(join(root, 'supabase/migrations/0021_pin_helper_search_path.sql'), 'utf8'));
    ok('applied 0021_pin_helper_search_path.sql');
    const unpinned = (await client.query(`select count(*)::int as total from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('gen_qr_slug', 'touch_updated_at') and not exists (select 1 from unnest(p.proconfig) c
        where c in ('search_path=', 'search_path=""'))`)).rows[0].total;
    if (unpinned === 0) ok('gen_qr_slug and touch_updated_at use an empty search path');
    else bad('gen_qr_slug and touch_updated_at use an empty search path', `${unpinned} remain`);
    await rows('a new pet still gets a generated PET ID', ID.cavd,
      `insert into public.pets (created_by, source, registry_status, name, species, sex, size, birth_date)
       values ($1, 'shelter', 'approved', 'Slug Check', 'cat', 'female', 'small', '2023-01-01') returning qr_slug`,
      r => /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(r[0]?.qr_slug ?? ''), [ID.cavd]);
    await rows('a pet update still stamps updated_at', ID.cavd,
      `update public.pets set name = name where id = $1 returning updated_at = now() as fresh`,
      r => r[0]?.fresh === true, [tagPet.id]);

    section('Migration 0022: nine-criterion matching');
    await client.query(await readFile(join(root, 'supabase/migrations/0022_nine_criterion_matching.sql'), 'utf8'));
    ok('applied 0022_nine_criterion_matching.sql');
    const nineCriteria = ['size', 'age', 'activity', 'temperament', 'space', 'time', 'children', 'other_pets', 'experience'];
    const nineSetting = (await client.query('select weights, cavd_confirmed from public.public_match_weights')).rows[0];
    const nineTotal = Object.values(nineSetting.weights).reduce((sum, value) => sum + Number(value), 0);
    if (Object.keys(nineSetting.weights).sort().join() === [...nineCriteria].sort().join() &&
      Math.abs(nineTotal - 1) < 1e-6 && nineSetting.cavd_confirmed === false)
      ok('default weights cover the nine scored criteria at 1/9 and await CAVD review');
    else bad('default weights cover the nine scored criteria at 1/9 and await CAVD review', JSON.stringify(nineSetting));
    const nineWeights = Object.fromEntries(nineCriteria.map(key => [key, 1 / 9]));
    await denied('animal type can no longer be weighted', ID.cavd,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify({ ...nineWeights, species: 0 })], 'nine supported');
    await denied('ten-criterion weights from before 0022 are rejected', ID.cavd,
      'select public.set_match_weights($1::jsonb)', [JSON.stringify(equalWeights)], 'nine supported');
    const childrenOnlyWeights = Object.fromEntries(nineCriteria.map(key => [key, key === 'children' ? 1 : 0]));
    await commitAs(ID.cavd, () => client.query('select public.set_match_weights($1::jsonb)', [JSON.stringify(childrenOnlyWeights)]));
    const nineScore = (await client.query(`select public.match_score_with_weights(p, pref, t, s.weights) as score
      from public.pets p, public.adopter_preferences pref, public.pet_match_traits t, public.match_settings s
      where p.id = $1 and pref.user_id = $2 and t.pet_id = $1`, [tagPet.id, tagAdopter])).rows[0]?.score;
    if (Number(nineScore) === 100) ok('server scoring uses only the nine criteria (animal type is not scored)');
    else bad('server scoring uses only the nine criteria (animal type is not scored)', String(nineScore));
    await commitAs(ID.cavd, () => client.query('select public.set_match_weights($1::jsonb)', [JSON.stringify(nineWeights)]));
    await rows('CAVD can save equal nine-criterion weights', ID.cavd,
      'select weights from public.match_settings', r => Object.keys(r[0]?.weights ?? {}).length === 9, []);

    section('Registration detail requests');
    const draftPet = (await commitAs(ID.owner, () => client.query(`insert into public.pets
      (owner_id, created_by, source, registry_status, name, species, sex, size, birth_date)
      values ($1, $1, 'owner', 'pending', 'Dani', 'dog', 'female', 'small', '2024-05-01') returning id`, [ID.owner]))).rows[0].id;
    // The app sends decided_at as the text 'now', which Postgres reads as the statement's time.
    const asked = (await commitAs(ID.cavd, () => client.query(`update public.pets set registry_note = $2, decided_at = 'now'
      where id = $1 returning registry_status, decided_at = updated_at as stamped`, [draftPet, 'Please complete: breed, colour.']))).rows[0];
    if (asked?.registry_status === 'pending' && asked.stamped === true) ok('CAVD can ask for details and the registration stays pending');
    else bad('CAVD can ask for details and the registration stays pending', JSON.stringify(asked));
    await rows('the owner can read CAVD\u2019s request', ID.owner,
      'select registry_note from public.pets where id = $1', r => r[0]?.registry_note === 'Please complete: breed, colour.', [draftPet]);
    await denied('the owner cannot clear CAVD\u2019s request', ID.owner,
      'update public.pets set registry_note = null where id = $1', [draftPet], 'registry decision');
    await denied('the owner cannot approve their own registration', ID.owner,
      `update public.pets set registry_status = 'approved' where id = $1`, [draftPet], 'registry status');
    const answered = (await commitAs(ID.owner, () => client.query(`update public.pets set breed = 'Aspin (mixed)', color = 'Brown'
      where id = $1 returning updated_at > decided_at as answered, registry_status`, [draftPet]))).rows[0];
    if (answered?.answered === true && answered.registry_status === 'pending') ok('the owner\u2019s correction is saved and marks the request answered');
    else bad('the owner\u2019s correction is saved and marks the request answered', JSON.stringify(answered));
    await noEffect('another user cannot edit that registration', ID.other,
      `update public.pets set breed = 'Changed' where id = $1`, [draftPet]);
  } finally {
    await client.end().catch(() => {});
    await pg.stop().catch(() => {});
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('\nFailed checks:');
    failures.forEach(f => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error('\nHarness error: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
