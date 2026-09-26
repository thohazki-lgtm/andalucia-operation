import type { PGlite } from '@electric-sql/pglite'
import type { DailyReportReadinessItem } from '../src/domain.js'
import { DailyReportSnapshotRepository, type DailyReportActor, type DailyReportManualPayload, type DailyReportRevenueVerification, type DailyReportSnapshotContent } from './daily-report-snapshot-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { WineSpiritsRepository } from './wine-spirits-repository.js'

const DEFAULT_CATEGORIES = [
  ['honeymoon', 'Honeymoon'], ['birthday', 'Birthday'], ['anniversary', 'Anniversary'], ['seeYouSoon', 'See You Soon'],
  ['vip', 'VIP'], ['tlc', 'TLC'], ['siyamFamily', 'Repeaters / Siyam Family'], ['famtrip', 'Famtrip'], ['presstrip', 'Presstrip'],
] as const
const moneyKeys = ['foodRevenue', 'beverageRevenue', 'wineRevenue', 'liquorRevenue', 'totalSale', 'totalDiscount', 'totalVoid', 'netSale', 'totalRevenue'] as const
const moneyValue = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Number(value) : null
const fixed = (value: number) => value.toFixed(2)
const parseJson = (value: unknown): any => { if (typeof value !== 'string') return value || {}; try { return JSON.parse(value) } catch { return {} } }
const cleanText = (value: unknown, maximum = 4000) => String(value ?? '').trim().slice(0, maximum)
export const isWalkInBookingEvidence = (row: { booking_source?: string | null; source_activity_label?: string | null; raw_import_payload?: unknown }) => { const payload = parseJson(row.raw_import_payload); return row.booking_source === 'walk_in' || payload?.effective?.walkIn === true || payload?.walkIn === true || /walk\s*in/i.test(row.source_activity_label || '') }

export const emptyDailyReportManualPayload = (): DailyReportManualPayload => ({
  symphony: { foodRevenue: '', beverageRevenue: '', wineRevenue: '', liquorRevenue: '', totalSale: '', totalDiscount: '', totalVoid: '', netSale: '', totalRevenue: '', voidDetails: [] },
  serviceVerification: { doubleDinePax: null, details: [] },
  manager: { operationSummary: '', keyOperationalIssue: '', guestFeedbackServiceRecovery: '', followUpRequired: '' },
  revenueVerification: { acknowledged: false },
})

export class DailyReportService {
  readonly snapshots: DailyReportSnapshotRepository
  private readonly wineSpirits: WineSpiritsRepository
  constructor(private readonly db: PGlite, private readonly reporting: ReportingRepository) {
    this.snapshots = new DailyReportSnapshotRepository(db)
    this.wineSpirits = new WineSpiritsRepository(db)
  }

  normalizeManual(input: any): DailyReportManualPayload {
    const symphony: any = {}; for (const key of moneyKeys) symphony[key] = cleanText(input?.symphony?.[key], 30)
    symphony.voidDetails = Array.isArray(input?.symphony?.voidDetails) ? input.symphony.voidDetails.slice(0, 100).map((row: any) => ({ amount: cleanText(row?.amount, 30), reason: cleanText(row?.reason, 500), checkInvoiceNumber: cleanText(row?.checkInvoiceNumber, 120) })) : []
    const doubleDineRaw = input?.serviceVerification?.doubleDinePax
    const doubleDinePax = doubleDineRaw === '' || doubleDineRaw == null ? null : Number(doubleDineRaw)
    const details = Array.isArray(input?.serviceVerification?.details) ? input.serviceVerification.details.slice(0, 100).map((row: any) => ({ roomNumber: cleanText(row?.roomNumber, 120), pax: Number(row?.pax || 0), sourceOutlet: cleanText(row?.sourceOutlet, 200), note: cleanText(row?.note, 500) })) : []
    const verificationInput = input?.revenueVerification
    const revenueVerification: DailyReportRevenueVerification = { acknowledged: verificationInput?.acknowledged === true }
    for (const key of ['verifiedByUserId', 'verifiedByName', 'verifiedAt', 'netSale', 'totalRevenue', 'difference'] as const) if (verificationInput?.[key]) revenueVerification[key] = cleanText(verificationInput[key], 200)
    if (Array.isArray(verificationInput?.messages)) revenueVerification.messages = verificationInput.messages.slice(0, 10).map((message: unknown) => cleanText(message, 500))
    return { symphony, serviceVerification: { doubleDinePax, details }, manager: { operationSummary: cleanText(input?.manager?.operationSummary, 10000), keyOperationalIssue: cleanText(input?.manager?.keyOperationalIssue), guestFeedbackServiceRecovery: cleanText(input?.manager?.guestFeedbackServiceRecovery), followUpRequired: cleanText(input?.manager?.followUpRequired) }, revenueVerification }
  }

