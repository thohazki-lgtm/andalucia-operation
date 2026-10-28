import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const [component, styles] = await Promise.all([
  readFile(`${root}src/financial-preview.tsx`, 'utf8'),
  readFile(`${root}src/financial-preview.css`, 'utf8')
])
const app = await readFile(`${root}src/App.tsx`, 'utf8')

assert.match(component, /className="external-allocation-actions"/)
assert.match(component, /className="financial-metrics bill-tip-metrics"/)
assert.match(component, /tone="financial"/)
assert.match(component, /className="bill-tip-staff-cards"/)
assert.match(component, /Future \/ Unclosed/)
assert.match(component, /AL Excluded/)
assert.match(component, /className="panel bill-tip-finalization-card"/)
assert.match(component, /Manager action: open Duty Roster → Duty Code Settings/)
assert.match(app, /<main className=\{page === 'Incentives & Bill Tips' \? 'financial-main' : undefined\}>/)

assert.match(styles, /\.bill-tip-command \.financial-command-controls\{display:grid;grid-template-columns:168px minmax\(180px,1fr\) auto/)
assert.match(styles, /\.external-allocation-actions\{display:flex/)
assert.match(styles, /\.bill-tip-metrics article\{display:flex;min-height:94px/)
assert.match(styles, /@media\(min-width:901px\)\{\.bill-tip-metrics\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/)
assert.match(styles, /\.bill-tip-team-table\{display:none\}/)
assert.match(styles, /\.bill-tip-staff-cards\{display:grid/)
assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
assert.match(styles, /\.financial-primary-tabs\{display:grid;width:100%;min-width:0;max-width:none;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
assert.match(styles, /\.financial-primary-tabs button\{width:100%;max-width:none;min-width:0/)
assert.match(styles, /\.financial-main\{align-self:start;margin:0 auto\}/)
assert.match(styles, /\.staff-incentive-table :is\(th,td\):not\(:first-child\),\.earnings-summary-table :is\(th,td\):not\(:first-child\)\{text-align:center\}/)

console.log('Bill Tips I5 UI assertions passed.')
