import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')
const parityBlock = theme.slice(theme.lastIndexOf('/* Incentives & Bill Tips: use the Guest Occasions calendar composition'))

for (const className of [
  'chargeable-date-controls',
  'wine-date-navigation',
  'wine-month-navigation',
  'bill-tip-month-navigation',
  'earnings-month-navigation',
  'chargeable-date-step',
  'wine-date-step',
  'wine-month-step',
  'bill-tip-month-step',
  'earnings-month-step',
  'chargeable-date-picker',
  'wine-date-control',
  'wine-month-control',
  'bill-tip-month-control',
  'earnings-month-control',
]) {
  assert.match(parityBlock, new RegExp(`\\.${className.replaceAll('-', '\\-')}`))
}

assert.match(parityBlock, /grid-template-columns: 44px minmax\(0, 1fr\) 44px/)
assert.match(parityBlock, /border: 1px solid var\(--ao-financial-gold\)/)
assert.match(parityBlock, /background: linear-gradient\(90deg, #dff3e7 0%, #f3fbf6 52%, #cfeada 100%\)/)
assert.match(parityBlock, /\.ao-financial-date-control__trigger/)
assert.match(parityBlock, /@media \(max-width: 700px\)[\s\S]*?gap: 8px/)

console.log('Incentives & Bill Tips calendar parity assertions passed.')