  revenueReconciliation(manual: DailyReportManualPayload) {
    const values = Object.fromEntries(moneyKeys.map(key => [key, moneyValue(manual.symphony[key])])) as Record<(typeof moneyKeys)[number], number | null>
    if (moneyKeys.some(key => values[key] == null)) return { status: 'incomplete' as const, messages: [], netSale: values.netSale == null ? null : fixed(values.netSale), totalRevenue: values.totalRevenue == null ? null : fixed(values.totalRevenue), difference: null }
    const messages: string[] = []
    const expectedNet = values.totalSale! - values.totalDiscount! - values.totalVoid!
    if (Math.abs(expectedNet - values.netSale!) > .005) messages.push(`Net Sale differs from Total Sale − Discount − Void by ${fixed(Math.abs(expectedNet - values.netSale!))}.`)
    if (Math.abs(values.netSale! - values.totalRevenue!) > .005) messages.push(`Net Sale and Total Revenue differ by ${fixed(Math.abs(values.netSale! - values.totalRevenue!))}.`)
    if (values.wineRevenue! + values.liquorRevenue! > values.beverageRevenue! + .005) messages.push('Wine and Liquor breakdown exceeds Beverage Revenue.')
    if (!messages.length) return { status: 'reconciled' as const, messages, netSale: fixed(values.netSale!), totalRevenue: fixed(values.totalRevenue!), difference: '0.00' }
    const verification = manual.revenueVerification
    const difference = fixed(Math.abs(values.netSale! - values.totalRevenue!))
    const matches = verification?.acknowledged === true && verification.netSale === fixed(values.netSale!) && verification.totalRevenue === fixed(values.totalRevenue!) && verification.difference === difference && Boolean(verification.verifiedByUserId && verification.verifiedByName && verification.verifiedAt)
    return { status: matches ? 'verified-with-variance' as const : 'verification-required' as const, messages, netSale: fixed(values.netSale!), totalRevenue: fixed(values.totalRevenue!), difference, verifiedByName: matches ? verification!.verifiedByName : undefined, verifiedAt: matches ? verification!.verifiedAt : undefined }
  }

