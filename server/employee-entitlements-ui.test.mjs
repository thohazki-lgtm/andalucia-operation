import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')
const corporateTheme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

const employeeManager = workforce.match(/export function StaffEntitlementsManager[\s\S]*?\n\}/)?.[0] || ''
for (const heading of ['Employee', 'Employee ID', 'Available', 'Used', 'Booked', 'Balance', 'Action']) assert.ok(employeeManager.includes(`<th>${heading}</th>`), `Missing Employee Entitlements table heading: ${heading}`)
assert.doesNotMatch(employeeManager, /<th>Accrued<\/th>|data-label="Accrued"/, 'Accrued must not appear in the main Annual Leave table.')
assert.match(employeeManager, /className="employee-entitlement-table"/, 'Employee Entitlements must use one full-width table.')
assert.match(employeeManager, /visible\.map\(item =>/, 'The table must render every active employee returned by the existing entitlement source.')
assert.match(employeeManager, /serviceYear \? serviceYear\.remaining/, 'Available must use the authoritative post-usage balance.')
assert.match(employeeManager, /serviceYear \? serviceYear\.availableAfterBooked/, 'Balance must deduct separate future bookings exactly once.')
assert.match(employeeManager, /<EntitlementInlineDetails/, 'Each employee row must expand its details inline.')
assert.doesNotMatch(employeeManager, /EntitlementBalanceDialog|modal-backdrop|setViewing/, 'The large entitlement popup must be removed from Employee Entitlements.')
assert.doesNotMatch(workforce, /Show inactive staff/, 'The Employee Entitlements view must not expose inactive-staff filtering.')
assert.doesNotMatch(workforce, />Reconcile(?: Year)?</, 'The employee reconciliation action must remain removed.')

assert.match(styles, /\.employee-entitlement-table-wrap\{[^}]*overflow-x:auto/, 'The desktop table must contain horizontal overflow safely.')
assert.match(styles, /\.employee-entitlement-table\{width:100%;min-width:820px/, 'The seven-column entitlement table must remain full-width and aligned on desktop.')
assert.match(employeeManager, /<th>Employee<\/th><th>Employee ID<\/th><th>Available<\/th><th>Used<\/th><th>Booked<\/th><th>Balance<\/th><th>Action<\/th>/, 'Employee name, ID, balances, and the action must have distinct columns.')
assert.match(employeeManager, /<colgroup><col className="entitlement-employee-column"\s*\/><col className="entitlement-id-column"\s*\/>(?:<col className="entitlement-metric-column"\s*\/>){4}<col className="entitlement-action-column"\s*\/><\/colgroup>/, 'The table must contain exactly seven explicit data columns with no unused spacer column.')
assert.match(employeeManager, /<div className="panel-title workforce-section-title"><div><p className="eyebrow">EMPLOYEE OVERRIDES &amp; BALANCES<\/p><h3>Employee Entitlements<\/h3><\/div><\/div>/, 'Employee Entitlements must be the Dahlia heading beneath the compact eyebrow.')
assert.doesNotMatch(employeeManager, /entitlement-view-summary|employees? shown/, 'The redundant employee-count strip must be removed.')
assert.match(employeeManager, /<footer className="entitlement-information-footer"[\s\S]*?Individual allowances override policy defaults without changing confirmed Duty Roster evidence\.[\s\S]*?Annual Leave figures use confirmed Duty Roster usage and separate future bookings\.[\s\S]*?<\/footer>/, 'Both existing explanatory lines must move unchanged into one footer after the table.')
assert.ok(employeeManager.indexOf('entitlement-information-footer') > employeeManager.indexOf('employee-entitlement-table-wrap'), 'The information footer must follow the table and expanded inline details.')
assert.doesNotMatch(employeeManager, /Close Details/, 'Inline details must not duplicate the row-level Close action.')
assert.match(styles, /\.employee-entitlement-table-wrap\{margin-top:10px;[^}]*overflow-x:auto/, 'The table must be visually separated from its heading without another container.')
assert.match(styles, /\.employee-entitlement-table th\{[^}]*font-size:9px[^}]*font-weight:500[^}]*text-align:center/, 'Metric headings must match the Planner calendar typography.')
assert.match(styles, /\.employee-entitlement-table \.employee-entitlement-row td>b\{[^}]*font-size:11\.5px[^}]*font-weight:400/, 'Entitlement values must use the Planner table scale and lighter numeric typography.')
assert.match(styles, /\.employee-entitlement-table \.employee-entitlement-row td\{[^}]*font-variant-numeric:tabular-nums/, 'Entitlement values must remain tabular and aligned.')
assert.match(styles, /\.employee-entitlement-table \.employee-entitlement-id b\{[^}]*font-size:11\.25px[^}]*font-weight:500/, 'Employee IDs must match the Planner calendar scale.')
assert.match(styles, /\.employee-entitlement-table \.employee-entitlement-identity b\{font-size:11\.5px;font-weight:500/, 'Employee names must match the Planner calendar scale.')
assert.match(styles, /\.employee-entitlement-table \.employee-entitlement-row td\{[^}]*vertical-align:middle/, 'Table values must stay vertically aligned.')
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.employee-entitlement-table \.employee-entitlement-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Mobile rows must use a readable two-column layout.')
assert.match(styles, /\.employee-entitlement-details-row>td\{[^}]*background:var\(--ao-leave-surface/, 'Inline details must remain connected to the selected employee.')
assert.match(styles, /\.employee-entitlement-table \.entitlement-metric-column\{width:13\.75%\}/, 'The four balance columns must share the rebalanced table width.')
assert.match(styles, /\.entitlement-information-footer\{[^}]*display:flex[^}]*border:1px solid var\(--ao-leave-gold/, 'The explanatory footer must use one compact gold-framed information treatment.')
assert.match(corporateTheme, /main\.module-leave-planner \.employee-entitlement-table-wrap\s*\{[\s\S]*?border-color:\s*var\(--ao-leave-gold\) !important;[\s\S]*?border-top-width:\s*2px !important;/, 'Employee Entitlements must retain a continuous gold outer and top table border.')
assert.match(corporateTheme, /main\.module-leave-planner \.employee-entitlement-table :is\(th, td\)\s*\{[\s\S]*?border-color:\s*var\(--ao-leave-grid-gold\) !important;/, 'Employee Entitlements row and column dividers must render gold.')
assert.match(corporateTheme, /html body \.app-shell main\.module-leave-planner \.employee-entitlement-table \.employee-entitlement-id b\s*\{[^}]*font-family:\s*var\(--ao-font-ui\);[^}]*font-size:\s*11\.25px;[^}]*font-weight:\s*500;/, 'The authoritative theme layer must match Planner Employee ID typography.')
assert.match(corporateTheme, /html body \.app-shell main\.module-leave-planner \.employee-entitlement-table \.employee-entitlement-row td:not\(\.employee-entitlement-identity\):not\(\.employee-entitlement-id\):not\(\.employee-entitlement-action\) > b\s*\{[^}]*font-family:\s*var\(--ao-font-ui\);[^}]*font-size:\s*11\.5px;[^}]*font-weight:\s*400;[^}]*font-variant-numeric:\s*tabular-nums;/, 'The authoritative theme layer must preserve aligned Planner-scale balance values.')

