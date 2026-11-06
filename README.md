# PawsLink

An adoption bridge for the City Agriculture and Veterinary Department of Butuan City.

One sentence: every pet is registered on this site first, CAVD approves shelter and owner listings, adopters apply against that registry, and CAVD staff, who are also its veterinary clinic, keep the pet details and private medical records.

Single responsive website. Mobile-first for owners and adopters (`/app`), desktop queues and veterinary tools for the office (`/office`). Not a native app.

## How to run locally

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migrations **in order**:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/migrations/0003_storage.sql`
   - `supabase/migrations/0004_service_role_bootstrap.sql`
   - `supabase/migrations/0005_identity_verification.sql`
   - `supabase/migrations/0006_user_profile.sql`
   - `supabase/migrations/0007_pet_health_records.sql`
   - `supabase/migrations/0008_rejected_identity_cleanup.sql`
   - `supabase/migrations/0009_owner_id_immediate_access.sql`
   - `supabase/migrations/0010_cavd_account_auth.sql`
   - `supabase/migrations/0011_adopter_matching.sql`
   - `supabase/migrations/0012_adoption_application_review.sql`
   - `supabase/migrations/0013_match_only_applications.sql`
   - `supabase/migrations/0014_backend_security.sql`
   - `supabase/migrations/0015_identity_status_privacy.sql`
   - `supabase/migrations/0016_demo_cavd_password_only.sql` (temporary demo mode)
   - `supabase/migrations/0017_direct_adoption_requests.sql`
   - `supabase/migrations/0018_strict_adoption_rules.sql`
   - `supabase/migrations/0019_required_adoption_forms.sql`
   - `supabase/migrations/0020_cavd_vet_integration_and_adoption_tags.sql`
   - `supabase/migrations/0019_required_adoption_forms.sql`
3. Copy `.env.example` to `.env.local` and paste **Project Settings → API**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (seed script only — never put `VITE_` on this)
   - Three distinct random `DEMO_*_PASSWORD` values if using the demo seed
4. Install and seed:

```bash
cd partial-PawsLink # or the pawslink app directory in the capstone workspace
npm install
npm run seed
npm run seed:matching
npm run dev
```

Open http://localhost:5173. Pet records can be looked up by their eight-character pet ID/code.

### Demo accounts

Each demo account has a separate password stored as `DEMO_USER_PASSWORD`, `DEMO_ADOPTER_PASSWORD`, or `DEMO_CAVD_PASSWORD` in your private `.env.local` file. Set these before running `npm run seed`; the seed script never prints them.

| Email | Role | Lands on |
|---|---|---|
| `user@demo.local` | user (owner) | `/app` |
| `adopter@demo.local` | user (adopter) | `/app` |
| `cavd@demo.local` | cavd | `/office` |

During the demo, migration 0016 lets `cavd@demo.local` open `/office` after password sign-in without an authenticator code. Set `VITE_CAVD_DEMO_PASSWORD_ONLY=true` in local and GitHub Pages builds. Other CAVD accounts still require MFA. Restore the demo account's authenticator after the demo using [SECURITY.md](SECURITY.md).

If you created the users by hand in Authentication instead of `npm run seed`, run `supabase/seed_roles.sql` in the SQL editor.

### New account setup

In **Supabase → Authentication → Providers → Email**, enable email confirmation. A signup without an active session goes to `/check-email` with the next steps. After confirming the email, new pet owners/adopters go to the existing profile editor at `/app/profile`. They save their profile, upload a government ID, and enter their account immediately after the file is recorded. The welcome step persists in Auth user metadata, so refreshing, opening a direct portal link, or returning on another device resumes setup. Existing accounts are not enrolled retroactively. Veterinary applicants continue directly to PRC ID submission and CAVD review.

IDs go to a private Storage bucket. Owner/adopter submissions activate account access automatically when the uploaded file is present; they do not enter the CAVD review queue. The system checks the chosen ID category, file format, size, and uploaded file presence, but cannot establish document authenticity without a separate verification service or human review. CAVD can see the ID history at `/office/verifications`. On rejection, the app deletes the ID file through the Storage API and clears its path and submitted PRC/clinic details while keeping the decision and reason so the applicant can upload a replacement. If deletion fails, CAVD sees a retry action; opening the review desk also retries cleanup of previously rejected IDs. The welcome flag only controls navigation and never grants access through database policies. Run `npm run test:onboarding` to check the role and onboarding destinations.

The ID upload now runs Tesseract.js OCR in the browser before submission. It checks the account name and recognizable wording for National IDs, driver's licenses, and passports; other government IDs get a readability and name check. JPG/PNG and one- or two-page PDFs are supported. If OCR cannot read a genuine ID, the applicant sees the warning and can confirm submission anyway. The raw OCR text is not stored in Supabase. CAVD can run the same text check on a private PRC document during review and must still compare the card with the [official PRC license register](https://verification.prc.gov.ph/Verification). Tesseract reads text but cannot authenticate a card, verify a live PRC license, or check a National ID's QR signature. For the latter, use the [official PSA National ID Check](https://everify.gov.ph/check). The OCR engine and language data are fetched when first used, so scanning needs an internet connection; submission remains available if OCR cannot load. Run `npm run test:ocr` to check the text matching rules.

Owners can edit their photo, name, birthday, location, phone, and email at `/app/profile`. Profile photos are public; identity documents remain private. Email changes use Supabase confirmation and do not take effect immediately.

The owner/adopter home at `/app` is a digital education and community awareness page, following Chapter II section 2.2.4. It includes three locally stored lesson photos, expandable care guides, WHO/CDC source links, a compact three-question practice quiz with immediate explanations, community actions, and a preview of CAVD-approved pets open for adoption. The quiz is for learning and does not influence adoption decisions. The **Adoption** page at `/app/bridge` offers **Apply for adoption** on available pets, opening the required adoption application form for CAVD assessment without requiring preference matching. Saved pets, applications, and listing requests for the user's own pets remain available. **Find My Pet Match** at `/app/match` saves a 10-question adopter preference profile and ranks open CAVD-approved listings as an optional path. CAVD can configure the 10 compatibility weights; their initial equal values are labeled as prototype settings until CAVD saves a version. The score supports decisions and never approves adoption. CAVD records pet-side traits for scoring and separately verifies strict adoption readiness. All listings and both application paths require the eligibility checks; traits are additionally required for scoring. Owners and adopters use the same `user` account. **My profile** contains the photo, personal details, and login email settings. Community event publishing is not implemented.

For an existing database, apply every remaining numbered migration through **0019**, in order. For example, an installation at 0012 needs 0013–0019; an installation at 0018 needs only 0019. Do not reimport the initial schema into an existing project. Migration 0018 places unreviewed pets on Hold, so read [STRICT_ADOPTION_GUIDE.md](STRICT_ADOPTION_GUIDE.md) before activation.

On a demo project, run `npm run seed:matching` after the remaining migrations. It adds ten labeled sample pets and traits without resetting accounts, overwriting CAVD-reviewed traits or reopening closed listings. New pets have no photos; existing photos are preserved. With strict controls installed, new sample listings stay pending until CAVD verifies eligibility and approves them. To explicitly prepare only these demo pets for full matching and application tests, use `npm run seed:matching -- --ready-for-matching` (add `--dry-run` to inspect targets first). It records labeled synthetic readiness through the demo CAVD account and normal eligibility checks. Find My Match uses Supabase pets only; the local preview has been removed. Recommendations require exact selected type, size, age, temperament and activity, adequate space/time/experience, and applicable child/other-pet compatibility. Mismatches are excluded regardless of weights; other eligible pets can be browsed on Adoption. Do not run the demo seed on a public production project.

For exhaustive matching demos, `npm run seed:matching -- --coverage --ready-for-matching` adds a separate 600-pet set covering every current type/size/age/temperament/activity combination. All are labeled synthetic, have no photos, use minimum test care needs and both household compatibility flags, and still pass the normal eligibility and matching filters. Add `--dry-run` to preview. Details are in `STRICT_ADOPTION_GUIDE.md`.

### Adoption application and CAVD review

Selecting **Apply for adoption** on the home page, adoption list or pet details opens the complete application form. No application is created until the adopter completes the required answers and accuracy declaration and presses **Submit application for CAVD review**. This listed-pet path does not require preferences or matching traits and uses source `explore` without a compatibility score. Applying from Find My Pet Match uses the same form and retains its score snapshot. Both paths validate current adoption eligibility and reject applications for an adopter's own pet. This workflow requires migration **0019** after 0018. The former form-free submission endpoint now refuses requests. Earlier pending requests can gain completed answers without losing their CAVD remarks or history.

Selecting **Apply from this match** on a ranked result still opens the questionnaire about the applicant, household, care capacity, pet experience, and adoption intent. Matching preferences can prefill three relevant answers. Supabase stores those answers and the server-calculated match score. A match score never determines approval.

CAVD opens requests from **Office → Applications**, assesses the submitted form, applicant profile and submitted ID, records applicant-visible remarks, and may request an interview or additional requirements. The adopter sees instructions in **My applications** and can reply. Every final approval requires a completed application form, CAVD validation and the ownership-transfer action; earlier form-free pending requests must be completed first. Earlier decided requests are preserved. The CAVD dashboard also displays all registered pets across all statuses, with search, pagination and links to full records.

Migration 0014 adds the CAVD authenticator step, Storage pet-photo limits, an application quota, and append-only review history. Existing applications retain their decisions; their event timeline starts with changes made after 0014. See [SECURITY.md](SECURITY.md) for setup and recovery steps.
Migration 0015 restricts direct identity-status lookups to the person concerned and authorized CAVD staff.
Migration 0016 temporarily allows only `cavd@demo.local` to work with a password-only session for the office demo. Re-enable the database and frontend MFA checks for that account after the demo.

The public homepage at `/` opens with the “Find the pet that fits your home” introduction and shows the same care guides, safety advice, quiz, and community actions without requiring an account. A cats-and-dogs photo replaces the decorative hero panel. The pet owner and found pet shortcuts appear after the awareness content; eligible approved pet listings are also browsable without signing in at `/explore`.

CAVD staff can open **Accounts → View profile** to see a registered person's contact and account details, their submitted ID, and their currently registered pets. The pet links open each full registry and visit record. ID files stay in private Storage and are opened through short-lived signed links. The account email and confirmation dates come from Supabase Auth through the CAVD-only function in migration **0010**. Existing projects that already ran 0001–0009 should run **0010** in the Supabase SQL editor before using these email details. Rejected ID files that were already deleted cannot be viewed again.

If an existing Supabase project already has migrations 0001–0008, run only **0009** in its SQL editor. If 0008 is still missing, run **0008, then 0009**. Migration 0009 activates earlier pending owner requests when their uploaded ID file exists; a missing upload receives a resubmission notice. It leaves veterinarian requests pending for CAVD. Migration 0007 adds pet weight, structured veterinary visits, a private visit-document bucket, clinic pet-detail edits, correction audits, and adoption transfer records. Migration 0008 enables rejected ID file removal and clears its stored document details. Migration 0018 introduces strict adoption checks: current vaccination with a valid-through date, completed sterilization, cleared behavior, Available status and CAVD verification are required before listing approval, applications and transfer. Detailed visit records remain available as supporting evidence. CAVD validates each adoption request through an owner/caretaker conversation or a CAVD visit, records the outcome, and then approves the transfer. Run `npm run test:rls` locally to verify these access rules.

If profile photo upload reports that photos are unavailable, check that migration **0006** ran successfully: it creates `profiles.avatar_path` and the public `profile-photos` Storage bucket. Run 0005 first if the `verification_requests` table is also missing. Choosing a photo and clicking **Upload photo** gives success or error feedback next to the photo; **Save profile** updates the other details separately.

## Strict adoption controls

Migration **0018** adds CAVD eligibility reviews, automatic Hold for unreviewed pets, configurable versioned compatibility weights, and strict server checks across browsing, listed-pet forms, matched applications and final approval. All existing pets require an explicit eligibility review before appearing for adoption. See [STRICT_ADOPTION_GUIDE.md](STRICT_ADOPTION_GUIDE.md) for the feature comparison, setup and demonstration steps. Hosted migrations are not applied by changing local source files.

## CAVD veterinary work and adoption tags

Migration **0020** retires outside veterinarian accounts: CAVD is the clinic, so staff record visits and edit pet details at **Veterinary** (`/office/veterinary`) and on each pet record. Earlier vet accounts are deactivated and their visits stay on record. Each visit carries an **Adoption clearance** (Cleared, Hold or Pending); changing it on a saved visit needs an audit note.

A pet is only offered for adoption when its latest visit is Cleared. **After applying 0020, existing pets leave the public feed until CAVD records a Cleared visit.** Applications are tagged From Find My Match or From Direct Adoption, pets are tagged Shelter or Private, and Match applications keep a stamped copy of the adopter's 10 Find My Match answers.

## Five-minute panel script

1. Sign in as `user@demo.local` → **Register a pet** → see it pending.
2. Sign in as `cavd@demo.local` → **Registrations** → Verify → the pet's public record and pet ID/code become available.
3. Sign in as `user@demo.local` → open the pet → request a listing. It is still hidden from the public bridge.
4. Sign in as `cavd@demo.local` → open the pet → record a veterinary visit marked Cleared, health flags and **Adoption eligibility** review → **Listings** → Approve only after all conditions pass.
5. Sign in as `adopter@demo.local` → **Adoption** → **Find My Pet Match** → answer the preference questions → apply from a ranked live listing.
6. Sign in as `cavd@demo.local` → **Applications** → review answers, record remarks or request an interview → validate through an owner conversation or CAVD visit → transfer ownership. The listing closes and a permanent adoption record is saved.

## Roles

One account type for owners and adopters (`user`). CAVD accounts are created by a trusted administrator or the local demo seed. Signup on the website cannot self-elevate.

| | user | cavd |
|---|---|---|
| Register a pet (starts pending) | yes | shelter intake |
| Approve registration / listing / adoption | no | yes |
| See owner contact on public pet record / listing | no | office only |
| Record a visit and its adoption clearance | no | yes |
| Edit approved pet details and photo | own pet | yes |
| Edit a saved visit | no | yes, with an audit note |
| Change ownership | no | yes, only via Approve adoption |

Hiding a menu is not security. Postgres Row Level Security and column guards in `0001_schema.sql` / `0002_rls.sql` refuse the write. Prove it with:

```bash
npm run test:rls
```

That spins a throwaway Postgres (no Docker, no hosted project) and checks the permission matrix.

## Pet IDs / codes

Each pet has a unique eight-character `qr_slug` stored in the existing database. The app presents it as the **Pet ID**, and each pet's public record is at `/p/{code}`. The field name remains for database compatibility. Pet camera scanning, printed QR codes, and NFC are not used.

## What was deliberately not built

- Stray / checkpoint scan-logging, GPS trails, maps of scans
- SMS or email vaccination reminders
- Admin publishing for education articles and community events
- Native apps, Play Store, PWA store listing, offline-first
- AI chat, generative descriptions, NLP / cosine matching (structured weighted matching only)
- Payments

## Publish on Firebase Hosting

This is one website with separate role links. Replace `PROJECT_ID` with the Firebase project ID, or use your connected custom domain:

| Audience | Link | Access |
|---|---|---|
| Public adoption board | `https://PROJECT_ID.web.app/` | Anyone |
| Pet owners and adopters | `https://PROJECT_ID.web.app/app` | Signed-in `user` |
| Butuan CAVD office | `https://PROJECT_ID.web.app/office` | CAVD-issued `cavd` |
| Pet public record | `https://PROJECT_ID.web.app/p/{pet-code}` | Anyone, approved pets only |

