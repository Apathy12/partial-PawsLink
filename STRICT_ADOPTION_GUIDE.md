# Strict adoption: what changed

The project continues to use React, TypeScript, Vite and Supabase/PostgreSQL. No PHP, MySQL, XAMPP, or extra application stack is introduced.

Source changes remain local. Migration `0018_strict_adoption_rules.sql` was verified against a temporary local PostgreSQL database and is now present in the configured Supabase database. For a new environment, apply numbered migrations in order through 0020 before using the current workflow. Migration 0019 adds the required application form for listed-pet applications and was activated in the configured Supabase database on 2026-10-20 using the supplied Session pooler and verified TLS certificate. Hosted rollback checks confirmed completed form submission, CAVD answer access, duplicate protection, and refusal of empty or form-free requests; no test application was retained.

## Before and after

| Area | Before | Strict workflow |
|---|---|---|
| Adoption readiness | Approved registration and listing | Those approvals plus Available status, current vaccination, completed sterilization, cleared behavior, a Cleared latest veterinary visit and recorded CAVD review |
| Previously registered pets | Could appear once their listing was approved | Start on Hold until CAVD explicitly reviews eligibility; old decisions and ownership records stay intact |
| Match weights | Ten fixed equal weights | CAVD can set ten weights totaling 1.00; each save is versioned |
| Match explanation | Overall score and considerations | Overall score plus each criterion’s fit and configured weight |
| Public browsing | Adoption list required a user login | `/explore` lets visitors browse eligible pets; applying still requires a verified active user account |
| Results | Save or view a pet | Skip a pet in the current results and restore skipped pets |
| Availability | Listing and registration states | Separate Available, Hold and Adopted states; completed transfers automatically record Adopted |
| CAVD overview | Review queues and all registered pets | Adds eligible-pet, on-hold and owner/adopter account totals, plus a dedicated rules and exclusion report |
| Historical scores | Equal-weight score | New matching applications capture score, weights and weight version; subsequent edits do not rewrite them |

## CAVD demonstration sequence

1. Open **CAVD → Adoption rules**. Inspect required conditions and the excluded pets list.
2. Open a pet using **Review pet**. Add a veterinary visit and set **Adoption clearance** to Cleared; Hold, Pending or no visit keeps the pet excluded. In **Public health flags**, record the reviewed rabies vaccination/date and completed sterilization first. Changing those flags invalidates a previous eligibility review.
3. In **Adoption eligibility**, choose Available or Hold, record vaccination status and the valid-through date from its reviewed record, record behavioral clearance, and enter notes. Confirm the review and save. The preview shows remaining exclusion reasons; incomplete conditions can be saved but keep the pet excluded.
4. Add matching traits if this pet should receive recommendation scores. Traits are not required to complete an application form from a listed pet.
5. Approve its pending listing in **Listings**. Approve is unavailable until all eligibility conditions pass.
6. Open **Adoption rules → Compatibility weights**. Adjust values to total 1.00, then confirm and save. Initial equal values are labeled as default equal weights until CAVD saves a version.
7. Open `/explore` without signing in. Only eligible, approved listings appear.
8. Sign in as an adopter. Use **Apply for adoption** on a home/listing card to open the required application form, or choose a pet from **Find My Pet Match** and complete that same form. Opening the form submits nothing; CAVD receives the answers only after the adopter submits them. Try **Why this score?**, **Skip this pet**, and **Restore skipped pets**.
9. CAVD reviews the application and completes its existing validation and ownership transfer. The pet becomes Adopted, its listing closes, and it disappears from public adoption browsing.

Migration 0020 removes every pet without a Cleared latest visit from the public feed until CAVD records one. Hold and vaccination expiry immediately remove a pet from the public pool and block listed-pet form applications, matching applications and final approval at the database level. Existing pending applications remain available for CAVD review; they are not silently deleted or rejected.

## Safe demo data

