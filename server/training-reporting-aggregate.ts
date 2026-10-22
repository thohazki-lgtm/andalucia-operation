import type { PGlite } from '@electric-sql/pglite'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

export interface CompletedTrainingAggregate {
  sessionsCompleted: number
  participantAttendances: number
  creditedMinutes: number
  trainingHours: number
}

const round = (value: number, places = 2) => Number(value.toFixed(places))

/**
 * Authoritative delivered-Training totals. The completed metrics view is built
 * from immutable completion and per-staff evidence, so Reports and Training use
 * the same revision-aware source without relying on legacy attendee rows.
 */
export async function completedTrainingAggregate(db: PGlite, start: string, end: string): Promise<CompletedTrainingAggregate> {
  const row = (await db.query<{
    sessions_completed: number
    participant_attendances: number
    credited_minutes: number
  }>(`select
      count(*)::int sessions_completed,
      coalesce(sum(participant_count),0)::int participant_attendances,
      coalesce(sum(credited_minutes),0)::int credited_minutes
    from training_completed_session_metrics
    where outlet_scope_id=$1 and training_date between $2 and $3 and outcome='completed'`, [
    ANDALUCIA_SCOPE_ID, start, end
  ])).rows[0]
  const creditedMinutes = Number(row?.credited_minutes || 0)
  return {
    sessionsCompleted: Number(row?.sessions_completed || 0),
    participantAttendances: Number(row?.participant_attendances || 0),
    creditedMinutes,
    trainingHours: round(creditedMinutes / 60)
  }
}
