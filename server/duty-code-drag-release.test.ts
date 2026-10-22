import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { ConfigOption } from '../src/domain.js'
import { moveDutyCode } from '../src/duty-code-order.js'

const option = (id: string): ConfigOption => ({ id, value: id, label: id, active: true })
const original = ['A', 'B', 'C', 'D', 'E'].map(option)
const ids = (options: ConfigOption[]) => options.map(item => item.id)

assert.deepEqual(ids(moveDutyCode(original, 'A', 'C', 'after')), ['B', 'C', 'A', 'D', 'E'], 'The first code must move to the middle.')
assert.deepEqual(ids(moveDutyCode(original, 'C', 'A', 'before')), ['C', 'A', 'B', 'D', 'E'], 'A middle code must move to the first position.')
assert.deepEqual(ids(moveDutyCode(original, 'E', 'A', 'before')), ['E', 'A', 'B', 'C', 'D'], 'The last code must move to the top.')
assert.deepEqual(ids(moveDutyCode(original, 'B', 'C', 'after')), ['A', 'C', 'B', 'D', 'E'], 'A code must move down one position.')
assert.deepEqual(ids(moveDutyCode(original, 'C', 'B', 'before')), ['A', 'C', 'B', 'D', 'E'], 'A code must move up one position.')
const alreadyPlaced = moveDutyCode(original, 'B', 'C', 'before')
assert.equal(alreadyPlaced, original, 'Repeated pointer moves over the same target must not oscillate the order.')

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const server = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
assert.match(app, /useEffect\(\(\) => \{ if \(!draggingId && !savingOrderRef\.current\)[\s\S]*?\}, \[options\]\)/, 'Dropping must not trigger a stale prop-order reset.')
assert.doesNotMatch(app, /\}, \[options, draggingId\]\)/, 'The drag-release state must not be a prop synchronization dependency.')
assert.match(app, /event\.clientY < bounds\.top \+ bounds\.height \/ 2 \? 'before' : 'after'/, 'Pointer drops must distinguish above and below the target midpoint.')
assert.match(app, /onPointerCancel=\{pointerCancel\}/, 'Pointer cancellation must use the rollback path rather than save a partial drag.')
assert.match(app, /if \(savingOrderRef\.current\) return/, 'Concurrent reorder saves must be blocked.')
assert.match(app, /disabled=\{savingOrder\}/, 'Drag handles must be disabled during persistence.')
assert.match(app, /setOrdered\(activeFromProps\)[\s\S]*?last saved order has been restored/, 'A failed save must restore the last persisted order and report a clear error.')
const dutyCodeReorderHandler = /const reorderDutyCodes = async[\s\S]*?\n const removeDutyCode/.exec(app)?.[0] || ''
assert.doesNotMatch(dutyCodeReorderHandler, /setToast\(/, 'Duty Code reordering must not display an unnecessary success popup.')
assert.match(server, /duty-codes\/reorder'\) \{ assertTrustedOrigin\(request\); const context = await authorizedWorkforceContext\(request\);/, 'The reorder endpoint must retain trusted-origin and authenticated workforce authorization.')
assert.match(server, /reorderDutyCodes\(input\.orderedIds, auditActorLabel\(context\.principal\)\)/, 'The reorder audit must use the authenticated manager identity.')

console.log(JSON.stringify({ firstToMiddle: true, middleToFirst: true, lastToTop: true, downOne: true, upOne: true, stableDropTarget: true, releaseStatePreserved: true, failedSaveRollback: true, concurrentSaveBlocked: true, authenticatedPersistence: true }, null, 2))
