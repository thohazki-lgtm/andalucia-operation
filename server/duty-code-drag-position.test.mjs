import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/duty-roster.css', import.meta.url), 'utf8')

assert.match(app, /<thead><tr><th>Reorder<\/th><th>Code<\/th><th>Duty Name<\/th><th>Color<\/th><th>Preview<\/th><th>Counts as Working<\/th><th>Bill Tip Rule<\/th><th>Actions<\/th><\/tr><\/thead>/, 'Reorder must be the far-left table column and the approved Bill Tip Rule column must remain visible.')
assert.match(app, /key=\{option\.id\}><td><IconAction icon="grip"[\s\S]*?<\/td><td><b>\{dutyDisplayCode\(option\)\}<\/b>/, 'Each shared SVG drag handle must appear immediately before its Duty Code.')
assert.match(styles, /\.duty-code-table td:first-child \{ width: 6%; min-width: 48px;[^}]*text-align: center; \}/, 'The far-left reorder column must remain compact and aligned.')
assert.match(styles, /\.duty-code-table td:nth-child\(2\) b \{/, 'Code typography must follow the moved reorder column.')
assert.match(styles, /\.duty-code-name \{/, 'Duty Name must retain its dedicated balanced typography.')
assert.match(styles, /\.duty-code-table td:nth-child\(6\) \{ width: 12%; text-align: center; \}/, 'Counts as Working must remain aligned after the column move.')
assert.match(app, /onPointerDown=\{event => pointerDown\(event, option\.id\)\}/)
assert.match(app, /onKeyDown=\{event => keyboardMove\(event, option\.id\)\}/)
assert.match(app, /await onReorder\(requested\.map\(option => option\.id\)\)/, 'Atomic complete-order persistence must remain unchanged.')
assert.match(app, /className=\{option \? 'mobile-duty-select duty-pill-select' : 'mobile-duty-select duty-pill-select no-assignment'\}/, 'The mobile roster must retain its pill selector and unassigned styling.')

console.log(JSON.stringify({ reorderColumnFirst: true, handleBeforeCode: true, narrowAlignedColumn: true, remainingColumnsAligned: true, mouseTouchKeyboardPreserved: true, atomicPersistencePreserved: true, stage4bMobilePreserved: true }, null, 2))
