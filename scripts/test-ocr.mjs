import assert from 'node:assert/strict'
import { assessIdentityOcr } from '../src/lib/identity-ocr.ts'

const national = assessIdentityOcr({
  text: 'REPUBLIKA NG PILIPINAS PHILIPPINE IDENTIFICATION ANA M REYES',
  confidence: 88, pages: 1
}, { name: 'Ana M. Reyes', idType: 'national_id' })
assert.equal(national.warnings.length, 0, 'clear national ID text should have no warning')
assert.deepEqual(national.checks.map(check => check.found), [true, true])

const unreadable = assessIdentityOcr({ text: 'blur', confidence: 12, pages: 1 }, {
  name: 'Ana Reyes', idType: 'national_id'
})
assert.ok(unreadable.warnings.some(warning => warning.includes('hard to read')))
assert.equal(unreadable.checks[0].found, false)

const otherId = assessIdentityOcr({ text: 'GOVERNMENT CARD ANA REYES', confidence: 82, pages: 1 }, {
  name: 'Ana Reyes', idType: 'other_government_id'
})
assert.deepEqual(otherId.checks.map(check => check.found), [true], 'other ID types have no unsupported template test')

console.log('PASS OCR text assessment: national ID, unreadable, other ID')
