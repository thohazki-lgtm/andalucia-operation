import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [reports, theme] = await Promise.all([
  readFile(new URL('../src/reports.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8'),
])

assert.match(reports, /function ReportDatePicker/)
assert.match(reports, /className="report-date-picker"/)
assert.match(reports, /id="weekly-service-performance"/)
assert.match(reports, /id="weekly-service-charges-card"/)
assert.match(reports, /id="weekly-completeness-card"/)
assert.doesNotMatch(reports, /DateControl label="Select custom report start date"/)

assert.match(theme, /Weekly Reports: pale purple highlights and Good Sans numeric values/)
assert.match(theme, /#weekly-performance \.weekly-kpis \.report-stat:nth-child\(odd\)/)
assert.match(theme, /#weekly-performance[\s\S]*transform: translate\(-50%, -50%\)/)
assert.match(theme, /Custom Reports: module-coloured date picker and consistently centred figures/)
assert.match(theme, /\.report-date-popover/)
assert.match(theme, /Reports tables: clip every header and body fill to the table shell radius/)
assert.match(theme, /clip-path: inset\(0 round 12px\)/)

console.log('Latest Reports UI restoration checks passed.')
