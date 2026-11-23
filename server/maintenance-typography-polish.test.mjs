import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(css, /Compact Maintenance typography[\s\S]*?main\.module-maintenance > \.page-header h1 \{[\s\S]*?font-size: clamp\(25px, 2\.4vw, 30px\);/, 'desktop Maintenance heading must use the compact scale')
assert.match(css, /main\.module-maintenance \.maintenance-date-control \.ao-financial-date-control__trigger \{[\s\S]*?font-size: 18px;/, 'desktop Maintenance calendar must use compact typography')
assert.match(css, /main\.module-maintenance \.maintenance-issue-trigger \{[\s\S]*?font-size: 13px;/, 'desktop issue titles must use compact typography')
assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?main\.module-maintenance > \.page-header h1 \{[\s\S]*?font-size: 23px;[\s\S]*?\.maintenance-issue-trigger\.mobile \{[\s\S]*?font-size: 12px;/, 'mobile Maintenance headings and issue titles must use the compact scale')

console.log('Maintenance typography polish verified')
