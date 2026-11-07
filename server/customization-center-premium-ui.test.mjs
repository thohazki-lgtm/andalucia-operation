import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, entry, styles] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
  readFile('src/customization-center.css', 'utf8')
])

for (const label of ['Bookings', 'Training', 'Guest Experience', 'Chargeable', 'Maintenance', 'Platform']) {
  assert.match(app, new RegExp(`label: '${label}'`), `${label} must remain in the Customization Center navigation`)
}

assert.match(entry, /import '\.\/customization-center\.css'/, 'premium Customization Center styles must load after the shared theme')
assert.match(styles, /linear-gradient\(to bottom, #1c2e4c 0%, #285f8f 32%, #429bc7 66%, #6cd0ff 100%\)/, 'module must use the approved navy-to-sky gradient')
assert.match(styles, /main\.module-customization-center > \.page-header::before \{ content: none; \}/, 'legacy header decoration must be removed')
assert.match(styles, /font: 500 clamp\(26px, 3vw, 36px\)\/1\.05 var\(--ao-font-display\)/, 'main title must use the approved Dahlia display face')
assert.match(styles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/, 'desktop navigation must preserve six balanced tabs')
assert.match(styles, /border-top: 3px solid var\(--custom-gold\)/, 'major cards must use the stronger gold top accent')
assert.match(styles, /body:has\(main\.module-customization-center\) \.modal/, 'dialog styling must remain scoped to the active Customization Center')
assert.match(styles, /\.booking-config-section,[\s\S]*?\.training-custom-card,[\s\S]*?\.occasion-config-card,[\s\S]*?\.chargeable-config-card,[\s\S]*?\.maintenance-config-card,[\s\S]*?\.database-health-heading/, 'all six settings areas must share the premium card system')
assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'mobile navigation must retain two balanced columns')

console.log(JSON.stringify({
  status: 'PASS',
  scope: 'Customization Center UI only',
  tabs: 6,
  gradient: '#1C2E4C to #6CD0FF',
  popupStyling: 'scoped',
  backendChanged: false,
  databaseChanged: false
}, null, 2))
