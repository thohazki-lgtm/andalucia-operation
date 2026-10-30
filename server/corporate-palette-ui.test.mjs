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
assert.match(theme, /--ao-royal-purple:\s*#5b146f/i, 'Dashboard Royal Purple token is missing')
assert.match(theme, /--ao-soft-lavender:\s*#c89feb/i, 'Dashboard lavender token is missing')
assert.match(theme, /--ao-forest-green:\s*#1e5b53/i, 'Customization Center Forest Green token is missing')
assert.match(theme, /--ao-soft-mint:\s*#c9e7dd/i, 'Customization Center mint token is missing')
assert.match(theme, /main\[class\*='module-'\] :is\(h1, h2\)[\s\S]*font-family:\s*var\(--ao-font-display\)/, 'module title hierarchy does not use Dahlia')
assert.match(theme, /auth-page \.auth-card h1[\s\S]*font-family:\s*var\(--ao-font-display\)/, 'login headline does not use Dahlia')
assert.doesNotMatch(theme, /Rework/i, 'trial-only Rework Display must not be referenced')
assert.match(theme, /main\[class\*='module-'\]\s*\{[\s\S]*--ao-module-line:[\s\S]*--ao-module-divider:[\s\S]*--ao-module-surface:[\s\S]*background-color:\s*transparent;[\s\S]*background-image:\s*none/, 'inner module content must remain transparent over the page canvas')
assert.match(theme, /\.app-shell:has\(> main\[class\*='module-'\]\)\s*\{[\s\S]*min-height:\s*100dvh;[\s\S]*background-image:\s*linear-gradient/, 'full-page module gradient is not applied to the application shell')
assert.match(theme, /\.app-shell:has\(> main\.module-dashboard\)\s*\{[\s\S]*linear-gradient\(to bottom,\s*#f4f1eb 0%,\s*#e8d9ef 56%,\s*#d4b2e8 100%\)/i, 'Dashboard full-page gradient does not use the approved ivory and lavender stops')
assert.match(theme, /\.module-dashboard\s*\{[\s\S]*--ao-module-accent:\s*var\(--ao-royal-purple\)[\s\S]*--ao-module-accent-soft:\s*var\(--ao-soft-lavender\)/, 'Dashboard does not use the approved Royal Purple family')
assert.match(theme, /\.module-customization-center\s*\{[\s\S]*--ao-module-accent:\s*var\(--ao-forest-green\)[\s\S]*--ao-module-accent-soft:\s*var\(--ao-soft-mint\)/, 'Customization Center does not use the approved Forest Green family')
assert.match(theme, /\.module-dashboard \.dashboard-hero\s*\{[\s\S]*background:\s*var\(--ao-midnight-teal\)/, 'Dashboard greeting banner lost Midnight Teal')
assert.match(theme, /var\(--ao-page-canvas-tint\)/, 'module page tint token is unused')
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
assert.match(theme, /--ao-page-title-size:\s*29px/, 'Dashboard-aligned page title scale is missing')
assert.match(theme, /--ao-section-title-size:\s*18px/, 'shared section title scale is missing')
assert.match(theme, /--ao-card-title-size:\s*15px/, 'shared card title scale is missing')
assert.match(theme, /--ao-table-copy-size:\s*11\.5px/, 'shared table copy scale is missing')
assert.match(theme, /--ao-status-pill-radius:\s*999px/, 'shared compact pill radius is missing')
assert.match(theme, /page-header h1\s*\{[\s\S]*font-size:\s*var\(--ao-page-title-size\)[\s\S]*font-weight:\s*500[\s\S]*line-height:\s*1\.08/, 'page title hierarchy does not match the approved Dashboard')
assert.match(theme, /\.panel-title,[\s\S]*\.config-heading\) :is\(h3, h4\)[\s\S]*font-family:\s*var\(--ao-font-ui\)[\s\S]*font-size:\s*var\(--ao-card-title-size\)[\s\S]*font-weight:\s*500/, 'card headings do not match the Dashboard Good Sans hierarchy')
assert.match(theme, /\.ao-action,[\s\S]*\.config-icon-action[\s\S]*min-height:\s*var\(--ao-module-control-height\)[\s\S]*font-size:\s*11\.5px[\s\S]*font-weight:\s*500/, 'shared action sizing is inconsistent')
assert.match(theme, /\.booking-status,[\s\S]*\.config-protected-state[\s\S]*border-radius:\s*var\(--ao-status-pill-radius\)[\s\S]*font-weight:\s*500/, 'status pill geometry is inconsistent')
assert.match(theme, /table :is\(th, td\)\s*\{[\s\S]*vertical-align:\s*middle/, 'table cells are not vertically aligned')
assert.match(theme, /table th\s*\{[\s\S]*font-size:\s*var\(--ao-label-size\)[\s\S]*font-weight:\s*500/, 'table headers do not use the shared compact hierarchy')
assert.match(theme, /table td\s*\{[\s\S]*font-size:\s*var\(--ao-table-copy-size\)[\s\S]*font-weight:\s*400/, 'table rows do not use the shared readable hierarchy')
assert.match(theme, /\.staff-tools,[\s\S]*\.maintenance-filters[\s\S]*border:\s*1px solid var\(--ao-module-line\)/, 'legacy filter toolbars do not use the corporate frame')
assert.match(theme, /input:not\(\[type='checkbox'\]\)[\s\S]*border-color:\s*var\(--ao-module-line\)[\s\S]*font-family:\s*var\(--ao-font-ui\)/, 'shared form controls do not use Good Sans')
assert.match(theme, /\.ao-action--primary,[\s\S]*background-color:\s*var\(--ao-module-accent-ink\)/, 'primary actions do not use the module accent')
assert.match(theme, /@media \(max-width:\s*700px\)[\s\S]*--ao-module-control-height:\s*44px/, 'mobile controls do not retain touch-friendly height')
assert.doesNotMatch(theme, /!important/)
assert.doesNotMatch(theme, /\.badge|\.status-dot|\[style\]/, 'corporate palette must not override semantic or configured status colors')
assert.equal(createHash('sha256').update(logo).digest('hex'), 'ee7fde7ba4f1e99a81fea8981b2282e2f6ff9f36e21ce17141a04916082bb41d', 'official wordmark asset changed')

console.log(JSON.stringify({ paletteTokens: Object.keys(palette).length, moduleAccents: 11, moduleCanvasFamilies: ['royal-purple', 'teal', 'sunset', 'violet', 'forest-green'], selectedNavigationAccents: true, sectionHierarchyAccents: true, sharedTypographyHierarchy: true, sharedActionSizing: true, sharedTableRhythm: true, semanticColorsPreserved: true, logoPreserved: true }, null, 2))
