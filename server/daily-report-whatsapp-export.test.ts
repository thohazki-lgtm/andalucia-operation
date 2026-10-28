import assert from 'node:assert/strict'
import { buildDailyReportWhatsAppMessage, dailyReportExportStatus } from '../src/daily-report-whatsapp.js'
import type { DailyReportView } from '../src/domain.js'

const view = {
  serviceDate: '2026-10-16',
  report: { status: 'approved', revisionNumber: 3 },
  snapshot: { id: 'snapshot-1' },
  content: {
    servicePerformance: { totalCovers: 27, adults: 22, kids: 5, totalBookings: 8, arrivedCovers: 24, noShowCovers: 3, noShowRooms: ['406', '709'], walkIns: 2, walkInRooms: ['118'], bookingByTimeSlot: [] },
    symphony: { foodRevenue: '1200', beverageRevenue: '500', wineRevenue: '200', liquorRevenue: '100', totalSale: '1700', totalDiscount: '20', totalVoid: '10', netSale: '1670', totalRevenue: '1670', voidDetails: [] },
    serviceVerification: { doubleDinePax: 4, details: [{ roomNumber: '470', pax: 4, sourceOutlet: 'Japanese Restaurant', note: 'Second seating confirmed.' }] },
    serviceCharges: { amount: '42.50', remarks: 'Collected separately at the outlet.' },
    upselling: { chargeables: [], wineSpirits: [], details: [], totalUpsellRevenue: '75', itemsSold: 2, topItem: 'Birthday Basic', topSeller: 'Server One' },
    guestOccasions: {
      categories: [
        { key: 'vip', label: 'VIP', count: 3, covers: 13 },
        { key: 'siyamFamily', label: 'Repeaters / Siyam Family', count: 3, covers: 13 },
        { key: 'famtrip', label: 'Famtrip', count: 1, covers: 4 },
        { key: 'birthday', label: 'Birthday', count: 1, covers: 2 },
        { key: 'tlc', label: 'TLC', count: 1, covers: 1 }
      ],
      roomDetails: [
        { occasionId: 'occasion-228', bookingId: 'booking-228', category: 'vip', categoryKeys: ['vip', 'siyamFamily'], label: 'VIP', guestName: 'Guest 228', roomNumber: '228', covers: 2 },
        { occasionId: 'occasion-512', bookingId: 'booking-512', category: 'vip', categoryKeys: ['vip', 'siyamFamily', 'famtrip'], label: 'VIP', guestName: 'Guest 512', roomNumber: '512', covers: 4 },
        { occasionId: 'occasion-512-duplicate', bookingId: 'booking-512', category: 'vip', categoryKeys: ['vip', 'siyamFamily', 'famtrip'], label: 'VIP', guestName: 'Guest 512', roomNumber: '512', covers: 4 },
        { occasionId: 'occasion-multi-room', bookingId: 'booking-multi-room', category: 'vip', categoryKeys: ['vip', 'siyamFamily'], label: 'VIP', guestName: 'Multi-room Party', roomNumber: '620 / 621', covers: 7 },
        { occasionId: 'occasion-birthday', bookingId: 'booking-birthday', category: 'birthday', label: 'Birthday', guestName: 'Birthday Guest', roomNumber: '333', covers: 2 },
        { occasionId: 'occasion-tlc', bookingId: 'booking-tlc', category: 'tlc', categoryKeys: ['tlc'], label: 'TLC', guestName: 'TLC Guest', roomNumber: '', covers: 1 }
      ]
    },
    manager: { operationSummary: '', operatingSummary: 'Smooth service with strong teamwork.', operationsIssues: 'Ice machine follow-up.', keyOperationalIssue: '', guestFeedbackServiceRecovery: '', followUpRequired: '' }
  }
} as unknown as DailyReportView

const full = buildDailyReportWhatsAppMessage(view, 'full')
assert.equal(dailyReportExportStatus(view), 'APPROVED · REVISION 3')
for (const expected of ['*ANDALUCÍA DAILY REPORT*', '*SERVICE PERFORMANCE*', '*SYMPHONY / REVENUE*', '*CHARGEABLE ITEMS / UPSELLING*', '*GUEST OCCASIONS*', '*SERVICE VERIFICATION & CHARGES*', '*MANAGER REVIEW*', '*Status:* APPROVED · REVISION 3', 'Covers: 27 · Adults: 22 · Kids: 5', 'No-show Covers: 3 · Rooms: 406, 709', 'Walk-ins: 2 · Rooms: 118', 'Total Revenue: $1,670.00', 'Revenue: $75.00\nItems Sold: 2', 'VIP: 3 bookings · 13 pax\nRooms: 228 × 2, 512 × 4, 620 / 621 × 7', 'Repeaters / Siyam Family: 3 bookings · 13 pax\nRooms: 228 × 2, 512 × 4, 620 / 621 × 7', 'Famtrip: 1 booking · 4 pax\nRooms: 512 × 4', 'Birthday: 1 booking · 2 pax\nRooms: 333 × 2', 'TLC: 1 booking · 1 pax', 'Double Dine Pax: 4', '470 · 4 pax · Japanese Restaurant · Second seating confirmed.', 'Daily Service Charges: $42.50', 'Remarks: Collected separately at the outlet.', 'Operating Summary: Smooth service with strong teamwork.', 'Operations Issues: Ice machine follow-up.']) assert.ok(full.includes(expected), expected)
assert.equal((full.match(/━━━━━━━━━━━━━━━━━━━━/g) || []).length, 6)
assert.equal((full.match(/────────────────────/g) || []).length, 4, 'guest occasion categories must have consistent separators')
for (const metric of ['Food Revenue', 'Beverage Revenue', 'Wine Revenue', 'Liquor Revenue', 'Total Sale', 'Discount', 'Void', 'Net Sale', 'Total Revenue']) assert.match(full, new RegExp(`^${metric}:`, 'm'), `${metric} must occupy its own line`)
assert.equal(/\*[^*]+\*\n(?!\n)/.test(full), false, 'every heading must be followed by one blank line')
assert.equal(/\n{3,}/.test(full), false, 'message must not contain excessive blank lines')
assert.equal(full.includes('TLC: 1 booking · 1 pax\nRooms:'), false)
assert.equal((full.match(/512 × 4/g) || []).length, 3, 'overlapping category membership must appear once in each applicable category')

