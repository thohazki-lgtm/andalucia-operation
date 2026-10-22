import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

const mobileRoster = app.match(/<div className="mobile-roster"[\s\S]*?<\/section>\}/)?.[0] || ''
assert.ok(mobileRoster, 'Mobile Duty Roster must remain available.')
assert.doesNotMatch(mobileRoster, /mobile-duty-name|duty-description|Assigned duty/, 'Standalone duplicate duty labels must be removed from mobile cards.')
assert.match(mobileRoster, /<select className=\{option \? 'mobile-duty-select duty-pill-select' : 'mobile-duty-select duty-pill-select no-assignment'\}/, 'The colored premium duty dropdown must sit directly in each mobile card.')
assert.match(mobileRoster, /\{dutyDisplayCode\(item\)\} · \{item\.label\}<\/option>/, 'Each dropdown option must display its configured code and name.')
assert.match(mobileRoster, /style=\{\{backgroundColor:option\?\.color,color:option \? readableDutyText\(option\.color\) : undefined\}\}/, 'Configured Duty Code colors must remain applied.')
assert.match(mobileRoster, /onChange=\{event => updateDraft\(person\.id, mobileDate, event\.target\.value\)\}/, 'Mobile assignment changes must remain wired to the local batch draft.')
assert.match(mobileRoster, /<b>\{person\.name\}<\/b>[\s\S]*?\{person\.number\} · \{designationLabel\(person\.position, positions\)\}/, 'Employee name, ID, and the authoritative configured designation must remain at the top.')
assert.doesNotMatch(mobileRoster, /\{person\.number\} · \{person\.position\}/, 'Mobile roster must not expose a stale stored designation key.')

assert.match(styles, /@media\(max-width:700px\)\{\.mobile-roster-card>\.mobile-duty-select\{[^}]*width:100%;min-width:0;max-width:100%/, 'The dropdown must use the available card width without horizontal overflow.')
assert.match(styles, /overflow:hidden;text-overflow:ellipsis;white-space:nowrap/, 'Long selected duty names must remain contained and readable.')
assert.match(styles, /@media\(max-width:390px\)\{\.mobile-roster-card\{padding:12px\}\.mobile-roster-card>\.mobile-duty-select\{min-height:40px;margin-top:9px;font-size:11px\}\}/, 'Cards must remain compact at 390px and smaller.')
assert.match(styles, /\.roster-scroll\{display:none\}\.mobile-roster\{display:block\}/, 'Desktop and mobile roster layouts must remain independently scoped.')

console.log(JSON.stringify({ duplicateLabelsRemoved: true, configuredCodeAndName: true, colorsPreserved: true, dropdownFunctional: true, employeeIdentityPreserved: true, compactAt390: true, noHorizontalOverflow: true, desktopLayoutPreserved: true }, null, 2))
