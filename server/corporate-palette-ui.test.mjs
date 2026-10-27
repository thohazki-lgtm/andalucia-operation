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
for (const moduleName of ['dashboard', 'staff-management', 'duty-roster', 'leave-planner', 'training', 'bookings', 'guest-occasions', 'incentives-and-bill-tips', 'maintenance', 'reports', 'customization-center']) assert.match(theme, new RegExp(`\\.module-${moduleName}\\s*\\{`), `${moduleName} has no restrained accent assignment`)
assert.match(app, /moduleThemeClass\(page\)/)
assert.match(main, /import '\.\/corporate-theme\.css'/)
assert.doesNotMatch(theme, /!important/)
assert.doesNotMatch(theme, /\.badge|\.status-dot|\[style\]/, 'corporate palette must not override semantic or configured status colors')
assert.equal(createHash('sha256').update(logo).digest('hex'), 'ee7fde7ba4f1e99a81fea8981b2282e2f6ff9f36e21ce17141a04916082bb41d', 'official wordmark asset changed')

console.log(JSON.stringify({ paletteTokens: Object.keys(palette).length, moduleAccents: 11, semanticColorsPreserved: true, logoPreserved: true }, null, 2))
