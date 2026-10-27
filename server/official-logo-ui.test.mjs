import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const asset = await readFile(new URL('../public/andalucia-mosaic-wordmark.png', import.meta.url))
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const auth = await readFile(new URL('../src/auth.tsx', import.meta.url), 'utf8')
const brand = await readFile(new URL('../src/brand.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.equal(asset.readUInt32BE(0), 0x89504e47, 'official logo must remain a PNG')
assert.equal(asset.readUInt32BE(16), 2172, 'official logo width changed')
assert.equal(asset.readUInt32BE(20), 724, 'official logo height changed')
assert.equal(asset.readUInt8(25), 6, 'official logo must retain RGBA transparency')
assert.equal(createHash('sha256').update(asset).digest('hex'), 'ee7fde7ba4f1e99a81fea8981b2282e2f6ff9f36e21ce17141a04916082bb41d')
assert.match(brand, /src="\/andalucia-mosaic-wordmark\.png"/)
assert.match(brand, /alt="Andalucía"/)
assert.match(brand, />OPERATION</)
assert.match(auth, /<BrandWordmark className="login-wordmark"/)
assert.match(app, /<BrandWordmark className="sidebar-wordmark"/)
assert.match(app, /<BrandWordmark className="mobile-wordmark"/)
assert.doesNotMatch(app, />Á</)
assert.match(styles, /\.andalucia-wordmark-image\{[^}]*object-fit:contain/)

console.log(JSON.stringify({ officialAssetPreserved: true, transparent: true, login: true, desktopSidebar: true, mobileHeader: true }, null, 2))
