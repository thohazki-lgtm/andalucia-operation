import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, TrainingCompletionInput, TrainingEligibilityState, TrainingOperationalStatus, TrainingPerformance, TrainingSession, TrainingSessionDetail, TrainingStaffEvidence } from '../src/domain.js'
import { serviceDate, monthRange } from '../src/service-date.js'
import { auditActorLabel } from './authorization-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { TrainingRepository } from './training-repository.js'

const metadata = (value: unknown): Record<string, unknown> => typeof value === 'string' ? JSON.parse(value) : (value as Record<string, unknown> || {})
const round = (value: number, places = 2) => Number(value.toFixed(places))

export class TrainingR2Service {
  constructor(private readonly db: PGlite, private readonly repository: TrainingRepository) {}

  private async statusStages() {
    const rows = (await this.db.query<any>("select value,metadata from configuration_options where group_key='training_statuses'")).rows
    return new Map(rows.map((row: any) => [row.value, String(metadata(row.metadata).trainingStage || row.value)]))
  }

  private async latestCompletion(trainingId: string) {
    return (await this.db.query<any>(`select c.*,m.eligible_staff_count,m.participant_count,m.credited_minutes,m.requires_review_count
      from training_session_completion_evidence c
      left join training_completed_session_metrics m on m.completion_evidence_id=c.id
      where c.training_session_id=$1 order by c.revision_number desc limit 1`, [trainingId])).rows[0] || null
  }

  private async operationalStatus(session: TrainingSession): Promise<TrainingOperationalStatus> {
    const completion = await this.latestCompletion(session.id)
    if (completion?.outcome === 'completed') return 'completed'
    if (completion?.outcome === 'cancelled') return 'cancelled'
    const stages = await this.statusStages()
    const configured = stages.get(session.status)
    if (configured === 'cancelled') return 'cancelled'
    if (configured === 'completed') return session.date <= serviceDate() ? 'awaiting_confirmation' : 'scheduled'
    return session.date < serviceDate() ? 'awaiting_confirmation' : 'scheduled'
  }

  async list() {
    const sessions = await this.repository.list()
    return Promise.all(sessions.map(async session => ({ ...session, operationalStatus: await this.operationalStatus(session) })))
  }

  private recommendedEligibility(row: any): TrainingEligibilityState {
    if (!row.roster_entry_id) return 'requires_review'
    const duty = metadata(row.duty_metadata)
    if (duty.dutyClassification === 'off') return 'excluded_off'
    if (duty.dutyClassification === 'annualLeave') return 'excluded_annual_leave'
    return duty.countsAsWorking === true ? 'eligible' : 'requires_review'
  }

  private async eligibilityCandidates(trainingDate: string): Promise<TrainingStaffEvidence[]> {
    const rows = (await this.db.query<any>(`select distinct on(s.id)
      s.id staff_id,s.full_name staff_name,s.staff_number,s.position_key,
      mh.id membership_history_id,r.id roster_entry_id,r.duty_code_value,
      c.label duty_label,c.metadata duty_metadata
      from staff s
      join staff_membership_history mh on mh.staff_id=s.id and mh.outlet_scope_id=$1
        and mh.membership_dimension='regular_outlet' and mh.review_status='approved'
        and mh.effective_from<=$2 and coalesce(mh.effective_to,$2)>=$2
      left join configuration_options employment on employment.group_key='employment_statuses'
        and employment.value=s.employment_status_key
      left join duty_roster_entries r on r.staff_id=s.id and r.duty_date=$2
      left join configuration_options c on c.group_key='duty_codes' and c.value=r.duty_code_value
      where coalesce((employment.metadata->>'eligibleForAssignments')::boolean,s.employment_status_key='active')=true
      order by s.id,mh.effective_from desc`, [ANDALUCIA_SCOPE_ID, trainingDate])).rows
    return rows.map((row: any) => {
      const eligibilityState = this.recommendedEligibility(row)
      return {
        staffId: row.staff_id, staffName: row.staff_name, staffNumber: row.staff_number, designation: row.position_key,
        membershipHistoryId: row.membership_history_id, rosterEntryId: row.roster_entry_id, dutyCode: row.duty_code_value,
        dutyLabel: row.duty_label, eligibilityState, recommendedEligibility: eligibilityState,
        participationState: eligibilityState === 'eligible' ? 'did_not_participate' : eligibilityState === 'requires_review' ? 'requires_review' : 'not_applicable',
        creditedMinutes: 0, evidenceNote: ''
      }
    })
  }

