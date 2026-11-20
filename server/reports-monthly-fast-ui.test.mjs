import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const reports = readFileSync(new URL('../src/reports.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/reports.css', import.meta.url), 'utf8')

test('monthly report month control has a dedicated collision-safe hook', () => {
  assert.match(reports, /className="monthly-report-month-control"/)
  assert.match(css, /grid-template-columns:44px minmax\(220px,250px\) 44px/)
  assert.match(css, /\.monthly-report-month-control input\{[\s\S]*?padding:0 42px 0 12px;[\s\S]*?white-space:nowrap/)
})

test('monthly revenue values remain centered and on one line', () => {
  assert.match(css, /\.monthly-dashboard-grid\.revenue \.monthly-trend-content\{[\s\S]*?grid-template-columns:1fr;[\s\S]*?justify-items:center/)
  assert.match(css, /\.monthly-dashboard-grid\.revenue \.monthly-trend-content>strong\{[\s\S]*?text-align:center;[\s\S]*?white-space:nowrap;[\s\S]*?word-break:normal/)
})
