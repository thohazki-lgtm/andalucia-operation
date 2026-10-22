import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { OFFICIAL_TIMESHEET_TEMPLATE_SHA256, OFFICIAL_TIMESHEET_TEMPLATE_VERSION, readZipArchive } from './official-timesheet-export.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'
import { TimesheetService } from './timesheet-service.js'

const fixture = await createDisposableStoreThrough('official-timesheet-export-route', '027')
const processes: ChildProcess[] = []
const port = 3031
const base = `http://127.0.0.1:${port}`
const token = `isolated-export-route-${randomUUID()}`
const sleep = (milliseconds: number) => new Promise(resolveCall => setTimeout(resolveCall, milliseconds))
const waitForHealth = async () => {
  let detail = ''
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
      detail = `${response.status} ${await response.text()}`
    } catch (error) { detail = error instanceof Error ? error.message : String(error) }
    await sleep(200)
  }
  throw new Error(`Timed out waiting for isolated export API: ${detail}`)
}
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

try {
  const staffId = randomUUID()
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,active,sort_order) values($1,'staff_positions','assistant_manager','Assistant F&B Manager',true,1)", [randomUUID()])
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'ROUTE-OT-01','Route Export Employee','assistant_manager','active','2024-01-01')", [staffId])
  await fixture.db.query('update user_accounts set staff_id=$2 where id=$1', [fixture.ownerId, staffId])
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','ROUTE_WORK','Morning Service','#1b6288',$2,true,1),($3,'duty_codes','ROUTE_OFF','Day Off','#a7b0ba',$4,true,2)", [randomUUID(), JSON.stringify({ displayCode: 'ON', dutyClassification: 'working', countsAsWorking: true }), randomUUID(), JSON.stringify({ displayCode: 'OFF', dutyClassification: 'off', countsAsWorking: false })])
  for (let day = 1; day <= 31; day++) {
    const date = `2026-01-${String(day).padStart(2, '0')}`
    await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, day <= 2 ? 'ROUTE_WORK' : 'ROUTE_OFF'])
  }
  const service = new TimesheetService(fixture.db, () => new Date('2025-12-15T00:00:00.000Z'))
  const approved = await service.confirmDay(staffId, '2026-01-01', { firstShift: { timeIn: '08:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null }, overtime: { duration: '01:15', expectedRevision: 0 } }, fixture.ownerId)
  await service.reviewOvertime(staffId, '2026-01-01', 'approved', '', approved.overtime.revision, fixture.ownerId)
  const rejected = await service.confirmDay(staffId, '2026-01-02', { firstShift: { timeIn: '08:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null }, overtime: { duration: '00:45', expectedRevision: 0 } }, fixture.ownerId)
  await service.reviewOvertime(staffId, '2026-01-02', 'rejected', 'Not payable', rejected.overtime.revision, fixture.ownerId)
  await service.submitMonth(staffId, '2026-01', fixture.ownerId)
  await service.approveMonth(staffId, '2026-01', fixture.ownerId)
  await fixture.db.close()

  processes.push(spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: String(port), APP_ORIGIN: 'http://127.0.0.1:5199' },
    stdio: 'inherit'
  }))
  await waitForHealth()

  const response = await fetch(`${base}/api/timesheets/${staffId}/2026-01/official-export`, { headers: { Cookie: `andalucia_session=${token}` } })
  if (response.status !== 200) assert.fail(`${response.status} ${await response.text()}`)
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.match(response.headers.get('content-disposition') || '', /Siyam-World-Timesheet-ROUTE-OT-01-2026-01\.xlsx/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-andalucia-timesheet-template-version'), OFFICIAL_TIMESHEET_TEMPLATE_VERSION)
  assert.equal(response.headers.get('x-andalucia-timesheet-template-sha256'), OFFICIAL_TIMESHEET_TEMPLATE_SHA256)

  const bytes = Buffer.from(await response.arrayBuffer())
  await mkdir(resolve('.tmp', 'official-route'), { recursive: true })
  await writeFile(resolve('.tmp', 'official-route', 'isolated-http-route-approved-ot-v2.xlsx'), bytes)
  const archive = readZipArchive(bytes)
  assert.equal(archive.entries.some(entry => entry.name.toLowerCase() === 'xl/calcchain.xml'), false)
  assert.doesNotMatch(archive.entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels')!.uncompressed.toString('utf8'), /calcChain/i)
  assert.doesNotMatch(archive.entries.find(entry => entry.name === '[Content_Types].xml')!.uncompressed.toString('utf8'), /calcChain/i)
  assert.match(archive.entries.find(entry => entry.name === 'xl/workbook.xml')!.uncompressed.toString('utf8'), /<calcPr\b[^>]*calcMode="auto"[^>]*fullCalcOnLoad="1"[^>]*forceFullCalc="1"[^>]*\/>/)
  const sheet = archive.entries.find(entry => entry.name === 'xl/worksheets/sheet1.xml')!.uncompressed.toString('utf8')
  const sharedStrings = archive.entries.find(entry => entry.name === 'xl/sharedStrings.xml')!.uncompressed.toString('utf8')
  assert.match(sheet, /<dimension[^>]*ref="A1:I45"/)
  assert.equal(cell(sheet, 'H10'), 'Approved OT')
  assert.match(sharedStrings, />Signature</)
  assert(Math.abs(Number(cell(sheet, 'H11')) - 75 / 1440) < 1e-9)
  assert.equal(cell(sheet, 'H12'), 0)
  console.log(JSON.stringify({ realHttpRouteExercised: true, route: `/api/timesheets/${staffId}/2026-01/official-export`, templateVersion: OFFICIAL_TIMESHEET_TEMPLATE_VERSION, templateChecksum: OFFICIAL_TIMESHEET_TEMPLATE_SHA256, approvedOt: '01:15', rejectedOt: '00:00', calculationChainAbsent: true, approvedOtColumnPresent: true, canonicalDatabaseUsed: false }, null, 2))
} finally {
  for (const process of processes) process.kill()
  await Promise.all(processes.map(process => new Promise<void>(resolveCall => process.once('exit', () => resolveCall())).catch(() => undefined)))
  await fixture.cleanup()
}
