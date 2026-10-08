# PawsLink: frontend, backend, and feature flows

This document describes the current `pawslink` project. The older `PawsLink_App` folder is a separate PHP/MySQL prototype. The current project does **not** run PHP or MySQL.

## What “frontend” and “backend” mean here

**Frontend** means the part people see and use in their browser: pages, buttons, forms, pet cards, match results, QR scanner, and messages. React builds these screens. TypeScript holds the page logic, and CSS controls their appearance. The frontend can check a form and calculate a displayed match ranking, but it cannot grant roles or approve an adoption by itself.

**Backend** means the services that keep records and enforce decisions after a browser sends a request. In this project, **Supabase** provides that backend: email accounts, a PostgreSQL database, file storage, and an API used by the React app. PostgreSQL Row Level Security (RLS), triggers, and database functions check permissions and important business rules even if someone bypasses a button in the browser.

```text
Browser: React pages and forms
        ↓ @supabase/supabase-js
Supabase Auth + PostgreSQL + Storage
        ↓
Saved records, protected files, and CAVD decisions
```

There is no separate Express or Node.js API server. Node.js and npm are used to install dependencies, run Vite, build the site, seed demo data, and run tests. `firebase.json` configures **Firebase Hosting for the built frontend files**; Firebase is not the app's database or authentication system. The hosting configuration does not by itself mean the site has been deployed.

## Technologies in use

| Part | Current technology | What it does |
| --- | --- | --- |
| Pages and components | React 19, TypeScript 6 | Renders the user, veterinarian, CAVD, and public screens |
| Page navigation | React Router 7 | Changes pages such as `/app/match` and `/office/applications` without a full page reload |
| Styling | `src/index.css` and `src/tokens.css` | Responsive layout, colors, components, and light/dark themes; no CSS framework |
| Local development and build | Vite 8, Node.js, npm | Serves the app locally on port 5173 and builds static files into `dist/` |
| Browser-to-backend connection | `@supabase/supabase-js` 2 | Calls Supabase Auth, database tables, Storage, and SQL functions |
| Accounts | Supabase Auth | Email signup, confirmation, login, sessions, and CAVD authenticator MFA |
| Records and rules | Supabase PostgreSQL | Stores pets, profiles, listings, preferences, applications, visits, and adoption history; enforces RLS and SQL rules |
| Uploaded files | Supabase Storage | Holds photos and protected identity/visit documents |
| Hosting setup | Firebase Hosting | Can serve `dist/` with React route rewrites and security response headers |
| Optional bot check | Cloudflare Turnstile + Supabase Auth CAPTCHA | Provides verified signup/login challenges when configured in both the app and Supabase |
| Code checks | TypeScript compiler, Oxlint, embedded PostgreSQL tests | Checks types, lint rules, database migrations, and permissions |

## How the main features work

### 1. Accounts and identity checks

- **Frontend:** A person signs up, confirms their email if confirmation is enabled, fills in a profile, and uploads a government ID. Veterinary applicants submit a PRC ID. The browser uses Tesseract.js to read image text and `pdfjs-dist` to prepare PDF pages for OCR. OCR gives a warning or guidance; it does not prove that an ID is genuine.
- **Backend:** Supabase Auth stores the login. A PostgreSQL profile is linked to that Auth account. The ID file goes into a **private** Supabase Storage bucket, while `verification_requests` stores its status. Owner/adopter access becomes available after their submitted ID is recorded. CAVD reviews PRC submissions before a veterinarian receives the `vet` role. Database rules prevent users from assigning themselves a CAVD or vet role.

### 2. Pet registration and the public QR record

- **Frontend:** An owner registers a pet and can upload its photo. CAVD has a registration queue for reviewing pets; CAVD can also add a shelter pet. The app generates QR images with `qrcode` and scans them with `@zxing/browser`.
- **Backend:** The `pets` table stores the registry entry and a unique QR slug. New owner-submitted pets wait for CAVD approval. Only approved pets appear in the public pet view at `/p/{qr_slug}`. That view shows limited registry and health information, not private owner contact details or visit documents. Pet photos are stored in a public Storage bucket.

### 3. Listings and the Adoption browsing page

- **Frontend:** An owner can request a listing for their registered pet. CAVD reviews listing requests. The **Adoption** page shows available pets and lets users search, filter, open a pet record, or save a pet. Browsing does not offer a direct application button.
- **Backend:** The `listings` table stores pending, approved, rejected, and closed listings. The `public_listings` view exposes only listings approved by CAVD whose pet registration is also approved. RLS controls who can create or decide a listing.

### 4. Find My Pet Match

