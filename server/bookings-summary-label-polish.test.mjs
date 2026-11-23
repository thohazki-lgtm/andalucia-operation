import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(css, /Bookings summary labels[\s\S]*?booking-service-overview \.service-summary > \.panel > span \{[\s\S]*?font-size: 12px;/, 'Booking summary labels must use the clearer desktop scale')
assert.match(css, /Bookings summary labels[\s\S]*?@media \(max-width: 700px\) \{[\s\S]*?booking-service-overview \.service-summary > \.panel > span \{[\s\S]*?font-size: 11px;/, 'Booking summary labels must use the clearer mobile scale')
assert.match(css, /Bookings summary labels[\s\S]*?@media \(max-width: 700px\) \{[\s\S]*?main\.module-bookings \.booking-command \{[\s\S]*?gap: 6px;[\s\S]*?row-gap: 6px;/, 'Booking calendar and action rows must use the compact mobile gap')
assert.match(css, /booking-command > \.booking-command-actions \{[\s\S]*?margin-top: 0;/, 'Booking action row must not add extra top spacing')

console.log('Bookings summary-card label typography verified')
