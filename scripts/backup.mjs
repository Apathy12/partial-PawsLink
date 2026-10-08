// Run with `npm run backup` after setting PAWSLINK_BACKUP_DIR to an encrypted,
// access-controlled destination. Requires a PostgreSQL client with pg_dump.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'

process.umask(0o077)

const dbUrl = process.env.SUPABASE_DB_URL
const apiUrl = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const outputBase = process.env.PAWSLINK_BACKUP_DIR
if (!dbUrl || !apiUrl || !serviceKey || !outputBase || !isAbsolute(outputBase)) {
  throw new Error('Set SUPABASE_DB_URL, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and an absolute PAWSLINK_BACKUP_DIR.')
}

const destination = join(resolve(outputBase), `pawslink-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
const buckets = ['identity-documents', 'visit-documents', 'pet-photos', 'profile-photos']
const client = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

function dumpDatabase(path) {
  const parsed = new URL(dbUrl)
  const environment = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: 'verify-full'
  }
  // Credentials are passed through the child environment, never command args.
  return new Promise((done, fail) => {
    const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', path], {
      env: environment, stdio: ['ignore', 'ignore', 'pipe']
    })
    let detail = ''
    child.stderr.on('data', chunk => { detail += String(chunk).slice(0, 2000) })
    child.on('error', error => fail(new Error(`pg_dump could not start: ${error.code || error.message}`)))
    child.on('close', code => code === 0 ? done() : fail(new Error(`pg_dump failed (${code}): ${detail}`)))
  })
}

function safePath(bucket, objectName) {
  const base = join(destination, 'storage', bucket)
  const target = resolve(base, objectName)
  const inside = relative(base, target)
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('Storage returned an unsafe object path')
  }
  return target
}

async function backUpBucket(bucket) {
  const storage = client.storage.from(bucket)
  let count = 0
  async function visit(prefix = '') {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage.list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`Cannot list ${bucket}: ${error.message}`)
      for (const item of data || []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name
        if (!item.id) { await visit(path); continue }
        const { data: file, error: downloadError } = await storage.download(path)
        if (downloadError || !file) throw new Error(`Cannot download ${bucket}/${path}: ${downloadError?.message || 'empty response'}`)
        const target = safePath(bucket, path)
        await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 })
        await writeFile(target, Buffer.from(await file.arrayBuffer()), { mode: 0o600 })
        count++
      }
      if (!data || data.length < 100) break
    }
  }
  await visit()
  return count
}

await mkdir(destination, { recursive: true, mode: 0o700 })
try {
  await dumpDatabase(join(destination, 'database.dump'))
  const counts = {}
  for (const bucket of buckets) counts[bucket] = await backUpBucket(bucket)
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({
    created_at: new Date().toISOString(), buckets: counts, database: 'database.dump'
  }, null, 2), { mode: 0o600 })
  console.log(`Backup complete: ${destination}`)
  console.log(`Storage objects: ${Object.values(counts).reduce((total, count) => total + count, 0)}`)
} catch (error) {
  await rm(destination, { recursive: true, force: true })
  throw error
}
