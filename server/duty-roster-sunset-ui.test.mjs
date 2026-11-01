import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, corporateTheme, rosterTheme] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/duty-roster.css', import.meta.url), 'utf8'),
])

assert.match(corporateTheme, /linear-gradient\(to bottom, #fd8451 0%, #f99b58 48%, #ffbd6f 100%\)/, 'Duty Roster must use one continuous sunset-to-gold page gradient.')
assert.match(rosterTheme, /--roster-gold: #c9a65a/, 'Duty Roster must expose the approved muted-gold accent token.')
assert.match(rosterTheme, /\.roster-controls \{[\s\S]*?border-top: 4px solid var\(--roster-gold\)/, 'Primary controls must use the premium muted-gold top border.')
assert.match(rosterTheme, /\.staff-header-month-picker > summary \{[\s\S]*?font-family: var\(--ao-font-display/, 'Month navigation must use the approved Dahlia display typography.')
assert.match(app, /<StaffHeaderMonthNavigation[\s\S]*?ariaLabel="Duty Roster month"/, 'Duty Roster must use the coordinated month picker and navigation control.')
assert.match(app, /<footer className="roster-bottom-actions">[\s\S]*?Export PDF[\s\S]*?Save Changes/, 'Export and save actions must share the bottom action area.')
assert.doesNotMatch(app, /RosterMonthLockDialog|rosterMonthLocks|reopenRosterMonth|relockRosterMonth/, 'The presentation-only checkpoint must not expose protected month-lock behavior.')

console.log(JSON.stringify({
  continuousGradient: true,
  premiumCardAccents: true,
  dahliaMonthPicker: true,
  bottomActions: true,
  protectedLockFeatureExcluded: true,
}, null, 2))