  readiness(manual: DailyReportManualPayload, content: DailyReportSnapshotContent): DailyReportReadinessItem[] {
    const requiredMoney = moneyKeys.filter(key => moneyValue(manual.symphony[key]) == null)
    const values = Object.fromEntries(moneyKeys.map(key => [key, moneyValue(manual.symphony[key])])) as Record<(typeof moneyKeys)[number], number | null>
    const voidRows = manual.symphony.voidDetails
    const validVoidRows = voidRows.filter(row => moneyValue(row.amount) != null && row.reason && row.checkInvoiceNumber)
    const voidSubtotal = validVoidRows.reduce((sum, row) => sum + (moneyValue(row.amount) || 0), 0)
    const reconciliation = this.revenueReconciliation(manual)
    const voidMessages: string[] = []
    if ((values.totalVoid || 0) > 0 && !voidRows.length) voidMessages.push('Void details are required when Total Void is greater than zero.')
    if ((values.totalVoid || 0) > 0 && validVoidRows.length !== voidRows.length) voidMessages.push('Every Void requires amount, reason and Check / Invoice Number.')
    if (values.totalVoid != null && Math.abs(voidSubtotal - values.totalVoid) > .005) voidMessages.push('Void detail subtotal does not match Total Void.')
    const doubleDineEntered = Number.isInteger(manual.serviceVerification.doubleDinePax) && Number(manual.serviceVerification.doubleDinePax) >= 0
    const detailPax = manual.serviceVerification.details.reduce((sum, row) => sum + (Number.isInteger(row.pax) && row.pax > 0 ? row.pax : 0), 0)
    const doubleMismatch = doubleDineEntered && manual.serviceVerification.details.length > 0 && detailPax !== manual.serviceVerification.doubleDinePax
    const item = (key: string, label: string, state: DailyReportReadinessItem['state'], message: string, blocking = false): DailyReportReadinessItem => ({ key, label, state, message, blocking })
    return [
      item('operational', 'Operational Data', 'complete', `${content.servicePerformance.totalBookings} bookings loaded from authoritative operational data.`),
      item('symphony', 'Symphony Revenue', requiredMoney.length ? 'missing' : 'complete', requiredMoney.length ? `Not entered: ${requiredMoney.map(key => key.replace(/([A-Z])/g, ' $1')).join(', ')}.` : 'Official Symphony values explicitly entered.', requiredMoney.length > 0),
      item('upselling', 'Upselling', 'complete', `${content.upselling.itemsSold || 0} realized item${content.upselling.itemsSold === 1 ? '' : 's'} loaded.`),
      item('occasions', 'Guest Occasions', 'complete', `${content.guestOccasions.roomDetails.length} occasion record${content.guestOccasions.roomDetails.length === 1 ? '' : 's'} loaded.`),
      item('voids', 'Void Evidence', requiredMoney.includes('totalVoid') ? 'missing' : voidMessages.length ? 'warning' : 'complete', requiredMoney.includes('totalVoid') ? 'Enter Total Void, including 0 when none.' : voidMessages.join(' ') || ((values.totalVoid || 0) === 0 ? 'Total Void explicitly entered as 0; no supporting detail required.' : 'Void details match the entered Total Void.'), requiredMoney.includes('totalVoid') || voidMessages.length > 0),
      item('doubleDine', 'Double Dine Verification', !doubleDineEntered ? 'missing' : doubleMismatch ? 'warning' : 'complete', !doubleDineEntered ? 'Enter Double Dine Pax, including 0 when none.' : doubleMismatch ? `Detail subtotal ${detailPax} differs from the authoritative total ${manual.serviceVerification.doubleDinePax}.` : `Authoritative total entered: ${manual.serviceVerification.doubleDinePax}.`, !doubleDineEntered),
      item('manager', 'Manager Summary', manual.manager.operationSummary ? 'complete' : 'missing', manual.manager.operationSummary ? 'Manager commentary entered.' : 'Manager Operation Summary is required.', !manual.manager.operationSummary),
      { ...item('reconciliation', 'Revenue Reconciliation', reconciliation.status === 'incomplete' ? 'missing' : reconciliation.status === 'verification-required' ? 'warning' : 'complete', reconciliation.status === 'incomplete' ? 'Complete Symphony entry before reconciliation.' : reconciliation.status === 'reconciled' ? 'RECONCILED — entered Symphony figures require no variance acknowledgement.' : reconciliation.status === 'verified-with-variance' ? `VERIFIED WITH VARIANCE by ${reconciliation.verifiedByName}. ${reconciliation.messages.join(' ')}` : `${reconciliation.messages.join(' ')} Verify against Symphony before approval.`, false), verificationRequired: reconciliation.status === 'verification-required' },
    ]
  }