const quick = buildDailyReportWhatsAppMessage(view, 'quick')
assert.ok(quick.includes('*QUICK MANAGEMENT SUMMARY*'))
assert.ok(quick.includes('*MANAGER REVIEW*'))
assert.equal((quick.match(/━━━━━━━━━━━━━━━━━━━━/g) || []).length, 2)
assert.equal(/\*[^*]+\*\n(?!\n)/.test(quick), false, 'every heading must be followed by one blank line')
assert.equal(/\n{3,}/.test(quick), false, 'message must not contain excessive blank lines')
assert.ok(quick.includes('Guest Occasions: VIP: 3 bookings · 13 pax'))
assert.ok(quick.includes('Service Charges: $42.50'))
assert.ok(quick.includes('Total Revenue: $1,670.00\nNet Sale: $1,670.00\nUpselling Revenue: $75.00\nItems Sold: 2'))
assert.equal(quick.includes('Rooms: 228 × 2'), false, 'Quick Management Summary must remain unchanged')
assert.equal(quick.includes('*SYMPHONY / REVENUE*'), false)

const explicitZero = { ...view, snapshot: null, content: { ...view.content, serviceCharges: { amount: '0.00', remarks: '' } } } as DailyReportView
assert.ok(buildDailyReportWhatsAppMessage(explicitZero, 'quick').includes('Service Charges: $0.00'))
const unentered = { ...view, snapshot: null, content: { ...view.content, serviceCharges: { amount: '', remarks: '' } } } as DailyReportView
assert.ok(buildDailyReportWhatsAppMessage(unentered, 'quick').includes('Service Charges: Not entered'))

const longRooms = Array.from({ length: 24 }, (_, index) => ({ occasionId: `occasion-long-${index}`, bookingId: `booking-long-${index}`, category: 'vip', categoryKeys: ['vip'], label: 'VIP', guestName: `Guest ${index}`, roomNumber: String(700 + index), covers: index + 1 }))
const longView = { ...view, snapshot: null, report: { ...view.report!, status: 'draft' as const }, content: { ...view.content, guestOccasions: { categories: [{ key: 'vip', label: 'VIP', count: 24, covers: 300 }], roomDetails: longRooms } } } as DailyReportView
const longMessage = buildDailyReportWhatsAppMessage(longView, 'full')
assert.ok(longMessage.includes('Rooms: 700 × 1'))
assert.ok(longMessage.includes('723 × 24'), 'long room lists must not be truncated')

const frozenContent = { ...view.content, guestOccasions: { categories: [{ key: 'anniversary', label: 'Anniversary', count: 1, covers: 6 }], roomDetails: [{ occasionId: 'snapshot-occasion', bookingId: 'snapshot-booking', category: 'anniversary', categoryKeys: ['anniversary'], label: 'Anniversary', guestName: 'Snapshot Guest', roomNumber: '905', covers: 6 }] } }
const snapshotView = { ...view, content: { ...view.content, guestOccasions: { categories: [{ key: 'vip', label: 'VIP', count: 1, covers: 2 }], roomDetails: [{ occasionId: 'live-occasion', bookingId: 'live-booking', category: 'vip', categoryKeys: ['vip'], label: 'VIP', guestName: 'Live Guest', roomNumber: '101', covers: 2 }] } }, snapshot: { ...view.snapshot!, frozenPayload: frozenContent } } as unknown as DailyReportView
const snapshotMessage = buildDailyReportWhatsAppMessage(snapshotView, 'full')
assert.ok(snapshotMessage.includes('Anniversary: 1 booking · 6 pax\nRooms: 905 × 6'))
assert.equal(snapshotMessage.includes('Rooms: 101 × 2'), false, 'approved frozen snapshot must remain authoritative')

const emptyView = { ...view, snapshot: null, report: null, content: { ...view.content, guestOccasions: { categories: [{ key: 'vip', label: 'VIP', count: 0, covers: 0 }], roomDetails: [] } } } as DailyReportView
assert.ok(buildDailyReportWhatsAppMessage(emptyView, 'full').includes('*GUEST OCCASIONS*\n\nNone recorded'))

const draft = { ...view, report: { ...view.report!, status: 'draft' as const }, snapshot: null, content: { ...view.content, symphony: { ...view.content.symphony, totalRevenue: '' } } } as DailyReportView
const draftMessage = buildDailyReportWhatsAppMessage(draft, 'quick')
assert.ok(draftMessage.includes('*Status:* DRAFT · NOT APPROVED'))
assert.ok(draftMessage.includes('Total Revenue: Not entered'))
assert.equal(draftMessage.includes('*Status:* APPROVED'), false)

console.log(JSON.stringify({ status: 'PASS', approvedSnapshotPreferred: true, draftClearlyMarked: true, formats: ['full', 'quick'], guestOccasionRooms: true, overlappingCategories: true, duplicateRoomEvidenceRemoved: true, missingRoomsNotInvented: true, longListsPreserved: true }, null, 2))
