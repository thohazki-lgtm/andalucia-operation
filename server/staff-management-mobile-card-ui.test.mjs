import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')

test('mobile staff cards align the profile action with the duty information', () => {
  assert.match(app, /<div className="staff-mobile-duty"><dt>Today<\/dt>[\s\S]*?<div className="staff-mobile-profile-action"><dt>Profile<\/dt>/)
  assert.doesNotMatch(app, /<\/dl><div className="staff-row-icon-actions"><IconAction icon="user" label={`View profile for \$\{person\.name\}`}/)
  assert.match(css, /\.staff-mobile-card dl\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"profile duty \.";/)
  assert.match(css, /\.staff-mobile-duty\s*\{[\s\S]*?grid-area:\s*duty;[\s\S]*?justify-self:\s*center;[\s\S]*?text-align:\s*center;/)
  assert.match(css, /\.staff-mobile-profile-action dd\s*\{[\s\S]*?justify-content:\s*center;/)
  assert.match(css, /\.staff-mobile-profile-action\s*\{[\s\S]*?grid-area:\s*profile;[\s\S]*?justify-self:\s*start;/)
})

test('mobile staff card headers use the compact Staff Management fade', () => {
  assert.match(css, /\.staff-mobile-card > header\s*\{[\s\S]*?padding:\s*10px 9px;/)
  assert.match(css, /background:\s*linear-gradient\(90deg, var\(--ao-staff-emerald-deep\) 0%, var\(--ao-staff-emerald\) 58%, #8fc3a8 100%\);/)
  assert.match(css, /\.staff-mobile-card\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?padding:\s*0;/)
  assert.match(css, /\.staff-mobile-card dl\s*\{[\s\S]*?padding:\s*9px 9px 10px;/)
})

test('mobile Team Directory cards use the compact light green treatment', () => {
  assert.match(css, /\.staff-directory-page \.staff-tools\s*\{[\s\S]*?margin:\s*4px 4px 9px;/)
  assert.match(css, /\.staff-mobile-cards\s*\{[\s\S]*?padding:\s*10px 4px;/)
  assert.match(css, /\.staff-mobile-card\s*\{[\s\S]*?background:\s*var\(--ao-staff-surface-strong\);/)
  assert.match(css, /\.staff-summary > \.panel[\s\S]*?background:\s*var\(--ao-staff-surface-strong\);/)
  assert.match(css, /\.staff-summary strong\s*\{[\s\S]*?font-family:\s*var\(--ao-font-ui\);/)
  assert.match(css, /\.staff-summary strong \.staff-summary-zero\s*\{[\s\S]*?font-family:\s*inherit;/)
})

test('Team Directory uses the approved compact typography on desktop and mobile', () => {
  assert.match(css, /main\.module-staff-management > \.page-header h1\s*\{[\s\S]*?font-size:\s*25px;/)
  assert.match(css, /\.staff-section-bar \.staff-section-tabs button,[\s\S]*?\.staff-section-add\s*\{[\s\S]*?font-size:\s*10px;/)
  assert.match(css, /\.staff-directory-page \.staff-summary strong\s*\{[\s\S]*?font-size:\s*17px;/)
  assert.match(css, /\.staff-directory-page \.staff-table th\s*\{[\s\S]*?font-size:\s*9px;/)
  assert.match(css, /\.staff-directory-page \.staff-table td\s*\{[\s\S]*?font-size:\s*10\.5px;/)
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?main\.module-staff-management > \.page-header h1\s*\{[\s\S]*?font-size:\s*23px;[\s\S]*?\.staff-mobile-card > header b\s*\{[\s\S]*?font-size:\s*12px;[\s\S]*?\.staff-mobile-card dd\s*\{[\s\S]*?font-size:\s*10px;/)
})

test('Team Directory filters stay simple and accessible without visible headings', () => {
  assert.doesNotMatch(app, /<span>Search team<\/span>/)
  assert.doesNotMatch(app, /<span>Designation<\/span>/)
  assert.doesNotMatch(app, /<span>Employment status<\/span>/)
  assert.doesNotMatch(app, /<span>Sort team<\/span>/)
  assert.match(app, /aria-label="Search staff"/)
  assert.match(app, /label="Filter by position"/)
  assert.match(app, /label="Filter by employment status"/)
  assert.match(app, /label="Sort staff"/)
  assert.match(css, /\.staff-summary strong \.staff-summary-zero\s*\{[\s\S]*?font-size:\s*inherit;/)
  assert.match(css, /\.staff-control-card\s*\{[\s\S]*?align-content:\s*center;/)
})

test('mobile staff profile uses a compact two-column layout', () => {
  assert.match(css, /\.staff-profile-drawer > \.staff-profile-header\s*\{[\s\S]*?padding:\s*12px 14px 11px;/)
  assert.match(css, /\.staff-profile-scroll\s*\{[\s\S]*?padding:\s*8px 10px;/)
  assert.match(css, /\.staff-profile-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap:\s*5px;/)
  assert.match(css, /\.leave-summary-cards article\s*\{[\s\S]*?min-height:\s*50px;[\s\S]*?padding:\s*7px;/)
  assert.match(css, /\.staff-training-summary article\s*\{[\s\S]*?padding:\s*7px;/)
})

test('mobile staff profile uses the same native emerald scrollbar as desktop', () => {
  assert.match(app, /className="staff-profile-scroll"/)
  assert.doesNotMatch(app, /staff-profile-scroll-indicator/)
  assert.doesNotMatch(app, /profileScrollIndicator|staffProfileScrollThumb|staffProfileScrollTopForPointer/)
  assert.match(css, /body:has\(\.app-shell > main\.module-staff-management\) \*::\-webkit-scrollbar\s*\{[\s\S]*?width:\s*6px;/)
  assert.match(css, /body:has\(\.app-shell > main\.module-staff-management\) \*::\-webkit-scrollbar-thumb\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?background:\s*linear-gradient\(180deg, #4f9c87 0%, #287a69 52%, #103e38 100%\);/)
  assert.match(css, /\.staff-profile-scroll\s*\{[\s\S]*?overflow-y:\s*scroll;[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?touch-action:\s*pan-y;[\s\S]*?\-webkit-overflow-scrolling:\s*touch;[\s\S]*?scrollbar-gutter:\s*stable;/)
  assert.doesNotMatch(css, /staff-profile-scroll-indicator/)
})

test('mobile staff profile is narrower and uses green surfaces throughout', () => {
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.staff-profile-drawer\s*\{[\s\S]*?align-items:\s*stretch;[\s\S]*?width:\s*min\(480px, calc\(100vw - 28px\)\);[\s\S]*?height:\s*calc\(100dvh - 20px\);[\s\S]*?background:\s*var\(--ao-staff-surface-strong\);/)
  assert.match(css, /\.staff-profile-scroll-content > section,[\s\S]*?\.staff-training-history\s*\{[\s\S]*?background:\s*var\(--ao-staff-surface-strong\);/)
  assert.match(css, /\.staff-profile-grid > div,[\s\S]*?\.leave-summary-cards article,[\s\S]*?\.staff-training-summary article,[\s\S]*?\.staff-training-mobile-cards article,[\s\S]*?\.leave-history-link[\s\S]*?background:\s*var\(--ao-staff-surface\) !important;/)
  assert.match(css, /\.staff-profile-scroll::-[wW]ebkit-scrollbar\s*\{[\s\S]*?width:\s*5px;[\s\S]*?\.staff-profile-scroll::-[wW]ebkit-scrollbar-thumb\s*\{[\s\S]*?border:\s*1px solid var\(--ao-staff-gold\);[\s\S]*?background:\s*linear-gradient\(180deg, #4f9c87 0%, var\(--ao-staff-emerald\) 52%, var\(--ao-staff-emerald-deep\) 100%\);/)
})
