import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [ui, css, api, server] = await Promise.all([
  readFile('src/bookings.tsx', 'utf8'),
  readFile('src/booking-service.css', 'utf8'),
  readFile('src/api.ts', 'utf8'),
  readFile('server/index.ts', 'utf8')
])

assert.match(ui, /bookingApi\.dayLock\(targetDate\)/)
assert.match(ui, /booking-day-lock-status is-\$\{dayLock\.state\}/)
assert.match(ui, />Lock Day</)
assert.match(ui, /reopening \? 'Reopening…' : 'Reopen'/)
assert.match(ui, />Relock Day</)
assert.match(ui, /bookingApi\.reopenDay\(date\)/)
assert.doesNotMatch(ui, /setLockAction\('reopen'\)/)
assert.doesNotMatch(ui, /Correction window/)
assert.match(ui, /disabled=\{locked\}/)
assert.match(ui, /This Booking service day is locked and view-only/)
assert.match(ui, /className="booking-day-lock-form"/)
assert.match(css, /\.booking-day-lock-controls/)
assert.match(css, /\.booking-day-lock-status\.is-locked/)
assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.booking-day-lock-controls/)
assert.match(api, /dayLock: \(date: string\)/)
assert.match(server, /authorizedBookingDayLockManager/)
assert.match(server, /canManageBookingDayLocks[\s\S]*?outlet_manager/)

console.log('Booking day lock compact status, one-click manager reopen, responsive controls and manager API UI contract tests passed.')
