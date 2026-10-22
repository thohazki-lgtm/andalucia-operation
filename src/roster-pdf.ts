import type { ConfigOption, RosterEntry, Staff } from './domain'

export interface RosterPdfInput {
  view: 'Weekly' | 'Monthly'
  start: string
  end: string
  dates: string[]
  staff: Staff[]
  roster: RosterEntry[]
  dutyOptions: ConfigOption[]
}

type PdfColor = [number, number, number]
type PageDate = string | null

const NAVY: PdfColor = [.04, .16, .25]
const TEXT_NAVY: PdfColor = [.09, .2, .28]
const GOLD: PdfColor = [.82, .66, .36]
const GOLD_DARK: PdfColor = [.49, .37, .16]
const BORDER: PdfColor = [.84, .88, .9]
const MUTED: PdfColor = [.38, .48, .54]
const HEADER_FILL: PdfColor = [.95, .97, .98]
const TODAY_FILL: PdfColor = [.99, .97, .91]

const ascii = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?')
const literal = (value: string) => `(${ascii(value).replace(/([\\()])/g, '\\$1')})`
const number = (value: number) => Number(value.toFixed(2))
const rgb = (hex = '#e9eef0'): PdfColor => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  const value = Number.parseInt(match?.[1] || 'e9eef0', 16)
  return [number((value >> 16) / 255), number((value >> 8 & 255) / 255), number((value & 255) / 255)]
}
const readable = (hex?: string): PdfColor => {
  const [r, g, b] = rgb(hex)
  return r * .299 + g * .587 + b * .114 >= .62 ? TEXT_NAVY : [1, 1, 1]
}
const estimatedTextWidth = (content: string, size: number, bold = false) => ascii(content).length * size * (bold ? .57 : .52)
const fitTextSize = (content: string, width: number, preferred: number, minimum: number) => Math.max(minimum, Math.min(preferred, width / Math.max(ascii(content).length * .57, 1)))
const text = (content: string, x: number, y: number, size = 8, bold = false, color: PdfColor = TEXT_NAVY) => `${color.join(' ')} rg BT /${bold ? 'F2' : 'F1'} ${number(size)} Tf ${number(x)} ${number(y)} Td ${literal(content)} Tj ET\n`
const centeredText = (content: string, x: number, y: number, width: number, size = 8, bold = false, color: PdfColor = TEXT_NAVY) => text(content, x + Math.max(0, (width - estimatedTextWidth(content, size, bold)) / 2), y, size, bold, color)
const rect = (x: number, y: number, width: number, height: number, fill: PdfColor, stroke: PdfColor = BORDER) => `${fill.join(' ')} rg ${stroke.join(' ')} RG ${number(x)} ${number(y)} ${number(width)} ${number(height)} re B\n`
const roundedRect = (x: number, y: number, width: number, height: number, radius: number, fill: PdfColor, stroke: PdfColor = fill) => {
  const r = Math.min(radius, width / 2, height / 2)
  const k = .55228475 * r
  return `${fill.join(' ')} rg ${stroke.join(' ')} RG ${number(x + r)} ${number(y)} m ${number(x + width - r)} ${number(y)} l ${number(x + width - r + k)} ${number(y)} ${number(x + width)} ${number(y + r - k)} ${number(x + width)} ${number(y + r)} c ${number(x + width)} ${number(y + height - r)} l ${number(x + width)} ${number(y + height - r + k)} ${number(x + width - r + k)} ${number(y + height)} ${number(x + width - r)} ${number(y + height)} c ${number(x + r)} ${number(y + height)} l ${number(x + r - k)} ${number(y + height)} ${number(x)} ${number(y + height - r + k)} ${number(x)} ${number(y + height - r)} c ${number(x)} ${number(y + r)} l ${number(x)} ${number(y + r - k)} ${number(x + r - k)} ${number(y)} ${number(x + r)} ${number(y)} c B\n`
}
const line = (x1: number, y1: number, x2: number, y2: number, color: PdfColor, width = 1) => `${color.join(' ')} RG ${number(width)} w ${number(x1)} ${number(y1)} m ${number(x2)} ${number(y2)} l S\n`
const parseDate = (date: string) => new Date(`${date}T00:00:00Z`)
const weekday = (date: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(parseDate(date))
const shortDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parseDate(date))
const longDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parseDate(date))
const maldivesToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function datePages(input: RosterPdfInput): PageDate[][] {
  if (input.view === 'Weekly') return [input.dates.slice(0, 7)]
  const pages: PageDate[][] = []
  let page: PageDate[] = Array(parseDate(input.dates[0] || input.start).getUTCDay()).fill(null)
  for (const date of input.dates) {
    page.push(date)
    if (page.length === 7) { pages.push(page); page = [] }
  }
  if (page.length) pages.push([...page, ...Array(7 - page.length).fill(null)])
  return pages.length ? pages : [Array(7).fill(null)]
}

