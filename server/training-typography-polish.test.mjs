import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(css, /main\.module-training > \.page-header h1\s*\{[\s\S]*?font-size:\s*25px;/, 'Training title must use the compact desktop scale')
assert.match(css, /\.training-r2-month > span\s*\{[\s\S]*?clamp\(19px, 1\.8vw, 23px\)/, 'Training month must use the compact display scale')
assert.match(css, /\.training-r2-kpis span\s*\{[\s\S]*?font-size:\s*8\.5px;/, 'Training KPI labels must be compact')
assert.match(css, /\.training-r2-kpis strong\s*\{[\s\S]*?clamp\(15px, 1\.25vw, 17px\)/, 'Training KPI figures must use the compact Good Sans scale')
assert.match(css, /\.training-next h2\s*\{[\s\S]*?font-size:\s*15px;/, 'Next Training title must be compact')
assert.match(css, /\.training-r2-view-heading h2\s*\{[\s\S]*?font:\s*500 16px/, 'Calendar heading must be compact')
assert.match(css, /\.training-r2-list > header h2\s*\{[\s\S]*?font-size:\s*16px;/, 'Training List heading must be compact')
assert.match(css, /\.training-r2-table td\s*\{[\s\S]*?font-size:\s*10px;/, 'Training table values must be compact')
assert.match(css, /@media \(max-width: 430px\)[\s\S]*?main\.module-training > \.page-header h1\s*\{[\s\S]*?font-size:\s*23px;/, 'Training title must retain a compact mobile scale')
assert.match(css, /Training summary labels[\s\S]*?main\.module-training \.training-r2-kpis span \{[\s\S]*?font-size: 11px;/, 'Training KPI card wording must use the clearer approved scale')

console.log(JSON.stringify({ trainingTypography: 'compact', desktop: true, mobile: true }, null, 2))