The two role links use the same deployment and login page. Opening a role link directly sends a signed-out visitor to login, then back to that desk. A signed-in account with the wrong role goes to its own desk. Postgres RLS remains the data access boundary.

1. Create a Supabase project and run all `supabase/migrations` files in numerical order. Keep email confirmation enabled. Create the first real CAVD account in Supabase Auth. Then, in the Supabase SQL editor, issue that account's role (replace the example email):

```sql
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set role = 'cavd'
where id = (select id from auth.users where email = 'office@example.com');
commit;
```

Do not run `npm run seed` on a public production project: it creates demo accounts with privileged roles.
2. Create a Firebase project with Hosting enabled. In `pawslink`, copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from that Supabase project. Keep `SUPABASE_SERVICE_ROLE_KEY` out of the hosting build environment and the browser.
3. Install the Firebase CLI, sign in, build, and deploy from `pawslink`:

```bash
npm ci
npm install -g firebase-tools
firebase login
npm run build
firebase deploy --only hosting --project PROJECT_ID
```

The checked-in `firebase.json` publishes `dist` and sends direct visits to `/app`, `/office`, and `/p/{pet-code}` through the React router.

4. In Supabase **Authentication → URL Configuration**, set **Site URL** to `https://PROJECT_ID.web.app/` (or the custom domain). Add `https://PROJECT_ID.web.app/**` and `http://localhost:5173/**` as allowed redirect URLs. The signup email returns to `/verify` after confirmation. Add any other local port you use, such as `http://localhost:5174/**`.

