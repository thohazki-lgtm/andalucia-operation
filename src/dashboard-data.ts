import type { BookingRecord, BookingSummary, ConfigOption, MaintenanceSummary, OperationalReport, RosterEntry, Staff } from './domain'
import { bookingTimeWindow } from './booking-time.js'
import { serviceDate, serviceTime } from './service-date.js'

type ServiceParty = { id: string; time: string; covers: number; state: 'upcoming' | 'arrived' | 'noShow'; tables: string[] }

export function buildTeamToday(staff: Staff[], roster: RosterEntry[], dutyOptions: ConfigOption[]) {
  const duty = (value?: string | null) => dutyOptions.find(option => option.value === value)
  const activeStaff = staff.filter(person => person.assignmentEligible ?? person.employmentStatus === 'active')
  const assigned = activeStaff.map(person => ({ person, entry: roster.find(row => row.staffId === person.id) }))
  return {
    totalStaff: activeStaff.length,
    working: assigned.filter(item => duty(item.entry?.dutyCode)?.metadata?.countsAsWorking),
    off: assigned.filter(item => duty(item.entry?.dutyCode)?.metadata?.dutyClassification === 'off'),
    leave: assigned.filter(item => ['annualLeave', 'publicHoliday', 'sickLeave'].includes(duty(item.entry?.dutyCode)?.metadata?.dutyClassification || ''))
  }
}

const minutesFor = (time: string) => { const match = /^(\d{2}):(\d{2})/.exec(time); return match ? Number(match[1]) * 60 + Number(match[2]) : -1 }

function authoritativeServiceParties(bookings: BookingRecord[], statuses: ConfigOption[]): ServiceParty[] {
  const statusMetadata = (value: string) => statuses.find(option => option.value === value)?.metadata
  const unique = [...new Map(bookings.map(booking => [booking.id, booking])).values()]
  const included = unique.filter(booking => {
    const metadata = statusMetadata(booking.bookingStatus)
    return metadata?.serviceStage !== 'excluded' && !(metadata?.excludesFromExpectedCovers && metadata?.bookingMetric !== 'noShow' && !metadata?.serviceStage)
  })
  const grouped = new Map<string, BookingRecord[]>()
  const ungrouped: BookingRecord[][] = []
  for (const booking of included) {
    const groupId = booking.coverResolution?.groupId
    const groupTotal = booking.coverResolution?.groupTotal
    if (!groupId || !groupTotal) { ungrouped.push([booking]); continue }
    const key = `${booking.reservationDate}|${booking.reservationTime.slice(0, 5)}|${groupId}`
    grouped.set(key, [...(grouped.get(key) || []), booking])
  }
  return [...ungrouped, ...grouped.values()].map(group => {
    const first = group[0]
    const stages = group.map(booking => statusMetadata(booking.bookingStatus)?.serviceStage || (statusMetadata(booking.bookingStatus)?.bookingMetric === 'arrived' ? 'arrived' : statusMetadata(booking.bookingStatus)?.bookingMetric === 'noShow' ? 'noShow' : 'remaining'))
    const state = stages.some(stage => ['arrived', 'completed'].includes(stage)) ? 'arrived' : stages.some(stage => stage === 'noShow') ? 'noShow' : 'upcoming'
    return { id: group.length > 1 ? `${first.reservationDate}|${first.reservationTime.slice(0, 5)}|${first.coverResolution!.groupId}` : first.id, time: first.reservationTime.slice(0, 5), covers: first.coverResolution?.groupTotal || first.covers, state, tables: [...new Set(group.map(booking => booking.tableNumber).filter(Boolean))] }
  })
}

const partyCounts = (parties: ServiceParty[]) => [...new Set(parties.map(party => party.covers))].sort((a, b) => a - b).map(size => ({ size, count: parties.filter(party => party.covers === size).length }))

