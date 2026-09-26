import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BookingGuestMemberPreview, BookingImportPreviewRecord } from '../src/domain.js'
import { resolveBookingCoverRecords } from './booking-cover-resolver.js'

export const ACTIVITY_PROGRAM_PARSER_VERSION = 'andalucia-activity-program-v2'

type PositionedText = { text: string; x: number; y: number; width: number }
type TextLine = { page: number; y: number; items: PositionedText[]; text: string }
type Section = { time: string; label: string; bookings: number; covers: number; walkIn: boolean }
export type ParsedActivityProgram = { reportDate: string; bookings: BookingImportPreviewRecord[]; validation: { declaredBookingGroups: number; declaredCovers: number; reconciled: boolean; messages: string[] } }

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const dateValue = (value: string): string | null => { const match = value.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/); return match ? `${match[3]}-${match[2]}-${match[1]}` : null }
const inColumn = (line: TextLine, min: number, max = Infinity) => clean(line.items.filter(item => item.x >= min && item.x < max).map(item => item.text).join(' '))
const statusAndPax = (value: string) => { const match = value.match(/\b(Confirmed|Pending|Cancelled)\b\s*\((\d+)\s*pax\)/i); return match ? { status: match[1], covers: Number(match[2]) } : null }
const splitRoom = (value: string) => { const match = clean(value).match(/^(\d+[A-Za-z]?)(?:\s+(.+))?$/); return match ? { roomNumber: match[1], accommodationCode: match[2] || '' } : { roomNumber: '', accommodationCode: clean(value) } }
const warningState = (warnings: string[]) => warnings.some(value => /missing (booking number|reservation time|room|explicit pax)|totals do not reconcile/i.test(value)) ? 'REVIEW_REQUIRED' as const : warnings.length ? 'WARNING' as const : 'READY' as const

async function linesFromPdf(data: Uint8Array): Promise<TextLine[]> {
  const document = await getDocument({ data }).promise
  const lines: TextLine[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = (content.items as any[]).filter(item => typeof item.str === 'string' && item.str.trim()).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width || 0 })) as PositionedText[]
    const rows: PositionedText[][] = []
    for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find(candidate => Math.abs(candidate[0].y - item.y) <= 2.4)
      if (row) row.push(item); else rows.push([item])
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      lines.push({ page: pageNumber, y: row[0].y, items: row, text: clean(row.map(item => item.text).join(' ')) })
    }
  }
  return lines
}

