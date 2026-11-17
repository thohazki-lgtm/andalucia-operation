import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/import-preview.css', import.meta.url), 'utf8')

assert.match(css, /\.activity-import-modal \.review-edit-heading\{[^}]*border-color:#8fc3df;[^}]*background:linear-gradient\(90deg,#1c2e4c 0%,#31587b 48%,#8fc3df 100%\)/)
assert.match(css, /\.activity-import-modal \.review-edit-heading \.eyebrow\{[^}]*font-size:10px/)
assert.match(css, /\.activity-import-modal \.review-edit-heading h3\{[^}]*font-size:17px/)
assert.match(css, /\.activity-import-modal \.review-edit-heading>div>strong\{[^}]*font-size:11px/)
assert.match(css, /\.activity-import-modal \.review-edit-scroll legend\{[^}]*background:#eaf7ff;[^}]*font-size:13px;[^}]*line-height:1\.15/)

const compactDialogStyles = css.slice(css.indexOf('/* Compact blue Edit Before Import dialog. */'), css.indexOf('/* Approved gold treatment for completed manager-review decisions. */'))
assert.doesNotMatch(compactDialogStyles, /#c5a35a|#dec58f|#b99043|#fffaf0|#fffdf9/i)

console.log('Booking import edit dialog pale-blue styling verified')
