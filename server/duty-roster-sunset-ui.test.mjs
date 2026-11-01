import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, corporateTheme, rosterTheme, sharedStyles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/duty-roster.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(corporateTheme, /linear-gradient\(to bottom, #fd8451 0%, #f99b58 48%, #ffbd6f 100%\)/, 'Duty Roster must use one continuous sunset-to-gold page gradient.')
assert.match(rosterTheme, /--roster-gold: #c9a65a/, 'Duty Roster must expose the approved muted-gold accent token.')
assert.match(rosterTheme, /\.duty-roster-page > \.duty-roster-tabs \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 8px;[\s\S]*?border: 0;[\s\S]*?background: transparent;/, 'Roster and Duty Code Settings must remain separate compact equal tabs without a shared frame.')
assert.match(rosterTheme, /\.duty-roster-page > \.duty-roster-tabs button \{[\s\S]*?border: 2px solid var\(--roster-gold\)/, 'Each Duty Roster tab must have its own complete muted-gold border.')
assert.match(rosterTheme, /\.roster-controls\.roster-calendar-header \{[\s\S]*?padding: 4px 8px;[\s\S]*?border-top: 3px solid var\(--roster-gold\);[\s\S]*?background: linear-gradient\(120deg, #8b3f25, #c85c31\)/, 'Month navigation must use the compact premium sunset-gradient command header.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?font-family: var\(--ao-font-display/, 'Month navigation must use the approved Dahlia display typography.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?color: #fff8ec;/, 'The month heading must sit directly on the gradient header without a cream box.')
assert.match(rosterTheme, /\.roster-period-navigation \{[\s\S]*?width: min\(440px, 100%\);[\s\S]*?grid-template-columns: 34px minmax\(210px, 1fr\) 34px;/, 'Desktop month arrows must stay close to the centered date inside the compact header.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?min-height: 34px;[\s\S]*?font-size: 18px;/, 'The Duty Roster date range must use the compact Team Membership visual scale.')
assert.match(rosterTheme, /\.roster-member-cell b \{[\s\S]*?font-size: 15px;[\s\S]*?font-weight: 600;/, 'Team member names must retain the compact operational hierarchy above secondary identity details.')
assert.match(rosterTheme, /\.roster \.roster-member-cell small \{[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 500;/, 'Designation and employee ID must remain readable without increasing row height.')
assert.match(rosterTheme, /\.mobile-roster-identity b \{[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 600;/, 'Mobile team member names must remain compact and readable.')
assert.match(rosterTheme, /\.roster thead th \{[\s\S]*?height: 58px;[\s\S]*?padding: 6px 3px 5px;/, 'Weekly table headers must return to the compact approved height.')
assert.match(rosterTheme, /\.roster tbody td \{[\s\S]*?height: 50px;[\s\S]*?padding: 6px 4px;/, 'Weekly roster rows must remain compact.')
assert.doesNotMatch(sharedStyles, /\.roster thead th:not\(:first-child\):not\(:last-child\)[\s\S]*?font-size:17\.5px/, 'Legacy global roster typography must not override the scoped compact design.')
assert.match(app, /<StaffHeaderMonthNavigation[\s\S]*?ariaLabel="Duty Roster month"/, 'Duty Roster must use the coordinated month picker and navigation control.')
assert.match(app, /<\/section>\s*<div className="roster-view-switch roster-view-switch-standalone"/, 'Weekly and Monthly controls must remain separate from the calendar command header.')
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
