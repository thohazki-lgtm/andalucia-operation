import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')
const membership = await readFile(new URL('../src/staff-membership-baseline.tsx', import.meta.url), 'utf8')

test('approved member section omits the duplicated member-count wording', () => {
  assert.doesNotMatch(membership, /<h3>Regular Andalucía Team<\/h3><\/div><span>\{preview\.status\.approvedMemberCount\} members<\/span>/)
  assert.match(membership, /<dt>Approved Members<\/dt><dd>\{preview\.status\.approvedMemberCount\}<\/dd>/)
})

test('approved Team Membership pills use the requested light gold treatment', () => {
  assert.match(membership, /membership-summary-heading[\s\S]*?membership-status approved/)
  assert.match(css, /\.membership-approved-page \.membership-status\.approved\s*\{[\s\S]*?border-color:\s*var\(--ao-staff-gold\);[\s\S]*?background:\s*#f7e8bd;[\s\S]*?color:\s*var\(--ao-staff-emerald-deep\);/)
})

test('mobile approval summary moves its approved pill to the right', () => {
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*?\.membership-summary-heading\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?justify-content:\s*space-between;/)
  assert.match(css, /\.membership-summary-heading \.membership-status\s*\{[\s\S]*?margin-left:\s*auto;/)
})
