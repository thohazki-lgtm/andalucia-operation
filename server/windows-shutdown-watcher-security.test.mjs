import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const script = resolve('deployment/windows/Watch-AndaluciaWindowsShutdown.ps1')
const installer = resolve('deployment/windows/Install-AndaluciaDatabaseScheduler.ps1')
const roots = []
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))
const fixture = async role => {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-shutdown-watcher-')); roots.push(root)
  const data = join(root, '.data', 'postgres'); await mkdir(data, { recursive: true }); await mkdir(join(root, '.runtime', 'logs'), { recursive: true })
  await writeFile(join(root, '.data', 'andalucia-store-identity.json'), JSON.stringify({ role, storeId: 'disposable-watcher', databaseDirectory: data }))
  await writeFile(join(data, 'postmaster.pid'), '-42\n/pglite/data\n1\n5432\n')
  return { root, data, trigger: join(root, 'simulate.event'), signal: join(root, '.backups', '.db2', 'scheduler', 'control', 'windows-shutdown.signal'), responses: join(root, '.backups', '.db2', 'scheduler', 'control', 'responses') }
}
const run = (f, timeout = 5) => new Promise((resolveRun) => {
  const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',script,'-ProjectRoot',f.root,'-SimulationEventPath',f.trigger,'-TimeoutSeconds',String(timeout)], { stdio: ['ignore','pipe','pipe'] })
  let out = '', err = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d); child.on('exit', code => resolveRun({ code, out, err }))
})
try {
  const watcherSource = await readFile(script, 'utf8')
  const installerSource = await readFile(installer, 'utf8')
  assert.match(watcherSource, /SystemEvents\]\) -EventName SessionEnding/)
  assert.doesNotMatch(watcherSource, /Remove-Item[^\n]+postmaster|unlink[^\n]+postmaster/i)
  assert.match(installerSource, /New-ScheduledTaskTrigger -AtLogOn/)
  assert.doesNotMatch(installerSource, /EventID=1074/)
  const good = await fixture('disposable'); const pending = run(good, 8); await writeFile(good.trigger, 'go')
  for (let i=0;i<40 && !existsSync(good.signal);i++) await delay(100)
  assert(existsSync(good.signal), 'watcher did not emit the guarded shutdown signal')
  await mkdir(good.responses, { recursive: true }); await rm(join(good.data, 'postmaster.pid'))
  await writeFile(join(good.responses, 'test.json'), JSON.stringify({ requestId:'test',state:'completed',completedAt:new Date().toISOString(),source:'windows_shutdown_signal' }))
  assert.equal((await pending).code, 0)
  assert.match(await readFile(join(good.root,'.runtime','logs','windows-shutdown-watcher.jsonl'),'utf8'), /ACKNOWLEDGED/)

  const interrupted = await fixture('test'); const failed = run(interrupted, 1); await writeFile(interrupted.trigger, 'go'); const failure = await failed
  assert.notEqual(failure.code, 0); assert(existsSync(join(interrupted.data,'postmaster.pid')), 'watcher must never remove the marker')

  const canonical = await fixture('canonical'); const rejected = await run(canonical, 1)
  assert.notEqual(rejected.code, 0); assert.match(rejected.err + rejected.out, /SHUTDOWN_WATCHER_SIMULATION_CANONICAL_FORBIDDEN/)
  console.log('Windows shutdown watcher security tests passed.')
} finally { await Promise.all(roots.map(root => rm(root, { recursive:true, force:true }))) }
