import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/customization-center.css', import.meta.url), 'utf8')

assert.match(css, /booking-config-r2 > \.panel\.booking-config-section[\s\S]*?border-top: 4px solid #d5ad61 !important;/, 'Booking cards require a prominent gold top border')
assert.match(css, /\.training-custom-card \{[\s\S]*?border: 1px solid #d5ad61 !important;[\s\S]*?border-top: 4px solid #d5ad61 !important;/, 'Training cards require gold outlines and prominent top borders')
assert.match(css, /customization-category-panel:is\([\s\S]*?:has\(\.training-customization-r1\),[\s\S]*?:has\(\.occasion-config\),[\s\S]*?:has\(\.chargeable-config\),[\s\S]*?:has\(\.maintenance-config\),[\s\S]*?:has\(\.database-health-admin\)[\s\S]*?outline: 2px solid #d5ad61;/, 'Every customization surface requires the shared Training-style outer frame')
assert.match(css, /\.training-custom-card \{[\s\S]*?background: linear-gradient\(145deg, #edf8fc 0%, #d9edf7 100%\);/, 'Training cards require pale-blue surfaces')
assert.match(css, /\.occasion-config-card,[\s\S]*?\.chargeable-config-card,[\s\S]*?\.maintenance-config-card,[\s\S]*?\.database-health-heading,[\s\S]*?border-top: 4px solid #d5ad61 !important;[\s\S]*?background: linear-gradient\(145deg, #edf8fc 0%, #d9edf7 100%\) !important;/, 'Remaining customization cards require the shared gold and pale-blue treatment')
assert.match(css, /\.occasion-config-heading,[\s\S]*?\.chargeable-config-card \.config-heading,[\s\S]*?\.maintenance-config-heading,[\s\S]*?\.database-health-heading,[\s\S]*?background: linear-gradient\(105deg, #173e54 0%, #285f8f 100%\) !important;/, 'Customization card headers require the dark left-to-right gradient')
assert.match(css, /scrollbar-width: thin;[\s\S]*?scrollbar-color: #285f8f #cfe7f3;/, 'Customization Center requires a narrow module-colored scrollbar')
assert.match(css, /\.booking-config-section \.panel-title :is\([\s\S]*?\.compact-config-action,[\s\S]*?\.reset-walk-in[\s\S]*?\) :is\(\.ao-action__label, \.ao-icon\)[\s\S]*?color: #173e54 !important;/, 'Booking configuration header actions require readable dark labels and icons')
assert.match(css, /\.training-workflow-card \.panel-title > \.badge \{[\s\S]*?color: #173e54 !important;/, 'Training Workflow protected badge requires readable dark text')
assert.doesNotMatch(css.match(/\/\* Customization cards:[\s\S]*?(?=body:has|@media|$)/)?.[0] || '', /#fff(?:fff|df8|af0)?\b/i, 'Customization card palette must not reintroduce white card surfaces')

console.log('Customization card palette regression passed.')
