import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

const employeeList = workforce.match(/<div className="employee-entitlement-list"([\s\S]*?)\{!visible\.length/)?.[1] || ''
for (const metric of ['Available AL', 'Future Booked AL', 'Accruing Next Year AL']) assert.ok(employeeList.includes(metric), `Missing compact entitlement metric: ${metric}`)
for (const removedMetric of ['Projected Balance', 'Additional Leave', 'Confirmed AL Used']) assert.ok(!employeeList.includes(removedMetric), `The compact entitlement list must not show ${removedMetric}.`)
const manageActions = workforce.match(/<div className="entitlement-manage-menu">([\s\S]*?)<\/div>/)?.[1] || ''
for (const action of ['Balance', 'Carry Forward', 'Edit Year', 'Settings']) {
  assert.equal((manageActions.match(new RegExp(`>${action}<`, 'g')) || []).length, 1, `The Manage menu must contain ${action} exactly once.`)
}
assert.equal((manageActions.match(/<button/g) || []).length, 4, 'The Manage menu must contain exactly four actions.')
assert.equal((employeeList.match(/<summary>Manage<\/summary>/g) || []).length, 1, 'Each rendered employee row must expose one Manage control.')
assert.doesNotMatch(workforce, />Reconcile(?: Year)?</, 'The employee reconciliation action must be removed from desktop and mobile views.')
assert.doesNotMatch(workforce, /Entitlement Reconciliation Preview/, 'The manager-facing reconciliation preview must be removed.')

assert.match(styles, /\.employee-entitlement-row\{display:grid;grid-template-columns:minmax\(190px,1\.35fr\) minmax\(0,2fr\) auto/, 'Desktop employee entitlements must use one compact horizontal row.')
assert.match(styles, /\.employee-entitlement-metrics\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'The three approved values must share a balanced desktop row.')
assert.match(styles, /\.entitlement-manage-menu\{position:absolute/, 'Existing actions must be consolidated in one Manage menu.')
assert.doesNotMatch(styles, /entitlement-reconciliation-modal|reconciliation-lines|reconciliation-evidence/, 'Reconciliation-only presentation styles must be removed.')
assert.match(styles, /@media\(max-width:700px\)/, 'Mobile breakpoint must remain available.')
assert.match(styles, /\.employee-entitlement-row\{grid-template-columns:minmax\(0,1fr\) auto/, 'Mobile entitlement cards must preserve identity and Manage alignment without overflow.')

assert.match(workforce, /displayEntitlement\(serviceYear \? serviceYear\.availableLeave/, 'Available Leave rendering must preserve Unconfigured versus zero.')
assert.match(workforce, /summary\?\.bookedFuture/, 'Booked/Future must remain separately rendered.')

console.log(JSON.stringify({
  compactEmployeeRows: true,
  displayedMetrics: 3,
  responsiveCards: true,
  unconfiguredPreserved: true,
  serviceYearPresentationPreserved: true,
  consolidatedManageActions: true,
  reconciliationUiRemoved: true,
}, null, 2))