Find My Match now uses Supabase listings and traits only. The local sample preview has been removed.

Recommendations must satisfy all chosen preferences: exact animal type, size, age group, temperament and activity level (categorical fields with No preference are unrestricted). Available space, time and experience must meet or exceed the pet’s needs. Pets incompatible with children or other pets are excluded when those household conditions apply. Weights cannot override these filters. With the current score formula, pets passing every requirement score 100%; this is recorded-trait compatibility, not a guarantee or an adoption approval. Other eligible pets remain available through the separate Adoption page.

For a demo, choose Dog / Medium / 1–3 years / Calm / Moderate activity, with at least average living space, moderate care time and some experience: Luna and the corresponding coverage pet match. Change the selected type, size, age, temperament or activity to see the matching coverage pet change.

`npm run seed:matching` creates missing labeled demo pets, their traits, and pending listings. It leaves eligibility review to CAVD. Newly created pets have no photos; existing pet photos are preserved.

To explicitly prepare the ten named synthetic demo pets for full matching and application tests, run `npm run seed:matching -- --ready-for-matching --dry-run` to inspect the targets, then `npm run seed:matching -- --ready-for-matching`. This uses the demo CAVD account and the normal eligibility RPC to record Available, current vaccination with an expiry, cleared behavior, a Cleared demo visit, and a labeled synthetic review. It approves demo listings after the checks pass, preserves existing matching traits, and never reopens owned, adopted, closed or rejected pets. These sample health and behavior records are for testing only. No image generation is used.

The seed reads credentials from `.env.local` and does not print them. Ordinary pet eligibility rules remain in force.

### Complete form coverage

`npm run seed:matching -- --coverage --ready-for-matching --dry-run` previews a separate set of 600 synthetic pets. Remove `--dry-run` to create them in Supabase. The eight-character PET IDs `dmx00001` through `dmx00600` identify this set. Each pet is labeled as a demo, has no photo, and has one unique combination of dog/cat, small/medium/large, four age groups, five temperaments and five activity levels.

These fixtures deliberately use minimum demo space/time/experience needs of 1/5 and both household compatibility flags true. This guarantees at least one result for every valid current form combination while the full fixture set remains available. They are synthetic test values, not realistic care recommendations or clinical assessments; the pet description and CAVD review notes identify them as tests. No matching rule is loosened and no pet changes its traits based on adopter input. Original demo pets retain their varied care needs. The test suite checks all 600 exact combinations against the actual matching filter, using minimum adopter capacities and both household requirements.

## Verification

- `npm run test:matching`: scoring and configurable-weight validation.
- `npm run test:eligibility`: missing, expired, future-dated and incomplete readiness conditions.
- `npm run test:rls`: permissions, exclusions, public visibility, both form submission paths, transfer checks and score snapshots using a temporary local database.
- `npm run build`: TypeScript and production bundle.
- Laptop and phone browser checks use isolated fixtures with hosted requests intercepted. They check layout, invalid weight totals, eligibility confirmation and Skip/Restore interactions; they do not claim a live hosted migration has been applied.

## Required application forms (0019)

The form collects applicant/contact information, living situation, household consent, pet-care and financial plans, experience and adoption intent. Listed-pet applications do not require saved matching preferences or pet matching traits. Matched applications retain their saved preferences/traits and score snapshot requirements. Both require the complete form and accuracy declaration, plus all existing account and pet eligibility checks.

CAVD reads the submitted answers in the application detail page. Approval is blocked without a completed form, including for earlier pending direct requests. Adopters can open **Complete application** to fill those earlier requests; remarks and review history remain intact. Existing final decisions are not changed. No new form-free requests are accepted through the old direct RPC.

Migration `supabase/migrations/0019_required_adoption_forms.sql` is active in the configured Supabase database. For another environment, apply it after 0018 in the Supabase SQL editor or via a reachable database connection. Local source changes alone do not update a hosted database.
