/**
 * Creates the four demo accounts and assigns their roles.
 *
 *   npm run seed
 *
 * Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the four
 * DEMO_*_PASSWORD values from .env.local.
 * Safe to re-run: existing emails are reused, roles are reset.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACCOUNTS = [
  { email: 'user@demo.local', passwordEnv: 'DEMO_USER_PASSWORD', name: 'Ana Reyes', role: 'user', contact: '0917 555 0101', clinic: null },
  { email: 'adopter@demo.local', passwordEnv: 'DEMO_ADOPTER_PASSWORD', name: 'Ben Santos', role: 'user', contact: '0918 555 0102', clinic: null },
  { email: 'vet@demo.local', passwordEnv: 'DEMO_VET_PASSWORD', name: 'Dr. Liza Ramos', role: 'vet', contact: '085 555 0200', clinic: 'Butuan Pet Clinic' },
  { email: 'cavd@demo.local', passwordEnv: 'DEMO_CAVD_PASSWORD', name: 'CAVD Registry Desk', role: 'cavd', contact: '(085) 342-1111', clinic: 'CAVD Animal Health Unit' }
]

if (!url || !service) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
for (const account of ACCOUNTS) {
  if (!process.env[account.passwordEnv]) {
    console.error(`Missing ${account.passwordEnv} in .env.local`)
    process.exit(1)
  }
}

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 })
if (listErr) {
  console.error('Could not list users:', listErr.message)
  process.exit(1)
}

for (const a of ACCOUNTS) {
  let user = existing.users.find(u => u.email === a.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: a.email,
      password: process.env[a.passwordEnv],
      email_confirm: true,
      user_metadata: { name: a.name, contact: a.contact }
    })
    if (error) {
      console.error('Failed to create', a.email, error.message)
      process.exit(1)
    }
    user = data.user
    console.log('created', a.email)
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: process.env[a.passwordEnv],
      email_confirm: true,
      user_metadata: { name: a.name, contact: a.contact }
    })
    if (error) {
      console.error('Failed to update auth user', a.email, error.message)
      process.exit(1)
    }
    console.log('already existed, password reset', a.email)
  }

  const { error: upErr } = await admin.from('profiles').update({
    role: a.role,
    name: a.name,
    contact: a.contact,
    clinic_name: a.clinic,
    is_active: true,
    verification_exempt: true
  }).eq('id', user.id)

  if (upErr) {
    console.error('Failed to set role for', a.email, upErr.message)
    process.exit(1)
  }
}

console.log('\nDemo accounts:')
for (const a of ACCOUNTS) console.log('  ' + a.email.padEnd(22) + a.role)
