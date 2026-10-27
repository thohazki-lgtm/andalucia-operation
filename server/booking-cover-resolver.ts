import type { BookingCoverResolution, BookingCoverResolutionSource, BookingImportPreviewRecord } from '../src/domain.js'

type Instruction = { total: number; explicitKids: number; source: BookingCoverResolutionSource; evidence: string; groupTotal?: number; groupId?: string }

const wordNumbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const numberValue = (value: string) => /^\d+$/.test(value) ? Number(value) : wordNumbers[value.toLowerCase()]
const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

function childOnDate(birthDate: string | null, serviceDate: string) {
  if (!birthDate || !serviceDate) return false
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const service = new Date(`${serviceDate}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(service.getTime()) || birth > service) return false
  let age = service.getUTCFullYear() - birth.getUTCFullYear()
  if (service.getUTCMonth() < birth.getUTCMonth() || (service.getUTCMonth() === birth.getUTCMonth() && service.getUTCDate() < birth.getUTCDate())) age--
  return age < 12
}

function roomIdentity(text: string) {
  const match = text.match(/\b\d{3,4}[A-Za-z]?(?:\s*[\/,]\s*\d{3,4}[A-Za-z]?){1,}\b/)
  if (!match) return undefined
  const rooms = match[0].split(/[\/,]/).map(value => value.trim().toUpperCase()).filter(Boolean).sort()
  return rooms.length > 1 ? `rooms:${rooms.join('|')}` : undefined
}

function parseInstruction(text: string, baseCovers = 0): Instruction | null {
  const normalized = clean(text)
  if (!normalized) return null
  const arithmetic = normalized.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(pax|adults?)\s*\+\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(infants?|children|child|kids?)\b/i)
  if (arithmetic) {
    const first = numberValue(arithmetic[1]); const kids = numberValue(arithmetic[3])
    return { total: first + kids, explicitKids: kids, source: 'arithmetic_expression', evidence: arithmetic[0] }
  }
  // Activity Program comments also use compact party notation (for example
  // "B: 414/415 4+2pax"). It is an explicit larger-party correction, not a
  // trailing two-pax override. Resolve it before the generic `N pax` rule.
  const compactArithmetic = normalized.match(/\b(\d+)\s*\+\s*(\d+)\s*(?:pax|people|persons?|guests?)\b/i)
  if (compactArithmetic) {
    const first = Number(compactArithmetic[1]); const second = Number(compactArithmetic[2])
    return { total: first + second, explicitKids: 0, source: 'arithmetic_expression', evidence: compactArithmetic[0] }
  }
  const incremental = normalized.match(/(?:\bADD\s+(\d+)\s+MORE\s+(?:PEOPLE|PERSONS?|GUESTS?|PAX)\b|\b(\d+)\s+ADDITIONAL\s+(?:PEOPLE|PERSONS?|GUESTS?|PAX)\b|(?:^|[\s:;(])\+(\d+)\s*(?:PEOPLE|PERSONS?|GUESTS?|PAX)\b)/i)
  const incrementalCount = incremental?.[1] || incremental?.[2] || incremental?.[3]
  if (incrementalCount && baseCovers > 0) return { total: baseCovers + Number(incrementalCount), explicitKids: 0, source: 'incremental_addition', evidence: incremental![0] }
  const joining = normalized.match(/\b(?:JOINING\s+WITH\s+(?:FAMILY\s*[,\-]?\s*)?(\d+)\s*[.]?\s*PAX|JOINING\s+FAMILY\s+WITH\s+(\d+)\s*[.]?\s*PAX|JOINING\s+(?:ANOTHER|OTHER)\s+ROOM\s*[,\-]?\s*TOTAL\s+(\d+)\s*[.]?\s*PAX|JOINING\s+GROUP\s+(\d+)\s*[.]?\s*PAX|JOINING\s+(\d+)\s*[.]?\s*PAX)\b/i)
  const joiningTotal = joining?.slice(1).find(Boolean)
  if (joiningTotal) return { total: Number(joiningTotal), explicitKids: 0, source: 'joining_family_total', evidence: joining![0], groupTotal: Number(joiningTotal), groupId: roomIdentity(normalized) }
  const groupDinner = normalized.match(/\b(\d+)\s*[.]?\s*PAX\s+(?:DINNER\s+TOGETHER|TOGETHER)\b/i)
  if (groupDinner) return { total: Number(groupDinner[1]), explicitKids: 0, source: 'group_total', evidence: groupDinner[0], groupTotal: Number(groupDinner[1]), groupId: roomIdentity(normalized) }
  const bookingGroup = normalized.match(/\b(?:TABLE|BOOKING)\s+FOR\s+(\d+)\s*(?:PAX|PEOPLE|PERSONS?|GUESTS?)?\b/i)
  if (bookingGroup) return { total: Number(bookingGroup[1]), explicitKids: 0, source: 'group_total', evidence: bookingGroup[0], groupTotal: Number(bookingGroup[1]), groupId: roomIdentity(normalized) }
  const namedGroup = normalized.match(/\b(\d+)\s*[.]?\s*PAX\s*(GROUP|FAMILY)\b/i)
  if (namedGroup) return { total: Number(namedGroup[1]), explicitKids: 0, source: 'group_total', evidence: namedGroup[0], groupTotal: Number(namedGroup[1]), groupId: roomIdentity(normalized) }
  const paxThenRooms = normalized.match(/\b(\d+)\s*PAX\s*\/\s*\d{3,4}[A-Za-z]?(?:\s*,\s*\d{3,4}[A-Za-z]?)+/i)
  if (paxThenRooms) return { total: Number(paxThenRooms[1]), explicitKids: 0, source: 'group_total', evidence: paxThenRooms[0], groupTotal: Number(paxThenRooms[1]), groupId: roomIdentity(paxThenRooms[0]) }
  const roomsThenPax = normalized.match(/\b\d{3,4}[A-Za-z]?(?:\s*[\/,]\s*\d{3,4}[A-Za-z]?)+\s+(\d+)\s*PAX\b/i)
  if (roomsThenPax) return { total: Number(roomsThenPax[1]), explicitKids: 0, source: 'group_total', evidence: roomsThenPax[0], groupTotal: Number(roomsThenPax[1]), groupId: roomIdentity(roomsThenPax[0]) }
  const futureRussian = normalized.match(/будет\s+(\d+)\s+человек(?:а|ов)?/iu)
  if (futureRussian) return { total: Number(futureRussian[1]), explicitKids: 0, source: 'explicit_booking_override', evidence: futureRussian[0] }
  const guestsRussian = normalized.match(/(\d+)\s+гост(?:я|ей|ь)/iu)
  if (guestsRussian) return { total: Number(guestsRussian[1]), explicitKids: 0, source: 'explicit_booking_override', evidence: guestsRussian[0] }
  const simple = normalized.match(/\b(\d+)\s*[.]?\s*PAX\b/i)
  if (!simple) return null
  const total = Number(simple[1])
  return { total, explicitKids: 0, source: 'explicit_booking_override', evidence: simple[0] }
}

function labelledInstructions(notes: string, baseCovers: number | null) {
  const segments: Record<'B' | 'I', string[]> = { B: [], I: [] }
  const matches = [...notes.matchAll(/(?:^|\s)([BI]):\s*([\s\S]*?)(?=(?:\s+[BI]:)|$)/gi)]
  for (const match of matches) segments[match[1].toUpperCase() as 'B' | 'I'].push(match[2])
  const parseLast = (values: string[]) => values.map(value => parseInstruction(value, baseCovers || 0)).filter((value): value is Instruction => Boolean(value)).at(-1) || null
  return parseLast(segments.I) || parseLast(segments.B) || parseInstruction(notes, baseCovers || 0)
}

function counts(record: BookingImportPreviewRecord, total: number | null, explicitKids: number) {
  const structuredKids = record.guestMembers.filter(member => childOnDate(member.birthDate, record.reservationDate)).length
  const datedMembers = record.guestMembers.filter(member => member.birthDate && !Number.isNaN(new Date(`${member.birthDate}T00:00:00Z`).getTime())).length
  if (total === null) return { structuredKids, kids: structuredKids, adults: null, unknownAges: 0, diagnostics: [] as string[] }
  const diagnostics: string[] = []
  const unrepresentedPeople = Math.max(0, total - record.guestMembers.length)
  const additionalKids = Math.min(explicitKids, unrepresentedPeople)
  let kids = Math.min(total, structuredKids + additionalKids)
  if (explicitKids > additionalKids) {
    kids = Math.min(total, Math.max(kids, explicitKids))
    if (structuredKids && explicitKids) diagnostics.push('Explicit child wording overlaps structured guest rows; the higher supported child count was used to prevent double counting.')
  }
  const explicitlyClassified = /\badults?\b/i.test(record.sourceNotes) && /\b(?:infants?|children|child|kids?)\b/i.test(record.sourceNotes)
  const unknownAges = explicitlyClassified ? 0 : Math.max(0, total - datedMembers - additionalKids)
  if (unknownAges) diagnostics.push(`${unknownAges} guest age${unknownAges === 1 ? ' is' : 's are'} unavailable; the adult/child split remains provisional.`)
  return { structuredKids, kids, adults: Math.max(0, total - kids), unknownAges, diagnostics }
}

export function resolveBookingCover(record: BookingImportPreviewRecord): BookingImportPreviewRecord {
  const notes = [record.sourceNotes, ...record.guestMembers.map(member => member.guestNotes)].filter(Boolean).join(' ')
  const instruction = labelledInstructions(notes, record.covers)
  const baseSource: BookingCoverResolutionSource = record.sourceStatus.toLowerCase() === 'pending' ? 'base_pending_pax' : record.sourceStatus.toLowerCase() === 'cancelled' ? 'base_cancelled_pax' : 'base_confirmed_pax'
  // A group total describes the combined party, not this booking's own covers.
  // Keep confirmed/pending source PAX authoritative and retain the mentioned
  // total separately for manager review. Only an explicit non-group correction
  // is allowed to replace the individual booking value.
  const total = instruction?.groupTotal && record.covers
    ? record.covers
    : instruction?.total ?? record.covers ?? (record.guestMembers.length || null)
  const source = instruction?.source ?? (record.covers ? baseSource : 'structured_member_count')
  const resolved = counts(record, total, instruction?.explicitKids || 0)
  const coverResolution: BookingCoverResolution = { baseCovers: record.covers, totalCovers: total, adults: resolved.adults, kids: resolved.kids, structuredKids: resolved.structuredKids, explicitKids: instruction?.explicitKids || 0, unknownAges: resolved.unknownAges, source, evidence: instruction?.evidence || (record.covers ? `${record.sourceStatus} (${record.covers} pax)` : `${record.guestMembers.length} structured guest rows`), groupId: instruction?.groupId || roomIdentity(notes), groupTotal: instruction?.groupTotal, diagnostics: resolved.diagnostics }
  return { ...record, covers: total, coverResolution }
}

export function resolveBookingCoverRecords(records: BookingImportPreviewRecord[]) {
  const resolved = records.map(resolveBookingCover)
  const groups = new Map<string, number[]>()
  resolved.forEach((record, index) => { const id = record.coverResolution?.groupId; if (id) { const key = `${record.reservationDate}|${id}`; groups.set(key, [...(groups.get(key) || []), index]) } })
  for (const [, indexes] of groups) {
    const totals = [...new Set(indexes.map(index => resolved[index].coverResolution?.groupTotal).filter((value): value is number => Boolean(value)))]
    if (!totals.length) continue
    if (totals.length > 1) {
      for (const index of indexes) resolved[index].coverResolution?.diagnostics.push(`Conflicting linked-group totals (${totals.join(', ')}) require manager review.`)
      continue
    }
    // Never allocate or redistribute a mentioned group total across bookings.
    // Individual source PAX must survive preview, persistence and reporting.
  }
  return resolved
}
