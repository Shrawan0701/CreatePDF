import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { INDEXABLE_PATHS } from '../src/seo/metadata.js'
import { BRAND_ICONS } from '../src/data/brand.js'

const assets = (await readdir('dist/assets', { recursive: true }))
  .filter((name) => /\.(js|css|mjs|wasm|woff2?|ttf|svg|png)$/.test(name))
  .map((name) => `/assets/${name.replaceAll('\\', '/')}`)
  .sort()
const shell = await readFile('dist/index.html')
const manifest = await readFile('dist/manifest.json')
const version = createHash('sha256').update(JSON.stringify(assets)).update(shell).update(manifest).digest('hex').slice(0, 12)
const serviceWorker = await readFile('dist/sw.js', 'utf8')
const iconUrls = Object.entries(BRAND_ICONS).filter(([key]) => key !== 'version').map(([, url]) => url)
const precache = [...INDEXABLE_PATHS, '/manifest.json', `/manifest.json?v=${BRAND_ICONS.version}`, ...iconUrls, ...assets]
await writeFile('dist/sw.js', `self.__CREATEPDF_VERSION = ${JSON.stringify(version)};\nself.__CREATEPDF_PRECACHE = ${JSON.stringify(precache)};\n${serviceWorker}`)
process.stdout.write(`Prepared offline cache for ${precache.length} assets (${version}).\n`)
