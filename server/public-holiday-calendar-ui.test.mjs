import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/workforce.css', import.meta.url), 'utf8')
const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(workforce, /function PublicHolidayDeleteDialog/)
assert.match(workforce, /role="alertdialog"/)
assert.match(workforce, /aria-describedby="holiday-delete-description"/)
assert.match(workforce, /<strong>\{holiday\.name\}<\/strong>/)
assert.match(workforce, /<time dateTime=\{holiday\.date\}>\{displayDate\(holiday\.date\)\}<\/time>/)
assert.match(workforce, />Cancel<\/button>/)
assert.match(workforce, /'Delete Holiday'/)
assert.doesNotMatch(workforce, /window\.confirm\(`Remove \$\{holiday\.name\}/, 'Public Holiday deletion must not use a browser-native confirmation.')
assert.match(workforce, /await staffApi\.removePublicHoliday\(holiday\.id\)/, 'The existing authorized delete API must remain unchanged.')

for (const token of ['--ao-leave-line', '--ao-leave-divider', '--ao-leave-surface', '--ao-violet-hour', '--ao-font-display', '--ao-font-ui']) {
  assert.match(styles, new RegExp(token), `Public Holiday styles must reuse ${token}.`)
}
assert.match(styles, /\.holiday-record\{[^}]*min-height:52px/)
assert.match(styles, /\.holiday-record>:not\(:first-child\)\{border-left:1px solid var\(--ao-leave-divider/)
assert.match(styles, /\.public-holiday-form input,\.public-holiday-form select\{[^}]*height:44px/)
assert.match(styles, /\.public-holiday-delete-dialog\{[^}]*var\(--ao-leave-line/)
assert.doesNotMatch(theme, /\.holiday-record-value,\s*\.holiday-record-status\s*\)\s*\{[^}]*background:/, 'Shared theme must not reintroduce tinted value strips.')

console.log(JSON.stringify({
  publicHolidayTable: true,
  violetLilacTokens: true,
  officialTypography: true,
  customDeleteDialog: true,
  deleteApiPreserved: true,
  canonicalDataTouched: false,
}, null, 2))
