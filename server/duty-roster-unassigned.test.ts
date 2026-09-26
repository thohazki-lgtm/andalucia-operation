import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { OperationsRepository } from './operations-repository.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const onDuty = 'DUTY_TEST_ON'
const offDuty = 'DUTY_TEST_OFF'
const annualLeave = 'DUTY_TEST_AL'
await db.query(
  "insert into configuration_options (id,group_key,value,label,metadata,active,sort_order) values ($1,'duty_codes',$2,'Duty',$3,true,0),($4,'duty_codes',$5,'Off',$6,true,1),($7,'duty_codes',$8,'Annual Leave',$9,true,2)",
  [randomUUID(), onDuty, JSON.stringify({ displayCode: 'ON', dutyClassification: 'working', countsAsWorking: true }), randomUUID(), offDuty, JSON.stringify({ displayCode: 'OFF', dutyClassification: 'off', countsAsWorking: false }), randomUUID(), annualLeave, JSON.stringify({ displayCode: 'AL', dutyClassification: 'annualLeave', countsAsWorking: false })]
)
const staffId = randomUUID()
const existingStaffId = randomUUID()
await db.query(
  'insert into staff (id,staff_number,full_name,position_key,employment_status_key,join_date) values ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',
  [staffId, 'ROSTER-NEW', 'New Active Staff', 'Waiter', 'active', '2026-09-01', existingStaffId, 'ROSTER-EXISTING', 'Existing Staff', 'Waiter', 'active', '2026-01-01']
)
const operations = new OperationsRepository(db)
await operations.initialize()

assert.equal((await operations.roster('2026-08-31', '2026-09-06')).filter(entry => entry.staffId === staffId).length, 0)

await operations.updateRoster(existingStaffId, '2026-08-31', onDuty)
await operations.updateRoster(existingStaffId, '2026-09-01', offDuty)
await operations.updateRoster(existingStaffId, '2026-09-02', annualLeave)
await operations.updateRoster(staffId, '2026-09-04', onDuty)
assert.equal((await operations.roster('2026-08-31', '2026-09-06')).find(entry => entry.staffId === staffId)?.dutyCode, onDuty)

await operations.updateRoster(staffId, '2026-09-04', '')
assert.equal((await operations.roster('2026-08-31', '2026-09-06')).some(entry => entry.staffId === staffId), false)
assert.deepEqual(
  (await operations.roster('2026-08-31', '2026-09-06')).filter(entry => entry.staffId === existingStaffId).map(entry => [entry.date, entry.dutyCode]).sort(),
  [['2026-08-31', onDuty], ['2026-09-01', offDuty], ['2026-09-02', annualLeave]]
)

await operations.updateRoster(staffId, '2026-09-04', onDuty)
const rosterEntry = await db.query<{ id: string }>('select id from duty_roster_entries where staff_id=$1 and duty_date=$2', [staffId, '2026-09-04'])
await db.query("insert into attendance_records (id,staff_id,attendance_date,roster_entry_id,actual_status,actual_duty_code) values ($1,$2,$3,$4,'worked_as_scheduled',$5)", [randomUUID(), staffId, '2026-09-04', rosterEntry.rows[0].id, onDuty])
await operations.updateRoster(staffId, '2026-09-04', '')
const attendance = await db.query<{ roster_entry_id: string | null; actual_status: string; actual_duty_code: string }>('select roster_entry_id,actual_status,actual_duty_code from attendance_records where staff_id=$1 and attendance_date=$2', [staffId, '2026-09-04'])
assert.deepEqual(attendance.rows[0], { roster_entry_id: null, actual_status: 'worked_as_scheduled', actual_duty_code: onDuty })

console.log(JSON.stringify({ sparseRosterPreserved: true, assignmentPersisted: true, explicitUnassignRemovedOnlyTarget: true, existingAssignmentsPreserved: true, linkedAttendancePreserved: true }))
await db.close()
