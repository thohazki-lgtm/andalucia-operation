import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { PGlite } from '@electric-sql/pglite'
import { TimesheetError, TimesheetService } from './timesheet-service.js'

export const OFFICIAL_TIMESHEET_TEMPLATE_VERSION = 'approved-ot-v2'
export const OFFICIAL_TIMESHEET_TEMPLATE_SHA256 = 'c1b2517d25370c7acbf034d6bde83c8ed8d4ff29717f5067379720edd8742a88'
export const OFFICIAL_TIMESHEET_TEMPLATE_PATH = fileURLToPath(new URL('./templates/Siyam World Official Timesheet - Approved OT v2.xlsx', import.meta.url))
export const LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_SHA256 = '1effd08c0e2ed9491b497a8328fc8048878ebe9e194d005e64b49839c9797b9c'
export const LEGACY_OFFICIAL_TIMESHEET_TEMPLATE_PATH = fileURLToPath(new URL('./templates/Admin - Manual Attendance Signing Sheet - uODATED- 2026.xlsx', import.meta.url))

type ZipEntry = {
  name: string
  central: Buffer
  localOffset: number
  localRecord: Buffer
  compression: number
  flags: number
  modTime: number
  modDate: number
  localExtra: Buffer
  uncompressed: Buffer
}

type ZipArchive = { entries: ZipEntry[]; comment: Buffer }

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let value = 0; value < 256; value++) {
    let crc = value
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    table[value] = crc >>> 0
  }
  return table
})()

const crc32 = (input: Buffer) => {
  let crc = 0xffffffff
  for (const value of input) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const findEndOfCentralDirectory = (archive: Buffer) => {
  const minimum = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimum; offset--) if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  throw new Error('The official timesheet template is not a supported ZIP package.')
}

export function readZipArchive(archive: Buffer): ZipArchive {
  const eocdOffset = findEndOfCentralDirectory(archive)
  if (archive.readUInt16LE(eocdOffset + 4) !== 0 || archive.readUInt16LE(eocdOffset + 6) !== 0) throw new Error('Multi-disk Excel packages are not supported.')
  const entryCount = archive.readUInt16LE(eocdOffset + 10)
  const centralOffset = archive.readUInt32LE(eocdOffset + 16)
  const commentLength = archive.readUInt16LE(eocdOffset + 20)
  const comment = archive.subarray(eocdOffset + 22, eocdOffset + 22 + commentLength)
  const centralEntries: Array<Omit<ZipEntry, 'localRecord' | 'localExtra' | 'uncompressed'>> = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('The official timesheet central directory is invalid.')
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLengthForEntry = archive.readUInt16LE(cursor + 32)
    const length = 46 + nameLength + extraLength + commentLengthForEntry
    const central = Buffer.from(archive.subarray(cursor, cursor + length))
    const flags = central.readUInt16LE(8)
    const nameBytes = central.subarray(46, 46 + nameLength)
    const name = nameBytes.toString(flags & 0x0800 ? 'utf8' : 'latin1').replace(/\\/g, '/')
    const localOffset = central.readUInt32LE(42)
    if (localOffset === 0xffffffff || central.readUInt32LE(20) === 0xffffffff || central.readUInt32LE(24) === 0xffffffff) throw new Error('ZIP64 Excel packages are not supported.')
    centralEntries.push({ name, central, localOffset, compression: central.readUInt16LE(10), flags, modTime: central.readUInt16LE(12), modDate: central.readUInt16LE(14) })
    cursor += length
  }
  const offsets = centralEntries.map(entry => entry.localOffset).sort((left, right) => left - right)
  const entries: ZipEntry[] = centralEntries.map(entry => {
    if (archive.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error(`The local ZIP record for ${entry.name} is invalid.`)
    const nameLength = archive.readUInt16LE(entry.localOffset + 26)
    const extraLength = archive.readUInt16LE(entry.localOffset + 28)
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength
    const compressedSize = entry.central.readUInt32LE(20)
    const nextOffset = offsets.find(offset => offset > entry.localOffset) ?? centralOffset
    const localRecord = Buffer.from(archive.subarray(entry.localOffset, nextOffset))
    const localExtra = Buffer.from(archive.subarray(entry.localOffset + 30 + nameLength, dataOffset))
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize)
    const uncompressed = entry.compression === 0 ? Buffer.from(compressed) : entry.compression === 8 ? inflateRawSync(compressed) : (() => { throw new Error(`Unsupported ZIP compression method ${entry.compression} for ${entry.name}.`) })()
    return { ...entry, localRecord, localExtra, uncompressed }
  })
  return { entries, comment: Buffer.from(comment) }
}

