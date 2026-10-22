import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

for (const heading of ['Staff', 'Available Leave', 'Used', 'Remaining', 'Accruing', 'Booked', 'Available', 'Additional Leave', 'OFF', 'PH', 'Source', 'Actions']) {
  assert.match(workforce, new RegExp(`<th>${heading}`), `Missing ordered entitlement heading: ${heading}`)
}
const desktopActions = workforce.match(/<div className="entitlement-row-actions">([\s\S]*?)<\/div>/)?.[1] || ''
const mobileActions = workforce.match(/<div className="workforce-card-actions">([\s\S]*?)<\/div>/)?.[1] || ''
for (const action of ['Balance', 'Carry Forward', 'Edit Year', 'Settings']) {
  assert.equal((desktopActions.match(new RegExp(`>${action}<`, 'g')) || []).length, 1, `The desktop action grid must contain ${action} exactly once.`)
  assert.equal((mobileActions.match(new RegExp(`>${action}<`, 'g')) || []).length, 1, `The mobile action grid must contain ${action} exactly once.`)
}
assert.equal((desktopActions.match(/<button/g) || []).length, 4, 'The desktop action grid must contain exactly four actions.')
assert.equal((mobileActions.match(/<button/g) || []).length, 4, 'The mobile action grid must contain exactly four actions.')
assert.doesNotMatch(workforce, />Reconcile(?: Year)?</, 'The employee reconciliation action must be removed from desktop and mobile views.')
assert.doesNotMatch(workforce, /Entitlement Reconciliation Preview/, 'The manager-facing reconciliation preview must be removed.')
for (const metric of ['Available Leave', 'Used', 'Remaining', 'Accruing Next Service Year', 'Booked / Future', 'Available After Booked', 'Additional Leave', 'OFF / Week', 'PH / Year']) assert.ok(workforce.includes(metric), `Missing mobile entitlement metric: ${metric}`)

assert.match(styles, /\.entitlement-table th:first-child,.entitlement-table td:first-child\{position:sticky;left:0/, 'Employee identity must remain visible during desktop horizontal scrolling.')
assert.match(styles, /\.entitlement-table th:last-child,.entitlement-table td:last-child\{position:sticky;right:0/, 'Actions must remain visible during desktop horizontal scrolling.')
assert.match(styles, /\.entitlement-row-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Desktop actions must use a compact grid.')
assert.doesNotMatch(styles, /entitlement-reconciliation-modal|reconciliation-lines|reconciliation-evidence/, 'Reconciliation-only presentation styles must be removed.')
assert.match(styles, /@media\(max-width:1050px\)/, 'Compact desktop and tablet widths must switch to cards before excessive table scrolling.')
assert.match(styles, /\.staff-entitlements-panel \.entitlement-mobile-cards\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Tablet entitlement cards must use a two-column layout.')
assert.match(styles, /@media\(max-width:700px\)/, 'Mobile breakpoint must remain available.')
assert.match(styles, /\.staff-entitlements-panel \.entitlement-mobile-cards\{grid-template-columns:1fr\}/, 'Mobile entitlement cards must stack in one column.')
assert.match(styles, /@media\(max-width:420px\)/, 'Narrow mobile action controls must stack.')

assert.match(workforce, /displayEntitlement\(serviceYear \? serviceYear\.availableLeave/, 'Available Leave rendering must preserve Unconfigured versus zero.')
assert.match(workforce, /Automatic service year/, 'Automatic service-year status must remain visible.')
assert.match(workforce, /summary\?\.bookedFuture/, 'Booked/Future must remain separately rendered.')

console.log(JSON.stringify({
  stickyEmployeeIdentity: true,
  stickyCompactActions: true,
  orderedMetrics: 12,
  tabletCards: true,
  mobileCards: true,
  unconfiguredPreserved: true,
  serviceYearPresentationPreserved: true,
  fourActionsOnly: true,
  reconciliationUiRemoved: true,
}, null, 2))