  private async liveContent(serviceDate: string, outletScopeId: string): Promise<DailyReportSnapshotContent> {
    const report = await this.reporting.report('today', serviceDate, serviceDate)
    const bookingEvidence = (await this.db.query<any>(`select b.room_number,b.booking_source,b.source_activity_label,b.raw_import_payload,c.metadata status_metadata from bookings b left join configuration_options c on c.group_key='booking_statuses' and c.value=b.booking_status where b.reservation_date=$1`, [serviceDate])).rows
    const noShowRooms = bookingEvidence.filter(row => { const metadata = parseJson(row.status_metadata); return metadata.serviceStage === 'noShow' || metadata.bookingMetric === 'noShow' }).flatMap(row => String(row.room_number || '').split(',').map((value: string) => value.trim()).filter(Boolean))
    const walkIns = bookingEvidence.filter(isWalkInBookingEvidence).length
    const chargeables = report.chargeables.financialProofRecords.map(row => ({ id: row.id, item: row.item, quantity: row.quantity, soldBy: row.waiter, staffNumber: '', roomNumber: row.roomNumber, checkInvoiceNumber: row.checkInvoiceNumber, amount: fixed(row.grossTotal), source: 'Chargeable' as const }))
    const wineRows = (await this.wineSpirits.list({ start: serviceDate, end: serviceDate, outletScopeId })).filter(row => !row.archived && row.status === 'charged')
    const wineSpirits = wineRows.map(row => ({ id: row.id, item: row.itemName, quantity: row.quantity, soldBy: row.waiter.name, staffNumber: row.waiter.number, roomNumber: row.roomNumber, checkInvoiceNumber: row.checkInvoiceNumber, amount: row.grossTotal, source: 'Wine / Spirits' as const }))
    const details = [...chargeables, ...wineSpirits]
    const itemTotals = new Map<string, number>(); const sellerTotals = new Map<string, number>()
    for (const row of details) { itemTotals.set(row.item, (itemTotals.get(row.item) || 0) + row.quantity); sellerTotals.set(row.soldBy, (sellerTotals.get(row.soldBy) || 0) + Number(row.amount)) }
    const topItem = [...itemTotals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '—'
    const topSeller = [...sellerTotals].filter(([name]) => name !== 'Unassigned').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '—'
    const roomDetails = report.occasions.records.map(row => ({ occasionId: row.id, bookingId: row.bookingId, category: row.category, label: row.occasionType, guestName: row.guestName, roomNumber: row.roomNumber, covers: row.covers }))
    const categories = DEFAULT_CATEGORIES.map(([key, label]) => { const rows = roomDetails.filter(row => row.category === key || row.label.toLowerCase() === label.toLowerCase()); return { key, label, count: rows.length, covers: rows.reduce((sum, row) => sum + row.covers, 0) } })
    return {
      servicePerformance: { totalCovers: report.bookings.totalCovers, adults: report.bookings.totalAdults, kids: report.bookings.totalKids, totalBookings: report.bookings.totalBookings, arrivedCovers: report.bookings.arrivedCovers, noShowCovers: report.bookings.noShowCovers, noShowRooms: [...new Set(noShowRooms)], walkIns, bookingByTimeSlot: report.bookings.byTime.map(row => ({ time: row.time, bookings: row.bookings, covers: row.totalCovers, adults: row.totalAdults, kids: row.totalKids, noShows: row.noShowCovers, status: row.status })) },
      symphony: emptyDailyReportManualPayload().symphony,
      serviceVerification: { doubleDinePax: 0, details: [] },
      upselling: { chargeables, wineSpirits, details, totalUpsellRevenue: fixed(details.reduce((sum, row) => sum + Number(row.amount), 0)), itemsSold: details.reduce((sum, row) => sum + row.quantity, 0), topItem, topSeller },
      guestOccasions: { categories, roomDetails }, manager: emptyDailyReportManualPayload().manager,
    }
  }

  private contentWithManual(content: DailyReportSnapshotContent, manual: DailyReportManualPayload): DailyReportSnapshotContent {
    return { ...content, symphony: manual.symphony, serviceVerification: { doubleDinePax: Number(manual.serviceVerification.doubleDinePax || 0), details: manual.serviceVerification.details }, manager: manual.manager, revenueVerification: manual.revenueVerification }
  }

  async view(serviceDate: string, outlet: { id: string; scopeKey: string; displayName: string }) {
    const report = await this.snapshots.currentForDate(outlet.id, serviceDate)
    const snapshot = report ? await this.snapshots.snapshotForReport(report.id) : null
    const manual = report?.manualPayload || emptyDailyReportManualPayload()
    const live = snapshot ? null : await this.liveContent(serviceDate, outlet.id)
    const content = snapshot?.frozenPayload || this.contentWithManual(live!, manual)
    return { outlet: { id: outlet.id, key: outlet.scopeKey, name: outlet.displayName }, serviceDate, report, snapshot, content, readiness: this.readiness(manual, content), revenueReconciliation: this.revenueReconciliation(manual), editable: !report || report.status === 'draft' }
  }

  async saveDraft(serviceDate: string, manualInput: unknown, outlet: { id: string; scopeKey: string; displayName: string }, actor: DailyReportActor) {
    const manual = this.normalizeManual(manualInput)
    const current = await this.snapshots.currentForDate(outlet.id, serviceDate)
    if (current?.status === 'reviewed') throw new Error('Reviewed Daily Reports are read-only. This schema does not provide a controlled Return to Draft transition.')
    if (current?.status === 'approved' || current?.status === 'superseded') throw new Error('Approved Daily Reports are locked. Create a future correction revision instead.')
    const reconciliation = this.revenueReconciliation(manual)
    if (manual.revenueVerification?.acknowledged && reconciliation.messages.length) {
      const existingVerification = current?.manualPayload.revenueVerification
      const existingReconciliation = existingVerification ? this.revenueReconciliation({ ...manual, revenueVerification: existingVerification }) : null
      if (existingReconciliation?.status === 'verified-with-variance') manual.revenueVerification = existingVerification
      else {
        const resolvedActor = await this.snapshots.resolveActor(actor, outlet.id)
        manual.revenueVerification = { acknowledged: true, verifiedByUserId: resolvedActor.userId, verifiedByName: resolvedActor.displayName, verifiedAt: new Date().toISOString(), netSale: reconciliation.netSale!, totalRevenue: reconciliation.totalRevenue!, difference: reconciliation.difference!, messages: reconciliation.messages }
      }
    } else if (reconciliation.status !== 'verified-with-variance') manual.revenueVerification = { acknowledged: false }
    if (current) await this.snapshots.updateDraft(current.id, manual, actor)
    else await this.snapshots.createDraft({ outletScopeId: outlet.id, serviceDate, manualPayload: manual }, actor)
    return this.view(serviceDate, outlet)
  }

  async review(serviceDate: string, outlet: { id: string; scopeKey: string; displayName: string }, actor: DailyReportActor) {
    const current = await this.snapshots.currentForDate(outlet.id, serviceDate); if (!current) throw new Error('Save the Daily Report draft before review.')
    const view = await this.view(serviceDate, outlet); const blockers = view.readiness.filter(item => item.blocking)
    if (blockers.length) throw new Error(`Daily Report is not ready: ${blockers.map(item => item.label).join(', ')}.`)
    await this.snapshots.review(current.id, actor); return this.view(serviceDate, outlet)
  }

  async approve(serviceDate: string, idempotencyKey: string, outlet: { id: string; scopeKey: string; displayName: string }, actor: DailyReportActor) {
    const current = await this.snapshots.currentForDate(outlet.id, serviceDate); if (!current) throw new Error('Daily Report not found.')
    const view = await this.view(serviceDate, outlet); const blockers = view.readiness.filter(item => item.blocking)
    if (blockers.length) throw new Error(`Daily Report is not ready: ${blockers.map(item => item.label).join(', ')}.`)
    if (view.revenueReconciliation.status === 'verification-required') throw new Error('Revenue variance must be verified against Symphony before approval.')
    if (current.status !== 'reviewed' && current.status !== 'approved') throw new Error('Only Reviewed reports can be approved.')
    if (current.status === 'approved') {
      const snapshot = await this.snapshots.snapshotForReport(current.id)
      if (!snapshot || snapshot.approvalIdempotencyKey !== idempotencyKey) throw new Error('Daily Report revision is already approved.')
      return view
    }
    const live = await this.liveContent(serviceDate, outlet.id)
    await this.snapshots.approve(current.id, this.contentWithManual(live, current.manualPayload), idempotencyKey, actor)
    return this.view(serviceDate, outlet)
  }
}
