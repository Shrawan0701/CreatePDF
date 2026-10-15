import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'

const assets = (await readdir('dist/assets', { recursive: true }))
  .filter((name) => /\.(js|css|mjs|wasm|woff2?|ttf|svg|png)$/.test(name))
  .map((name) => `/assets/${name.replaceAll('\\', '/')}`)
  .sort()
const shell = await readFile('dist/index.html')
const version = createHash('sha256').update(JSON.stringify(assets)).update(shell).digest('hex').slice(0, 12)
const serviceWorker = await readFile('dist/sw.js', 'utf8')
const precache = ['/', '/manifest.json', '/favicon.svg', ...assets]
await writeFile('dist/sw.js', `self.__CREATEPDF_VERSION = ${JSON.stringify(version)};\nself.__CREATEPDF_PRECACHE = ${JSON.stringify(precache)};\n${serviceWorker}`)
process.stdout.write(`Prepared offline cache for ${precache.length} assets (${version}).\n`)