If a confirmation email opens `http://localhost:3000/`, the email was sent with the wrong callback destination; Vite serves this app on port 5173. In **Authentication → URL Configuration**, set the Site URL to the address people actually use (for local-only testing, `http://localhost:5173/`) and add `http://localhost:5173/verify` to **Redirect URLs**. Keep the deployed `/verify` URL there too when testing both environments. In **Authentication → Email Templates → Confirm signup**, use `{{ .ConfirmationURL }}` for the confirmation link; a hard-coded `localhost:3000` or `{{ .SiteURL }}` can send people to the wrong place. Already-confirmed users can open `http://localhost:5173/login` and sign in normally. Test a newly generated confirmation email after changing these settings; an older email retains the callback it was sent with.

Vite embeds `VITE_` values during `npm run build`, so rebuild and redeploy after changing the Supabase project URL or anon key. Never use the service-role key as a `VITE_` variable.

## GitHub Pages copy

The standalone `partial-PawsLink` repository builds this app for `https://apathy12.github.io/partial-PawsLink/` using `npm run build:pages` and `.github/workflows/pages.yml`. It publishes only the static React app. Supabase remains the backend; never add `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL` to GitHub Actions or the browser build. The workflow needs repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the browser publishable key). `VITE_TURNSTILE_SITE_KEY` is optional when Turnstile is configured.

In Supabase **Authentication → URL Configuration**, add `https://apathy12.github.io/partial-PawsLink/**` to allowed redirect URLs, and use the Pages URL as the Site URL if this becomes the main public site. The generated `404.html` loads direct links to React routes such as `/partial-PawsLink/verify` and `/partial-PawsLink/p/{slug}`. GitHub Pages returns HTTP 404 for those direct URLs while the app renders them; normal in-app navigation stays on the project path.

GitHub Pages does not apply `firebase.json` response headers. The Pages build puts a Content Security Policy and referrer policy in HTML metadata, but response-header-only protections such as `frame-ancestors` and `Permissions-Policy` require a host that supports custom headers.
