import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [serverSource, bookingSource, customizationCss] = await Promise.all([
  readFile(new URL('./index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/bookings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/customization-center.css', import.meta.url), 'utf8'),
])

assert.match(serverSource, /group !== 'tableRanges' && \(!input\.value\?\.trim\(\) \|\| !input\.label\?\.trim\(\)\)/, 'table ranges must not require generic configuration code and label fields')
assert.doesNotMatch(bookingSource, /Choose any first and last table from 1–100/, 'redundant table-range wording must be removed')
assert.match(customizationCss, /customization-category-panel:has\(\.booking-config-r2\)[\s\S]*?outline: 2px solid #d5ad61;/, 'Booking customization main card must have a gold outline')

console.log('Booking table range polish regression passed.')
