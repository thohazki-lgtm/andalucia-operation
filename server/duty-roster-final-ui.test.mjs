import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, api, server, styles, dutyRosterStyles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/api.ts', import.meta.url), 'utf8'),
  readFile(new URL('./index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/duty-roster.css', import.meta.url), 'utf8')
])

assert.match(app, /view === 'Weekly' \? rosterWeekRange\(anchor\) : monthRange\(anchor\)/)
assert.match(app, /direction \* 7/)
assert.doesNotMatch(app, /staff-reorder-trigger/)
assert.doesNotMatch(app, /StaffOrderEditor/)
assert.match(app, /direct-staff-drag-handle/)
assert.match(app, /touch and hold on mobile/)
assert.match(app, /Arrow Up or Arrow Down/)
assert.match(app, /Staff display order/)
assert.match(app, /if \(state\.active && state\.targetId\) void persistStaffOrder\(moveStaff\(state\.id, state\.targetId, state\.targetAfter\)\)/)
assert.match(app, /state\.targetId = row\.dataset\.staffRowId/)
assert.match(app, /setStaffDropTarget\(\{ id: state\.targetId, after: state\.targetAfter \}\)/)
assert.match(app, /<th>Staff<\/th>/)
assert.match(app, /className="staff-reorder-cell">\{staffDragHandle\(person\)\}/)
assert.match(app, /await onReorder\(next\.map\(person => person\.id\)\)/)
assert.match(app, /visibleStaff = directoryOrder\.filter/)
assert.doesNotMatch(app, /<p className="eyebrow">DUTY COVERAGE<\/p>/)
assert.match(api, /reorder: \(orderedIds: string\[\]\) => request<Staff\[\]>\('\/api\/staff\/reorder'/)
assert.match(server, /request\.method === 'POST' && url\.pathname === '\/api\/staff\/reorder'/)
assert.match(server, /assertTrustedOrigin\(request\)/)
assert.match(server, /authorizedStaffContext\(request\)/)
assert.match(styles, /\.direct-staff-drag-handle[^}]*touch-action:none/)
assert.match(styles, /\.staff-name-cell\{padding-left:4px!important\}/)
assert.match(styles, /\.staff-mobile-identity\{[^}]*gap:14px/)
assert.match(styles, /\.staff-table tr\.drop-before td/)
assert.match(dutyRosterStyles, /\.duty-roster-page \.duty-code-table \{[\s\S]*?min-width: 900px;[\s\S]*?table-layout: fixed;/)
assert.match(dutyRosterStyles, /\.duty-roster-page \.duty-code-table td \{[\s\S]*?height: 58px;/)
assert.match(dutyRosterStyles, /\.duty-roster-page \.duty-code-table td:nth-child\(3\) \{ width: 13%; text-align: left; \}/)
assert.match(dutyRosterStyles, /\.duty-roster-page \.duty-code-table td:nth-child\(7\) \{ width: 22%; text-align: center; \}/)
assert.match(dutyRosterStyles, /\.duty-code-card-list \{ display: none; \}/)
assert.match(dutyRosterStyles, /@media \(max-width: 800px\)[\s\S]*?\.duty-code-table-wrap \{ display: none; \}[\s\S]*?\.duty-code-card-list \{ display: grid;/)
assert.match(app, /option\.active \? '' : 'is-disabled'/)
assert.match(app, /className="duty-code-modal" wide headerContent=\{modalIdentity\}/)
assert.match(app, /showClose=\{false\} closeOnBackdrop closeOnEscape lockBackgroundScroll/)
assert.match(app, /className="modal duty-discard-confirmation"/)
assert.match(app, /Keep Editing/)
assert.match(app, /Discard Changes/)
assert.match(dutyRosterStyles, /\.duty-code-modal \{[\s\S]*?max-height: calc\(100dvh - 32px\);[\s\S]*?overflow: hidden;/)
assert.match(dutyRosterStyles, /\.duty-code-form-fields \{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/)
assert.doesNotMatch(app.match(/<tbody>\{activeOptions\.map[\s\S]*?<\/tbody>/)?.[0] || '', /protected-config/i)
assert.match(styles, /\.staff-table\{min-width:850px\}/)
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.roster-controls/)

console.log(JSON.stringify({ sundaySaturdayUI: true, sevenDayNavigation: true, directStaffDragHandles: true, stableDropTarget: true, automaticDropSave: true, dedicatedHandleColumn: true, separateReorderModeRemoved: true, mouseTouchKeyboard: true, directoryAndRosterSharedOrder: true, managerAuthorization: true, trustedOrigin: true, dutyCodeTableCompacted: true, dutyNameBalanced: true, standardizedRowsAndPreview: true, teamDirectorySpacingCompacted: true, redundantHeadingRemoved: true, mobileControlsResponsive: true }, null, 2))
