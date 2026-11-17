import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/booking-service.css', import.meta.url), 'utf8')
const corporateCss = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')
const bookings = await readFile(new URL('../src/bookings.tsx', import.meta.url), 'utf8')

const tablet = css.match(/@media\(max-width:900px\) and \(min-width:701px\)\{([\s\S]*?)\n\}/)?.[1] || ''
const mobile = [...css.matchAll(/@media\(max-width:700px\)\{([\s\S]*?)\n\}/g)]
  .map(match => match[1])
  .find(section => section.includes('.booking-command{display:grid')) || ''

assert.match(tablet, /grid-template-areas:"copy" "navigation" "actions"/)
assert.match(tablet, /\.booking-command-actions\{display:grid;width:100%/)
assert.match(mobile, /grid-template-areas:"copy" "navigation" "actions"/)
assert.match(corporateCss, /@media \(max-width: 900px\) and \(min-width: 701px\)[\s\S]*?"copy"\s*"navigation"\s*"actions"/)
assert.match(corporateCss, /@media \(max-width: 700px\)[\s\S]*?main\.module-bookings \.booking-command[\s\S]*?"copy"\s*"navigation"\s*"actions"/)
assert.match(
  css,
  /\.mobile-booking-list \.mobile-operation-card>header\{align-items:center;margin:-13px -13px 10px;padding:11px 12px 10px;border-bottom:1px solid #9fcce4;border-radius:8px 8px 0 0;background:#cfefff\}/,
  'mobile booking guest-name headers must use the light-blue treatment',
)
assert.match(
  css,
  /\.module-bookings \.mobile-booking-list \.mobile-operation-card \.mobile-card-facts small,[\s\S]*?\.module-bookings \.mobile-booking-list \.mobile-operation-card \.mobile-card-fields>label\{color:#244b64;font-weight:800!important\}/,
  'mobile booking operational wording must use visible extra-bold emphasis',
)
assert.match(
  css,
  /\.booking-member-cards dl\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:4px 6px;margin:0\}/,
  'linked guest cards must use a compact three-column detail grid',
)
assert.match(
  bookings,
  /<div><dt>Birth<\/dt>[\s\S]*?<div><dt>Meal plan<\/dt>[\s\S]*?<div><dt>Arrival<\/dt>/,
  'meal plan must occupy the right column before the second detail row',
)
assert.match(
  css,
  /@media \(max-width:700px\)[\s\S]*?\.booking-edit-modal \.booking-form-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); gap:6px; \}[\s\S]*?\.booking-edit-modal \.booking-form-grid>label:last-child:nth-child\(odd\) \{ grid-column:1\/-1; \}/,
  'mobile Edit Booking fields must use compact paired columns with the final unmatched field spanning the row',
)
assert.match(
  css,
  /\.booking-guest-trigger b\{min-width:0;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap\}/,
  'booking guest names must display in uppercase across desktop and mobile views',
)
assert.match(
  css,
  /\.mobile-booking-list \.booking-guest-trigger b\{font-size:14px;line-height:1\.15\}/,
  'mobile booking guest names must use the reduced compact size',
)
assert.match(bookings, /guestOccasionApi\.experience\(targetDate\)[\s\S]*?experience\.attention/)
assert.match(bookings, /item\.normalizedKey === 'GUEST_ATTENTION_TLC'/)
assert.match(bookings, /className="occasion-chip booking-info-pill booking-tlc-pill">TLC<\/span>/)
assert.match(
  css,
  /\.booking-tlc-pill\{border-color:#55a9d0!important;background:#e4eff4!important;color:#23678c!important\}/,
  'booking sheets must display authoritative TLC findings as a blue pill',
)

console.log('Bookings responsive toolbar layout verified')
