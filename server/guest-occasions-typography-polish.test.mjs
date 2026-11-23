import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(css, /Compact Guest Occasions typography[\s\S]*?> \.page-header h1 \{[\s\S]*?font-size: clamp\(25px, 2\.4vw, 30px\);/, 'desktop page title must use the compact scale')
assert.match(css, /\.occasion-summary-card strong \{[\s\S]*?font-size: 18px;/, 'summary figures must use compact typography')
assert.match(css, /:is\(\.occasion-table, \.attention-table\) td \{[\s\S]*?font-size: 10\.5px;/, 'desktop record tables must use compact typography')
assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?> \.page-header h1 \{[\s\S]*?font-size: 23px;[\s\S]*?\.mobile-attention-card\) :is\(\.mobile-occasion-guest-trigger, \.mobile-attention-guest-trigger\) \{[\s\S]*?font-size: 12px;/, 'mobile titles and guest names must use the compact scale')

console.log('Guest Occasions typography polish verified')
