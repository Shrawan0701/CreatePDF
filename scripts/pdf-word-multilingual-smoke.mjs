import assert from 'node:assert/strict'
import 'regenerator-runtime/runtime.js'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import JSZip from 'jszip'

const samples = [
  ['devanagari', 'मराठी भाषा', 'विद्यार्थ्याचे नाव', 'शिक्षण आणि परीक्षा'],
  ['bengali', 'বাংলা ভাষা', 'শিক্ষার্থীর নাম', 'শিক্ষা এবং পরীক্ষা'],
  ['gujarati', 'ગુજરાતી ભાષા', 'વિદ્યાર્થીનું નામ', 'શિક્ષણ અને પરીક્ષા'],
  ['tamil', 'தமிழ் மொழி', 'மாணவர் பெயர்', 'கல்வி மற்றும் தேர்வு'],
  ['telugu', 'తెలుగు భాష', 'విద్యార్థి పేరు', 'విద్య మరియు పరీక్ష'],
  ['kannada', 'ಕನ್ನಡ ಭಾಷೆ', 'ವಿದ್ಯಾರ್ಥಿಯ ಹೆಸರು', 'ಶಿಕ್ಷಣ ಮತ್ತು ಪರೀಕ್ಷೆ'],
]
const pdf = await PDFDocument.create()
pdf.registerFontkit(fontkit)
const latin = await pdf.embedFont(StandardFonts.Helvetica)
for (const [script, title, label, sentence] of samples) {
  const path = script === 'telugu' ? 'src/assets/fonts/NotoSansTelugu-Regular.ttf' : `node_modules/@fontsource/noto-sans-${script}/files/noto-sans-${script}-${script}-400-normal.woff`
  const font = await pdf.embedFont(await readFile(path), { subset: true })
  const page = pdf.addPage([595, 842])
  page.drawText(title, { x: 40, y: 790, size: 18, font })
  page.drawText('Reference: 2026 / 01', { x: 40, y: 760, size: 10, font: latin })
  page.drawText(sentence, { x: 40, y: 730, size: 12, font })
  // Adjacent text fragments deliberately share a baseline, as in translated PDFs.
  const first = title.split(' ')[0], second = title.split(' ').slice(1).join(' ')
  page.drawText(first, { x: 40, y: 700, size: 11, font })
  page.drawText(second, { x: 40 + font.widthOfTextAtSize(first, 11) + 7, y: 700, size: 11, font })
  for (const y of [660, 630, 600]) page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: .5, color: rgb(.5, .5, .5) })
  for (const x of [40, 300, 555]) page.drawLine({ start: { x, y: 600 }, end: { x, y: 660 }, thickness: .5, color: rgb(.5, .5, .5) })
  page.drawText(label, { x: 45, y: 642, size: 10, font })
  page.drawText('Student / 2026', { x: 305, y: 642, size: 10, font: latin })
  page.drawText(sentence, { x: 45, y: 612, size: 10, font })
  page.drawText('Reviewed', { x: 305, y: 612, size: 10, font: latin })
}
const input = Buffer.from(await pdf.save())
const directory = await mkdtemp(join(tmpdir(), 'createpdf-word-languages-'))
await writeFile(join(directory, 'languages.pdf'), input)
const origin = 'http://127.0.0.1:4224'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4224', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt > 100) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/pdf-to-word`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles({ name: 'languages.pdf', mimeType: 'application/pdf', buffer: input })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download DOCX', exact: true }).click()
  const download = await pending
  const bytes = await readFile(await download.path())
  await writeFile(join(directory, 'languages.docx'), bytes)
  const archive = await JSZip.loadAsync(bytes)
  const xml = await archive.file('word/document.xml').async('string')
  const fonts = await archive.file('word/fontTable.xml').async('string')
  const embedded = Object.keys(archive.files).filter(name => name.endsWith('.odttf'))
  assert.equal(embedded.length, 12, 'Regular and bold fonts must be embedded for all six scripts')
  for (const name of ['Devanagari', 'Bengali', 'Gujarati', 'Tamil', 'Telugu', 'Kannada']) assert.ok(fonts.includes(`Noto Sans ${name}`), `Missing embedded ${name} font`)
  assert.equal((xml.match(/<w:sectPr>/g) || []).length, 6)
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 6)
  assert.ok(xml.includes('Reference: 2026 / 01') && xml.includes('Student / 2026'))
  assert.equal((xml.match(/<w:tab\/>/g) || []).length, 0, 'Translated word spacing must not become tabs')
  const stats = await page.evaluate(xml => {
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const all = (node, name) => [...node.getElementsByTagNameNS(ns, name)]
    return { text: all(document, 't').map(t => t.textContent).join(' '), scripts: all(document, 'r').filter(run => /[\u0900-\u0dff]/.test(all(run, 't').map(t => t.textContent).join(''))).map(run => ({ font: all(run, 'rFonts')[0]?.getAttributeNS(ns, 'cs'), size: all(run, 'sz')[0]?.getAttributeNS(ns, 'val'), csSize: all(run, 'szCs')[0]?.getAttributeNS(ns, 'val') })), frames: all(document, 'framePr').map(frame => ({ x: +frame.getAttributeNS(ns, 'x'), width: +frame.getAttributeNS(ns, 'w') })) }
  }, xml)
  // PDF.js can infer spaces between separately drawn glyphs. Verify that all
  // title characters survive; explicit joining/spacing has separate unit tests.
  for (const [, title] of samples) assert.ok(stats.text.replace(/\s/g, '').includes(title.replace(/\s/g, '')), `Missing title characters: ${title}`)
  assert.ok(stats.scripts.length > 20)
  assert.ok(stats.scripts.every(run => run.font?.startsWith('Noto Sans ') && run.size === run.csSize), 'Script runs lost their fonts or complex-script sizes')
  assert.ok(stats.frames.every(frame => frame.x >= 0 && frame.x + frame.width <= 11900), 'A translated text frame leaves the page')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log(`PASS: six Indic scripts retain editable Unicode, script fonts, embedded shaping tables, sizes, separate columns and six editable tables; no word tabs or mobile overflow. Samples: ${directory}`)
} finally { await browser?.close(); server.kill() }
