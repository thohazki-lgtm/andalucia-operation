import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const theme = await readFile(new URL('../src/corporate-theme.css', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const logo = await readFile(new URL('../public/andalucia-mosaic-wordmark.png', import.meta.url))

const palette = {
  '--ao-moonlight-black': '#000000',
  '--ao-violet-hour': '#45176b',
  '--ao-turquoise-coral': '#b1e4dc',
  '--ao-lilac-calm': '#c0b7f0',
  '--ao-lagoon-teal': '#0c675c',
  '--ao-sunset-orange': '#ce6233',
  '--ao-linen-grey': '#fff6e4',
  '--ao-orange-glow': '#fca851'
}

for (const [token, value] of Object.entries(palette)) assert.match(theme, new RegExp(`${token}:\\s*${value}`, 'i'), `${token} is missing`)
for (const moduleName of ['dashboard', 'staff-management', 'duty-roster', 'leave-planner', 'training', 'bookings', 'guest-occasions', 'incentives-and-bill-tips', 'maintenance', 'reports', 'customization-center']) assert.match(theme, new RegExp(`\\.module-${moduleName}(?:\\s*[,\\{])`), `${moduleName} has no restrained accent assignment`)
assert.match(app, /moduleThemeClass\(page\)/)
assert.match(main, /import '\.\/corporate-theme\.css'/)
assert.match(theme, /@font-face\s*\{[\s\S]*font-family:\s*'AO Dahlia'[\s\S]*local\('Dahlia Regular'\)[\s\S]*font-weight:\s*400/, 'Dahlia Regular local face is missing')
assert.match(theme, /@font-face\s*\{[\s\S]*font-family:\s*'AO Dahlia'[\s\S]*local\('Dahlia Medium'\)[\s\S]*font-weight:\s*500/, 'Dahlia Medium local face is missing')
assert.match(theme, /@font-face\s*\{[\s\S]*font-family:\s*'AO Good Sans'[\s\S]*local\('Good Sans Light'\)[\s\S]*font-weight:\s*300/, 'Good Sans Light local face is missing')
assert.match(theme, /@font-face\s*\{[\s\S]*font-family:\s*'AO Good Sans'[\s\S]*local\('Good Sans Regular'\)[\s\S]*font-weight:\s*400/, 'Good Sans Regular local face is missing')
assert.match(theme, /--ao-font-display:\s*'AO Dahlia'/, 'shared display typography token is missing')
assert.match(theme, /--ao-font-ui:\s*'AO Good Sans'/, 'shared operational typography token is missing')
assert.match(theme, /main\[class\*='module-'\] :is\(h1, h2\)[\s\S]*font-family:\s*var\(--ao-font-display\)/, 'module title hierarchy does not use Dahlia')
assert.match(theme, /auth-page \.auth-card h1[\s\S]*font-family:\s*var\(--ao-font-display\)/, 'login headline does not use Dahlia')
assert.doesNotMatch(theme, /Rework/i, 'trial-only Rework Display must not be referenced')
assert.match(theme, /main\[class\*='module-'\]\s*\{[\s\S]*--ao-module-line:[\s\S]*--ao-module-divider:[\s\S]*--ao-module-surface:[\s\S]*background-color:[\s\S]*background-image:\s*none/, 'module color-first surface tokens are missing')
assert.match(theme, /var\(--ao-module-canvas-primary\)/, 'primary module canvas token is unused')
assert.match(theme, /var\(--ao-module-accent-ink\)/, 'module corporate ink token is unused')
assert.match(theme, /--ao-module-canvas-secondary:\s*var\(--ao-violet-hour\)/, 'violet module canvas is missing')
assert.match(theme, /--ao-module-canvas-secondary:\s*var\(--ao-sunset-orange\)/, 'sunset module canvas is missing')
assert.match(theme, /--ao-module-canvas-secondary:\s*var\(--ao-lagoon-teal\)/, 'teal module canvas is missing')
assert.match(theme, /\.app-shell:has\(> main\.module-dashboard\)/, 'active module accent is not exposed to persistent navigation')
assert.match(theme, /\.app-sidebar nav \.selected \{[\s\S]*border-color:\s*var\(--ao-shell-highlight[\s\S]*var\(--ao-shell-accent/, 'selected navigation lacks a corporate outline')
assert.match(theme, /page-header \{[\s\S]*border:\s*1px solid var\(--ao-module-line\)[\s\S]*background:\s*var\(--ao-module-surface-strong\)/, 'page headers do not use the module color system')
assert.match(theme, /\.panel-title,[\s\S]*\.section-heading,[\s\S]*box-shadow: inset 3px 0 var\(--ao-module-accent\)/, 'section headings lack the restrained module ribbon')
assert.match(theme, /table :is\(th, td\) \{[\s\S]*border-color:\s*var\(--ao-module-divider\)/, 'table dividers do not use module colors')
assert.match(theme, /customization-category-nav[\s\S]*border-color:\s*var\(--ao-module-line\)/, 'module navigation outlines do not use module colors')
assert.match(theme, /\.custom-report-kpis[\s\S]*background-color:\s*var\(--ao-module-surface\)/, 'module cards do not use coordinated surfaces')
assert.match(theme, /--ao-module-control-height:\s*40px/, 'shared desktop control height is missing')
assert.match(theme, /\.staff-tools,[\s\S]*\.maintenance-filters[\s\S]*border:\s*1px solid var\(--ao-module-line\)/, 'legacy filter toolbars do not use the corporate frame')
assert.match(theme, /input:not\(\[type='checkbox'\]\)[\s\S]*border-color:\s*var\(--ao-module-line\)[\s\S]*font-family:\s*var\(--ao-font-ui\)/, 'shared form controls do not use Good Sans')
assert.match(theme, /\.ao-action--primary,[\s\S]*background-color:\s*var\(--ao-module-accent-ink\)/, 'primary actions do not use the module accent')
assert.match(theme, /@media \(max-width:\s*700px\)[\s\S]*--ao-module-control-height:\s*44px/, 'mobile controls do not retain touch-friendly height')
assert.doesNotMatch(theme, /!important/)
assert.doesNotMatch(theme, /\.badge|\.status-dot|\[style\]/, 'corporate palette must not override semantic or configured status colors')
assert.equal(createHash('sha256').update(logo).digest('hex'), 'ee7fde7ba4f1e99a81fea8981b2282e2f6ff9f36e21ce17141a04916082bb41d', 'official wordmark asset changed')

console.log(JSON.stringify({ paletteTokens: Object.keys(palette).length, moduleAccents: 11, moduleCanvasFamilies: ['teal', 'sunset', 'violet'], selectedNavigationAccents: true, sectionHierarchyAccents: true, semanticColorsPreserved: true, logoPreserved: true }, null, 2))
