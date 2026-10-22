import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MonthlyReportService } from './monthly-report-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { TrainingR2Service } from './training-r2-service.js'
import { TrainingRepository } from './training-repository.js'

const fixture = await createDisposableDevelopmentStore('training-monthly-report-reconciliation')

try {
  const db = fixture.db
  const repository = new TrainingRepository(db)
  await repository.initialize()
  const training = new TrainingR2Service(db, repository)
  const actor = (await db.query<any>("select id,display_name from user_accounts where status='active' order by created_at limit 1")).rows[0]
  assert.ok(actor)
  const planned = (await db.query<any>("select value from configuration_options where group_key='training_statuses' and active=true and coalesce(metadata->>'trainingStage','planned') in ('planned','upcoming') order by sort_order limit 1")).rows[0]?.value
  const category = (await db.query<any>("select value from configuration_options where group_key='training_categories' and active=true order by sort_order limit 1")).rows[0]?.value
  assert.ok(planned && category)

  const staffIds: string[] = []
  for (let index = 1; index <= 3; index += 1) {
    const id = randomUUID()
    staffIds.push(id)
    await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,'waiter','active','2026-01-01')", [id, `MR${index}`, `Monthly Reporting ${index}`])
  }

  const addSession = async (date: string, title: string, participants: number | null) => {
    const id = randomUUID()
    await repository.save({ id, title, category, date, time: '17:00', startTime: '17:00', endTime: '18:00', trainer: 'Training Manager', location: 'Andalucía', status: planned, notes: '', active: true, attendees: [], source: 'manual' }, 'Training reconciliation test')
    if (participants === null) return id
    const completionId = randomUUID()
    await db.query(`insert into training_session_completion_evidence(id,training_session_id,outlet_scope_id,revision_number,outcome,actual_duration_minutes,credited_minutes_per_participant,calculation_policy_version,confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at)
      values($1,$2,$3,1,'completed',60,30,'training-credit-v1',$4,$5,now())`, [completionId, id, ANDALUCIA_SCOPE_ID, actor.id, actor.display_name])
    for (const staffId of staffIds.slice(0, participants)) {
      const staff = (await db.query<any>('select full_name,staff_number from staff where id=$1', [staffId])).rows[0]
      await db.query(`insert into training_session_staff_evidence(id,completion_evidence_id,training_session_id,staff_id,staff_name_snapshot,staff_number_snapshot,eligibility_state,participation_state,credited_minutes,confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at)
        values($1,$2,$3,$4,$5,$6,'eligible','participated',30,$7,$8,now())`, [randomUUID(), completionId, id, staffId, staff.full_name, staff.staff_number, actor.id, actor.display_name])
    }
    return id
  }

  await addSession('2026-09-12', 'September completed', 1)
  await addSession('2026-10-02', 'October completed one', 2)
  await addSession('2026-10-15', 'October completed two', 3)
  await addSession('2026-10-20', 'October scheduled only', null)

  const workingCode = 'MONTHLY_REPORT_WORKING', offCode = 'MONTHLY_REPORT_OFF'
  await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'duty_codes',$2,'Monthly Report Working',$3,true,900),($4,'duty_codes',$5,'Monthly Report Off',$6,true,901)", [
    randomUUID(), workingCode, JSON.stringify({ displayCode: 'MRW', dutyClassification: 'working', countsAsWorking: true }),
    randomUUID(), offCode, JSON.stringify({ displayCode: 'MRO', dutyClassification: 'off', countsAsWorking: false })
  ])
  await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)', [
    randomUUID(), staffIds[0], '2026-09-30', workingCode,
    randomUUID(), staffIds[1], '2026-09-30', offCode,
    randomUUID(), staffIds[0], '2026-10-01', workingCode
  ])

  const obsoleteOperationalSupport = {
    training: { sessions: 77, participants: 0, attended: 0 },
    maintenance: { issuesReported: 0, completedDuringPeriod: 0, open: 0, inProgress: 0, unresolved: 0, records: [] },
    earnings: { incentives: { finalizedAmount: 0, provisionalAmount: 0, finalizedRecords: 0, provisionalRecords: 0 }, billTips: { finalizedAmount: 0, provisionalAmount: 0, finalizedMonths: 0, provisionalMonths: 0 }, state: 'not_recorded' }
  }
  const reporting = { report: async () => obsoleteOperationalSupport, getManagerSummary: async () => null }
  const monthly = new MonthlyReportService(db, reporting as never, () => '2026-10-17')
  const outlet = { id: ANDALUCIA_SCOPE_ID, scopeKey: 'andalucia', displayName: 'Andalucía' }

  const septemberTraining = await training.performance('2026-09')
  const septemberReport = await monthly.view('2026-09', outlet)
  assert.equal(septemberTraining.sessionsScheduled, 1)
  assert.deepEqual(septemberReport.training, { sessions: 1, participants: 1, attendance: 1, hours: 0.5 })
  assert.equal(septemberReport.training.sessions, septemberTraining.sessionsCompleted)
  assert.equal(septemberReport.training.participants, septemberTraining.participantAttendances)
  assert.equal(septemberReport.training.hours, septemberTraining.trainingHours)

  const octoberTraining = await training.performance('2026-10')
  const octoberReport = await monthly.view('2026-10', outlet)
  assert.equal(octoberTraining.sessionsScheduled, 3)
  assert.equal(octoberTraining.sessionsCompleted, 2)
  assert.equal(octoberTraining.participantAttendances, 5)
  assert.equal(octoberTraining.creditedMinutes, 150)
  assert.equal(octoberTraining.trainingHours, 2.5)
  assert.deepEqual(octoberReport.training, { sessions: 2, participants: 5, attendance: 5, hours: 2.5 })
  assert.equal(octoberReport.readiness.find(item => item.label === 'People / Training')?.detail.includes('2 completed trainings'), true)
  assert.equal(octoberReport.comparison.available, false, 'Daily snapshot comparison remains independently unavailable in this fixture.')
  const octoberTeamMetrics = new Map(octoberReport.comparison.teamDevelopmentMetrics?.map(item => [item.key, item]))
  assert.deepEqual(
    ['trainingSessions', 'trainingParticipants', 'trainingHours'].map(key => {
      const item = octoberTeamMetrics.get(key)
      return { key, available: item?.available, current: item?.current, previous: item?.previous }
    }),
    [
      { key: 'trainingSessions', available: true, current: 2, previous: 1 },
      { key: 'trainingParticipants', available: true, current: 5, previous: 1 },
      { key: 'trainingHours', available: true, current: 2.5, previous: 0.5 }
    ],
    'Team & Development must compare authoritative Training aggregates without requiring approved Daily snapshots.'
  )
  assert.equal(octoberTeamMetrics.get('averageOnDuty')?.available, true)
  assert.equal(octoberTeamMetrics.get('offDays')?.previous, 1)
  assert.equal(octoberTeamMetrics.get('annualLeaveDays')?.previous, 0, 'A verified zero roster classification must not be treated as missing history.')

  const septemberTeamMetrics = new Map(septemberReport.comparison.teamDevelopmentMetrics?.map(item => [item.key, item]))
  assert.equal(septemberTeamMetrics.get('averageOnDuty')?.available, false, 'Roster comparison is unavailable when the prior month has no saved roster evidence.')
  assert.equal(septemberTeamMetrics.get('trainingSessions')?.available, true)
  assert.equal(septemberTeamMetrics.get('trainingSessions')?.previous, 0, 'An authoritative Training zero remains a real zero.')

  const refreshedOctober = await monthly.view('2026-10', outlet)
  assert.deepEqual(refreshedOctober.training, octoberReport.training)
  const switchedBackToSeptember = await monthly.view('2026-09', outlet)
  assert.deepEqual(switchedBackToSeptember.training, septemberReport.training)
  const emptyMonth = await monthly.view('2026-11', outlet)
  assert.deepEqual(emptyMonth.training, { sessions: 0, participants: 0, attendance: 0, hours: 0 })

  console.log(JSON.stringify({
    status: 'PASS', isolated: true,
    september: septemberReport.training,
    october: octoberReport.training,
    octoberScheduled: octoberTraining.sessionsScheduled,
    octoberPreviousTraining: Object.fromEntries(['trainingSessions', 'trainingParticipants', 'trainingHours'].map(key => [key, octoberTeamMetrics.get(key)?.previous])),
    rosterZeroPreserved: octoberTeamMetrics.get('annualLeaveDays')?.previous === 0,
    missingRosterHistoryPreserved: septemberTeamMetrics.get('averageOnDuty')?.available === false,
    emptyMonth: emptyMonth.training,
    refreshPersistence: true,
    dateSwitching: true,
    legacyAttendanceRowsIgnored: true
  }, null, 2))
} finally {
  await fixture.cleanup()
}
