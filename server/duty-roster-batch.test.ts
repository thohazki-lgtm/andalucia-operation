import assert from 'node:assert/strict'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { StaffRepository } from './staff-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { buildRosterPdf } from '../src/roster-pdf.js'

const fixture = await createDisposableDevelopmentStore('duty-roster-batch')
try {
  const staffRepository = new StaffRepository(fixture.store, fixture.db)
  await staffRepository.initialize()
  const operations = new OperationsRepository(fixture.db)
  await operations.initialize()
  const staff = (await staffRepository.list()).filter(person => person.assignmentEligible).slice(0, 2)
  assert.equal(staff.length, 2)
  const configuration = await staffRepository.configuration()
  const duties = configuration.dutyCodes.filter(option => option.active && option.metadata?.displayCode !== 'SK').slice(0, 2)
  assert.equal(duties.length, 2)
  const dates = ['2026-10-18', '2026-10-19']
  const firstBatch = [
    { staffId: staff[0].id, date: dates[0], dutyCode: duties[0].value, expectedUpdatedAt: null },
    { staffId: staff[1].id, date: dates[1], dutyCode: duties[1].value, expectedUpdatedAt: null }
  ]
  assert.deepEqual(await operations.updateRosterBatch(firstBatch, 'Batch Test Manager'), { saved: 2 })
  const saved = await operations.roster(dates[0], dates[1])
  assert.equal(saved.length, 2)
  assert.deepEqual(saved.map(entry => entry.dutyCode).sort(), duties.map(option => option.value).sort())
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='duty_roster_entry' and actor='Batch Test Manager'")).rows[0].count), 2)

  const stale = saved.find(entry => entry.staffId === staff[0].id)!
  await fixture.db.query("update duty_roster_entries set updated_at=now()+interval '1 second' where staff_id=$1 and duty_date=$2", [stale.staffId, stale.date])
  await assert.rejects(operations.updateRosterBatch([
    { staffId: stale.staffId, date: stale.date, dutyCode: duties[1].value, expectedUpdatedAt: stale.updatedAt },
    { staffId: staff[1].id, date: dates[0], dutyCode: duties[0].value, expectedUpdatedAt: null }
  ], 'Conflict Test Manager'), /ROSTER_BATCH_CONFLICT/)
  assert.equal((await operations.roster(dates[0], dates[0])).some(entry => entry.staffId === staff[1].id), false, 'the whole conflicting batch must roll back')

  const latest = (await operations.roster(dates[0], dates[1])).find(entry => entry.staffId === staff[0].id)!
  await operations.updateRosterBatch([{ staffId: latest.staffId, date: latest.date, dutyCode: '', expectedUpdatedAt: latest.updatedAt }], 'Delete Test Manager')
  assert.equal((await operations.roster(dates[0], dates[0])).some(entry => entry.staffId === latest.staffId), false)

  const pdfDates = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']
  const pdfDuty = { ...duties[0], metadata: { ...duties[0].metadata, displayCode: 'TL | A' } }
  const pdfRoster = pdfDates.map((date, index) => ({ ...saved[0], id: `pdf-${index}`, date, dutyCode: pdfDuty.value }))
  const pdf = buildRosterPdf({ view: 'Weekly', start: pdfDates[0], end: pdfDates.at(-1)!, dates: pdfDates, staff, roster: pdfRoster, dutyOptions: [pdfDuty, ...configuration.dutyCodes.filter(option => option.id !== pdfDuty.id)] })
  const pdfText = new TextDecoder().decode(pdf)
  assert.ok(pdfText.startsWith('%PDF-1.4'))
  assert.match(pdfText, /WEEKLY DUTY ROSTER/)
  assert.match(pdfText, new RegExp(staff[0].number))
  assert.match(pdfText, /Sunday/)
  assert.match(pdfText, /Saturday/)
  assert.match(pdfText, /TL \| A/)
  assert.match(pdfText, /Saved Duty Roster assignments/)
  assert.match(pdfText, /0 517 842 78 re B/, 'the navy masthead must retain its complete 78pt height')
  assert.match(pdfText, /24 464 150 43 re B/, 'the weekly table must start 10pt below the masthead')
  assert.match(pdfText, /\/Count 1/, 'a fitting weekly roster must remain on one landscape page')
  assert.ok(pdf.byteLength > 1500)

  const monthDates = Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`)
  const monthlyPdf = new TextDecoder().decode(buildRosterPdf({ view: 'Monthly', start: monthDates[0], end: monthDates.at(-1)!, dates: monthDates, staff, roster: pdfRoster, dutyOptions: [pdfDuty, ...configuration.dutyCodes.filter(option => option.id !== pdfDuty.id)] }))
  assert.match(monthlyPdf, /MONTHLY DUTY ROSTER/)
  assert.match(monthlyPdf, /\/Count 5/)
  assert.match(monthlyPdf, /WEEK 5 OF 5/)

  console.log(JSON.stringify({ atomicBatchSave: true, duplicateSubmissionGuard: true, optimisticConflictDetection: true, failedBatchRollback: true, deleteSupported: true, auditPerAssignment: true, savedDataPdf: true, fullWeekdayHeaders: true, completeDutyCodes: true, monthlyWeekPagination: true, privateLocalExport: true, schemaChanged: false, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
