import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { OfficialTimesheetExportService, LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_PATH, LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_SHA256, OFFICIAL_TIMESHEET_TEMPLATE_PATH, OFFICIAL_TIMESHEET_TEMPLATE_SHA256, OFFICIAL_TIMESHEET_TEMPLATE_VERSION, readZipArchive } from './official-timesheet-export.js'
import { TimesheetError, TimesheetService } from './timesheet-service.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('official-timesheet-export', '027')
const templateBefore = await readFile(OFFICIAL_TIMESHEET_TEMPLATE_PATH)
const templateHash = createHash('sha256').update(templateBefore).digest('hex')
const legacyTemplateBefore = await readFile(LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_PATH)
const legacyTemplateHash = createHash('sha256').update(legacyTemplateBefore).digest('hex')

const xmlDecode = (value: string) => value.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
const cell = (xml: string, reference: string) => {
  const match = new RegExp(`<c\\b(?=[^>]*\\br="${reference}")([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`).exec(xml)
  assert(match, `Missing ${reference}`)
  if (!match[2]) return null
  const inline = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(match[2])
  if (inline) return xmlDecode(inline[1])
  const numeric = /<v>([^<]*)<\/v>/.exec(match[2])
  return numeric ? Number(numeric[1]) : null
}
const cellStyle = (xml: string, reference: string) => {
  const match = new RegExp(`<c\\b(?=[^>]*\\br="${reference}")[^>]*>`).exec(xml)
  assert(match, `Missing ${reference}`)
  const style = /\bs="(\d+)"/.exec(match[0])
  return style ? Number(style[1]) : 0
}
const excelSerial = (date: string) => { const [year, month, day] = date.split('-').map(Number); return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000 }
const daysInMonth = (month: string) => { const [year, monthNumber] = month.split('-').map(Number); return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() }
const closeTo = (actual: unknown, expected: number) => assert(Math.abs(Number(actual) - expected) < 1e-9, `${actual} was not close to ${expected}`)

