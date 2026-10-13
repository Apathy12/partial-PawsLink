# PawsLink backend security

PawsLink uses Supabase Auth, PostgreSQL RLS, SQL functions, and Storage as its backend. Firebase Hosting serves the React files. The browser's publishable/anon key identifies the app; database policies and each user's JWT decide what the user can do. Never put the service-role key or database URL in a `VITE_` variable, a committed file, or Firebase Hosting configuration. Keep `.env.local` restricted to your development machine.

## Applied in the project

- Migration `0014_backend_security.sql` introduced an `aal2` Supabase MFA requirement for all CAVD operations through `public.is_cavd()`. Migration `0016_demo_cavd_password_only.sql` temporarily exempts only `cavd@demo.local` for the office demo. Other CAVD accounts still need an authenticator code.
- The `pet-photos` Storage bucket now enforces the same 8 MB and JPG/PNG/WebP limits as the uploader. Identity and visit documents already use private buckets and restricted file types.
- At most 10 applications per adopter can be created in 24 hours. The check runs in a database trigger and serializes concurrent submissions from the same account. Supabase Auth's separate login rate limits still apply.
- New application submissions, CAVD review changes, and final decisions produce immutable `application_events`. CAVD and the applicant can read their relevant history. Earlier events were not invented for older applications.
- Existing application `SECURITY DEFINER` functions are pinned to an empty search path. Public listing views still intentionally show only approved pets/listings and selected columns. `listing_notes` and `about` are public once CAVD approves a listing; the owner forms now warn against entering contact or address details.
- Migration `0015_identity_status_privacy.sql` prevents an ordinary signed-in user from probing another person's identity approval status through the helper RPC.
- Firebase Hosting adds a Content Security Policy and other response headers. The theme script was moved out of inline HTML so a stricter script policy can work. The policy allows the external OCR assets, Supabase, Google Fonts, and optional Turnstile challenge used by the current app.
- `npm run backup` can export the PostgreSQL database and all four Storage buckets to an access-controlled destination. `.env` files and local backup folders are ignored by Git.

## Supabase dashboard setup

1. After the demo, run `supabase/maintenance/restore_cavd_mfa.sql` in the Supabase SQL editor, set `VITE_CAVD_DEMO_PASSWORD_ONLY=false` for the local build and GitHub Pages workflow, and redeploy. In **Authentication → Multi-Factor Authentication**, keep TOTP enrollment and verification enabled. Each CAVD staff member then signs in, opens `/office/mfa`, scans the QR code with an authenticator app, and confirms a code. Keep an administrator recovery procedure for a lost authenticator.
2. In **Authentication → Rate Limits**, review the signup, sign-in, recovery, OTP, and verification settings for your expected traffic. Supabase supplies the Auth endpoint limits; the application quota is separate.
3. For bot protection, create a **Cloudflare Turnstile** widget covering the deployed site and localhost. Put its *site key* in `VITE_TURNSTILE_SITE_KEY` and rebuild the app. Put its *secret key* only in Supabase **Authentication → Bot and Abuse Protection**, then enable CAPTCHA. Supabase validates tokens; the browser widget alone is not protection. Enable the dashboard switch only when the rebuilt login and registration pages are deployed, or users will be unable to sign in.
4. In **Database → Security Advisor**, review findings after every migration and at least weekly. Public `public_pets` and `public_listings` views intentionally expose approved fields to anonymous users; inspect their columns and filters before dismissing a view warning. Investigate any new exposed function, missing RLS policy, or unexpected grant. Run `npm run test:rls` after changing SQL.

## Backups and recovery

Supabase database backups do not contain Storage file bytes. Both the database and files are needed to restore IDs, visit documents, and pet photos. On a paid Supabase plan, check **Database → Backups** and consider Point-in-Time Recovery if the registry needs a shorter recovery window. On a free plan, schedule a separate database export.

For a complete manual export, install a `pg_dump` version compatible with your Supabase PostgreSQL server. Set `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and an absolute `PAWSLINK_BACKUP_DIR` pointing to an encrypted, restricted destination in `.env.local`, then run:

```bash
npm run backup
```

The script writes a custom-format `database.dump`, the four Storage buckets, and `manifest.json`. It removes an incomplete export on failure. It does not schedule itself or encrypt a plain destination. Schedule it outside the repository, keep off-site copies, and test restoring into a **separate** Supabase project. Use `pg_restore` for the database and the Storage API for file bytes; do not restore directly into the live project as a test.

## Deploying and checking

Run `npm run build`, `npm run test:rls`, and `npm run lint` before deploying. Firebase Hosting headers take effect only after `firebase deploy --only hosting --project PROJECT_ID`. Check the deployed site's network responses for the CSP and confirm login, ID OCR, pet photos, and QR scanning work there. Local Vite development does not apply Firebase Hosting headers.
