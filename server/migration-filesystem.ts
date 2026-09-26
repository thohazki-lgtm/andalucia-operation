import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

export type StoreManifestEntry = { path: string; bytes: number; sha256: string }
export type StoreManifest = { generatedAt: string; root: string; files: number; bytes: number; aggregateSha256: string; entries: StoreManifestEntry[] }
const hashFile = (path: string) => new Promise<string>((resolveHash, reject) => {
  const hash = createHash('sha256'); const stream = createReadStream(path)
  stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolveHash(hash.digest('hex')))
})
export const createStoreManifest = async (rootInput: string): Promise<StoreManifest> => {
  const root = resolve(rootInput); const entries: StoreManifestEntry[] = []
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) { const info = await stat(path); entries.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: info.size, sha256: await hashFile(path) }) }
      else throw new Error(`STORE_MANIFEST_UNSUPPORTED_ENTRY:${relative(root, path)}`)
    }
  }
  await walk(root); entries.sort((a, b) => a.path.localeCompare(b.path))
  const aggregate = createHash('sha256'); for (const entry of entries) aggregate.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
  return { generatedAt: new Date().toISOString(), root, files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), aggregateSha256: aggregate.digest('hex'), entries }
}
export const manifestsMatch = (left: StoreManifest, right: StoreManifest) => left.files === right.files && left.bytes === right.bytes && left.aggregateSha256 === right.aggregateSha256
export const copyStoreVerified = async (sourceInput: string, destinationInput: string) => {
  const source = resolve(sourceInput); const destination = resolve(destinationInput)
  if (!existsSync(join(source, 'PG_VERSION'))) throw new Error('SOURCE_STORE_NOT_FOUND')
  if (existsSync(destination)) throw new Error('BACKUP_DESTINATION_ALREADY_EXISTS')
  await mkdir(dirname(destination), { recursive: true })
  const sourceManifest = await createStoreManifest(source)
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  const backupManifest = await createStoreManifest(destination)
  if (!manifestsMatch(sourceManifest, backupManifest)) throw new Error('LIVE_BACKUP_VERIFICATION_FAILED')
  return { sourceManifest, backupManifest }
}
export const writeJsonAtomic = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  const { rename } = await import('node:fs/promises'); await rename(temporary, path)
}
