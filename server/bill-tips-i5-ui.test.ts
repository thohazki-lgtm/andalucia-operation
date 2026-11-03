import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const [component, styles, corporateTheme] = await Promise.all([
  readFile(`${root}src/financial-preview.tsx`, 'utf8'),
  readFile(`${root}src/financial-preview.css`, 'utf8'),
  readFile(`${root}src/corporate-theme.css`, 'utf8')
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
assert.match(app, /page === 'Incentives & Bill Tips' \? ' financial-main' : ''/)

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

assert.match(corporateTheme, /\.app-shell:has\(> main\.module-incentives-and-bill-tips\)[\s\S]*?linear-gradient\(to bottom, #103e38 0%, #287a69 34%, #8fc3a8 68%, #d5ebd9 100%\)/)
assert.match(corporateTheme, /main\.module-incentives-and-bill-tips > \.financial-page-header[\s\S]*?background: transparent/)
assert.match(corporateTheme, /main\.module-incentives-and-bill-tips > \.financial-page-header h1[\s\S]*?color: #fff/)
assert.match(corporateTheme, /main\.module-incentives-and-bill-tips \.financial-primary-tabs[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
assert.match(corporateTheme, /\.financial-primary-tabs button[\s\S]*?text-transform: uppercase/)
assert.match(corporateTheme, /\.financial-primary-tabs button\.selected[\s\S]*?background: var\(--ao-staff-emerald-deep\)/)
assert.match(corporateTheme, /\.financial-command\.bill-tip-command,[\s\S]*?\.financial-command\.earnings-command[\s\S]*?background: linear-gradient\(120deg, var\(--ao-staff-emerald-deep\), var\(--ao-staff-emerald\)\)/)
assert.match(corporateTheme, /\.chargeable-summary article,[\s\S]*?\.financial-metrics article[\s\S]*?border: 1px solid var\(--ao-financial-gold\)/)
assert.match(corporateTheme, /\.financial-table-wrap thead th[\s\S]*?background: #dceee5/)
assert.match(corporateTheme, /\.financial-table-wrap tbody tr:nth-child\(even\)[\s\S]*?background: var\(--ao-financial-row-alt\)/)
assert.match(corporateTheme, /@media \(max-width: 700px\)[\s\S]*?\.financial-primary-tabs[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
assert.match(corporateTheme, /\.chargeable-toolbar \{[\s\S]*?border-width: 3px 1px 1px;[\s\S]*?border-color: var\(--ao-financial-gold\)/)
assert.match(corporateTheme, /\.chargeable-summary \{[\s\S]*?max-width: 1080px;/)
assert.match(corporateTheme, /\.chargeable-summary article \{[\s\S]*?height: auto;[\s\S]*?min-height: 68px;[\s\S]*?border-width: 3px 1px 1px;[\s\S]*?border-color: var\(--ao-financial-gold\)/)
assert.match(corporateTheme, /\.chargeable-summary strong \{[\s\S]*?font-size: 20px;/)
assert.match(corporateTheme, /\):not\(\.chargeable-panel\):not\(\.chargeable-summary article\):not\(\.error-state\)/)
assert.match(corporateTheme, /\):not\(\.chargeable-summary article\):not\(\.chargeable-toolbar\):not\(\.chargeable-panel\):not\(\.chargeable-tabs\):not\(\.chargeable-filters\):not\(\.chargeable-table-wrap\):not\(\.mobile-chargeable-card\)/)
assert.match(corporateTheme, /\.panel\.chargeable-panel \{[\s\S]*?border-width: 2px 1px 1px;[\s\S]*?background: linear-gradient\(180deg, #fffaf0 0%, #eef7ef 100%\)/)
assert.match(corporateTheme, /\.chargeable-card-grid \{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(300px, 380px\)\)/)
assert.match(corporateTheme, /\.chargeable-table-wrap:has\(> \.inline-empty\) \.chargeable-card-grid \{[\s\S]*?display: none !important/)
assert.match(corporateTheme, /\.mobile-operation-card\.mobile-chargeable-card \{[\s\S]*?border-width: 3px 1px 1px;[\s\S]*?border-color: var\(--ao-financial-gold\)/)

console.log('Bill Tips I5 UI assertions passed.')
