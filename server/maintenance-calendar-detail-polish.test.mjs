import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const component = await readFile(new URL('../src/maintenance.tsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

const headingIndex = component.indexOf('className="maintenance-toolbar-heading"')
const calendarIndex = component.indexOf('className="maintenance-date-navigation"')
const addIndex = component.indexOf('className="maintenance-add-action"')

assert.ok(headingIndex >= 0 && calendarIndex > headingIndex && addIndex > calendarIndex, 'Maintenance heading, calendar, and add action must follow the approved order')
assert.match(component, /maintenance-toolbar-heading"><h2>Maintenance Issues<\/h2><\/div>/, 'Maintenance heading must not contain the add action')
assert.match(css, /Maintenance calendar parity with Guest Occasions[\s\S]*?maintenance-date-navigation \{[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\) 44px;/, 'Maintenance calendar must keep separate navigation arrows')
assert.match(css, /maintenance-date-control \.ao-financial-date-control__trigger \{[\s\S]*?background: linear-gradient\(90deg, #d7effb 0%, #edf8ff 52%, #c4e5f5 100%\);/, 'Maintenance date field must use the approved light-blue treatment')
assert.match(css, /maintenance-add-action \{[\s\S]*?width: 100%;[\s\S]*?margin-top: 10px;/, 'Add Maintenance Issue must be a full-width action below the calendar')
assert.match(css, /maintenance-details-modal \.maintenance-detail-hero h3 \{[\s\S]*?font-size: 17px;/, 'Maintenance detail title must use compact desktop typography')
assert.match(css, /maintenance-details-modal \.maintenance-detail-section dd \{[\s\S]*?font-size: 11px;/, 'Maintenance detail values must use compact desktop typography')
assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?maintenance-details-modal \.maintenance-detail-hero h3 \{[\s\S]*?font-size: 15px;/, 'Maintenance detail title must use compact mobile typography')
assert.match(css, /Maintenance summary labels[\s\S]*?maintenance-summary article::before \{[\s\S]*?content: none;[\s\S]*?display: none;/, 'Maintenance summary cards must not show the decorative top accent')
assert.match(css, /Maintenance summary labels[\s\S]*?maintenance-summary span \{[\s\S]*?font-size: 12px;[\s\S]*?@media \(max-width: 700px\) \{[\s\S]*?maintenance-summary span \{[\s\S]*?font-size: 11px;/, 'Maintenance summary labels must use the clearer desktop and mobile scale')
assert.match(css, /Maintenance summary: aligned edges[\s\S]*?maintenance-summary article \{[\s\S]*?width: 100%;[\s\S]*?margin: 0;/, 'Maintenance summary cards must remove the generic panel margin')
assert.match(css, /Maintenance summary: aligned edges[\s\S]*?@media \(max-width: 700px\) \{[\s\S]*?maintenance-summary \{[\s\S]*?width: 100%;[\s\S]*?margin: 0 0 6px;[\s\S]*?column-gap: 6px;[\s\S]*?row-gap: 6px;/, 'Mobile Maintenance summary must align with the panels above and below while keeping compact gaps')
assert.match(css, /Maintenance status: an in-card dropdown[\s\S]*?maintenance-status-menu \{[\s\S]*?border: 1px solid var\(--ao-maintenance-gold\);[\s\S]*?background: linear-gradient\(145deg, #edf8ff 0%, #d8effb 100%\);/, 'Maintenance status options must use the polished blue-and-gold card menu')
assert.match(css, /maintenance-status-menu > button\.selected \{[\s\S]*?background: linear-gradient\(105deg, #1c2e4c 0%, #31587b 58%, #478dba 100%\);[\s\S]*?color: #fff;/, 'Selected Maintenance status must use the approved gradient emphasis')
assert.match(css, /Maintenance status: an in-card dropdown[\s\S]*?panel\.maintenance-panel \{[\s\S]*?overflow: visible;/, 'Maintenance panel must not clip the open status option cards')
assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?maintenance-status-menu \{[\s\S]*?top: auto;[\s\S]*?bottom: calc\(100% \+ 6px\);/, 'Mobile Maintenance status options must open upward into the visible card area')

console.log('Maintenance calendar and detail typography polish verified')
