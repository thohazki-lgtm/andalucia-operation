import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const account = await readFile(new URL('../src/staff-account-management.tsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

test('mobile account filters share a compact aligned row', () => {
  assert.match(css, /\.staff-account-tools-panel \.staff-account-tools\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.45fr\) minmax\(120px, \.8fr\);[\s\S]*?align-items:\s*end;/)
  assert.match(css, /\.staff-account-tools-panel \.staff-account-search\s*\{[\s\S]*?grid-column:\s*auto;/)
  assert.match(css, /\.staff-account-tools-panel \.staff-account-tools :is\(input, select\)\s*\{[\s\S]*?height:\s*40px;/)
})

test('account summary sits directly above the employee search card', () => {
  assert.match(css, /\.staff-account-panel\s*\{[\s\S]*?gap:\s*12px;/)
  assert.match(css, /\.staff-account-header\s*\{[\s\S]*?gap:\s*20px;[\s\S]*?margin:\s*0;/)
})

test('account directory removes record wording and uses emerald fades', () => {
  assert.doesNotMatch(account, /\{visibleAccounts\.length\} records/)
  assert.match(css, /\.staff-account-directory-heading\s*\{[\s\S]*?background:\s*linear-gradient\(90deg, var\(--ao-staff-emerald-deep\) 0%, var\(--ao-staff-emerald\) 58%, #8fc3a8 100%\);/)
  assert.match(css, /\.staff-account-cards > article > header\s*\{[\s\S]*?background:\s*linear-gradient\(90deg, var\(--ao-staff-emerald-deep\) 0%, var\(--ao-staff-emerald\) 58%, #8fc3a8 100%\);/)
})

test('mobile account actions use the requested pill colors', () => {
  assert.match(account, /className="staff-account-manage-action"/)
  assert.match(account, /className="staff-account-create-action"/)
  assert.match(css, /\.staff-account-manage-action\s*\{[\s\S]*?background:\s*#f7e8bd;/)
  assert.match(css, /\.staff-account-create-action\s*\{[\s\S]*?background:\s*#dff3e6;/)
  assert.match(css, /:is\(\.staff-account-manage-action, \.staff-account-create-action\)\s*\{[\s\S]*?border-radius:\s*999px;/)
})

test('account summary numbers retain Good Sans typography', () => {
  assert.match(css, /\.staff-account-summary dd,[\s\S]*?font-family:\s*var\(--ao-font-ui\)/)
  assert.doesNotMatch(css, /\.membership-history dd,\s*\.staff-account-summary dd,\s*\.staff-account-table td/)
})