function rebuildZipArchive(source: ZipArchive, replacements: ReadonlyMap<string, Buffer>, removals: ReadonlySet<string> = new Set()) {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let localOffset = 0
  const retainedEntries = source.entries.filter(entry => !removals.has(entry.name))
  for (const entry of retainedEntries) {
    const replacement = replacements.get(entry.name)
    let localRecord: Buffer
    const central = Buffer.from(entry.central)
    if (replacement) {
      const compression = entry.compression === 0 ? 0 : 8
      const compressed = compression === 0 ? replacement : deflateRawSync(replacement, { level: 9 })
      const flags = entry.flags & ~0x0008
      const nameLength = central.readUInt16LE(28)
      const nameBytes = central.subarray(46, 46 + nameLength)
      const checksum = crc32(replacement)
      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(0x04034b50, 0)
      localHeader.writeUInt16LE(central.readUInt16LE(6), 4)
      localHeader.writeUInt16LE(flags, 6)
      localHeader.writeUInt16LE(compression, 8)
      localHeader.writeUInt16LE(entry.modTime, 10)
      localHeader.writeUInt16LE(entry.modDate, 12)
      localHeader.writeUInt32LE(checksum, 14)
      localHeader.writeUInt32LE(compressed.length, 18)
      localHeader.writeUInt32LE(replacement.length, 22)
      localHeader.writeUInt16LE(nameBytes.length, 26)
      localHeader.writeUInt16LE(entry.localExtra.length, 28)
      localRecord = Buffer.concat([localHeader, nameBytes, entry.localExtra, compressed])
      central.writeUInt16LE(flags, 8)
      central.writeUInt16LE(compression, 10)
      central.writeUInt32LE(checksum, 16)
      central.writeUInt32LE(compressed.length, 20)
      central.writeUInt32LE(replacement.length, 24)
    } else localRecord = entry.localRecord
    central.writeUInt32LE(localOffset, 42)
    localRecords.push(localRecord)
    centralRecords.push(central)
    localOffset += localRecord.length
  }
  const centralDirectory = Buffer.concat(centralRecords)
  const eocd = Buffer.alloc(22 + source.comment.length)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(retainedEntries.length, 8)
  eocd.writeUInt16LE(retainedEntries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localOffset, 16)
  eocd.writeUInt16LE(source.comment.length, 20)
  source.comment.copy(eocd, 22)
  return Buffer.concat([...localRecords, centralDirectory, eocd])
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const cellPattern = (reference: string) => new RegExp(`<c\\b(?=[^>]*\\br="${reference}")([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`)

function withoutCalculationChainRelationships(xml: string) {
  return xml.replace(/<Relationship\b[^>]*\/>/g, relationship =>
    /\bType="[^"]*\/calcChain"/.test(relationship) || /\bTarget="(?:[^"/]+\/)*calcChain\.xml"/.test(relationship) ? '' : relationship
  )
}

function withoutCalculationChainContentType(xml: string) {
  return xml.replace(/<Override\b[^>]*\/>/g, override =>
    /\bPartName="\/xl\/calcChain\.xml"/.test(override) ? '' : override
  )
}

function withFullCalculationOnLoad(xml: string) {
  const calculationProperties = /<calcPr\b[^>]*\/>/
  const match = calculationProperties.exec(xml)
  if (!match) return xml.replace(/<\/workbook>/, '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>')
  const normalized = match[0]
    .replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/g, '')
    .replace(/\/>$/, ' calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>')
  return xml.slice(0, match.index) + normalized + xml.slice(match.index + match[0].length)
}

function replaceCell(xml: string, reference: string, value: string | number | null, style?: number) {
  const pattern = cellPattern(reference)
  const match = pattern.exec(xml)
  if (!match) throw new Error(`The official Sample template is missing cell ${reference}.`)
  let attributes = match[1].replace(/\s+t="[^"]*"/g, '').trimEnd()
  if (style !== undefined) {
    attributes = /\bs="[^"]*"/.test(attributes)
      ? attributes.replace(/\bs="[^"]*"/, `s="${style}"`)
      : `${attributes} s="${style}"`
  }
  const replacement = value === null
    ? `<c${attributes}/>`
    : typeof value === 'number'
      ? `<c${attributes}><v>${Number.isInteger(value) ? value : value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')}</v></c>`
      : `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  return xml.slice(0, match.index) + replacement + xml.slice(match.index + match[0].length)
}

const excelSerial = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000
}
const timeSerial = (time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  return (hour * 60 + minute) / 1440
}
const weekday = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)).toUpperCase()
const totalValue = (minutes: number) => minutes === 1440 ? '24:00' : minutes / 1440

export type OfficialTimesheetExport = { bytes: Buffer; filename: string; templateSha256: string; templateVersion: string }

export class OfficialTimesheetExportService {
  private readonly timesheets: TimesheetService
  constructor(
    private readonly db: PGlite,
    private readonly templatePath = OFFICIAL_TIMESHEET_TEMPLATE_PATH,
    private readonly expectedTemplateSha256 = OFFICIAL_TIMESHEET_TEMPLATE_SHA256
  ) { this.timesheets = new TimesheetService(db) }

  async generate(staffId: string, month: string): Promise<OfficialTimesheetExport> {
    const template = await readFile(this.templatePath)
    const templateSha256 = createHash('sha256').update(template).digest('hex')
    if (templateSha256 !== this.expectedTemplateSha256.toLowerCase()) throw new TimesheetError('OFFICIAL_TEMPLATE_CHECKSUM_MISMATCH', 'The official Siyam World timesheet template failed its integrity check.', 409)
    const archive = readZipArchive(template)
    const workbookXml = archive.entries.find(entry => entry.name === 'xl/workbook.xml')?.uncompressed.toString('utf8') || ''
    const workbookRelationships = archive.entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels')?.uncompressed.toString('utf8') || ''
    if (!/<sheet\b[^>]*name="Sample"[^>]*r:id="rId1"/.test(workbookXml) || !/<Relationship\b[^>]*Id="rId1"[^>]*Target="worksheets\/sheet1.xml"/.test(workbookRelationships)) throw new TimesheetError('OFFICIAL_TEMPLATE_STRUCTURE_MISMATCH', 'The verified Sample worksheet mapping is unavailable.', 409)
    const sampleEntry = archive.entries.find(entry => entry.name === 'xl/worksheets/sheet1.xml')
    if (!sampleEntry) throw new TimesheetError('OFFICIAL_TEMPLATE_STRUCTURE_MISMATCH', 'The verified Sample worksheet is unavailable.', 409)
    const verifiedSampleXml = sampleEntry.uncompressed.toString('utf8')
    if (!/<dimension\b[^>]*ref="A1:I45"/.test(verifiedSampleXml) || !/r="H10"[^>]*t="inlineStr"[\s\S]*?<t>Approved OT<\/t>/.test(verifiedSampleXml) || !/r="I10"/.test(verifiedSampleXml)) {
      throw new TimesheetError('OFFICIAL_TEMPLATE_STRUCTURE_MISMATCH', 'The verified Approved OT template layout is unavailable.', 409)
    }

    const sheet = (await this.db.query<any>('select id,status from employee_timesheets where staff_id=$1 and month_start=$2::date', [staffId, `${month}-01`])).rows[0]
    if (!sheet || !['approved', 'locked'].includes(sheet.status)) throw new TimesheetError('OFFICIAL_TIMESHEET_NOT_APPROVED', 'Only an approved or locked monthly timesheet can be exported as official.', 409)
    const view = await this.timesheets.managerMonth(staffId, month)
    const blocking = view.exceptions.filter(issue => issue.blocking)
    if (blocking.length) throw new TimesheetError('OFFICIAL_TIMESHEET_INVALID', `Resolve ${blocking.length} blocking timesheet exception${blocking.length === 1 ? '' : 's'} before official export.`, 409)
    if (view.days.some(day => day.scheduledDuty?.countsAsWorking && (day.state !== 'confirmed' || !day.firstShift.timeIn || !day.firstShift.timeOut))) throw new TimesheetError('OFFICIAL_TIMESHEET_INCOMPLETE', 'Every scheduled working day must have confirmed complete hours before official export.', 409)

    const staff = (await this.db.query<any>(`select s.staff_number,s.full_name,coalesce(position.label,s.position_key) designation
      from staff s left join configuration_options position on position.group_key='staff_positions' and position.value=s.position_key where s.id=$1`, [staffId])).rows[0]
    if (!staff) throw new TimesheetError('STAFF_NOT_FOUND', 'The selected Staff profile was not found.', 404)
    const approval = (await this.db.query<any>(`select u.display_name manager_name,coalesce(position.label,manager.position_key,'') manager_designation
      from employee_timesheet_month_audits audit join user_accounts u on u.id=audit.actor_user_id
      left join staff manager on manager.id=u.staff_id
      left join configuration_options position on position.group_key='staff_positions' and position.value=manager.position_key
      where audit.timesheet_id=$1 and audit.action='approved' order by audit.created_at desc,audit.id desc limit 1`, [sheet.id])).rows[0]
    if (!approval) throw new TimesheetError('OFFICIAL_TIMESHEET_APPROVAL_EVIDENCE_MISSING', 'The official export requires a durable manager approval record.', 409)

    let xml = verifiedSampleXml
    xml = replaceCell(xml, 'D7', String(staff.staff_number))
    xml = replaceCell(xml, 'D8', String(staff.full_name))
    xml = replaceCell(xml, 'D9', String(staff.designation))
    xml = replaceCell(xml, 'I5', excelSerial(`${month}-01`))
    for (let row = 11; row <= 41; row++) {
      const day = view.days[row - 11]
      for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) xml = replaceCell(xml, `${column}${row}`, null)
      if (!day) continue
      xml = replaceCell(xml, `A${row}`, excelSerial(day.date))
      xml = replaceCell(xml, `B${row}`, weekday(day.date))
      xml = replaceCell(xml, `H${row}`, day.overtime.status === 'approved' ? day.overtime.durationMinutes / 1440 : 0)
      if (!day.scheduledDuty) continue
      if (!day.scheduledDuty.countsAsWorking) {
        xml = replaceCell(xml, `C${row}`, day.scheduledDuty.code, 51)
        continue
      }
      xml = replaceCell(xml, `C${row}`, timeSerial(day.firstShift.timeIn!))
      xml = replaceCell(xml, `D${row}`, timeSerial(day.firstShift.timeOut!))
      if (day.secondShift.timeIn && day.secondShift.timeOut) {
        xml = replaceCell(xml, `E${row}`, timeSerial(day.secondShift.timeIn))
        xml = replaceCell(xml, `F${row}`, timeSerial(day.secondShift.timeOut))
      }
      xml = replaceCell(xml, `G${row}`, totalValue(day.totalMinutes))
    }
    xml = replaceCell(xml, 'C43', String(approval.manager_name))
    xml = replaceCell(xml, 'C44', String(approval.manager_designation || ''))
    xml = replaceCell(xml, 'C45', null)
    const relationshipEntry = archive.entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels')
    const contentTypesEntry = archive.entries.find(entry => entry.name === '[Content_Types].xml')
    if (!relationshipEntry || !contentTypesEntry) throw new TimesheetError('OFFICIAL_TEMPLATE_STRUCTURE_MISMATCH', 'The verified workbook package metadata is unavailable.', 409)
    const workbookWithSafeCalculationProperties = withFullCalculationOnLoad(workbookXml)
    const relationshipsWithoutCalculationChain = withoutCalculationChainRelationships(relationshipEntry.uncompressed.toString('utf8'))
    const contentTypesWithoutCalculationChain = withoutCalculationChainContentType(contentTypesEntry.uncompressed.toString('utf8'))
    const calculationChainEntries = new Set(archive.entries.filter(entry => entry.name.toLowerCase() === 'xl/calcchain.xml').map(entry => entry.name))
    const bytes = rebuildZipArchive(archive, new Map([
      ['xl/worksheets/sheet1.xml', Buffer.from(xml, 'utf8')],
      ['xl/workbook.xml', Buffer.from(workbookWithSafeCalculationProperties, 'utf8')],
      ['xl/_rels/workbook.xml.rels', Buffer.from(relationshipsWithoutCalculationChain, 'utf8')],
      ['[Content_Types].xml', Buffer.from(contentTypesWithoutCalculationChain, 'utf8')]
    ]), calculationChainEntries)
    const safeNumber = String(staff.staff_number).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'employee'
    return { bytes, filename: `Siyam-World-Timesheet-${safeNumber}-${month}.xlsx`, templateSha256, templateVersion: OFFICIAL_TIMESHEET_TEMPLATE_VERSION }
  }
}
