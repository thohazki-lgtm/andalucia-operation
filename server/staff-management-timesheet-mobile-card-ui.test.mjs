import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')
const timesheets = await readFile(new URL('../src/manager-timesheets.tsx', import.meta.url), 'utf8')

test('mobile Timesheet cards share the Staff Management name-header fade', () => {
  assert.match(timesheets, /<article className="manager-timesheet-card"><header><div><b>\{item\.staff\.name\}<\/b>/)
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.manager-timesheet-card > header\s*\{[\s\S]*?padding:\s*11px 12px;/)
  assert.match(css, /\.manager-timesheet-card > header\s*\{[\s\S]*?background:\s*linear-gradient\(90deg, var\(--ao-staff-emerald-deep\) 0%, var\(--ao-staff-emerald\) 58%, #8fc3a8 100%\);/)
  assert.match(css, /\.manager-timesheet-card > header :is\(b, small\)\s*\{[\s\S]*?color:\s*#fff;/)
})

test('mobile Timesheet status pills use the requested light gold treatment', () => {
  assert.match(css, /\.manager-timesheet-card > header \.manager-month-status\s*\{[\s\S]*?border-color:\s*var\(--ao-staff-gold\);[\s\S]*?background:\s*#f7e8bd;[\s\S]*?color:\s*var\(--ao-staff-emerald-deep\);/)
  assert.match(css, /\.manager-timesheet-card > dl\s*\{[\s\S]*?padding:\s*9px 12px 7px;/)
  assert.match(css, /\.manager-timesheet-card > \.ao-action\s*\{[\s\S]*?width:\s*calc\(100% - 24px\);/)
})
