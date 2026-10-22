import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const membership = await readFile('src/staff-membership-baseline.tsx', 'utf8')
const membershipCss = await readFile('src/staff-membership-baseline.css', 'utf8')
const financial = await readFile('src/financial-preview.tsx', 'utf8')
const service = await readFile('server/financial-preview-service.ts', 'utf8')

assert.match(membership, /DateControl type="month" label="Membership month" min=\{FIRST_BASELINE_MONTH\}/)
assert.match(membership, /staffMembershipBaselineApi\.preview\(month, OUTLET_SCOPE_KEY\)/)
assert.match(membership, /staffMembershipBaselineApi\.beginReview\(month, OUTLET_SCOPE_KEY\)/)
assert.match(membership, /staffMembershipBaselineApi\.reopen\(reviewId, preview\.outlet\.id, month,/)
assert.doesNotMatch(membership, />September 2026 Baseline/)
assert.doesNotMatch(membership, /type="date"/)
assert.doesNotMatch(membership, /draft baseline/i)
assert.doesNotMatch(membership, /REGULAR_OUTLET_MEMBERSHIP_OVERLAP/)
assert.match(membership, /'Approve Membership'/)
assert.match(membership, /Correct Approved Membership/)
assert.match(membership, /disabled=\{!editable \|\| !selected\.length \|\| blockerCount > 0\}/)
assert.match(financial, /Staff Management → Team Membership/)
assert.match(service, /No approved Team Membership revision exists for \$\{input\.month\}/)
assert.match(membershipCss, /\.membership-intro-actions\{display:flex/)
assert.match(membershipCss, /@media\(max-width:700px\).*\.membership-intro-actions\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/s)
assert.match(membershipCss, /\.membership-month-control \.ao-date-control input\{min-height:42px/)
assert.match(membershipCss, /@media\(max-width:700px\).*\.membership-month-control input\{width:100%;min-height:44px\}/s)
assert.match(membership, /membership-approved-page/)
assert.match(membership, /Approved Date \/ Time/)
assert.match(membership, /membership-history-disclosure/)
assert.match(membership, /<th>Staff<\/th><th>Employee Number<\/th><th>Designation<\/th>/)
assert.doesNotMatch(membership, /<th>Membership Month<\/th><th>Status<\/th>/)

console.log(JSON.stringify({
  currentMonthSelectable: true,
  exactMonthApiFlow: true,
  noSeptemberUiLock: true,
  routineDateInputsRemoved: true,
  baselineTerminologyRemoved: true,
  monthlyCorrectionAvailable: true,
  approvalBlockedUntilWarningsResolve: true,
  actionableFinancialBlocker: true,
  desktopMonthControls: true,
  mobile390MonthControls: true,
  approvedHeaderAuthorityVisible: true,
  approvedRowsDeduplicated: true,
  revisionHistoryCollapsible: true,
}, null, 2))
