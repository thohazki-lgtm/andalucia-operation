import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { ConfigOption, Staff } from '../src/domain.js'
import { designationLabel, staffDirectorySearchText } from '../src/staff-directory-view.js'

const positions: ConfigOption[] = [
  { id: 'liquid-master', value: 'LQM', label: 'Liquid Master', active: true },
  { id: 'team-leader', value: 'Restaurant Supervisor', label: 'Team Leader', active: true }
]
const employee: Staff = {
  id: 'staff-1', number: 'SW2268', name: 'DODON', position: 'LQM', nationality: 'Maldivian',
  division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '',
  employmentStatus: 'active', joinDate: '2024-01-01'
}

assert.equal(designationLabel(employee.position, positions), 'Liquid Master')
assert.equal(designationLabel('Restaurant Supervisor', positions), 'Team Leader')
assert.equal(designationLabel('Unconfigured Role', positions), 'Unconfigured Role')
assert.match(staffDirectorySearchText(employee, positions), /liquid master/)

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const summary = app.slice(app.indexOf('<section className="staff-summary">'), app.indexOf('</section>', app.indexOf('<section className="staff-summary">')))

assert.doesNotMatch(summary, /<span>Active<\/span>|<span>Inactive<\/span>/)
for (const label of ['Total Staff', 'Working Today', 'Off Today', 'On Leave']) assert.match(summary, new RegExp(`<span>${label}<\\/span>`))
assert.doesNotMatch(app, /page === 'Staff Management'.*staff-header-add.*Add Staff Member/)
assert.match(app, /staff-section-bar.*staff-section-tabs.*staff-section-add.*Add Staff Member/s)
assert.match(app, /onAddStaff=\{\(\) => setShowStaff\(true\)\}/)
assert.doesNotMatch(app, /Staff are shared across duties/)
assert.match(app, /designationLabel\(staff\.position, configuration\.positions\)/)
assert.match(app, /backgroundColor: dutyOptionFor\(person\)\?\.color/)
assert.match(css, /\.staff-summary\{grid-template-columns:repeat\(4,minmax\(135px,1fr\)\)/)
assert.match(css, /\.today-duty\{justify-content:center;width:86px/)
assert.match(css, /@media\(max-width:700px\).*\.staff-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s)
assert.match(css, /\.staff-management-header\{margin-bottom:12px\}/)
assert.match(css, /\.staff-section-bar\{display:flex;align-items:center;gap:12px;margin-bottom:12px/)
assert.match(css, /\.staff-section-bar \.staff-section-tabs\{flex:1;min-width:0/)
assert.match(css, /\.staff-section-add\{flex:none;margin:0;white-space:nowrap\}/)
assert.match(css, /@media\(max-width:700px\)\{\.staff-management-header\{margin-bottom:10px\}\.staff-section-bar\{align-items:stretch;flex-direction:column/)
assert.match(css, /\.staff-section-bar \.staff-section-tabs\{width:100%;scrollbar-width:none;-ms-overflow-style:none\}/)
assert.match(css, /\.staff-section-bar \.staff-section-tabs::-webkit-scrollbar\{display:none\}/)
assert.match(css, /\.staff-section-bar \.staff-section-tabs button\{flex:none;padding-inline:10px;white-space:nowrap\}/)
assert.match(css, /\.staff-section-add\{width:100%;min-height:38px/)

console.log(JSON.stringify({ summaryCards: true, navigationAction: true, compactSpacing: true, designationLabels: true, designationSearch: true, configuredDutyPills: true, responsiveLayout: true }, null, 2))
