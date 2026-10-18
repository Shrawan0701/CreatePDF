import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const origin = 'http://127.0.0.1:4199'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4199', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite starting. */ }
    if (attempt >= 120) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const makePdf = async (name, title, width = 595) => {
    const document = await PDFDocument.create({ updateMetadata: false })
    const font = await document.embedFont(StandardFonts.Helvetica)
    document.addPage([width, 842]).drawText(`Content of ${title}`, { x: 40, y: 780, size: 14, font })
    document.setTitle(title); document.setAuthor('Original author'); document.setKeywords(['sales', 'report'])
    document.setProducer('Original PDF producer'); document.setCreator('Original PDF creator')
    document.setCreationDate(new Date('2020-01-02T03:04:05Z'))
    return { name, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) }
  }
  const first = await makePdf('first.pdf', 'First source')
  const second = await makePdf('second.pdf', 'Second source', 612)
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/edit-metadata`, { waitUntil: 'networkidle' })
  const field = name => page.getByRole('textbox', { name, exact: true })
  const upload = async (file, title) => {
    await page.locator('input[type=file]').setInputFiles(file)
    await page.waitForFunction(title => [...document.querySelectorAll('input')].some(input => input.value === title), title)
    assert.ok(await page.getByRole('button', { name: 'Save Metadata', exact: true }).isEnabled())
  }
  const download = async () => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save Metadata', exact: true }).click()
    const file = await pending
    return { name: file.suggestedFilename(), buffer: await readFile(await file.path()) }
  }
  await upload(first, 'First source')
  assert.equal(await field('Keywords').inputValue(), 'sales report')
  assert.equal(await field('Producer').inputValue(), 'Original PDF producer')
  const values = { Title: 'वार्षिक अहवाल — Café', Author: 'Shrawan Wandhekar', Subject: 'Hotel analytics', Keywords: 'sales, monthly report, Pune', Producer: 'Custom producer' }
  for (const [name, value] of Object.entries(values)) await field(name).fill(value)
  const edited = await download()
  assert.equal(edited.name, 'metadata-first.pdf')
  const output = await PDFDocument.load(edited.buffer, { updateMetadata: false })
  assert.equal(output.getTitle(), values.Title)
  assert.equal(output.getAuthor(), values.Author)
  assert.equal(output.getSubject(), values.Subject)
  assert.equal(output.getKeywords(), values.Keywords)
  assert.equal(output.getProducer(), values.Producer)
  assert.equal(output.getCreator(), 'Original PDF creator')
  assert.equal(output.getCreationDate().toISOString(), '2020-01-02T03:04:05.000Z')
  assert.equal(output.getPageCount(), 1)
  const savedText = await page.evaluate(async bytes => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const task = (await getPdfjsLib()).getDocument({ data: new Uint8Array(bytes) })
    try { return (await (await (await task.promise).getPage(1)).getTextContent()).items.map(item => item.str).join(' ') }
    finally { await task.destroy() }
  }, Array.from(edited.buffer))
  assert.ok(savedText.includes('Content of First source'), 'Metadata editing changed the visible document')
  await upload({ name: edited.name, mimeType: 'application/pdf', buffer: edited.buffer }, values.Title)
  for (const [name, value] of Object.entries(values)) assert.equal(await field(name).inputValue(), value)
  // Selecting a new PDF must replace the previous source rather than append it.
  await upload(second, 'Second source')
  const replacement = await download()
  assert.equal(replacement.name, 'metadata-second.pdf')
  assert.equal((await PDFDocument.load(replacement.buffer, { updateMetadata: false })).getPages()[0].getSize().width, 612)
  await field('Keywords').fill(''); await field('Producer').fill('')
  const cleared = await download()
  await upload({ name: cleared.name, mimeType: 'application/pdf', buffer: cleared.buffer }, 'Second source')
  assert.equal(await field('Keywords').inputValue(), '')
  assert.equal(await field('Producer').inputValue(), '')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Save Metadata' }).isDisabled())
  assert.equal(await field('Title').count(), 0)
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await page.getByRole('alert').filter({ hasText: 'Could not read this PDF' }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Save Metadata' }).isDisabled())
  await upload(first, 'First source')
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  // Reset while a file read is pending must cancel that result.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'slow.pdf') await new Promise(resolve => setTimeout(resolve, 500))
      return original.call(this)
    }
  })
  await page.locator('input[type=file]').setInputFiles({ ...second, name: 'slow.pdf' })
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.waitForTimeout(700)
  assert.equal(await field('Title').count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Save Metadata' }).isDisabled())
  assert.deepEqual(errors, [])
  console.log('Metadata checks passed: existing keywords, exact round-trip, original producer/creator/date, blank fields, file replacement, content preservation, invalid PDF recovery, reset cancellation, and mobile.')
} finally {
  await browser?.close()
  server.kill()
}
