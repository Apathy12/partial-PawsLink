import assert from 'node:assert/strict'
import { assessIdentityOcr } from '../src/lib/identity-ocr.ts'

const national = assessIdentityOcr({
  text: 'REPUBLIKA NG PILIPINAS PHILIPPINE IDENTIFICATION ANA M REYES',
  confidence: 88, pages: 1
}, { name: 'Ana M. Reyes', idType: 'national_id' })
assert.equal(national.warnings.length, 0, 'clear national ID text should have no warning')
assert.deepEqual(national.checks.map(check => check.found), [true, true])

const prc = assessIdentityOcr({
  text: 'PROFESSIONAL REGULATION COMMISSION VETERINARIAN VERGARA ROLLY license no 123-4567',
  confidence: 81, pages: 1
}, { name: 'Rolly Vergara', idType: 'prc_id', prcNumber: '1234567' })
assert.equal(prc.warnings.length, 0, 'matching PRC card text should have no warning')
assert.deepEqual(prc.checks.map(check => check.found), [true, true, true, true])

const wrongProfession = assessIdentityOcr({
  text: 'PROFESSIONAL REGULATION COMMISSION DENTIST VERGARA ROLLY license no 123-4567',
  confidence: 81, pages: 1
}, { name: 'Rolly Vergara', idType: 'prc_id', prcNumber: '9999999' })
assert.equal(wrongProfession.checks[2].found, false)
assert.equal(wrongProfession.checks[3].found, false)
assert.ok(wrongProfession.warnings.some(warning => warning.includes('veterinarian')))
assert.ok(wrongProfession.warnings.some(warning => warning.includes('PRC number')))

const unreadable = assessIdentityOcr({ text: 'blur', confidence: 12, pages: 1 }, {
  name: 'Ana Reyes', idType: 'national_id'
})
assert.ok(unreadable.warnings.some(warning => warning.includes('hard to read')))
assert.equal(unreadable.checks[0].found, false)

const otherId = assessIdentityOcr({ text: 'GOVERNMENT CARD ANA REYES', confidence: 82, pages: 1 }, {
  name: 'Ana Reyes', idType: 'other_government_id'
})
assert.deepEqual(otherId.checks.map(check => check.found), [true], 'other ID types have no unsupported template test')

console.log('PASS OCR text assessment: national ID, PRC vet, mismatch, unreadable, other ID')
