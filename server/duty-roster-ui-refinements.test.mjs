import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
const server = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
const repository = await readFile(new URL('./staff-repository.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.match(app, /className="duty-drag-handle"/, 'Duty Code Settings must expose a drag handle.')
assert.match(app, /onPointerDown=\{event => pointerDown\(event, option\.id\)\}/, 'Desktop pointer dragging must be wired.')
assert.match(app, /event\.pointerType === 'mouse'/, 'Mouse dragging must activate immediately.')
assert.match(app, /window\.setTimeout\(\(\) => \{ state\.activated = true;/, 'Touch dragging must use a deliberate long press.')
assert.match(app, /\['ArrowUp', 'ArrowDown'\]/, 'Keyboard ordering must support Arrow Up and Arrow Down.')
assert.doesNotMatch(app, /title="Move Up"|title="Move Down"|>↑<|>↓</, 'Legacy ordering buttons must be removed.')
assert.match(api, /reorderDutyCodes: \(orderedIds: string\[\]\)/, 'The client must persist the complete active order.')
assert.match(server, /repository\.reorderDutyCodes\(input\.orderedIds, auditActorLabel\(context\.principal\)\)/, 'The reorder endpoint must accept complete ordered IDs and preserve the manager audit actor.')
assert.match(repository, /async reorderDutyCodes\(orderedIds: string\[\], actor = 'Configuration manager'\)/, 'The repository must persist the complete order atomically with an audit actor.')
assert.match(repository, /new Set\(orderedIds\)\.size !== orderedIds\.length/, 'Duplicate order entries must fail closed.')
assert.match(styles, /\.duty-drag-handle\{[^}]*touch-action:none/, 'The drag handle must support touch without scrolling conflicts.')
assert.match(styles, /\.duty-code-table tr\.is-dragging/, 'Dragging state must remain visible.')

assert.match(app, /\{dutyDisplayCode\(item\)\} · \{item\.label\}<\/option>/, 'Mobile roster options must show code and configured name.')
assert.match(app, /className=\{option \? 'mobile-duty-select duty-pill-select' : 'mobile-duty-select duty-pill-select no-assignment'\}/, 'The configured premium duty dropdown must remain full-width and color-aware on mobile.')
assert.match(styles, /\.mobile-roster-card>\.mobile-duty-select\{[^}]*width:100%;min-width:0;max-width:100%/, 'Long configured names must remain contained on mobile.')
assert.match(app, /const dutyOptions = configuration\.dutyCodes/, 'Roster dropdowns must consume the refreshed configured order.')
assert.match(app, /setConfiguration\(current => \(\{ \.\.\.current, dutyCodes \}\)\)/, 'Persisted ordering must refresh shared configuration state.')
assert.match(app, /DutyRosterPage staff=\{staff\} dutyOptions=\{dutyOptions\} positions=\{configuration\.positions\}/, 'Duty Roster must consume the authoritative designation configuration.')
assert.match(app, /\{designationLabel\(person\.position, positions\)\} · \{person\.number\}/, 'Desktop roster must render the current configured designation label.')
assert.match(app, /\{person\.number\} · \{designationLabel\(person\.position, positions\)\}/, 'Mobile roster must render the current configured designation label.')

console.log(JSON.stringify({ dragHandle: true, desktopPointer: true, mobileTouch: true, keyboard: true, completeOrderPersistence: true, invalidOrderRejected: true, dropdownOrderShared: true, configuredMobileNames: true, configuredDesignationLabels: true, compactMobileDropdown: true, longNamesResponsive: true, legacyButtonsRemoved: true }, null, 2))
