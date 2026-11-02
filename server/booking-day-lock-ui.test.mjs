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
assert.match(ui, />Reopen Day</)
assert.match(ui, />Relock Day</)
assert.match(ui, /const expected = `\$\{verb\} BOOKINGS \$\{date\}`/)
assert.match(ui, /disabled=\{locked\}/)
assert.match(ui, /This Booking service day is locked and view-only/)
assert.match(ui, /className="booking-day-lock-form"/)
assert.match(css, /\.booking-day-lock-controls/)
assert.match(css, /\.booking-day-lock-status\.is-locked/)
assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.booking-day-lock-controls/)
assert.match(api, /dayLock: \(date: string\)/)
assert.match(server, /authorizedBookingDayLockManager/)
assert.match(server, /canManageBookingDayLocks[\s\S]*?outlet_manager/)

console.log('Booking day lock compact status, custom confirmation, responsive controls and manager API UI contract tests passed.')
