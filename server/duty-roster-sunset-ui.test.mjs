import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, corporateTheme, rosterTheme, sharedStyles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/duty-roster.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(corporateTheme, /linear-gradient\(to bottom, #a94428 0%, #d96538 30%, #fd8451 62%, #ffbd6f 100%\)/, 'Duty Roster must use the Staff Management distribution pattern while making the richer approved orange transition visible through the full module.')
assert.match(corporateTheme, /\.app-shell:has\(> main\.module-duty-roster\) \{[\s\S]*?background-size: 100% 100%;[\s\S]*?background-attachment: scroll;/, 'Duty Roster must retain the Staff Management full-height gradient behavior.')
assert.match(corporateTheme, /main\.module-duty-roster \{[\s\S]*?--ao-module-surface: rgb\(255 239 223 \/ 36%\);[\s\S]*?--ao-module-surface-strong: rgb\(255 246 233 \/ 48%\);/, 'The higher-specificity shared module frame must visibly expose the page gradient instead of covering it with cream surfaces.')
assert.match(rosterTheme, /\.roster-panel \{[\s\S]*?background: rgb\(255 239 223 \/ 76%\);/, 'The component fallback must remain compatible while the authoritative module token controls the live translucent panel.')
assert.match(rosterTheme, /--roster-table-row: #fff9f4;[\s\S]*?--roster-table-row-alt: #ffefe4;/, 'Roster tables must use subtle warm cream and peach row surfaces.')
assert.match(corporateTheme, /main\.module-duty-roster > \.page-header :is\(h1, \.eyebrow\) \{ color: #fff8ec; \}/, 'The external Workforce Planning page heading must remain readable in ivory on orange.')
assert.match(rosterTheme, /--roster-gold: #c9a65a/, 'Duty Roster must expose the approved muted-gold accent token.')
assert.match(rosterTheme, /\.duty-roster-page \.roster \{[\s\S]*?border: 1px solid var\(--roster-gold\);[\s\S]*?border-top-width: 2px;/, 'Roster tables must have a continuous gold perimeter with a slightly stronger top edge.')
assert.match(rosterTheme, /\.duty-roster-page \.roster \{[\s\S]*?border-collapse: separate;[\s\S]*?border-spacing: 0;/, 'Gold roster dividers must not be muted by collapsed-border conflict resolution.')
assert.match(rosterTheme, /main\.module-duty-roster \.duty-roster-page \.roster thead th \{[\s\S]*?border-right: 1px solid var\(--roster-gold\);/, 'Desktop roster header columns must use a scoped gold separator that beats the shared module divider rule.')
assert.match(rosterTheme, /main\.module-duty-roster \.duty-roster-page \.roster tbody td \{[\s\S]*?border-top: 1px solid var\(--roster-gold\);[\s\S]*?border-left: 1px solid var\(--roster-gold\);/, 'Desktop roster rows and columns must use scoped consistent thin gold dividers.')
assert.match(rosterTheme, /\.duty-code-table \{[\s\S]*?border: 1px solid var\(--roster-gold\);[\s\S]*?border-top-width: 2px;[\s\S]*?border-collapse: separate;/, 'Duty Code Settings must use the same continuous gold perimeter without collapsed-border conflicts.')
assert.match(rosterTheme, /\.duty-roster-page > \.duty-roster-tabs \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 8px;[\s\S]*?border: 0;[\s\S]*?background: transparent;/, 'Roster and Duty Code Settings must remain separate compact equal tabs without a shared frame.')
assert.match(rosterTheme, /\.duty-roster-page > \.duty-roster-tabs button \{[\s\S]*?border: 2px solid var\(--roster-gold\)/, 'Each Duty Roster tab must have its own complete muted-gold border.')
assert.match(rosterTheme, /\.roster-command-header \{[\s\S]*?justify-content: stretch;[\s\S]*?gap: 9px;[\s\S]*?padding: 13px 18px 11px;[\s\S]*?border-top: 3px solid var\(--roster-gold\);[\s\S]*?background: linear-gradient\(120deg, #8b3f25, #c85c31\)/, 'Duty Roster must neutralize the legacy global header spacing and retain one compact bordered command container.')
assert.match(rosterTheme, /\.roster-command-main \{[\s\S]*?width: 100%;[\s\S]*?grid-template-columns: minmax\(150px, 1fr\) auto;/, 'Duty Roster identity and right-aligned period navigation must span the compact top row.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?font-family: var\(--ao-font-display/, 'Month navigation must use the approved Dahlia display typography.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?color: #fff8ec;/, 'The month heading must sit directly on the gradient header without a cream box.')
assert.match(rosterTheme, /\.roster-period-navigation \{[\s\S]*?width: min\(420px, 100%\);[\s\S]*?grid-template-columns: 40px minmax\(240px, 340px\) 40px;[\s\S]*?justify-self: end;/, 'Desktop date navigation must align right while giving the longer weekly range enough room to remain compact.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?min-height: 40px;[\s\S]*?font-size: clamp\(20px, 1\.8vw, 23px\);[\s\S]*?white-space: nowrap;/, 'The Duty Roster date range must retain a balanced Dahlia scale without wrapping or changing the navigation layout.')
assert.match(rosterTheme, /\.roster-member-cell b \{[\s\S]*?font-size: 12\.5px;[\s\S]*?font-weight: 500;/, 'Team member names must retain a compact operational hierarchy above secondary identity details.')
assert.match(rosterTheme, /\.roster \.roster-member-cell small \{[\s\S]*?font-size: 11\.5px;[\s\S]*?font-weight: 500;/, 'Designation and employee ID must remain readable without increasing row height.')
assert.match(rosterTheme, /\.mobile-roster-identity b \{[\s\S]*?font-size: 12\.5px;[\s\S]*?font-weight: 500;/, 'Mobile team member names must remain compact and readable.')
assert.match(rosterTheme, /\.roster-view-switch \.view:not\(\.active\):not\(\.danger\):not\(\.remove\) \{[\s\S]*?background: #f3c49d;[\s\S]*?color: #5b2a1c;/, 'Only inactive view tabs may receive the warm cream treatment so the active state is not overridden.')
assert.match(rosterTheme, /@media \(max-width: 700px\) \{[\s\S]*?\.roster-view-switch\.roster-view-switch-standalone \{[\s\S]*?width: 100%;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, 'Mobile Weekly and Monthly tabs must override the desktop width cap and fill two equal header columns.')
assert.match(rosterTheme, /@media \(max-width: 700px\) \{[\s\S]*?\.roster-view-switch \.view\.active \{[\s\S]*?background: #a94428;[\s\S]*?color: #fff;/, 'The active mobile roster view must use the deeper orange state with readable white text.')
assert.match(rosterTheme, /html body \.app-shell main\.module-duty-roster \.duty-roster-page \.staff-header-month-picker > summary \{[\s\S]*?font-family: var\(--ao-font-display[\s\S]*?font-size: clamp\(20px, 1\.8vw, 23px\);/, 'The top-right period range must beat the shared Good Sans reset and render in the Duty Roster Dahlia face.')
assert.match(rosterTheme, /\.roster thead th \{[\s\S]*?height: 72px;[\s\S]*?padding: 4px 3px 3px;/, 'Weekly table headers must preserve the approved row geometry while the labels return to a compact scale.')
assert.match(rosterTheme, /\.roster tbody td \{[\s\S]*?height: 50px;[\s\S]*?padding: 6px 4px;/, 'Weekly roster rows must remain compact.')
assert.doesNotMatch(sharedStyles, /\.roster thead th:not\(:first-child\):not\(:last-child\)[\s\S]*?font-size:17\.5px/, 'Legacy global roster typography must not override the scoped compact design.')
assert.doesNotMatch(sharedStyles, /\.staff-section-tabs,\.duty-roster-tabs|\.roster-controls\{/, 'Legacy shared tab and calendar-frame rules must not compete with the dedicated Duty Roster stylesheet.')
assert.doesNotMatch(corporateTheme, /:is\(\s*\.staff-section-tabs,\s*\.duty-roster-tabs,/, 'The global module-tab rule must not restore a shared Duty Roster frame after the scoped stylesheet loads.')
assert.match(app, /<StaffHeaderMonthNavigation[\s\S]*?ariaLabel="Duty Roster month"/, 'Duty Roster must use the coordinated month picker and navigation control.')
assert.match(app, /function formatRosterPeriod\([\s\S]*?sameMonth \?[\s\S]*?const periodLabel = formatRosterPeriod\(start, end\)/, 'The longer weekly range must use a compact date label that remains between the navigation arrows.')
assert.match(app, /<header className="roster-command-header"[\s\S]*?<div className="roster-command-main">[\s\S]*?<h2>Duty Roster<\/h2><p>Weekly and monthly team planning<\/p>[\s\S]*?<StaffHeaderMonthNavigation[\s\S]*?<div className="roster-view-switch roster-view-switch-standalone"[\s\S]*?<\/header>/, 'The command container must keep title and subtitle beside date navigation, with Weekly/Monthly controls beneath them.')
assert.doesNotMatch(app, /\{page !== 'Duty Roster' && <header className=\{`page-header/, 'Duty Roster must render the established page heading above its command container.')
assert.match(app, /<footer className="roster-bottom-actions">[\s\S]*?Export PDF[\s\S]*?Save Changes/, 'Export and save actions must share the bottom action area.')
assert.doesNotMatch(app, /RosterMonthLockDialog|rosterMonthLocks|reopenRosterMonth|relockRosterMonth/, 'The presentation-only checkpoint must not expose protected month-lock behavior.')

console.log(JSON.stringify({
  continuousGradient: true,
  separatedGoldTabs: true,
  gradientMonthHeader: true,
  premiumCardAccents: true,
  dahliaMonthPicker: true,
  compactMeasuredHierarchy: true,
  conflictingLegacyOverridesRemoved: true,
  bottomActions: true,
  protectedLockFeatureExcluded: true,
}, null, 2))
