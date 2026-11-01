import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(theme, /\.module-leave-planner\s*\{[\s\S]*--ao-leave-gold:\s*#c5a35a;/)
assert.match(theme, /main\.module-leave-planner \.leave-planner-panel\s*\{[\s\S]*?border-color:\s*var\(--ao-leave-gold\) !important;/)
assert.match(theme, /main\.module-leave-planner \.leave-command-panel\s*\{[\s\S]*?border:\s*1px solid var\(--ao-leave-gold\) !important;/)
assert.match(theme, /main\.module-leave-planner \.leave-summary-card\s*\{[\s\S]*?height:\s*100%;[\s\S]*?border-color:\s*var\(--ao-leave-gold\);/)
assert.match(theme, /main\.module-leave-planner \.leave-planner-grid-wrap\s*\{[\s\S]*?border:\s*1px solid var\(--ao-leave-gold\) !important;[\s\S]*?border-top-width:\s*2px !important;/)
assert.match(theme, /main\.module-leave-planner \.leave-planner-grid :is\(th, td\)\s*\{[\s\S]*?border-color:\s*var\(--ao-leave-grid-gold\);/)
assert.match(theme, /main\.module-leave-planner \.leave-planner-grid tbody tr:nth-child\(odd\) > :is\(th, td\)\s*\{[\s\S]*?background:\s*#fffdf9;/)
assert.match(theme, /main\.module-leave-planner \.leave-planner-grid tbody tr:nth-child\(even\) > :is\(th, td\)\s*\{[\s\S]*?background:\s*var\(--ao-leave-row-alt\);/)

console.log(JSON.stringify({ status: 'PASS', suite: 'leave-planner-gold-ui' }))
