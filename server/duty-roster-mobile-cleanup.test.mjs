import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const dutyRosterStyles = await readFile(new URL('../src/duty-roster.css', import.meta.url), 'utf8')

const mobileRoster = app.match(/<div className="mobile-roster"[\s\S]*?<\/section>\}/)?.[0] || ''
assert.ok(mobileRoster, 'Mobile Duty Roster must remain available.')
assert.doesNotMatch(mobileRoster, /mobile-duty-name|duty-description|Assigned duty/, 'Standalone duplicate duty labels must be removed from mobile cards.')
assert.match(mobileRoster, /<DutyCodeSelect value=\{code\} options=\{available\}[^>]*mobile/, 'The shared colored duty dropdown must sit directly in each mobile card.')
assert.match(app, /className="duty-code-option-copy"><b>\{item\.label\}<\/b>/, 'Each dropdown option must display its configured name.')
assert.match(app, /className="duty-code-option-pill" style=\{\{ backgroundColor: item\.color/, 'Configured Duty Code colors must remain applied.')
assert.match(mobileRoster, /onChange=\{dutyCode => updateDraft\(person\.id, mobileDate, dutyCode\)\}/, 'Mobile assignment changes must remain wired to the local batch draft.')
assert.match(mobileRoster, /<b>\{person\.name\}<\/b>[\s\S]*?\{person\.number\} · \{designationLabel\(person\.position, positions\)\}/, 'Employee name, ID, and the authoritative configured designation must remain at the top.')
assert.doesNotMatch(mobileRoster, /\{person\.number\} · \{person\.position\}/, 'Mobile roster must not expose a stale stored designation key.')

assert.match(dutyRosterStyles, /\.mobile-roster-card > \.mobile-duty-select \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/, 'The dropdown must use the available card width without horizontal overflow.')
assert.match(dutyRosterStyles, /\.duty-code-trigger > span \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/, 'Long selected duty names must remain contained and readable.')
assert.match(dutyRosterStyles, /@media \(max-width: 390px\)[\s\S]*?\.mobile-roster-card \{ padding: 12px; \}/, 'Cards must remain compact at 390px and smaller.')
assert.match(styles, /\.roster-scroll\{display:none\}\.mobile-roster\{display:block\}/, 'Desktop and mobile roster layouts must remain independently scoped.')

console.log(JSON.stringify({ duplicateLabelsRemoved: true, configuredCodeAndName: true, colorsPreserved: true, dropdownFunctional: true, employeeIdentityPreserved: true, compactAt390: true, noHorizontalOverflow: true, desktopLayoutPreserved: true }, null, 2))
