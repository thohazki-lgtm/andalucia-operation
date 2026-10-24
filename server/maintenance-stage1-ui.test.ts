import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, baseStyles, stageStyles, actionSource, actionStyles] = await Promise.all([
  readFile('src/maintenance.tsx', 'utf8'),
  readFile('src/maintenance.css', 'utf8'),
  readFile('src/maintenance-stage1.css', 'utf8'),
  readFile('src/action-system.tsx', 'utf8'),
  readFile('src/action-system.css', 'utf8')
])

for (const label of ['Total Issues', 'Open Issues', 'In Progress', 'Resolved']) {
  assert.ok(source.includes(`>${label}<`), `Maintenance summary is missing ${label}`)
}
for (const label of ['Issue Description', 'Date Reported', 'Category', 'Priority', 'Reported By', 'Follow-up Notes']) {
  assert.ok(source.includes(label), `Maintenance form is missing ${label}`)
}
for (const status of ['Reported', 'In Progress', 'Resolved']) {
  assert.ok(source.includes(`return '${status}'`), `Maintenance workflow is missing ${status}`)
}
assert.equal(source.includes('Location / Area'), false, 'Single-outlet Maintenance must not ask for a location')
assert.equal(source.includes('<span>Revision</span>'), false, 'Manager details must not expose technical revision metadata')
assert.match(source, /maintenance-card-urgent/, 'Urgent mobile issues must be highlighted')
assert.match(source, /className="maintenance-issue-trigger mobile"/, 'Mobile issue titles must open details directly')
assert.equal(source.includes('<th>View</th>'), false, 'Desktop Maintenance must not retain a View column')
assert.equal(source.includes('>View</button>'), false, 'Maintenance cards must not retain a redundant View button')
assert.match(source, /function MaintenanceStatusControl/, 'Maintenance must use the shared compact status control')
assert.match(source, /className="maintenance-status-select"/, 'Editable statuses must use the pill select styling')
assert.match(source, /className="maintenance-card-footer"/, 'Mobile Status and Edit controls must share one compact footer')
assert.match(stageStyles, /\.maintenance-table-wrap \{[\s\S]*?display: none;/, 'The legacy desktop Maintenance table must be removed from the rendered layout')
assert.match(stageStyles, /\.maintenance-cards \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, 'Desktop Maintenance must use a compact two-column card grid')
assert.match(stageStyles, /@media \(max-width: 900px\)[\s\S]*?\.maintenance-cards \{ grid-template-columns: 1fr; \}/, 'Maintenance cards must stack at tablet and mobile widths')
assert.match(stageStyles, /@media \(max-width: 700px\)/, 'Stage 1 refinements must retain the mobile breakpoint')
assert.match(stageStyles, /\.maintenance-status-select,[\s\S]*?\.maintenance-status-pill/, 'Status controls must share the approved pill presentation')
assert.match(stageStyles, /\.maintenance-issue-trigger > :last-child[\s\S]*?color: #b38b3a;/, 'Issue details chevrons must use the approved gold styling')
assert.match(stageStyles, /\.maintenance-summary \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, 'Desktop summary cards must fill the available width equally')
assert.match(stageStyles, /\.maintenance-card-footer \{[\s\S]*?grid-template-columns: minmax\(126px, 1fr\) minmax\(96px, 118px\);/, 'Mobile Status and Edit controls must align in a compact grid with room for complete status text')
assert.match(source, /from '\.\/action-system'/, 'Maintenance must use the scoped shared action system')
assert.match(source, /<ActionButton variant="primary" icon="add"/, 'Add Maintenance Issue must remain a visible primary action')
assert.match(source, /<StatusSelect className="maintenance-status-select"/, 'Editable Maintenance status must remain an interactive select')
assert.match(source, /<StatusPill tone="success"/, 'Resolved Maintenance status must be a non-interactive status pill')
assert.match(source, /<h4>Issue Information<\/h4>/, 'Maintenance form must group issue information')
assert.match(source, /<h4>Follow-up &amp; Notes<\/h4>/, 'Maintenance form must group follow-up and notes')
assert.match(source, /className="maintenance-detail-hero"/, 'Maintenance details must use a compact issue header')
assert.match(source, /className="maintenance-detail-section"><h4>Issue Information<\/h4>/, 'Maintenance details must group issue information')
assert.match(source, /className="maintenance-detail-section"><h4>Follow-up &amp; Notes<\/h4>/, 'Maintenance details must group notes without duplicate fields')
assert.match(stageStyles, /\.maintenance-filters :is\(input, select\) \{[\s\S]*?height: 44px;[\s\S]*?border: 1px solid #dec58f;[\s\S]*?font-size: 13px;/, 'Maintenance filters must share typography, height and gold borders')
assert.match(stageStyles, /\.maintenance-detail-section \{[\s\S]*?border: 1px solid #dec58f;/, 'Maintenance detail sections must use the approved gold frame')
assert.match(source, /Discard unsaved maintenance issue changes\?/, 'Maintenance form dismissal must protect unsaved changes')
assert.equal(source.includes('className="maintenance-modal-close"'), false, 'Maintenance modal must not retain the redundant close icon')
assert.match(source, /event\.key === 'Escape'/, 'Maintenance modal must retain Escape dismissal')
assert.match(source, /event\.currentTarget === event\.target/, 'Maintenance modal must dismiss from backdrop clicks only')
assert.match(stageStyles, /border: 1px solid #dec58f;/, 'Maintenance cards and panels must use the approved gold border')
assert.match(baseStyles, /\.maintenance-form-grid\{display:grid/, 'Maintenance must retain its responsive form grid foundation')
for (const component of ['ActionButton', 'IconAction', 'StatusPill', 'StatusSelect', 'OverflowMenu']) assert.match(actionSource, new RegExp(`export function ${component}`), `Shared action system is missing ${component}`)
assert.match(actionSource, /<svg[\s\S]*?aria-hidden="true"[\s\S]*?focusable="false"/, 'Shared icons must be decorative inside labelled controls')
assert.match(actionStyles, /@media \(max-width: 700px\)[\s\S]*?\.ao-action \{ min-height: 44px; \}/, 'Mobile actions must meet the 44px touch target')
assert.match(actionStyles, /\.ao-action:focus-visible,[\s\S]*?outline: 3px solid/, 'Shared actions must expose a keyboard focus indicator')

console.log(JSON.stringify({ summary: true, workflow: true, compactDetails: true, titleChevron: true, statusPills: true, statusSelectInteractive: true, actionSystemScoped: true, mobileTouchTargets44: true, keyboardFocus: true, urgentHighlight: true, desktopCards: true, mobileCards390: true, groupedModal: true, unsavedProtection: true }))
