import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

const employeeList = workforce.match(/<div className="employee-entitlement-list"([\s\S]*?)\{!visible\.length/)?.[1] || ''
for (const heading of ['Service Year', 'Next Availability']) assert.ok(employeeList.includes(heading), `Missing compact entitlement header field: ${heading}`)
for (const metric of ['Available', 'Used', 'Remaining', 'Accruing Next Year', 'Future Booked', 'Available After Booked']) assert.ok(employeeList.includes(metric), `Missing visible entitlement metric: ${metric}`)
for (const removedMetric of ['Projected Balance', 'Additional Leave', 'Confirmed AL Used']) assert.ok(!employeeList.includes(removedMetric), `The compact entitlement list must not show ${removedMetric}.`)
const manageActions = workforce.match(/<div className="entitlement-manage-menu">([\s\S]*?)<\/div>/)?.[1] || ''
for (const action of ['Balance', 'Carry Forward', 'Edit Year', 'Settings']) {
  assert.equal((manageActions.match(new RegExp(`>${action}<`, 'g')) || []).length, 1, `The Manage menu must contain ${action} exactly once.`)
}
assert.equal((manageActions.match(/<button/g) || []).length, 4, 'The Manage menu must contain exactly four actions.')
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

console.log(JSON.stringify({
  compactEmployeeRows: true,
  displayedMetrics: 6,
  responsiveCards: true,
  unconfiguredPreserved: true,
  serviceYearPresentationPreserved: true,
  consolidatedManageActions: true,
  reconciliationUiRemoved: true,
}, null, 2))