try {
  assert.equal(templateHash, OFFICIAL_TIMESHEET_TEMPLATE_SHA256)
  assert.equal(legacyTemplateHash, LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_SHA256)
  const templateArchive = readZipArchive(templateBefore)
  const templateWorkbookXml = templateArchive.entries.find(entry => entry.name === 'xl/workbook.xml')!.uncompressed.toString('utf8')
  const templateWorkbookRelationships = templateArchive.entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels')!.uncompressed.toString('utf8')
  const templateContentTypes = templateArchive.entries.find(entry => entry.name === '[Content_Types].xml')!.uncompressed.toString('utf8')
  const templateSheetXml = templateArchive.entries.find(entry => entry.name === 'xl/worksheets/sheet1.xml')!.uncompressed.toString('utf8')
  assert.equal(templateArchive.entries.some(entry => entry.name.toLowerCase() === 'xl/calcchain.xml'), false)
  assert.doesNotMatch(templateWorkbookRelationships, /calcChain/i)
  assert.doesNotMatch(templateContentTypes, /calcChain/i)
  assert.match(templateWorkbookXml, /<calcPr\b[^>]*calcMode="auto"[^>]*fullCalcOnLoad="1"[^>]*forceFullCalc="1"[^>]*\/>/)
  assert.match(templateWorkbookXml, /name="Afzal"[^>]*state="hidden"/)
  assert.match(templateWorkbookXml, /Sample!\$A\$1:\$I\$45/)
  assert.match(templateSheetXml, /<dimension[^>]*ref="A1:I45"/)
  assert.match(templateSheetXml, /<pageSetup[^>]*paperSize="9"[^>]*orientation="portrait"/)
  assert.equal(cell(templateSheetXml, 'H10'), 'Approved OT')
  for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) assert.equal(cellStyle(templateSheetXml, `${column}10`), 52)
  for (let row = 11; row <= 41; row++) {
    assert.equal(cellStyle(templateSheetXml, `A${row}`), 47)
    assert.equal(cellStyle(templateSheetXml, `B${row}`), 48)
    for (const column of ['C', 'D', 'E', 'F', 'G']) assert.equal(cellStyle(templateSheetXml, `${column}${row}`), 49)
    assert.equal(cellStyle(templateSheetXml, `H${row}`), 50)
    assert.equal(cellStyle(templateSheetXml, `I${row}`), 48)
  }
  const managerId = randomUUID()
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,active,sort_order) values($1,'staff_positions','assistant_manager','Assistant F&B Manager',true,1)", [randomUUID()])
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'MGR-001','Export Manager','assistant_manager','active','2020-01-01')", [managerId])
  await fixture.db.query('update user_accounts set staff_id=$2 where id=$1', [fixture.ownerId, managerId])
  const dutyCodes = [
    ['WORK', 'ON', 'Morning Service', true, 'working'], ['OFFICIAL_OFF', 'OFF', 'Day Off', false, 'off'],
    ['OFFICIAL_AL', 'AL', 'Annual Leave', false, 'annual_leave'], ['OFFICIAL_PH', 'PH', 'Public Holiday', false, 'public_holiday'],
    ['OFFICIAL_SL', 'SL', 'Sick Leave', false, 'sick_leave'], ['OFFICIAL_SK', 'SK', 'Historical Sick Leave', false, 'sick_leave'],
    ['OFFICIAL_RR', 'RR', 'R&R1', false, 'rr'], ['OFFICIAL_EL', 'EL', 'Emergency Leave', false, 'emergency_leave'],
    ['OFFICIAL_OTHER', 'TR', 'Training', false, 'training']
  ] as const
  for (let index = 0; index < dutyCodes.length; index++) {
    const [value, displayCode, label, countsAsWorking, classification] = dutyCodes[index]
    await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,$3,'#1b6288',$4,true,$5)", [randomUUID(), value, label, JSON.stringify({ displayCode, countsAsWorking, dutyClassification: classification }), index + 1])
  }

  const exporter = new OfficialTimesheetExportService(fixture.db)
  const generated: Array<{ month: string; bytes: Buffer; xml: string }> = []
  for (const month of ['2027-02', '2028-02', '2026-04', '2026-01']) {
    const staffId = randomUUID()
    await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,'assistant_manager','active','2024-01-01')", [staffId, `EXP-${month}`, `Export Employee ${month}`])
    const count = daysInMonth(month)
    const rosterCodes = ['WORK', 'WORK', 'WORK', 'OFFICIAL_OFF', 'OFFICIAL_AL', 'OFFICIAL_PH', 'OFFICIAL_SL', 'OFFICIAL_SK', 'OFFICIAL_RR', 'OFFICIAL_EL', 'OFFICIAL_OTHER']
    for (let day = 1; day <= count; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`
      await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, rosterCodes[day - 1] || 'OFFICIAL_OFF'])
    }
    const service = new TimesheetService(fixture.db, () => new Date('2025-01-01T00:00:00.000Z'))
    const approvedOt = await service.confirmDay(staffId, `${month}-01`, { firstShift: { timeIn: '08:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null }, overtime: { duration: '01:15', expectedRevision: 0 } }, fixture.ownerId)
    await service.reviewOvertime(staffId, `${month}-01`, 'approved', '', approvedOt.overtime.revision, fixture.ownerId)
    const rejectedOt = await service.confirmDay(staffId, `${month}-02`, { firstShift: { timeIn: '08:00', timeOut: '12:00' }, secondShift: { timeIn: '18:00', timeOut: '22:00' }, overtime: { duration: '00:45', expectedRevision: 0 } }, fixture.ownerId)
    await service.confirmDay(staffId, `${month}-03`, { firstShift: { timeIn: '22:00', timeOut: '06:00' }, secondShift: { timeIn: null, timeOut: null } }, fixture.ownerId)
    const pendingView = await service.managerMonth(staffId, month)
    assert.equal(pendingView.overtimeTotals.pendingMinutes, 45)
    await service.submitMonth(staffId, month, fixture.ownerId)
    await assert.rejects(exporter.generate(staffId, month), (error: unknown) => error instanceof TimesheetError && error.code === 'OFFICIAL_TIMESHEET_NOT_APPROVED')
    await assert.rejects(service.approveMonth(staffId, month, fixture.ownerId), (error: unknown) => error instanceof TimesheetError && error.code === 'PENDING_OVERTIME_REVIEW')
    await service.reviewOvertime(staffId, `${month}-02`, 'rejected', 'Not payable', rejectedOt.overtime.revision, fixture.ownerId)
    await service.approveMonth(staffId, month, fixture.ownerId)
    const result = await exporter.generate(staffId, month)
    assert.equal(result.filename, `Siyam-World-Timesheet-EXP-${month}-${month}.xlsx`)
    assert.equal(result.templateVersion, OFFICIAL_TIMESHEET_TEMPLATE_VERSION)
    if (month === '2028-02') {
      await service.lockMonth(staffId, month, fixture.ownerId)
      const lockedResult = await exporter.generate(staffId, month)
      assert.equal(lockedResult.filename, result.filename)
      assert.deepEqual(lockedResult.bytes, result.bytes)
    }
    const output = readZipArchive(result.bytes)
    const source = readZipArchive(templateBefore)
    assert.deepEqual(output.entries.map(entry => entry.name), source.entries.map(entry => entry.name))
    const sourceByName = new Map(source.entries.map(entry => [entry.name, entry.uncompressed]))
    const expectedChangedParts = new Set(['xl/worksheets/sheet1.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'])
    for (const entry of output.entries) if (!expectedChangedParts.has(entry.name)) assert.deepEqual(entry.uncompressed, sourceByName.get(entry.name), `${entry.name} changed unexpectedly`)
    assert.doesNotMatch(output.entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels')!.uncompressed.toString('utf8'), /calcChain/)
    assert.doesNotMatch(output.entries.find(entry => entry.name === '[Content_Types].xml')!.uncompressed.toString('utf8'), /calcChain/)
    assert.equal(output.entries.some(entry => entry.name.toLowerCase() === 'xl/calcchain.xml'), false)
    assert.match(output.entries.find(entry => entry.name === 'xl/workbook.xml')!.uncompressed.toString('utf8'), /<calcPr\b[^>]*calcMode="auto"[^>]*fullCalcOnLoad="1"[^>]*forceFullCalc="1"[^>]*\/>/)
    const xml = output.entries.find(entry => entry.name === 'xl/worksheets/sheet1.xml')!.uncompressed.toString('utf8')
    assert.equal(cell(xml, 'D7'), `EXP-${month}`); assert.equal(cell(xml, 'D8'), `Export Employee ${month}`); assert.equal(cell(xml, 'D9'), 'Assistant F&B Manager')
    assert.equal(cell(xml, 'I5'), excelSerial(`${month}-01`)); assert.equal(cell(xml, 'A11'), excelSerial(`${month}-01`)); assert.equal(cell(xml, 'B11'), new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`)).toUpperCase())
    closeTo(cell(xml, 'C11'), 8 / 24); closeTo(cell(xml, 'D11'), 17 / 24); closeTo(cell(xml, 'G11'), 9 / 24)
    closeTo(cell(xml, 'C12'), 8 / 24); closeTo(cell(xml, 'D12'), 12 / 24); closeTo(cell(xml, 'E12'), 18 / 24); closeTo(cell(xml, 'F12'), 22 / 24); closeTo(cell(xml, 'G12'), 8 / 24)
    closeTo(cell(xml, 'C13'), 22 / 24); closeTo(cell(xml, 'D13'), 6 / 24); closeTo(cell(xml, 'G13'), 8 / 24)
    closeTo(cell(xml, 'H11'), 75 / 1440); assert.equal(cell(xml, 'H12'), 0); assert.equal(cell(xml, 'H13'), 0)
    assert.deepEqual(['OFF', 'AL', 'PH', 'SL', 'SK', 'RR', 'EL', 'TR'].map((_, index) => cell(xml, `C${14 + index}`)), ['OFF', 'AL', 'PH', 'SL', 'SK', 'RR', 'EL', 'TR'])
    for (let row = 14; row <= 21; row++) assert.equal(cellStyle(xml, `C${row}`), 51)
    assert.equal(cell(xml, 'C43'), 'official-timesheet-export Owner'); assert.equal(cell(xml, 'C44'), 'Assistant F&B Manager'); assert.equal(cell(xml, 'C45'), null)
    assert.equal(cell(xml, 'I11'), null); assert.equal(cell(xml, 'I41'), null)
    const firstUnusedRow = 11 + count
    if (firstUnusedRow <= 41) for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) assert.equal(cell(xml, `${column}${firstUnusedRow}`), null)
    generated.push({ month, bytes: result.bytes, xml })
  }

  const leap = generated.find(item => item.month === '2028-02')!.xml
  assert.equal(cell(leap, 'A39'), excelSerial('2028-02-29')); assert.equal(cell(leap, 'A40'), null)
  const nonLeap = generated.find(item => item.month === '2027-02')!.xml
  assert.equal(cell(nonLeap, 'A38'), excelSerial('2027-02-28')); assert.equal(cell(nonLeap, 'A39'), null)
  const april = generated.find(item => item.month === '2026-04')!.xml
  assert.equal(cell(april, 'A40'), excelSerial('2026-04-30')); assert.equal(cell(april, 'A41'), null)
  const january = generated.find(item => item.month === '2026-01')!.xml
  assert.equal(cell(january, 'A41'), excelSerial('2026-01-31'))

  const unapprovedStaff = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'EXP-OPEN','Unapproved Export','assistant_manager','active','2024-01-01')", [unapprovedStaff])
  await fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start,status,created_by_user_id,updated_by_user_id) select $1,$2,id,'2026-06-01','open',$3,$3 from outlet_scopes where scope_key='andalucia'", [randomUUID(), unapprovedStaff, fixture.ownerId])
  await assert.rejects(exporter.generate(unapprovedStaff, '2026-06'), (error: unknown) => error instanceof TimesheetError && error.code === 'OFFICIAL_TIMESHEET_NOT_APPROVED')

  const blockedStaff = randomUUID(); const blockedSheet = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'EXP-BLOCKED','Blocked Export','assistant_manager','active','2024-01-01')", [blockedStaff])
  await fixture.db.query("insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,'2026-05-01','WORK')", [randomUUID(), blockedStaff])
  await fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start,status,created_by_user_id,updated_by_user_id) select $1,$2,id,'2026-05-01','approved',$3,$3 from outlet_scopes where scope_key='andalucia'", [blockedSheet, blockedStaff, fixture.ownerId])
  await fixture.db.query("insert into employee_timesheet_month_audits(id,timesheet_id,actor_user_id,action,previous_status,new_status,snapshot_data) values($1,$2,$3,'approved','submitted','approved','{}'::jsonb)", [randomUUID(), blockedSheet, fixture.ownerId])
  await assert.rejects(exporter.generate(blockedStaff, '2026-05'), (error: unknown) => error instanceof TimesheetError && error.code === 'OFFICIAL_TIMESHEET_INVALID')
  await fixture.db.query("update employee_timesheets set status='locked' where id=$1", [blockedSheet])
  await assert.rejects(exporter.generate(blockedStaff, '2026-05'), (error: unknown) => error instanceof TimesheetError && error.code === 'OFFICIAL_TIMESHEET_INVALID')

  await assert.rejects(new OfficialTimesheetExportService(fixture.db, OFFICIAL_TIMESHEET_TEMPLATE_PATH, '0'.repeat(64)).generate(blockedStaff, '2026-05'), (error: unknown) => error instanceof TimesheetError && error.code === 'OFFICIAL_TEMPLATE_CHECKSUM_MISMATCH')
  assert.equal(createHash('sha256').update(await readFile(OFFICIAL_TIMESHEET_TEMPLATE_PATH)).digest('hex'), templateHash)
  assert.equal(createHash('sha256').update(await readFile(LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_PATH)).digest('hex'), legacyTemplateHash)
  const [server, api, ui] = await Promise.all(['server/index.ts', 'src/api.ts', 'src/manager-timesheets.tsx'].map(path => readFile(path, 'utf8')))
  assert.match(server, /officialTimesheetExportMatch[\s\S]*authorizedManagerTimesheet\(request\)[\s\S]*officialTimesheets\.generate/)
  assert.match(server, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/)
  assert.match(api, /downloadOfficial/); assert.match(api, /Content-Disposition/); assert.match(api, /link\.download = filename/)
  assert.match(ui, /Generate Official Timesheet/); assert.match(ui, /officialTimesheetExportAvailable\(detail\.status\)/)
  assert.match(ui, /disabled=\{!canExportOfficial \|\| exporting\}/); assert.match(ui, /Available after manager approval\./)
  assert.match(ui, /The official timesheet could not be generated\./)

  await mkdir(resolve('.tmp', 'stage5e2'), { recursive: true })
  for (const item of generated) await writeFile(resolve('.tmp', 'stage5e2', `official-timesheet-${item.month}.xlsx`), item.bytes)
  console.log(JSON.stringify({ templateVersion: OFFICIAL_TIMESHEET_TEMPLATE_VERSION, templateChecksumVerified: true, legacyMasterPreserved: true, versionedMasterPreserved: true, generatedPackageChangesLimitedToSampleAndCalculationMetadata: true, staleCalculationChainRemoved: true, hiddenAfzalPreserved: true, printAreaPreserved: true, monthLengths: [28, 29, 30, 31], singleShift: true, splitShift: true, overnightShift: true, serverCalculatedTotals: true, approvedOtExported: '01:15', rejectedOtExported: '00:00', absentOtExported: '00:00', approvedOtMonthlyMinutes: 75, rosterCodes: ['OFF', 'AL', 'PH', 'SL', 'SK', 'RR', 'EL', 'TR'], signaturesBlank: true, managerApprovalEvidence: true, approvedExport: true, lockedExport: true, unapprovedExportBlocked: true, incompleteApprovedAndLockedMonthsBlocked: true, managerOnlyRoute: true, canonicalDatabaseUsed: false }, null, 2))
} finally { await fixture.cleanup() }
