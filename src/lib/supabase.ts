import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anon && !url.includes('YOUR_PROJECT'))

export const supabase: SupabaseClient = createClient(url || 'https://example.supabase.co', anon || 'public-anon-key')

export function explain(err: { message?: string; code?: string } | null | undefined, fallback = 'Something went wrong.') {
  if (!err?.message) return fallback
  const m = err.message
  if (/row-level security/i.test(m)) return 'The database refused this. Your role is not allowed to do it.'
  if (/duplicate key/i.test(m)) return 'That record already exists.'
  if (/only cavd/i.test(m)) return m
  if (/append-only/i.test(m)) return m
  if (/correction_note/i.test(m)) return 'A visit correction needs an audit note.'
  if (/Invalid login/i.test(m) || /invalid_credentials/i.test(m)) return 'Email or password is not correct.'
  if (/Email not confirmed/i.test(m)) return 'This email is not confirmed yet.'
  if (/failed to fetch|fetch failed|network request failed|networkerror|load failed/i.test(m)) {
    return 'The account service could not be reached. Check your connection and try again. If it continues, ask CAVD to check the Supabase project.'
  }
  return m
}
