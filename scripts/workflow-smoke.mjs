import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4215'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4215', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt > 120) throw new Error('Vite did not start.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/pdf-workflow`, { waitUntil: 'networkidle' })
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/workflow-empty.png', fullPage: true, animations: 'disabled' })
  const makePdf = async (label, count) => {
    const pdf = await PDFDocument.create()
    for (let index = 0; index < count; index++) { const p = pdf.addPage([595, 842]); p.drawText(`${label}${index + 1}`, { x: 70, y: 700, size: 28 }) }
    return { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }
  }
  const a = await makePdf('A', 3), b = await makePdf('B', 2)
  const upload = files => page.locator('.wf-drop input[type=file]').setInputFiles(files)
  const configure = async (name, steps) => {
    const json = JSON.stringify({ version: 2, name, steps: steps.map(([type, settings = {}]) => ({ type, settings, enabled: true })) })
    await page.locator('.wf-sequence input[type=file]').setInputFiles({ name: 'workflow.json', mimeType: 'application/json', buffer: Buffer.from(json) })
    await page.getByLabel('Workflow name', { exact: true }).filter({ visible: true }).waitFor()
    await page.waitForFunction(name => document.querySelector('.wf-name-row input')?.value === name, name)
  }
  const run = async () => {
    await page.getByRole('button', { name: /^(Run workflow|Run again)$/ }).click()
    await page.getByRole('heading', { name: 'Your files are ready', exact: true }).waitFor()
    await page.locator('.wf-results canvas[data-rendered-page="1"]').waitFor()
  }
  const download = async button => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: button, exact: true }).click()
    const file = await pending
    return { bytes: await readFile(await file.path()), filename: file.suggestedFilename(), file }
  }
  const text = bytes => page.evaluate(async bytes => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const task = (await getPdfjsLib()).getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await task.promise, pages = []
      for (let number = 1; number <= pdf.numPages; number++) pages.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str).join(' '))
      return pages
    } finally { await task.destroy() }
  }, [...bytes])
  assert.ok(await page.getByRole('button', { name: 'Run workflow', exact: true }).isDisabled())
  await upload([a, b, { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('broken') }])
  await page.locator('.wf-source').nth(1).waitFor()
  await page.getByRole('alert').filter({ hasText: 'broken.pdf' }).waitFor()
  assert.equal(await page.locator('.wf-source').count(), 2)
  await page.getByRole('button', { name: 'Move source 2 up', exact: true }).click()
  await page.getByRole('button', { name: /Combine & number/ }).click()
  await run()
  const combined = await download('Download PDF')
  await combined.file.saveAs('artifacts/workflow-combined-example.pdf')
  const combinedText = await text(combined.bytes)
  assert.equal(combinedText.length, 5)
  for (const [index, label] of ['B1', 'B2', 'A1', 'A2', 'A3'].entries()) {
    assert.ok(combinedText[index].includes(label), `Missing ordered source ${label}`)
    assert.match(combinedText[index], new RegExp(`Page ${index + 1} of 5`))
  }
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor()
  await page.getByLabel('Workflow name', { exact: true }).fill('Combined documents')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.waitForFunction(async () => (await (await import('/src/services/storage.js')).getWorkflows())[0]?.name === 'Combined documents')
  assert.equal(await page.locator('.wf-saved-row').count(), 1)
  await page.getByRole('button', { name: 'Save copy', exact: true }).click()
  await page.waitForFunction(async () => (await (await import('/src/services/storage.js')).getWorkflows()).length === 2)
  const exported = await download('Export configuration')
  const config = JSON.parse(exported.bytes.toString())
  assert.equal(config.version, 2)
  assert.equal(config.name, 'Combined documents')
  assert.deepEqual(config.steps.map(step => step.type), ['merge', 'numbers', 'compress'])
  await page.getByRole('button', { name: 'Clear files', exact: true }).click()
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 300
    const ctx = c.getContext('2d'); ctx.fillStyle = '#f1e7d1'; ctx.fillRect(0, 0, 480, 300); ctx.fillStyle = '#0d7865'; ctx.fillRect(20, 20, 440, 260)
    return c.toDataURL('image/png').split(',')[1]
  })
  await upload([a, { name: 'photograph.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }, b])
  await page.locator('.wf-source').nth(2).waitFor()
  await page.getByRole('button', { name: /Prepare for sharing/ }).click()
  await page.locator('.wf-plan-errors').getByText(/Add an Images to PDF step/).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Run workflow', exact: true }).isDisabled())
  await page.getByRole('button', { name: /Images to one PDF/ }).click()
  await page.getByRole('button', { name: 'Add operation', exact: true }).click()
  await page.locator('.wf-operation-palette').getByRole('button', { name: /^Images to PDF/ }).click()
  await page.locator('.wf-plan-errors').getByText(/No images remain/).waitFor()
  await page.getByRole('button', { name: 'Remove step 4', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Enable step 1', exact: true }).uncheck()
  assert.ok(await page.getByRole('button', { name: 'Run workflow', exact: true }).isDisabled())
  await page.getByRole('checkbox', { name: 'Enable step 1', exact: true }).check()
  await run()
  const mixed = await download('Download PDF')
  const mixedText = await text(mixed.bytes)
  assert.equal(mixedText.length, 6)
  assert.deepEqual(mixedText.map(words => words.match(/\b[AB]\d\b/)?.[0] || 'image'), ['A1', 'A2', 'A3', 'image', 'B1', 'B2'])
  await configure('Review packet', [
    ['images'], ['merge'], ['reorder', { order: '6,1-3,4-5', keepRemaining: false }], ['split', { every: 2 }],
    ['watermark', { text: 'REVIEWED', rotation: 0 }], ['numbers'], ['compress', { mode: 'lossless' }],
  ])
  await page.getByRole('button', { name: 'Settings for step 3', exact: true }).click()
  await page.getByLabel('Page order', { exact: true }).fill('99')
  await page.locator('.wf-plan-errors').getByText(/between 1 and 6/).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Run workflow', exact: true }).isDisabled())
  await page.getByLabel('Page order', { exact: true }).fill('6,1-3,4-5')
  await page.getByRole('button', { name: 'Move step 4 up', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Run workflow', exact: true }).isDisabled(), 'Page ranges must refer to the previous step output')
  await page.getByRole('button', { name: 'Move step 3 down', exact: true }).click()
  await page.evaluate(() => scrollTo(0, 0))
  await page.locator('.toast-close').evaluateAll(buttons => buttons.forEach(button => button.click()))
  await page.screenshot({ path: 'artifacts/workflow-configured.png', fullPage: true, animations: 'disabled' })
  await run()
  assert.equal(await page.locator('.wf-result-file').count(), 3)
  await page.getByRole('button', { name: 'Preview output 2', exact: true }).click()
  await page.locator('.wf-results canvas[data-rendered-page="1"]').waitFor()
  await page.getByRole('button', { name: 'Next preview page', exact: true }).click()
  await page.locator('.wf-results canvas[data-rendered-page="2"]').waitFor()
  const single = await download('Download output 2')
  assert.equal((await PDFDocument.load(single.bytes)).getPageCount(), 2)
  const zipped = await download('Download all as ZIP')
  await zipped.file.saveAs('artifacts/workflow-review-packet.zip')
  const zip = await JSZip.loadAsync(zipped.bytes), names = Object.keys(zip.files).filter(name => !zip.files[name].dir)
  assert.equal(names.length, 3)
  const expectedLabels = [['B2', 'A1'], ['A2', 'A3'], ['image', 'B1']]
  for (const [index, name] of names.entries()) {
    const pages = await text(await zip.file(name).async('nodebuffer'))
    assert.equal(pages.length, 2)
    for (const [number, words] of pages.entries()) {
      assert.match(words, /REVIEWED/)
      assert.match(words, new RegExp(`Page ${number + 1} of 2`))
      if (expectedLabels[index][number] !== 'image') assert.ok(words.includes(expectedLabels[index][number]))
    }
  }
  await page.locator('.toast-close').evaluateAll(buttons => buttons.forEach(button => button.click()))
  await page.screenshot({ path: 'artifacts/workflow-results.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Workflow overflows on mobile')
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: 'artifacts/workflow-mobile.png', fullPage: true, animations: 'disabled' })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: 'artifacts/workflow-dark-mobile.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.getByRole('button', { name: 'Clear files', exact: true }).click()
  assert.equal(await page.locator('.wf-results').count(), 0, 'Results remained after the inputs changed')
  await upload([await makePdf('Long', 100)])
  await page.locator('.wf-source').waitFor()
  await configure('Cancellation check', [['split', { every: 1 }]])
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel workflow', exact: true }).click()
  await page.getByText(/Workflow cancelled/).waitFor()
  assert.equal(await page.locator('.wf-results').count(), 0)
  await configure('After cancel', [['rotate', { angle: 180, pages: '1' }]])
  await run()
  const recovered = await download('Download PDF')
  const recoveredPdf = await PDFDocument.load(recovered.bytes)
  assert.equal(recoveredPdf.getPageCount(), 100)
  assert.equal(recoveredPdf.getPage(0).getRotation().angle, 180)
  assert.equal(recoveredPdf.getPage(1).getRotation().angle, 0)
  await page.evaluate(async () => {
    await (await import('/src/services/storage.js')).saveWorkflow({ id: 'legacy-fixture', name: 'Legacy workflow', steps: [{ id: 'old-step', type: 'numbers', value: 'Legacy ' }], savedAt: Date.now() })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.wf-saved summary').click()
  await page.getByRole('button', { name: /^Legacy workflow/ }).click()
  assert.equal(await page.getByLabel('Custom format', { exact: true }).inputValue(), 'Legacy {number}')
  await upload([a]); await page.locator('.wf-source').waitFor(); await run()
  const legacy = await download('Download PDF')
  assert.match((await text(legacy.bytes))[0], /Legacy 1/)
  assert.deepEqual(errors, [])
  console.log('Workflow verified: real merge/convert/reorder/split/watermark/number/compress chains, source order, range validation after each step, skipped steps, repeated conversion prevention, real individual PDF and ZIP contents, previews, configuration import/export, save/update/copy and legacy migration, cancellation and recovery, invalid files, stale results, mobile and dark mode.')
} finally { await browser?.close(); server.kill() }
