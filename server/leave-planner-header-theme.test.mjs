import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(theme, /\.module-leave-planner\s*\{[\s\S]*?--ao-leave-header-start:\s*#45176b;[\s\S]*?--ao-leave-header-end:\s*#80539a;[\s\S]*?--ao-leave-header-text:\s*#fff;[\s\S]*?--ao-leave-header-muted:\s*#eadff1;/)
assert.match(theme, /main\.module-leave-planner\s+:is\([\s\S]*?\.leave-planner-heading-card,[\s\S]*?\)\s*\{[\s\S]*?background:\s*linear-gradient\(135deg,\s*var\(--ao-leave-header-start\)\s*0%,\s*var\(--ao-leave-header-end\)\s*100%\)\s*!important;/)
assert.match(theme, /main\.module-leave-planner\s+:is\([\s\S]*?\.leave-planner-heading-card,[\s\S]*?\)\s+:is\([\s\S]*?h2,[\s\S]*?\.eyebrow[\s\S]*?\)\s*\{[\s\S]*?color:\s*var\(--ao-leave-header-text\)\s*!important;/)
assert.match(theme, /main\.module-leave-planner \.leave-planner-heading-card\s*\{[\s\S]*?border:\s*1px solid var\(--ao-leave-gold\)\s*!important;/)

console.log(JSON.stringify({ status: 'PASS', suite: 'leave-planner-header-theme' }))
