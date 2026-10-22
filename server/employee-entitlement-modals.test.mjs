import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')

for (const [title, modalClass] of [
  ['Yearly Entitlement Balance', 'entitlement-balance-modal'],
  ['HR-Approved Yearly Entitlements', 'entitlement-edit-modal'],
  ['Edit Staff Entitlements', 'entitlement-edit-modal'],
]) {
  assert.ok(workforce.includes(title), `Missing entitlement modal: ${title}`)
  assert.match(workforce, new RegExp(`modal ${modalClass}`), `${title} must retain its scoped modal class.`)
}
assert.equal((workforce.match(/aria-label="Close"/g) || []).length >= 3, true, 'All retained entitlement modals must retain accessible close controls.')
assert.doesNotMatch(workforce, /Entitlement Reconciliation Preview|entitlement-reconciliation-modal/, 'The reconciliation preview modal must be absent.')
assert.match(workforce, /Annual Leave:.*calculated automatically from Date of Joining.*manual Carry Forward/, 'Yearly editing must explain automatic Annual Leave and separate manual Carry Forward.')
assert.match(styles, /#entitlement-title~form \.entitlement-fieldset:first-of-type legend::after\{content:' · legacy policy settings'/, 'Legacy AL policy settings must be visibly distinguished from authoritative service-year evidence.')
assert.match(styles, /\.modal\.entitlement-balance-modal\{width:min\(980px,calc\(100vw - 40px\)\)\}/, 'Yearly Balance must use the wider responsive desktop modal.')
assert.match(styles, /\.modal\.entitlement-edit-modal,.modal\.entitlement-balance-modal\{box-sizing:border-box;max-height:[^}]+overflow-x:hidden;overflow-y:auto/, 'Retained entitlement modals must scroll vertically without internal horizontal overflow.')
assert.match(styles, /\.additional-entitlement-balances>div\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Yearly balance cards must use two readable desktop columns.')
assert.match(styles, /\.additional-entitlement-balances article:first-child\{grid-column:1\/-1/, 'Authoritative AL service-year evidence must have a full-width card.')
assert.match(styles, /Schema 022 service year/, 'The authoritative service-year card must be clearly identified.')
assert.match(styles, /font-variant-numeric:tabular-nums;white-space:nowrap/, 'Decimals and Unconfigured values must remain stable and readable.')
assert.match(styles, /@media\(max-width:700px\)\{[\s\S]*\.additional-entitlement-balances>div\{grid-template-columns:1fr\}/, 'Balance cards must stack on narrow mobile screens.')
assert.match(styles, /@media\(max-width:700px\)\{[\s\S]*\.additional-entitlement-balances dl\{grid-template-columns:1fr\}/, 'Card metrics must stack without clipping on narrow mobile screens.')

console.log(JSON.stringify({ retainedModalsScoped: true, reconciliationModalRemoved: true, balanceWidthResponsive: true, verticalScrollOnly: true, desktopTwoColumnCards: true, mobileSingleColumnCards: true, stableDecimalAndUnconfiguredValues: true, legacyVsServiceYearClear: true, accessibleCloseControls: true }, null, 2))
