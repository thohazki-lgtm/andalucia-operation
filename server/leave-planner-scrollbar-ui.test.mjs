import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(css, /html:has\(\.app-shell > main\.module-leave-planner\)\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*#6d3f88 #eadff1;/s)
assert.match(css, /html:has\(\.app-shell > main\.module-leave-planner\)::\-webkit-scrollbar,[\s\S]*?body:has\(\.app-shell > main\.module-leave-planner\)::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;/s)
assert.match(css, /html:has\(\.app-shell > main\.module-leave-planner\)::\-webkit-scrollbar-thumb,[\s\S]*?border:\s*1px solid #c5a35a;[^}]*border-radius:\s*999px;[^}]*linear-gradient\(180deg, #80539a 0%, #45176b 100%\)/s)
assert.match(css, /main\.module-leave-planner \.leave-planner-grid-wrap\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--ao-leave-scrollbar\) var\(--ao-leave-scrollbar-track\);/s)
assert.match(css, /main\.module-leave-planner \.leave-planner-grid-wrap::\-webkit-scrollbar\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;/s)
assert.match(css, /main\.module-leave-planner \.leave-planner-grid-wrap::\-webkit-scrollbar-thumb\s*\{[^}]*min-width:\s*48px;[^}]*border:\s*1px solid var\(--ao-leave-gold\);[^}]*border-radius:\s*999px;[^}]*linear-gradient\(90deg,/s)

console.log('Leave Planner native page and calendar scrollbars use the narrow violet/gold module treatment.')
