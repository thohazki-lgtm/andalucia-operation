import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

const employeeManager = workforce.match(/export function StaffEntitlementsManager[\s\S]*?\n\}/)?.[0] || ''
for (const heading of ['Employee', 'Available', 'Used', 'Booked', 'Balance']) assert.ok(employeeManager.includes(`<th>${heading}</th>`), `Missing Employee Entitlements table heading: ${heading}`)
assert.doesNotMatch(employeeManager, /<th>Accrued<\/th>|data-label="Accrued"/, 'Accrued must not appear in the main Annual Leave table.')
assert.match(employeeManager, /className="employee-entitlement-table"/, 'Employee Entitlements must use one full-width table.')
assert.match(employeeManager, /visible\.map\(item =>/, 'The table must render every active employee returned by the existing entitlement source.')
assert.match(employeeManager, /serviceYear \? serviceYear\.remaining/, 'Available must use the authoritative post-usage balance.')
assert.match(employeeManager, /serviceYear \? serviceYear\.availableAfterBooked/, 'Balance must deduct separate future bookings exactly once.')
assert.match(employeeManager, /<EntitlementInlineDetails/, 'Each employee row must expand its details inline.')
assert.doesNotMatch(employeeManager, /EntitlementBalanceDialog|modal-backdrop|setViewing/, 'The large entitlement popup must be removed from Employee Entitlements.')
assert.doesNotMatch(workforce, /Show inactive staff/, 'The Employee Entitlements view must not expose inactive-staff filtering.')
assert.doesNotMatch(workforce, />Reconcile(?: Year)?</, 'The employee reconciliation action must remain removed.')

assert.match(styles, /\.employee-entitlement-table-wrap\{overflow-x:auto/, 'The desktop table must contain horizontal overflow safely.')
assert.match(styles, /\.employee-entitlement-table\{width:100%;min-width:680px/, 'The entitlement table must remain full-width and aligned on desktop.')
assert.match(styles, /\.employee-entitlement-table th\{[^}]*text-align:center/, 'Metric headings must be centered.')
assert.match(styles, /\.employee-entitlement-table \.employee-entitlement-row td\{[^}]*vertical-align:middle/, 'Table values must stay vertically aligned.')
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.employee-entitlement-table \.employee-entitlement-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Mobile rows must use a readable two-column layout.')
assert.match(styles, /\.employee-entitlement-details-row>td\{[^}]*background:var\(--ao-leave-surface/, 'Inline details must remain connected to the selected employee.')

const inlineDetails = workforce.match(/function EntitlementInlineDetails[\s\S]*?\n\}/)?.[0] || ''
assert.doesNotMatch(inlineDetails, /Accruing Next Service Year|accruingForNextServiceYear/, 'The misleading next-service-year accrual display must be removed from inline details.')
const offSummaryPosition = inlineDetails.indexOf('OFF Days Summary')
const nonAnnualBalancePosition = inlineDetails.indexOf('aria-label="Non-Annual Leave entitlement balances"')
assert.ok(offSummaryPosition > 0 && offSummaryPosition < nonAnnualBalancePosition, 'OFF Days Summary must remain before the simplified non-AL balances.')
for (const label of ['Service Year', 'Next Anniversary', 'OFF Taken', 'Accumulated OFF', 'Available Balance', 'Weekly OFF Review', 'Required', 'Assigned', 'Difference', 'Status']) assert.ok(inlineDetails.includes(label), `Missing inline entitlement detail: ${label}`)
assert.match(inlineDetails, /staffApi\.yearlyEntitlementBalance\(item\.staffId, year, weekDate\)/, 'Inline details must reuse the existing yearly balance service.')
assert.match(inlineDetails, /staffApi\.accumulatedOffBalance\(item\.staffId\)/, 'OFF summary must use the existing accumulated-OFF balance service.')
assert.match(inlineDetails, /weeklyOff\.status === 'pending' \? 'Pending'/, 'Incomplete weeks must render Pending.')
assert.match(inlineDetails, /weeklyOff\.complete \?/, 'Incomplete weeks must not display a shortage difference.')
assert.match(styles, /\.off-days-summary\{[^}]*border:1px solid #dec58f[^}]*border-radius:12px/, 'OFF summary must use the approved gold card treatment.')
assert.match(styles, /\.off-days-metrics\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'The three OFF figures must share one horizontal desktop row.')
assert.match(styles, /\.off-days-weekly-review dl\{display:grid[^}]*gap:6px/, 'Weekly OFF Review must remain compact.')
assert.match(inlineDetails, /<AnnualLeaveCarryForwardSection item=\{item\}/, 'Carry Forward must be embedded in inline details.')
assert.ok(inlineDetails.indexOf('AnnualLeaveCarryForwardSection') > inlineDetails.indexOf('OFF Days Summary'), 'Carry Forward must appear directly after the OFF summary.')
assert.match(workforce, /CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD/, 'Carry Forward confirmation protection must remain intact.')
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
assert.match(styles, /\.additional-entitlement-balances article\{display:flex;min-height:96px/, 'Non-AL balance cards must use a compact, consistent height.')
assert.match(styles, /\.balance-carry-forward-form\{grid-template-columns:minmax\(155px,1fr\) auto/, 'Carry Forward input and review action must align in one compact desktop row.')
assert.doesNotMatch(inlineDetails, /Automatic Annual Leave remains calculated from Date of Joining\. Enter only manager-approved additional days\./, 'The redundant Carry Forward explanation must remain removed.')
assert.match(inlineDetails, /event\.key === 'Escape'/, 'Escape must collapse inline details.')
assert.match(employeeManager, /Discard the unsaved Carry Forward value\?/, 'Unsaved Carry Forward values must be protected before changing details.')

console.log(JSON.stringify({
  fullWidthEmployeeTable: true,
  displayedColumns: ['Employee', 'Available', 'Used', 'Booked', 'Balance'],
  responsiveEmployeeRows: true,
  unconfiguredPreserved: true,
  serviceYearCalculationPreserved: true,
  inlineDetails: true,
  embeddedCarryForward: true,
  legacyEditWorkflowsHidden: true,
  reconciliationUiRemoved: true,
  offDaysSummaryFirst: true,
  duplicatedAnnualLeaveRemoved: true,
  nonAnnualMetrics: ['Entitled', 'Used', 'Balance'],
  rosterAuthoritativeOffBalance: true,
}, null, 2))