export async function parseActivityProgramPdf(data: Uint8Array): Promise<ParsedActivityProgram> {
  const lines = await linesFromPdf(data)
  const reportDate = dateValue(lines.map(line => line.text).find(text => /Activity Program\s*-/i.test(text)) || '') || ''
  const bookings: BookingImportPreviewRecord[] = []
  const sections: Section[] = []
  let section: Section | null = null
  let current: BookingImportPreviewRecord | null = null

  const finish = () => {
    if (!current) return
    current.primaryGuest = current.guestMembers[0]?.guestName || ''
    current.rooms = [...new Set(current.guestMembers.map(guest => guest.roomNumber).filter(Boolean))]
    if (!current.bookingNumber) current.warnings.push('Missing booking number; unique identity requires manager review.')
    if (!current.reservationTime) current.warnings.push('Missing reservation time; section context could not be established.')
    if (!current.rooms.length) current.warnings.push('Missing room information.')
    if (!current.covers) current.warnings.push('Missing explicit pax; covers were not guessed.')
    if (!current.primaryGuest) current.warnings.push('Missing primary guest name.')
    if ([current.sourceNotes, ...current.guestMembers.map(guest => guest.guestNotes)].some(value => value.includes('�'))) current.warnings.push('Source contains an unreadable character; compare with the PDF.')
    current.warnings = [...new Set(current.warnings)]
    current.readiness = warningState(current.warnings)
    bookings.push(current)
    current = null
  }

  for (const line of lines) {
    const normalized = line.text.toLowerCase()
    const activityTime = line.text.match(/^(\d{2}:\d{2})\b/)?.[1]
    const activityTotals = line.text.match(/(\d+)\s+Bookings\s+(\d+)\s+Guests\s*$/i)
    const isAndaluciaActivity = Boolean(activityTime && activityTotals && /\/\s*Andalucia\b/i.test(line.text))
    if (isAndaluciaActivity && activityTime && activityTotals) {
      finish()
      const label = clean(line.text.replace(/^\d{2}:\d{2}\s*/, '').replace(/\s+\d+\s+Bookings\s+\d+\s+Guests\s*$/i, ''))
      section = { time: activityTime, label, bookings: Number(activityTotals[1]), covers: Number(activityTotals[2]), walkIn: /walk\s*in|hostess/i.test(label) }
      sections.push(section)
      continue
    }
    if (/^\d{2}:\d{2}\s+.+\/\s*(?!Andalucia\b)/i.test(line.text) || (/Dinner at /i.test(line.text) && !/\/\s*Andalucia\b/i.test(line.text))) { finish(); section = null; continue }
    if (!section || /^(Room|Name|Birth Date|Arrival|Departure|MP|Guest Notes|Booking no\.|Status|Booked By)\b/i.test(line.text) || /Activity Program\s*-/i.test(line.text) || /Page \d+ (?:of|from) \d+/i.test(line.text)) continue

    const roomCell = inColumn(line, 35, 117)
    const nameCell = inColumn(line, 117, 232)
    const birthCell = inColumn(line, 232, 289)
    const arrivalCell = inColumn(line, 289, 346)
    const departureCell = inColumn(line, 346, 403)
    const mealCell = inColumn(line, 403, 455)
    const guestNotesCell = inColumn(line, 455, 601)
    const bookingCell = inColumn(line, 601, 643)
    const statusCell = inColumn(line, 643, 726)
    const bookedByCell = inColumn(line, 726)
    const bookingNumber = bookingCell.match(/\b\d{7}\b/)?.[0] || ''
    const status = statusAndPax(`${statusCell} ${bookedByCell}`)
    const isStart = Boolean(status && (bookingNumber || nameCell))

    if (isStart) {
      finish()
      current = { venue: 'andalucia', reservationDate: reportDate, reservationTime: section.time, bookingNumber, primaryGuest: '', rooms: [], covers: status?.covers || null, sourceStatus: status?.status || '', bookedBy: bookedByCell.replace(/^(Confirmed|Pending|Cancelled)\s*\(\d+\s*pax\)\s*/i, ''), sourceNotes: '', activityLabel: section.label, walkIn: section.walkIn, guestMembers: [], warnings: status ? [] : ['Booking status or explicit pax could not be read.'], readiness: 'READY' }
    }
    if (!current) continue

    const room = splitRoom(roomCell)
    const hasGuestData = Boolean(roomCell || birthCell || arrivalCell || departureCell || mealCell)
    if (nameCell && (hasGuestData || isStart || current.guestMembers.length === 0)) {
      current.guestMembers.push({ guestName: nameCell, roomNumber: room.roomNumber, accommodationCode: room.accommodationCode, birthDate: dateValue(birthCell), arrivalDate: dateValue(arrivalCell), departureDate: dateValue(departureCell), mealPlan: mealCell, guestNotes: guestNotesCell, sourceRowOrder: current.guestMembers.length + 1 })
    } else if (nameCell && current.guestMembers.length) {
      current.guestMembers[current.guestMembers.length - 1].guestName = clean(`${current.guestMembers[current.guestMembers.length - 1].guestName} ${nameCell}`)
    }
    if (!nameCell && guestNotesCell && current.guestMembers.length) current.guestMembers[current.guestMembers.length - 1].guestNotes = clean(`${current.guestMembers[current.guestMembers.length - 1].guestNotes} ${guestNotesCell}`)
    const annotation = clean([bookingCell.replace(bookingNumber, ''), !status ? statusCell : ''].filter(Boolean).join(' '))
    if (annotation) current.sourceNotes = clean(`${current.sourceNotes} ${annotation}`)
    if (!isStart && bookedByCell) current.bookedBy = clean(`${current.bookedBy} ${bookedByCell}`)
  }
  finish()

  const resolvedBookings = resolveBookingCoverRecords(bookings)

  const declaredBookingGroups = sections.reduce((total, value) => total + value.bookings, 0)
  const declaredCovers = sections.reduce((total, value) => total + value.covers, 0)
  const parsedCovers = resolvedBookings.reduce((total, value) => total + (value.covers || 0), 0)
  const messages: string[] = []
  if (!reportDate) messages.push('Activity Program date could not be read.')
  if (resolvedBookings.length !== declaredBookingGroups) messages.push(`Parsed ${resolvedBookings.length} booking groups but section headers declare ${declaredBookingGroups}.`)
  if (parsedCovers !== declaredCovers) messages.push(`Pre-intelligence booking candidates total ${parsedCovers} covers while raw section headers declare ${declaredCovers}; the reconciliation ledger must explain the difference.`)
  const structurallyReconciled = Boolean(reportDate) && resolvedBookings.length === declaredBookingGroups
  if (!structurallyReconciled) for (const booking of resolvedBookings) if (booking.readiness === 'READY') { booking.warnings.push('Document structure does not reconcile; review before import.'); booking.readiness = 'REVIEW_REQUIRED' }
  for (const booking of resolvedBookings) if (booking.coverResolution?.diagnostics.some(value => /require manager review|cannot be safely allocated/i.test(value))) { booking.warnings.push(...booking.coverResolution.diagnostics); booking.warnings = [...new Set(booking.warnings)]; booking.readiness = 'REVIEW_REQUIRED' }
  return { reportDate, bookings: resolvedBookings, validation: { declaredBookingGroups, declaredCovers, reconciled: structurallyReconciled, messages } }
}