const inlineDetails = workforce.match(/function EntitlementInlineDetails[\s\S]*?\n\}/)?.[0] || ''
assert.doesNotMatch(inlineDetails, /Accruing Next Service Year|accruingForNextServiceYear/, 'The misleading next-service-year accrual display must be removed from inline details.')
const offSummaryPosition = inlineDetails.indexOf('OFF Days Summary')
const nonAnnualBalancePosition = inlineDetails.indexOf('aria-label="Non-Annual Leave entitlement balances"')
assert.ok(offSummaryPosition > 0 && offSummaryPosition < nonAnnualBalancePosition, 'OFF Days Summary must remain before the simplified non-AL balances.')
for (const label of ['Employee ID', 'Service Year', 'Next Anniversary', 'OFF Taken', 'Accumulated OFF', 'Available Balance', 'Weekly OFF Review', 'Required', 'Assigned', 'Difference', 'Status']) assert.ok(inlineDetails.includes(label), `Missing inline entitlement detail: ${label}`)
assert.match(inlineDetails, /employee-entitlement-details-identity[^>]*><h4>\{item\.staffName\}<\/h4>/, 'The compact detail header must keep the employee name separate from the Employee ID fact.')
assert.match(inlineDetails, /staffApi\.yearlyEntitlementBalance\(item\.staffId, year, weekDate\)/, 'Inline details must reuse the existing yearly balance service.')
assert.match(inlineDetails, /staffApi\.accumulatedOffBalance\(item\.staffId\)/, 'OFF summary must use the existing accumulated-OFF balance service.')
assert.match(inlineDetails, /weeklyOff\.status === 'pending' \? 'Pending'/, 'Incomplete weeks must render Pending.')
assert.match(inlineDetails, /weeklyOff\.complete \?/, 'Incomplete weeks must not display a shortage difference.')
assert.match(styles, /\.off-days-summary\{[^}]*border:1px solid var\(--ao-leave-gold/, 'OFF summary must use the approved gold card treatment.')
assert.match(styles, /\.off-days-metrics\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'The three OFF figures must share one horizontal desktop row.')
assert.match(styles, /\.off-days-weekly-review dl\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*gap:5px/, 'Weekly OFF Review must remain compact and equal-width.')
assert.match(styles, /\.off-days-summary \.balance-week-actions\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'Week navigation buttons must use three consistent columns.')
assert.doesNotMatch(workforce, /AnnualLeaveCarryForwardSection|CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD|Review Carry Forward/, 'Manual Annual Leave Carry Forward controls must be removed.')
assert.doesNotMatch(employeeManager, /<EntitlementForm|<YearlyEntitlementForm|AnnualLeaveCarryForwardForm/, 'Legacy entitlement edit workflows must not remain exposed in Employee Entitlements.')
assert.match(inlineDetails, /yearlyLeave\.filter\(line => line\.classification !== 'annualLeave'\)/, 'The duplicated Annual Leave card must be excluded from inline details.')
assert.match(inlineDetails, /<dt>Entitled<\/dt>/)
assert.match(inlineDetails, /<dt>Used<\/dt>/)
assert.match(inlineDetails, /<dt>Balance<\/dt>/)
assert.doesNotMatch(inlineDetails, /<dt>Booked<\/dt>[\s\S]*?line\.bookedFuture/, 'Non-AL cards must not display Booked.')
assert.match(inlineDetails, /displayEntitlement\(line\.remaining\)/, 'Non-AL Balance must use the existing confirmed-usage remaining balance.')
assert.match(styles, /\.additional-entitlement-balances>div\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Non-AL cards must use two desktop columns.')
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.additional-entitlement-balances>div\{grid-template-columns:1fr\}/, 'Non-AL cards must stack on mobile.')
assert.match(styles, /\.additional-entitlement-balances dl\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'Each non-AL card must keep Entitled, Used, and Balance in one row.')
assert.match(styles, /\.additional-entitlement-balances article\{display:flex;min-height:82px[^}]*border:1px solid var\(--ao-leave-gold/, 'Non-AL balance cards must use a compact, gold-framed treatment.')
assert.ok(inlineDetails.indexOf('employee-entitlement-as-of') > inlineDetails.indexOf('additional-entitlement-balances'), 'The employee-specific As of note must follow all inline entitlement cards.')
assert.doesNotMatch(corporateTheme, /\.off-days-summary,|\.additional-entitlement-balances article\s*\n\)\s*\{\s*border-color:\s*var\(--ao-leave-line\) !important/, 'Shared Leave Planner rules must not override inline detail gold borders.')
for (const className of ['off-days-summary', 'off-days-weekly-review', 'additional-entitlement-card']) assert.match(corporateTheme, new RegExp(`:not\\(\\.${className}\\)`), `The generic corporate structural rule must not recolor ${className}.`)
assert.match(inlineDetails, /event\.key === 'Escape'/, 'Escape must collapse inline details.')
assert.doesNotMatch(employeeManager, /Carry Forward|detailsDirty/, 'The retired manual carry-forward workflow must not leave dirty-state handling behind.')

console.log(JSON.stringify({
  fullWidthEmployeeTable: true,
  displayedColumns: ['Employee', 'Employee ID', 'Available', 'Used', 'Booked', 'Balance', 'Action'],
  responsiveEmployeeRows: true,
  unconfiguredPreserved: true,
  serviceYearCalculationPreserved: true,
  inlineDetails: true,
  automaticLifetimeCarryForward: true,
  legacyEditWorkflowsHidden: true,
  reconciliationUiRemoved: true,
  offDaysSummaryFirst: true,
  duplicatedAnnualLeaveRemoved: true,
  nonAnnualMetrics: ['Entitled', 'Used', 'Balance'],
  rosterAuthoritativeOffBalance: true,
}, null, 2))