  async detail(id: string): Promise<TrainingSessionDetail> {
    const session = await this.repository.find(id)
    if (!session) throw new Error('Training session not found.')
    const completionRow = await this.latestCompletion(id)
    let staff: TrainingStaffEvidence[]
    if (completionRow) {
      const rows = (await this.db.query<any>(`select e.*,s.position_key from training_session_staff_evidence e left join staff s on s.id=e.staff_id where e.completion_evidence_id=$1 order by e.staff_name_snapshot`, [completionRow.id])).rows
      staff = rows.map((row: any) => ({
        staffId: row.staff_id, staffName: row.staff_name_snapshot, staffNumber: row.staff_number_snapshot, designation: row.position_key || '',
        membershipHistoryId: row.membership_history_id, rosterEntryId: row.roster_entry_id, dutyCode: row.duty_code_value_snapshot,
        dutyLabel: String(metadata(row.duty_metadata_snapshot).displayCode || row.duty_code_value_snapshot || ''), eligibilityState: row.eligibility_state,
        recommendedEligibility: row.eligibility_state, participationState: row.participation_state, creditedMinutes: Number(row.credited_minutes), evidenceNote: row.evidence_note || ''
      }))
    } else staff = await this.eligibilityCandidates(session.date)
    const eligible = completionRow ? Number(completionRow.eligible_staff_count || 0) : staff.filter(item => item.eligibilityState === 'eligible').length
    const participants = completionRow ? Number(completionRow.participant_count || 0) : 0
    const creditedMinutes = completionRow ? Number(completionRow.credited_minutes || 0) : 0
    const completion = completionRow ? {
      id: completionRow.id, revisionNumber: Number(completionRow.revision_number), outcome: completionRow.outcome,
      actualDurationMinutes: completionRow.actual_duration_minutes === null ? null : Number(completionRow.actual_duration_minutes),
      creditedMinutesPerParticipant: Number(completionRow.credited_minutes_per_participant), confirmedBy: completionRow.confirmed_by_name_snapshot,
      confirmedAt: completionRow.confirmed_at, calculationPolicyVersion: completionRow.calculation_policy_version,
      eligibleStaff: eligible, participantCount: participants, creditedMinutes, requiresReviewCount: Number(completionRow.requires_review_count || 0)
    } : null
    return {
      session: { ...session, operationalStatus: await this.operationalStatus(session) }, sourceLabel: session.source === 'hr_calendar' ? 'HR File Import' : session.source === 'sharepoint' ? 'Future SharePoint Sync' : 'Manual',
      operationalStatus: await this.operationalStatus(session), completion, staff,
      coveragePercent: completion && eligible > 0 ? round(participants / eligible * 100, 1) : null,
      sessionTrainingHours: round(creditedMinutes / 60)
    }
  }

