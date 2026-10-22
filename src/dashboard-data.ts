import { isLeaveClassification, type BookingRecord, type BookingSummary, type ConfigOption, type MaintenanceSummary, type OperationalReport, type RosterEntry, type Staff, type TrainingSession } from './domain'
import { bookingTimeWindow } from './booking-time.js'
import { serviceDate, serviceTime } from './service-date.js'

type ServiceParty = { id: string; time: string; covers: number; state: 'upcoming' | 'arrived' | 'noShow'; tables: string[] }

const readableOccasionText = (color: string) => { const match = /^#([0-9a-f]{6})$/i.exec(color); if (!match) return '#ffffff'; const value = Number.parseInt(match[1], 16); const red = value >> 16; const green = value >> 8 & 255; const blue = value & 255; return (red * 299 + green * 587 + blue * 114) / 1000 >= 150 ? '#173247' : '#ffffff' }
export function dashboardOccasionStyle(key: string, occasionTypes: ConfigOption[]) {
  const option = occasionTypes.find(item => item.metadata?.occasionCategory === key)
  const backgroundColor = option?.color || (key === 'vip' ? '#6c63a8' : key === 'tlc' ? '#e4eff4' : '#fffaf0')
  return { backgroundColor, borderColor: backgroundColor, color: key === 'tlc' ? '#23678c' : option || key === 'vip' ? readableOccasionText(backgroundColor) : '#173d56' }
}

export function buildTeamToday(staff: Staff[], roster: RosterEntry[], dutyOptions: ConfigOption[]) {
  const duty = (value?: string | null) => dutyOptions.find(option => option.value === value)
  const activeStaff = staff.filter(person => person.assignmentEligible ?? person.employmentStatus === 'active')
  const assigned = activeStaff.map(person => ({ person, entry: roster.find(row => row.staffId === person.id) }))
  return {
    totalStaff: activeStaff.length,
    working: assigned.filter(item => duty(item.entry?.dutyCode)?.metadata?.countsAsWorking),
    off: assigned.filter(item => duty(item.entry?.dutyCode)?.metadata?.dutyClassification === 'off'),
    leave: assigned.filter(item => { const classification = duty(item.entry?.dutyCode)?.metadata?.dutyClassification; return isLeaveClassification(classification) && classification !== 'off' }),
    unassigned: assigned.filter(item => !item.entry?.dutyCode || !duty(item.entry.dutyCode))
  }
}

export function buildDailyTraining(sessions: TrainingSession[], selectedDate: string) {
  const eligible = sessions
    .filter(session => session.active && (session.operationalStatus || session.status) !== 'cancelled')
    .sort((left, right) => `${left.date}T${left.startTime || left.time}`.localeCompare(`${right.date}T${right.startTime || right.time}`))
  const today = eligible.find(session => session.date === selectedDate)
  if (today) return { mode: 'today' as const, session: today }
  return { mode: 'upcoming' as const, session: eligible.find(session => session.date > selectedDate) || null }
}

const minutesFor = (time: string) => { const match = /^(\d{2}):(\d{2})/.exec(time); return match ? Number(match[1]) * 60 + Number(match[2]) : -1 }

function authoritativeServiceParties(bookings: BookingRecord[], statuses: ConfigOption[]): ServiceParty[] {
  const statusMetadata = (value: string) => statuses.find(option => option.value === value)?.metadata
  const unique = [...new Map(bookings.map(booking => [booking.id, booking])).values()]
  const included = unique.filter(booking => {
    const metadata = statusMetadata(booking.bookingStatus)
    return metadata?.serviceStage !== 'excluded' && !(metadata?.excludesFromExpectedCovers && metadata?.bookingMetric !== 'noShow' && !metadata?.serviceStage)
  })
  return included.map(booking => {
    const stage = statusMetadata(booking.bookingStatus)?.serviceStage || (statusMetadata(booking.bookingStatus)?.bookingMetric === 'arrived' ? 'arrived' : statusMetadata(booking.bookingStatus)?.bookingMetric === 'noShow' ? 'noShow' : 'remaining')
    const state = ['arrived', 'completed'].includes(stage) ? 'arrived' : stage === 'noShow' ? 'noShow' : 'upcoming'
    return { id: booking.id, time: booking.reservationTime.slice(0, 5), covers: booking.covers, state, tables: booking.tableNumber ? [booking.tableNumber] : [] }
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
  const live = selectedDate === serviceDate(now)
  const currentMinutes = minutesFor(serviceTime(now))
  const rows = times.map(time => ({
    time,
    label: bookingTimeWindow(time),
    counts: Object.fromEntries(partySizes.map(size => [size, upcoming.filter(party => party.time === time && party.covers === size).length])) as Record<number, number>,
    active: live && minutesFor(time) <= currentMinutes && currentMinutes < minutesFor(time) + 30
  }))
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

export function buildDashboardData(report: OperationalReport | null, _bookingSummary?: BookingSummary, maintenanceSummary: MaintenanceSummary = { openIssues: 0, inProgress: 0, completedToday: 0 }) {
  const bookings = report?.bookings
  const unresolvedMaintenance = maintenanceSummary.unresolved ?? maintenanceSummary.openIssues + maintenanceSummary.inProgress
  const attentionCategories = [{ key: 'maintenance', label: 'Maintenance follow-up', count: unresolvedMaintenance }]
  return {
    bookings: { totalCovers: bookings?.totalCovers || 0, adults: bookings?.totalAdults || 0, kids: bookings?.totalKids || 0 },
    serviceProgress: { arrivedCovers: bookings?.arrivedCovers || 0, remainingCovers: bookings?.remainingCovers || 0, noShowCovers: bookings?.noShowCovers || 0 },
    occasions: { total: report?.occasions.total || 0, categories: (report?.occasions.byCategory || []).filter(category => category.count > 0) },
    chargeables: { realizedRevenue: report?.chargeables.realizedRevenue || 0, itemsSold: report?.chargeables.itemsSold || 0, topItem: report?.chargeables.topItem?.item || '—' },
    attention: { total: attentionCategories.reduce((sum, category) => sum + category.count, 0), categories: attentionCategories.filter(category => category.count > 0) }
  }
}
