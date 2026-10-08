import { readFile, writeFile } from 'node:fs/promises'

// GitHub Pages serves this file for direct visits to React Router paths.
// Vite has already written asset URLs with the /partial-PawsLink/ base.
// Pages cannot set Firebase's response headers, so apply supported browser
// protections through HTML metadata in this Pages-specific build.
const csp = "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; upgrade-insecure-requests"
const html = (await readFile('dist/index.html', 'utf8')).replace('<head>',
  `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`)
await writeFile('dist/index.html', html)
await writeFile('dist/404.html', html)
await writeFile('dist/.nojekyll', '')
