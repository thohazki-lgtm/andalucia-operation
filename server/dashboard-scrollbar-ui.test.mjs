import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

test('Dashboard page and internal scrollbars use the narrow gold treatment', () => {
  assert.match(theme, /html:has\(\.app-shell > main\.module-dashboard\)[\s\S]*scrollbar-width:\s*thin/)
  assert.match(theme, /scrollbar-color:\s*var\(--ao-dashboard-gold, #c9a65a\) #160923/)
  assert.match(theme, /\.app-shell:has\(> main\.module-dashboard\) \.app-sidebar::\-webkit-scrollbar/)
  assert.match(theme, /\.app-shell:has\(> main\.module-dashboard\) \.tonight-scroll::\-webkit-scrollbar/)
  assert.match(theme, /width:\s*6px;[\s\S]*height:\s*6px/)
  assert.match(theme, /background:\s*linear-gradient\(180deg, #e0c476 0%, var\(--ao-dashboard-gold, #c9a65a\) 52%, #ad853b 100%\)/)
  assert.match(theme, /@media \(max-width: 700px\)[\s\S]*width:\s*5px;[\s\S]*height:\s*5px/)
  assert.match(theme, /::\-webkit-scrollbar-button[\s\S]*display:\s*none;[\s\S]*width:\s*0;[\s\S]*height:\s*0/)
})
