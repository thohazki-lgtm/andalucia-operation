import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.match(app, /function DutyRosterPage\(/)
assert.match(app, /useState<'roster' \| 'duty-codes'>\('roster'\)/, 'Roster must be the default Duty Roster tab.')
assert.match(app, /aria-label="Duty Roster sections"/)
assert.match(app, />Roster<\/button>/)
assert.match(app, />Duty Code Settings<\/button>/)
assert.match(app, /section === 'roster' \? <Roster[^>]+> : <DutyCodeManager/, 'The tabs must switch between the existing roster and Duty Code manager.')
assert.equal((app.match(/<DutyCodeManager /g) || []).length, 1, 'Duty Code Settings must render only in Duty Roster.')

const leavePlannerWorkspace = app.match(/function LeavePlannerWorkspace\([^\n]*\) \{([\s\S]*?)\n\}/)?.[1] || ''
assert.ok(leavePlannerWorkspace, 'The standalone Leave Planner workspace must be available.')
assert.doesNotMatch(leavePlannerWorkspace, /DutyCodeManager/, 'Duty Code Settings must remain in Duty Roster.')
assert.match(leavePlannerWorkspace, /StaffEntitlementsManager/)
assert.match(leavePlannerWorkspace, /PublicHolidaySettingsManager/)
assert.doesNotMatch(app, /function ConfigurationView/, 'The retired Workforce customization surface must not remain.')

for (const behavior of ['Display Code', 'Duty Name', 'Counts as Working', 'dutyClassification', 'onReorder', 'onRemove']) assert.ok(app.includes(behavior), `Existing Duty Code behavior must remain: ${behavior}`)
for (const classification of ['working', 'other']) assert.ok(app.includes(`value="${classification}"`), `Duty classification must remain available: ${classification}`)
assert.match(app, /Object\.entries\(LEAVE_CLASSIFICATION_LABELS\)/, 'Approved leave/status classifications must remain available.')
assert.match(app, /item\.value === entry\?\.dutyCode \|\| item\.active/, 'Historical Duty Codes must remain visible on assigned roster records.')

assert.match(styles, /\.staff-section-tabs,\.duty-roster-tabs\{display:flex/)
assert.match(styles, /@media\(max-width:700px\)\{\.staff-section-tabs,\.duty-roster-tabs\{width:100%\}/, 'Duty Roster tabs must expand responsively on mobile.')
assert.match(styles, /\.duty-code-table-wrap\{[^}]*overflow-x:auto/, 'Duty Code settings table must remain usable at narrow widths.')

console.log(JSON.stringify({ defaultRosterTab: true, dutyCodeSettingsRelocated: true, customizationEntryRemoved: true, existingDutyCodeManagerReused: true, historicalRenderingPreserved: true, responsiveTabs: true }, null, 2))