export function buildHostessServiceBoard(bookings: BookingRecord[], statuses: ConfigOption[], selectedDate: string, now = new Date()) {
  const parties = authoritativeServiceParties(bookings, statuses)
  const upcoming = parties.filter(party => party.state === 'upcoming')
  const arrived = parties.filter(party => party.state === 'arrived')
  const noShows = parties.filter(party => party.state === 'noShow')
  const partySizes = [...new Set(upcoming.map(party => party.covers))].sort((a, b) => a - b)
  const times = [...new Set(upcoming.map(party => party.time).filter(Boolean))].sort()
  const rows = times.map(time => ({
    time,
    label: bookingTimeWindow(time),
    counts: Object.fromEntries(partySizes.map(size => [size, upcoming.filter(party => party.time === time && party.covers === size).length])) as Record<number, number>
  }))
  const live = selectedDate === serviceDate(now)
  const currentMinutes = minutesFor(serviceTime(now))
  const future = upcoming.filter(party => minutesFor(party.time) >= currentMinutes)
  const nextThirty = live ? future.filter(party => minutesFor(party.time) < currentMinutes + 30) : []
  const nextTime = (live ? future : upcoming).map(party => party.time).sort()[0]
  const nextSlotParties = nextTime ? upcoming.filter(party => party.time === nextTime) : []
  const next = nextThirty.length
    ? { mode: 'next30' as const, eyebrow: 'NEXT 30 MINUTES', label: `${serviceTime(now)} – ${String(Math.floor((currentMinutes + 30) / 60) % 24).padStart(2, '0')}:${String((currentMinutes + 30) % 60).padStart(2, '0')}`, groups: partyCounts(nextThirty) }
    : nextSlotParties.length
      ? { mode: live ? 'nextSlot' as const : 'schedule' as const, eyebrow: live ? 'NEXT SERVICE SLOT' : 'UPCOMING BY TIME', label: bookingTimeWindow(nextTime), groups: partyCounts(nextSlotParties) }
      : { mode: 'none' as const, eyebrow: live ? 'NEXT ARRIVALS' : 'UPCOMING BY TIME', label: '', groups: [] }
  const zeroMessage = upcoming.length ? '' : arrived.length && !noShows.length ? 'All expected guests have arrived.' : 'No bookings remaining for tonight.'
  return { partySizes, rows, next, zeroMessage, summary: { upcomingParties: upcoming.length, upcomingCovers: upcoming.reduce((sum, party) => sum + party.covers, 0), arrivedParties: arrived.length, arrivedCovers: arrived.reduce((sum, party) => sum + party.covers, 0), noShowParties: noShows.length, noShowCovers: noShows.reduce((sum, party) => sum + party.covers, 0) } }
}

export function buildPartySizeGrid(bookings: BookingRecord[], statuses: ConfigOption[]) {
  const board = buildHostessServiceBoard(bookings, statuses, bookings[0]?.reservationDate || serviceDate())
  return { rows: board.rows, partySizes: board.partySizes, includedBookings: board.summary.upcomingParties }
}

export function buildDashboardData(report: OperationalReport | null, bookingSummary: BookingSummary, maintenanceSummary: MaintenanceSummary) {
  const bookings = report?.bookings
  const attentionCategories = [
    { key: 'maintenance', label: 'Urgent maintenance', count: maintenanceSummary.urgentUnresolved || 0 },
    { key: 'tables', label: 'Unassigned tables', count: bookingSummary.unassignedTables },
    { key: 'waiters', label: 'Unassigned waiters', count: bookingSummary.unassignedWaiters },
    { key: 'occasions', label: 'Guest occasions', count: report?.occasions.requiringAttention || 0 }
  ]
  return {
    bookings: { totalCovers: bookings?.totalCovers || 0, adults: bookings?.totalAdults || 0, kids: bookings?.totalKids || 0 },
    serviceProgress: { arrivedCovers: bookings?.arrivedCovers || 0, remainingCovers: bookings?.remainingCovers || 0, noShowCovers: bookings?.noShowCovers || 0 },
    occasions: { total: report?.occasions.total || 0, categories: report?.occasions.byCategory || [] },
    chargeables: { realizedRevenue: report?.chargeables.realizedRevenue || 0, itemsSold: report?.chargeables.itemsSold || 0, topItem: report?.chargeables.topItem?.item || '—' },
    attention: { total: attentionCategories.reduce((sum, category) => sum + category.count, 0), categories: attentionCategories.filter(category => category.count > 0) }
  }
}
