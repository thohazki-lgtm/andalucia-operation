import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

test('Staff Management scrollbars use the narrow module accent treatment', () => {
  assert.match(css, /html:has\(\.app-shell > main\.module-staff-management\),[\s\S]*scrollbar-width:\s*thin;/)
  assert.match(css, /scrollbar-color:\s*#287a69\s+#e3f0e8;/)
  assert.match(css, /body:has\(\.app-shell > main\.module-staff-management\) \*::\-webkit-scrollbar\s*\{[\s\S]*?width:\s*6px;[\s\S]*?height:\s*6px;/)
  assert.match(css, /linear-gradient\(180deg,\s*#4f9c87 0%,\s*#287a69 52%,\s*#103e38 100%\)/)
  assert.match(css, /body:has\(\.app-shell > main\.module-staff-management\) \*::\-webkit-scrollbar-button\s*\{[\s\S]*?display:\s*none;/)
})

test('Staff Management mobile scrollbars narrow further without exposing the tab rail', () => {
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*?module-staff-management[\s\S]*?width:\s*5px;[\s\S]*?height:\s*5px;/)
  assert.match(css, /\.app-shell:has\(> main\.module-staff-management\) \.staff-section-tabs\s*\{[\s\S]*?scrollbar-width:\s*none;/)
  assert.match(css, /\.staff-section-tabs::\-webkit-scrollbar\s*\{[\s\S]*?display:\s*none;/)
})