  async confirm(id: string, input: TrainingCompletionInput, principal: AuthPrincipal): Promise<TrainingSessionDetail> {
    if (!Number.isInteger(input.actualDurationMinutes) || input.actualDurationMinutes < 1 || input.actualDurationMinutes > 720) throw new Error('Enter a valid actual Training duration between 1 and 720 minutes.')
    const detail = await this.detail(id)
    if (detail.completion) throw new Error('Training completion has already been confirmed.')
    if (detail.operationalStatus === 'cancelled') throw new Error('Cancelled Training cannot be confirmed as completed.')
    const supplied = new Map((input.staff || []).map(item => [item.staffId, item]))
    if (supplied.size !== detail.staff.length || detail.staff.some(item => !supplied.has(item.staffId))) throw new Error('Review every eligible staff member before confirming Training.')
    const credit = Math.min(input.actualDurationMinutes, 30)
    const resolved = detail.staff.map(candidate => {
      const decision = supplied.get(candidate.staffId)!
      const allowed: TrainingEligibilityState[] = candidate.recommendedEligibility === 'requires_review' ? ['eligible', 'excluded_off', 'excluded_annual_leave'] : [candidate.recommendedEligibility]
      if (!allowed.includes(decision.eligibilityState)) throw new Error(`Resolve eligibility for ${candidate.staffName} using the available options.`)
      const participationState = decision.eligibilityState === 'eligible' ? decision.participationState : 'not_applicable'
      if (decision.eligibilityState === 'eligible' && !['participated', 'did_not_participate'].includes(participationState)) throw new Error(`Confirm participation for ${candidate.staffName}.`)
      return { ...candidate, ...decision, participationState, creditedMinutes: participationState === 'participated' ? credit : 0 }
    })
    const actor = auditActorLabel(principal)
    await this.db.transaction(async tx => {
      const locked = (await tx.query<any>('select id,status_value from training_sessions where id=$1 and active=true for update', [id])).rows[0]
      if (!locked) throw new Error('Training session not found.')
      if ((await tx.query<any>('select id from training_session_completion_evidence where training_session_id=$1 limit 1', [id])).rows[0]) throw new Error('Training completion has already been confirmed.')
      const completionId = randomUUID()
      await tx.query(`insert into training_session_completion_evidence(id,training_session_id,outlet_scope_id,revision_number,outcome,actual_duration_minutes,credited_minutes_per_participant,calculation_policy_version,confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at)
        values($1,$2,$3,1,'completed',$4,$5,'training-credit-v1',$6,$7,now())`, [completionId, id, ANDALUCIA_SCOPE_ID, input.actualDurationMinutes, credit, principal.userId, principal.displayName])
      for (const item of resolved) {
        const dutyMetadata = detail.staff.find(candidate => candidate.staffId === item.staffId)
        await tx.query(`insert into training_session_staff_evidence(id,completion_evidence_id,training_session_id,staff_id,staff_name_snapshot,staff_number_snapshot,membership_history_id,roster_entry_id,duty_code_value_snapshot,duty_metadata_snapshot,eligibility_state,participation_state,credited_minutes,evidence_note,confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())`, [randomUUID(), completionId, id, item.staffId, item.staffName, item.staffNumber, item.membershipHistoryId, item.rosterEntryId, item.dutyCode, JSON.stringify({ displayCode: dutyMetadata?.dutyLabel || item.dutyCode, recommendedEligibility: item.recommendedEligibility }), item.eligibilityState, item.participationState, item.creditedMinutes, item.evidenceNote || null, principal.userId, principal.displayName])
      }
      const completedStatus = (await tx.query<any>("select value from configuration_options where group_key='training_statuses' and metadata->>'trainingStage'='completed' order by active desc,sort_order limit 1")).rows[0]?.value
      if (completedStatus) await tx.query('update training_sessions set status_value=$2,updated_by=$3,updated_at=now() where id=$1', [id, completedStatus, actor])
      const auditPayload = { actualDurationMinutes: input.actualDurationMinutes, creditedMinutesPerParticipant: credit, participants: resolved.filter(item => item.participationState === 'participated').map(item => item.staffId), eligibility: resolved.map(item => ({ staffId: item.staffId, recommended: item.recommendedEligibility, confirmed: item.eligibilityState })) }
      await tx.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)', [randomUUID(), 'training_completion', completionId, 'completion_confirmed', JSON.stringify(auditPayload), actor])
      await tx.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)', [randomUUID(), 'training_session', id, 'participants_confirmed', JSON.stringify(auditPayload), actor])
      if (resolved.some(item => item.eligibilityState !== item.recommendedEligibility)) await tx.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)', [randomUUID(), 'training_session', id, 'eligibility_corrected', JSON.stringify(auditPayload), actor])
    })
    return this.detail(id)
  }

  async performance(month: string): Promise<TrainingPerformance> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Select a valid Training month.')
    const [start, end] = monthRange(`${month}-01`)
    const target = (await this.db.query<any>('select * from training_target_versions where outlet_scope_id=$1 and effective_month<=$2 order by effective_month desc,version_number desc limit 1', [ANDALUCIA_SCOPE_ID, start])).rows[0]
    if (!target) throw new Error('Training target policy is unavailable.')
    const stages = await this.statusStages()
    const sessions = (await this.repository.list()).filter(item => item.active && item.date >= start && item.date <= end)
    const scheduled = sessions.filter(item => stages.get(item.status) !== 'cancelled').length
    const metrics = (await this.db.query<any>(`select m.* from training_completed_session_metrics m where m.outlet_scope_id=$1 and m.training_date between $2 and $3 and m.outcome='completed'`, [ANDALUCIA_SCOPE_ID, start, end])).rows
    const creditedMinutes = metrics.reduce((sum: number, row: any) => sum + Number(row.credited_minutes || 0), 0)
    const membership = (await this.db.query<any>(`select distinct s.id,s.full_name,s.staff_number,s.position_key from staff s join staff_membership_history h on h.staff_id=s.id and h.outlet_scope_id=$1 and h.membership_dimension='regular_outlet' and h.review_status='approved' and h.effective_from<=$3 and coalesce(h.effective_to,$3)>=$2 order by s.full_name`, [ANDALUCIA_SCOPE_ID, start, end])).rows
    const evidence = (await this.db.query<any>(`select e.staff_id,count(*) filter(where e.participation_state='participated')::int attended,coalesce(sum(e.credited_minutes),0)::int credited from training_session_staff_evidence e join training_session_completion_evidence c on c.id=e.completion_evidence_id join training_sessions s on s.id=e.training_session_id where c.outcome='completed' and s.training_date between $1 and $2 group by e.staff_id`, [start, end])).rows
    const evidenceByStaff = new Map(evidence.map((row: any) => [row.staff_id, row]))
    const perHeadTarget = Number(target.per_head_target_minutes)
    const staffCoverage = membership.map((person: any) => { const row: any = evidenceByStaff.get(person.id); const minutes = Number(row?.credited || 0); return { staffId: person.id, staffName: person.full_name, staffNumber: person.staff_number, designation: person.position_key, sessionsAttended: Number(row?.attended || 0), creditedMinutes: minutes, creditedHours: round(minutes / 60), targetMinutes: perHeadTarget, remainingMinutes: Math.max(0, perHeadTarget - minutes), minimumAchieved: minutes >= perHeadTarget } })
    const monthlyTarget = Number(target.monthly_target_credited_minutes)
    const eligibleHeadcount = membership.length
    return {
      month, target: { monthlyMinutes: monthlyTarget, monthlyHours: round(monthlyTarget / 60), perHeadMinutes: perHeadTarget, perHeadHours: round(perHeadTarget / 60), creditCapMinutes: Number(target.participant_credit_cap_minutes) },
      sessionsScheduled: scheduled, sessionsCompleted: metrics.length, creditedMinutes, trainingHours: round(creditedMinutes / 60), eligibleHeadcount,
      hoursPerHead: eligibleHeadcount ? round(creditedMinutes / eligibleHeadcount / 60) : 0,
      staffCovered: staffCoverage.filter(item => item.sessionsAttended > 0).length, remainingMinutes: Math.max(0, monthlyTarget - creditedMinutes), remainingHours: round(Math.max(0, monthlyTarget - creditedMinutes) / 60),
      targetAchieved: creditedMinutes >= monthlyTarget, requiresReview: Math.max(0, sessions.filter(item => item.date < serviceDate() && stages.get(item.status) !== 'cancelled').length - metrics.length),
      staffCoverage
    }
  }
}