function buildPage(input: RosterPdfInput, pageDates: PageDate[], pageIndex: number, pageCount: number) {
  const pageWidth = 842
  const pageHeight = 595
  const margin = 24
  const nameWidth = 150
  const totalsWidth = 50
  const gridWidth = pageWidth - margin * 2 - nameWidth - totalsWidth
  const cellWidth = gridWidth / 7
  const headerHeight = 43
  const mastheadHeight = 78
  const mastheadGap = 10
  const coverageHeight = 18
  const top = pageHeight - mastheadHeight - mastheadGap - headerHeight
  const availableForStaff = top - 70 - coverageHeight * 3
  const rowHeight = Math.min(29, availableForStaff / Math.max(input.staff.length, 1))
  const optionByValue = new Map(input.dutyOptions.map(option => [option.value, option]))
  const entryByKey = new Map(input.roster.map(entry => [`${entry.staffId}|${entry.date}`, entry]))
  const activeDates = pageDates.filter((date): date is string => Boolean(date))
  const pageStart = activeDates[0] || input.start
  const pageEnd = activeDates.at(-1) || input.end
  const today = maldivesToday()
  let stream = ''

  stream += rect(0, pageHeight - mastheadHeight, pageWidth, mastheadHeight, NAVY, NAVY)
  stream += roundedRect(margin, pageHeight - 57, 32, 32, 16, NAVY, GOLD)
  stream += centeredText('A', margin, pageHeight - 48, 32, 20, true, GOLD)
  stream += text('ANDALUCIA OPERATION', margin + 44, pageHeight - 39, 17, true, [1, 1, 1])
  stream += text(`${input.view.toUpperCase()} DUTY ROSTER`, margin + 44, pageHeight - 57, 8, true, GOLD)
  stream += text(`${longDate(input.start)} - ${longDate(input.end)}`, pageWidth - 220, pageHeight - 40, 8.5, true, [1, 1, 1])
  if (pageCount > 1) stream += text(`WEEK ${pageIndex + 1} OF ${pageCount}  |  ${shortDate(pageStart)} - ${shortDate(pageEnd)}`, pageWidth - 220, pageHeight - 57, 7, true, GOLD)

  stream += rect(margin, top, nameWidth, headerHeight, HEADER_FILL)
  stream += text('TEAM MEMBER', margin + 9, top + 17, 7.5, true)
  pageDates.forEach((date, index) => {
    const x = margin + nameWidth + index * cellWidth
    const isToday = date === today
    stream += rect(x, top, cellWidth, headerHeight, isToday ? TODAY_FILL : HEADER_FILL)
    if (isToday) stream += line(x, top + headerHeight - 2, x + cellWidth, top + headerHeight - 2, GOLD, 2)
    const dayLabel = date ? weekday(date) : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]
    stream += centeredText(dayLabel, x, top + 25, cellWidth, fitTextSize(dayLabel, cellWidth - 8, 7.6, 6.1), true, isToday ? GOLD_DARK : TEXT_NAVY)
    if (date) stream += centeredText(`${shortDate(date)}${isToday ? '  TODAY' : ''}`, x, top + 10, cellWidth, fitTextSize(`${shortDate(date)}${isToday ? ' TODAY' : ''}`, cellWidth - 8, 6.5, 5.4), isToday, isToday ? GOLD_DARK : MUTED)
  })
  const totalX = margin + nameWidth + gridWidth
  stream += rect(totalX, top, totalsWidth, headerHeight, HEADER_FILL)
  stream += centeredText('WORKING', totalX, top + 24, totalsWidth, 6.5, true)
  stream += centeredText('DAYS', totalX, top + 11, totalsWidth, 6.5, true)

  input.staff.forEach((person, rowIndex) => {
    const y = top - (rowIndex + 1) * rowHeight
    const rowFill: PdfColor = rowIndex % 2 ? [.98, .99, .99] : [1, 1, 1]
    stream += rect(margin, y, nameWidth, rowHeight, rowFill)
    stream += text(person.name, margin + 9, y + rowHeight / 2 + 3.3, fitTextSize(person.name, nameWidth - 18, 8.1, 6.4), true)
    stream += text(person.number, margin + 9, y + rowHeight / 2 - 8.2, 6.1, false, MUTED)
    let workingDays = 0
    pageDates.forEach((date, index) => {
      const x = margin + nameWidth + index * cellWidth
      stream += rect(x, y, cellWidth, rowHeight, rowFill)
      if (!date) return
      const entry = entryByKey.get(`${person.id}|${date}`)
      const option = optionByValue.get(entry?.dutyCode || '')
      if (option?.metadata?.countsAsWorking) workingDays++
      const code = option?.metadata?.displayCode?.trim() || option?.value || 'Unassigned'
      const pillWidth = cellWidth - 13
      const pillHeight = Math.min(20, rowHeight - 7)
      const pillX = x + (cellWidth - pillWidth) / 2
      const pillY = y + (rowHeight - pillHeight) / 2
      const fill: PdfColor = option ? rgb(option.color) : [.94, .96, .97]
      stream += roundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2, fill, option ? fill : BORDER)
      const fontSize = fitTextSize(code, pillWidth - 10, 8.1, 5.4)
      stream += centeredText(code, pillX, pillY + pillHeight / 2 - fontSize / 3, pillWidth, fontSize, true, option ? readable(option.color) : MUTED)
    })
    stream += rect(totalX, y, totalsWidth, rowHeight, rowFill)
    stream += centeredText(String(workingDays), totalX, y + rowHeight / 2 - 3, totalsWidth, 8.7, true)
  })

  const coverage = pageDates.map(date => {
    if (!date) return { working: '', off: '', annualLeave: '' }
    const entries = input.roster.filter(entry => entry.date === date)
    return {
      working: String(entries.filter(entry => optionByValue.get(entry.dutyCode)?.metadata?.countsAsWorking).length),
      off: String(entries.filter(entry => optionByValue.get(entry.dutyCode)?.metadata?.dutyClassification === 'off').length),
      annualLeave: String(entries.filter(entry => optionByValue.get(entry.dutyCode)?.metadata?.dutyClassification === 'annualLeave').length)
    }
  })
  const coverageStart = top - input.staff.length * rowHeight
  ;[
    ['SCHEDULED TO WORK', 'working'],
    ['OFF', 'off'],
    ['ANNUAL LEAVE', 'annualLeave']
  ].forEach(([label, key], rowIndex) => {
    const y = coverageStart - (rowIndex + 1) * coverageHeight
    const fill: PdfColor = rowIndex === 0 ? [.96, .98, .98] : [.98, .99, .99]
    stream += rect(margin, y, nameWidth, coverageHeight, fill)
    stream += text(label, margin + 9, y + 5.5, 6.2, rowIndex === 0, rowIndex === 0 ? TEXT_NAVY : MUTED)
    coverage.forEach((item, index) => {
      const x = margin + nameWidth + index * cellWidth
      stream += rect(x, y, cellWidth, coverageHeight, fill)
      stream += centeredText(item[key as keyof typeof item], x, y + 5.3, cellWidth, 6.5, rowIndex === 0, rowIndex === 0 ? TEXT_NAVY : MUTED)
    })
    stream += rect(totalX, y, totalsWidth, coverageHeight, fill)
  })

  stream += text('Saved Duty Roster assignments', margin, 21, 6.3, false, MUTED)
  stream += centeredText(`PAGE ${pageIndex + 1} OF ${pageCount}`, pageWidth - margin - 90, 21, 90, 6.3, true, MUTED)
  return stream
}

