import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

for (const [title, modalClass] of [
  ['HR-Approved Yearly Entitlements', 'entitlement-edit-modal'],
  ['Edit Staff Entitlements', 'entitlement-edit-modal'],
]) {
  assert.ok(workforce.includes(title), `Missing entitlement modal: ${title}`)
  assert.match(workforce, new RegExp(`modal ${modalClass}`), `${title} must retain its scoped modal class.`)
}
assert.equal((workforce.match(/aria-label="Close"/g) || []).length >= 2, true, 'All retained entitlement modals must retain accessible close controls.')
assert.doesNotMatch(workforce, /Entitlement Reconciliation Preview|entitlement-reconciliation-modal/, 'The reconciliation preview modal must be absent.')
assert.match(workforce, /Annual Leave:.*Lifetime availability is calculated automatically from completed service months and confirmed Duty Roster usage/, 'Yearly editing must explain automatic lifetime Annual Leave.')
assert.doesNotMatch(workforce, /AnnualLeaveCarryForwardSection|Review Carry Forward/, 'Manual Annual Leave carry-forward controls must be retired.')
assert.match(styles, /#entitlement-title~form \.entitlement-fieldset:first-of-type legend::after\{content:' · legacy policy settings'/, 'Legacy AL policy settings must be visibly distinguished from authoritative service-year evidence.')
assert.match(styles, /\.modal\.entitlement-edit-modal,.modal\.entitlement-balance-modal\{box-sizing:border-box;max-height:[^}]+overflow-x:hidden;overflow-y:auto/, 'Retained entitlement modals must scroll vertically without internal horizontal overflow.')
assert.match(styles, /\.additional-entitlement-balances>div\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Yearly balance cards must use two readable desktop columns.')
assert.match(workforce, /yearlyLeave\.filter\(line => line\.classification !== 'annualLeave'\)/, 'The Balance window must preserve only the eight non-AL balance cards.')
assert.match(styles, /font-variant-numeric:tabular-nums;white-space:nowrap/, 'Decimals and Unconfigured values must remain stable and readable.')
assert.match(styles, /@media\(max-width:700px\)\{[\s\S]*\.additional-entitlement-balances>div\{grid-template-columns:1fr\}/, 'Balance cards must stack on narrow mobile screens.')
assert.match(styles, /\.additional-entitlement-balances dl\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'Entitled, Used, and Balance must stay aligned within each card.')

console.log(JSON.stringify({ retainedModalsScoped: true, reconciliationModalRemoved: true, inlineBalanceResponsive: true, verticalScrollOnly: true, desktopTwoColumnCards: true, mobileSingleColumnCards: true, stableDecimalAndUnconfiguredValues: true, legacyVsServiceYearClear: true, accessibleCloseControls: true }, null, 2))
