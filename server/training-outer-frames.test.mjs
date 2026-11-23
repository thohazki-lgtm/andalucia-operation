import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../src/training-r2.tsx', import.meta.url), 'utf8')
const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

assert.match(page, /className="training-r2-overview-frame"[\s\S]*?className="training-r2-toolbar"[\s\S]*?className="training-r2-period"[\s\S]*?<TrainingKpis[\s\S]*?className="panel training-next"/, 'Training overview controls and cards must share the first outer frame')
assert.match(page, /className="training-r2-schedule-frame"[\s\S]*?training-r2-view--calendar[\s\S]*?<TrainingList/, 'Calendar and list views must share the second outer frame')
assert.match(theme, /\.training-r2-overview-frame,[\s\S]*?\.training-r2-schedule-frame[\s\S]*?border: 2px solid var\(--ao-training-gold\) !important;[\s\S]*?background: color-mix\(in srgb, var\(--ao-training-surface\) 88%, transparent\);/, 'Both Training outer frames must use the approved gold and mint treatment')
assert.match(theme, /@media \(max-width: 430px\)[\s\S]*?\.training-r2-overview-frame,[\s\S]*?\.training-r2-schedule-frame[\s\S]*?padding: 10px;/, 'Training outer frames must retain compact mobile spacing')

console.log(JSON.stringify({ outerFrames: 2, overviewGrouped: true, scheduleGrouped: true, responsive: true }, null, 2))
