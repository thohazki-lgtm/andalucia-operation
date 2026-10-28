import type { DailyReportView } from './domain'

export type DailyReportWhatsAppFormat = 'full' | 'quick'

const reportDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
const amount = (value: string | number | null | undefined) => value === '' || value == null ? 'Not entered' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value))
const rooms = (values: string[] | undefined) => values?.length ? values.join(', ') : 'None recorded'
const clean = (value: string | undefined) => value?.trim() || ''
const sectionDivider = '━━━━━━━━━━━━━━━━━━━━'
const categoryDivider = '────────────────────'
const messageSection = (heading: string, lines: string[]) => [`*${heading.toUpperCase()}*`, '', ...lines].join('\n')
const joinSections = (sections: string[]) => sections.join(`\n\n${sectionDivider}\n\n`)

export const dailyReportExportStatus = (view: DailyReportView) => view.snapshot && view.report?.status === 'approved'
  ? `APPROVED · REVISION ${view.report.revisionNumber}`
  : view.report?.status === 'reviewed'
    ? 'REVIEWED · NOT APPROVED'
    : view.report
      ? 'DRAFT · NOT APPROVED'
      : 'DRAFT · NOT SAVED · NOT APPROVED'

const authoritativeContent = (view: DailyReportView) => view.snapshot?.frozenPayload || view.content

const managerSummary = (content: DailyReportView['content']) => {
  const manager = content.manager
  return {
    operating: clean(manager.operatingSummary) || clean(manager.operationSummary),
    issues: clean(manager.operationsIssues)
  }
}

const occasionLines = (content: DailyReportView['content']) => content.guestOccasions.categories
  .filter(category => Number(category.count) > 0)
  .map(category => `${category.label}: ${category.count} booking${category.count === 1 ? '' : 's'} · ${category.covers} pax`)

const occasionRoomLines = (content: DailyReportView['content']) => content.guestOccasions.categories
  .filter(category => Number(category.count) > 0)
  .flatMap((category, categoryIndex) => {
    const seen = new Set<string>()
    const roomDetails = content.guestOccasions.roomDetails
      .filter(row => Array.isArray(row.categoryKeys) ? row.categoryKeys.includes(category.key) : row.category === category.key || row.label.toLowerCase() === category.label.toLowerCase())
      .filter(row => clean(row.roomNumber) && Number.isFinite(Number(row.covers)))
      .filter(row => {
        const identity = `${row.bookingId ? `booking:${row.bookingId}` : `occasion:${row.occasionId}`}|${row.roomNumber.trim()}|${Number(row.covers)}`
        if (seen.has(identity)) return false
        seen.add(identity)
        return true
      })
      .map(row => `${row.roomNumber.trim()} × ${Number(row.covers)}`)
    const summary = `${category.label}: ${category.count} booking${category.count === 1 ? '' : 's'} · ${category.covers} pax`
    const lines = roomDetails.length ? [summary, `Rooms: ${roomDetails.join(', ')}`] : [summary]
    return categoryIndex ? [categoryDivider, ...lines] : lines
  })

export function buildDailyReportWhatsAppMessage(view: DailyReportView, format: DailyReportWhatsAppFormat) {
  const content = authoritativeContent(view)
  const serviceCharges = content.serviceCharges || { amount: '', remarks: '' }
  const service = content.servicePerformance
  const manager = managerSummary(content)
  const occasions = occasionLines(content)
  const reportHeading = messageSection('Andalucía Daily Report', [
    `*Date:* ${reportDate(view.serviceDate)}`,
    `*Status:* ${dailyReportExportStatus(view)}`
  ])
  const serviceLines = [
    `Covers: ${service.totalCovers} · Adults: ${service.adults} · Kids: ${service.kids}`,
    `Arrived Covers: ${service.arrivedCovers}`,
    `No-show Covers: ${service.noShowCovers} · Rooms: ${rooms(service.noShowRooms)}`,
    `Walk-ins: ${service.walkIns} · Rooms: ${rooms(service.walkInRooms)}`
  ]
  const management = [manager.operating && `Operating Summary: ${manager.operating}`, manager.issues && `Operations Issues: ${manager.issues}`].filter(Boolean) as string[]

  if (format === 'quick') return joinSections([
    reportHeading,
    messageSection('Quick Management Summary', [
      ...serviceLines,
      `Total Revenue: ${amount(content.symphony.totalRevenue)}`,
      `Net Sale: ${amount(content.symphony.netSale)}`,
      `Upselling Revenue: ${amount(content.upselling.totalUpsellRevenue)}`,
      `Items Sold: ${content.upselling.itemsSold}`,
      `Double Dine: ${content.serviceVerification.doubleDinePax} pax`,
      `Service Charges: ${amount(serviceCharges.amount)}`,
      `Guest Occasions: ${occasions.length ? occasions.join('; ') : 'None recorded'}`
    ]),
    ...(management.length ? [messageSection('Manager Review', management)] : [])
  ])

  const doubleDineDetails = content.serviceVerification.details.map(row => {
    const parts = [`${row.roomNumber || 'No room'} · ${row.pax} pax`]
    if (clean(row.sourceOutlet)) parts.push(row.sourceOutlet.trim())
    if (clean(row.note)) parts.push(row.note.trim())
    return `- ${parts.join(' · ')}`
  })
  return joinSections([
    reportHeading,
    messageSection('Service Performance', serviceLines),
    messageSection('Symphony / Revenue', [
      `Food Revenue: ${amount(content.symphony.foodRevenue)}`,
      `Beverage Revenue: ${amount(content.symphony.beverageRevenue)}`,
      `Wine Revenue: ${amount(content.symphony.wineRevenue)}`,
      `Liquor Revenue: ${amount(content.symphony.liquorRevenue)}`,
      `Total Sale: ${amount(content.symphony.totalSale)}`,
      `Discount: ${amount(content.symphony.totalDiscount)}`,
      `Void: ${amount(content.symphony.totalVoid)}`,
      `Net Sale: ${amount(content.symphony.netSale)}`,
      `Total Revenue: ${amount(content.symphony.totalRevenue)}`
    ]),
    messageSection('Chargeable Items / Upselling', [
      `Revenue: ${amount(content.upselling.totalUpsellRevenue)}`,
      `Items Sold: ${content.upselling.itemsSold}`,
      `Top Item: ${content.upselling.topItem || 'None recorded'}`,
      `Top Seller: ${content.upselling.topSeller || 'None recorded'}`
    ]),
    messageSection('Guest Occasions', occasions.length ? occasionRoomLines(content) : ['None recorded']),
    messageSection('Service Verification & Charges', [
      `Double Dine Pax: ${content.serviceVerification.doubleDinePax}`,
      ...(doubleDineDetails.length ? doubleDineDetails : ['No Double Dine details recorded']),
      `Daily Service Charges: ${amount(serviceCharges.amount)}`,
      ...(clean(serviceCharges.remarks) ? [`Remarks: ${serviceCharges.remarks.trim()}`] : [])
    ]),
    ...(management.length ? [messageSection('Manager Review', management)] : [])
  ])
}