export function buildRosterPdf(input: RosterPdfInput): Uint8Array {
  const pageWidth = 842
  const pageHeight = 595
  const pages = datePages(input)
  const streams = pages.map((dates, index) => buildPage(input, dates, index, pages.length))
  const regularFontId = 3 + streams.length * 2
  const boldFontId = regularFontId + 1
  const pageIds = streams.map((_, index) => 3 + index * 2)
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${streams.length} >>`
  ]
  streams.forEach((stream, index) => {
    const contentId = 4 + index * 2
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    objects.push(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`)
  })
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')

  let output = '%PDF-1.4\n%ANDALUCIA\n'
  const offsets: number[] = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(new TextEncoder().encode(output).length)
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = new TextEncoder().encode(output).length
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(output)
}

export async function shareOrDownloadRosterPdf(input: RosterPdfInput) {
  const bytes = buildRosterPdf(input)
  const filename = `Andalucia-Duty-Roster-${input.start}-to-${input.end}.pdf`
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes)
  const file = new File([buffer], filename, { type: 'application/pdf' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ title: `Andalucía Duty Roster · ${input.start}–${input.end}`, files: [file] }); return 'shared' as const }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const }
  }
  const url = URL.createObjectURL(file)
  try { const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove() } finally { URL.revokeObjectURL(url) }
  return 'downloaded' as const
}