- **Frontend:** An adopter answers 10 preference questions about animal type, size, age, activity, temperament, space, daily care time, children, other pets, and experience. `src/lib/matching.ts` gives each criterion an equal demo weight of `0.10`, calculates a compatibility score, and ranks open pets with CAVD-reviewed traits. The results show the score and factors to discuss with CAVD.
- **Backend:** `adopter_preferences` stores each user's answers, and `pet_match_traits` stores traits entered by CAVD. RLS lets users edit only their own preferences and lets CAVD edit pet traits. Pets without matching traits remain browsable but do not receive a ranked score. A score helps compare pets; it never approves or rejects an adopter automatically.

### 5. Saved pets

- **Frontend:** The **Save pet** button adds a pet to the user's shortlist. **Saved pets** shows open saved listings and hides listings that have closed.
- **Backend:** `saved_listings` stores a user and listing pair. RLS limits each user to their own saved items. Saving a pet does not submit an adoption application.

### 6. Application after a match

- **Frontend:** The adopter selects **Apply from this match** on a ranked result, then completes a separate questionnaire about contact information, household, care plans, pet experience, and adoption intent. Some answers are prefilled from the profile or matching preferences, but the adopter reviews and submits them. **My applications** shows status and CAVD remarks.
- **Backend:** The `submit_adoption_application` PostgreSQL function checks the completed answers, an open approved listing, the adopter's saved matching preferences, and the pet's CAVD-reviewed traits. It rejects a direct Explore submission, a request for one's own pet, or a duplicate completed application. It recalculates the match score from stored data and saves the application. These rules are in `supabase/migrations/0012_adoption_application_review.sql` and `0013_match_only_applications.sql`.

### 7. CAVD application review and ownership transfer

- **Frontend:** CAVD opens **Applications** to read the questionnaire, add remarks, and move the request through pending review, under review, interview, additional requirements, rejection, or final approval. The adopter can read remarks and send a text response to interview or additional-requirements requests. For approval, CAVD records whether it spoke with an owner/caretaker or made a CAVD visit, when that happened, who was present, and the outcome.
- **Backend:** Database functions restrict review and final approval to CAVD. The approval function transfers the pet to the adopter, closes its listing, saves an immutable adoption record, and rejects other pending requests for that pet. A match score does not make this decision. Earlier applications remain readable, including those made before the matching-only rule.

### 8. Veterinary visits and pet health records

- **Frontend:** Authorized veterinarians can look up or scan a pet record, add visit details, attach a visit document, and update permitted pet details. Owners can view the visit history available to them; CAVD can review and correct records.
- **Backend:** PostgreSQL stores `visits`, permitted changes, and correction audit entries. Visit documents use a **private** Storage bucket. RLS and triggers prevent veterinarians from changing custody, listing approval, or adoption decisions. CAVD controls those decisions.

### 9. CAVD accounts and oversight

- **Frontend:** CAVD has queues for registrations, listings, applications, ID reviews, shelter intake, registry records, and accounts. Staff can inspect an account's pets and submitted ID and can activate or deactivate accounts.
- **Backend:** RLS and CAVD-only functions provide the permitted records. Identity files are opened through short-lived signed Storage links. The `cavd_account_auth` function supplies CAVD-only login details from Supabase Auth.
- **Security:** CAVD actions require an `aal2` Supabase MFA session. Application review and decisions are recorded in immutable `application_events`. PostgreSQL also limits new applications per adopter to 10 in 24 hours.

### 10. Education home and care guidance

- **Frontend:** The home page contains care guides, safety advice, source links, a three-question practice quiz, and a preview of available pets. The quiz checks answers in the browser and shows immediate feedback.
- **Backend:** The pet preview reads approved `public_listings`. The practice quiz does not change an adoption score or application status.

## Where the code lives

| Location | Contents |
| --- | --- |
| `src/App.tsx` | Page routes and role-protected entry points |
| `src/pages/` | React screens for public visitors, users, vets, and CAVD |
| `src/lib/` | Supabase client, authentication, matching, OCR, photos, and shared logic |
| `supabase/migrations/` | PostgreSQL tables, views, RLS policies, triggers, functions, and Storage rules |
| `scripts/` | Demo seed scripts, automated checks, and the complete backup exporter |
| `firebase.json` | Optional static hosting configuration |

## Running and checking the project

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test:rls
npm run test:matching
npm run test:applications
```

The browser reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.local`. The local demo seed scripts use `SUPABASE_SERVICE_ROLE_KEY`; it must never be prefixed with `VITE_` or included in browser code. See `.env.example` and `README.md` for setup details.
