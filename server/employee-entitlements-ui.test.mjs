import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

const employeeList = workforce.match(/<div className="employee-entitlement-list"([\s\S]*?)\{!visible\.length/)?.[1] || ''
for (const heading of ['Service Year', 'Next Availability']) assert.ok(employeeList.includes(heading), `Missing compact entitlement header field: ${heading}`)
for (const metric of ['Available', 'Used', 'Remaining', 'Accruing Next Year', 'Future Booked', 'Available After Booked']) assert.ok(employeeList.includes(metric), `Missing visible entitlement metric: ${metric}`)
for (const removedMetric of ['Projected Balance', 'Additional Leave', 'Confirmed AL Used']) assert.ok(!employeeList.includes(removedMetric), `The compact entitlement list must not show ${removedMetric}.`)
const manageActions = workforce.match(/<div className="entitlement-manage-menu">([\s\S]*?)<\/div>/)?.[1] || ''
assert.equal((manageActions.match(/>Leave Balance</g) || []).length, 1, 'The Manage menu must contain Leave Balance exactly once.')
assert.equal((manageActions.match(/<button/g) || []).length, 1, 'The Manage menu must contain exactly one action.')
for (const removedAction of ['Carry Forward', 'Edit Year', 'Settings']) assert.ok(!manageActions.includes(`>${removedAction}<`), `The Manage menu must not expose ${removedAction}.`)
assert.equal((employeeList.match(/<summary>Manage<\/summary>/g) || []).length, 1, 'Each rendered employee row must expose one Manage control.')
assert.doesNotMatch(workforce, />Reconcile(?: Year)?</, 'The employee reconciliation action must be removed from desktop and mobile views.')
assert.doesNotMatch(workforce, /Entitlement Reconciliation Preview/, 'The manager-facing reconciliation preview must be removed.')

assert.match(styles, /\.staff-entitlements-panel \.employee-entitlement-row\{display:block/, 'Each employee must use one full-width compact card.')
assert.match(styles, /\.staff-entitlements-panel \.employee-entitlement-header\{display:grid;grid-template-columns:minmax\(170px,1\.15fr\)/, 'Desktop cards must keep identity, service-year context, and Manage in one header.')
assert.match(styles, /\.staff-entitlements-panel \.employee-entitlement-metrics\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/, 'All six AL figures must share one desktop row.')
assert.match(styles, /@media\(max-width:1050px\).*?\.staff-entitlements-panel \.employee-entitlement-metrics\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/s, 'Tablet cards must use three metric columns.')
assert.match(styles, /\.entitlement-manage-menu\{position:absolute/, 'Existing actions must be consolidated in one Manage menu.')
assert.doesNotMatch(styles, /entitlement-reconciliation-modal|reconciliation-lines|reconciliation-evidence/, 'Reconciliation-only presentation styles must be removed.')
assert.match(styles, /@media\(max-width:700px\)/, 'Mobile breakpoint must remain available.')
assert.match(styles, /@media\(max-width:700px\).*?\.staff-entitlements-panel \.employee-entitlement-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s, 'Mobile entitlement cards must use two metric columns without overflow.')

assert.match(workforce, /displayEntitlement\(serviceYear \? serviceYear\.availableLeave/, 'Available Leave rendering must preserve Unconfigured versus zero.')
assert.match(workforce, /summary\?\.bookedFuture/, 'Booked/Future must remain separately rendered.')
const offSummaryPosition = workforce.indexOf('OFF Days Summary')
const nonAnnualBalancePosition = workforce.indexOf('aria-label="Non-Annual Leave entitlement balances"')
assert.ok(offSummaryPosition > 0 && offSummaryPosition < nonAnnualBalancePosition, 'OFF Days Summary must remain before the simplified non-AL balances.')
for (const label of ['OFF Taken', 'Accumulated OFF', 'Available Balance', 'Weekly OFF Review', 'Required', 'Assigned', 'Difference', 'Status']) assert.ok(workforce.includes(label), `Missing OFF summary label: ${label}`)
assert.match(workforce, /staffApi\.accumulatedOffBalance\(item\.staffId\)/, 'OFF summary must use the existing accumulated-OFF balance service.')
assert.match(workforce, /weeklyOff\.status === 'pending' \? 'Pending'/, 'Incomplete weeks must render Pending.')
assert.match(workforce, /weeklyOff\.complete \?/, 'Incomplete weeks must not display a shortage difference.')
assert.match(styles, /\.off-days-summary\{[^}]*border:1px solid #dec58f[^}]*border-radius:12px/, 'OFF summary must use the approved gold card treatment.')
assert.match(styles, /\.off-days-metrics\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'The three OFF figures must share one horizontal desktop row.')
assert.match(styles, /\.off-days-weekly-review dl\{display:grid[^}]*gap:7px/, 'Weekly OFF Review must remain compact.')
const balanceDialog = workforce.match(/function EntitlementBalanceDialog[\s\S]*?\n\}/)?.[0] || ''
assert.match(balanceDialog, /<AnnualLeaveCarryForwardSection item=\{item\}/, 'Carry Forward must be embedded in Leave Balance.')
assert.ok(balanceDialog.indexOf('AnnualLeaveCarryForwardSection') > balanceDialog.indexOf('OFF Days Summary'), 'Carry Forward must appear directly after the OFF summary.')
assert.match(workforce, /CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD/, 'Carry Forward confirmation protection must remain intact.')
const employeeManager = workforce.match(/export function StaffEntitlementsManager[\s\S]*?\n\}/)?.[0] || ''
assert.doesNotMatch(employeeManager, /<EntitlementForm|<YearlyEntitlementForm|AnnualLeaveCarryForwardForm/, 'Legacy entitlement edit workflows must not remain exposed in Employee Entitlements.')
assert.match(balanceDialog, /yearlyLeave\.filter\(line => line\.classification !== 'annualLeave'\)/, 'The duplicated Annual Leave card must be excluded from the Balance dialog.')
assert.match(balanceDialog, /<dt>Entitled<\/dt>/)
assert.match(balanceDialog, /<dt>Booked<\/dt>/)
assert.match(balanceDialog, /<dt>Balance<\/dt>/)
for (const removedMetric of ['Accrued', 'Carried Forward', 'Used', 'Available After Booked']) assert.ok(!balanceDialog.includes(`<dt>${removedMetric}</dt>`), `The Balance dialog must not render ${removedMetric}.`)
assert.match(balanceDialog, /availableAfterBooked \?\? line\.remaining/, 'The simplified Balance must reuse the existing calculated post-booking balance with the existing remaining-balance fallback.')
assert.match(styles, /\.additional-entitlement-balances>div\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Non-AL cards must use two desktop columns.')
assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.additional-entitlement-balances>div\{grid-template-columns:1fr\}/, 'Non-AL cards must stack on mobile.')
assert.match(styles, /\.additional-entitlement-balances dl\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'Each non-AL card must keep Entitled, Booked, and Balance in one row.')

console.log(JSON.stringify({
  compactEmployeeRows: true,
  displayedMetrics: 6,
  responsiveCards: true,
  unconfiguredPreserved: true,
  serviceYearPresentationPreserved: true,
  consolidatedManageActions: true,
  embeddedCarryForward: true,
  legacyEditWorkflowsHidden: true,
  reconciliationUiRemoved: true,
  offDaysSummaryFirst: true,
  duplicatedAnnualLeaveRemoved: true,
  nonAnnualMetrics: ['Entitled', 'Booked', 'Balance'],
  rosterAuthoritativeOffBalance: true,
}, null, 2))
