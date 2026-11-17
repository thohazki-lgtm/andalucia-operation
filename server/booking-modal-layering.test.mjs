import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/booking-service.css', import.meta.url), 'utf8')
const numberFor = pattern => Number(css.match(pattern)?.[1] || 0)

const closedDateLayer = numberFor(/\.booking-command \.booking-date-picker\{[^}]*z-index:(\d+)/)
const openDateLayer = numberFor(/\.booking-command \.booking-date-picker\.is-open\{z-index:(\d+)/)
const calendarLayer = numberFor(/\.module-bookings \.booking-date-picker \.ao-financial-picker\{[^}]*z-index:(\d+)/)
const bookingModalLayer = numberFor(/main\.module-bookings \.modal-backdrop\{z-index:(\d+)/)

assert.ok(closedDateLayer > 0)
assert.ok(openDateLayer > closedDateLayer)
assert.ok(calendarLayer > openDateLayer)
assert.ok(bookingModalLayer > calendarLayer, 'Bookings dialogs must cover the date trigger and floating calendar')

console.log('Bookings modal stacking verified')
