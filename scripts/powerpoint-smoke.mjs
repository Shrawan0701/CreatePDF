// Generated regression slides only; never reads or changes personal files.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4188'
const deck = new PptxGenJS()
deck.layout = 'LAYOUT_WIDE'
deck.defineSlideMaster({ title: 'BASE', background: { color: 'FFFFFF' }, objects: [
  { text: { text: 'MASTER FOOTER', options: { x: 0.5, y: 7, w: 3, h: 0.25, fontSize: 10, margin: 0 } } },
] })
let slide = deck.addSlide('BASE')
slide.addText('CENTERED TITLE', { x: 0.75, y: 0.5, w: 11.5, h: 1, fontSize: 32, align: 'center', valign: 'mid', margin: 0, color: 'FFFFFF', fill: { color: '204080' } })
slide.addText('First paragraph wraps onto multiple lines within this narrow text box.\nSecond paragraph must start below every wrapped line of the first paragraph.', { x: 0.75, y: 2, w: 4, h: 2.5, fontSize: 22, margin: 0, breakLine: false })
slide.addText('BOTTOM MARKER', { x: 0.75, y: 5.5, w: 4, h: 0.5, fontSize: 18, margin: 0 })
slide.addChart(deck.ChartType.bar, [{ name: 'Revenue', labels: ['Jan', 'Feb'], values: [10, 20] }], { x: 6, y: 2, w: 6, h: 3, showTitle: true, title: 'Quarterly sales', showLegend: false })
slide = deck.addSlide('BASE')
slide.addText('SECOND SLIDE', { x: 1, y: 1, w: 8, h: 1, fontSize: 30 })
slide.addImage({ data: `image/png;base64,${(await readFile(new URL('../src/assets/createpdf.png', import.meta.url))).toString('base64')}`, x: 2, y: 3, w: 2, h: 2 })
slide = deck.addSlide('BASE')
slide.addText('THIRD SLIDE', { x: 1, y: 1, w: 8, h: 1, fontSize: 30 })
const zip = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }))
const presentation = await zip.file('ppt/presentation.xml').async('string')
// The file names remain slide1/2/3, but the presentation order is 3/1/2.
zip.file('ppt/presentation.xml', presentation.replace(/<p:sldIdLst>(.*?)<\/p:sldIdLst>/s, (_match, list) => {
  const ids = list.match(/<p:sldId\b[^>]*\/>/g)
  return `<p:sldIdLst>${[ids[2], ids[0], ids[1]].join('')}</p:sldIdLst>`
}))
const input = await zip.generateAsync({ type: 'nodebuffer' })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4188', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt >= 120) throw new Error('Vite did not start.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/powerpoint-to-pdf`, { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles({ name: 'layout-regression.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: input })
  const pending = page.waitForEvent('download', { timeout: 180000 })
  await page.getByRole('button', { name: 'Convert and download' }).click()
  const download = await pending
  assert.equal(download.suggestedFilename(), 'layout-regression.pdf')
  const bytes = await readFile(await download.path())
  const result = await page.evaluate(async bytes => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
    try {
      const pdf = await task.promise
      const pages = []
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        pages.push({ size: page.view, items: (await page.getTextContent()).items.filter(item => item.str), images: (await page.getOperatorList()).fnArray.filter(operation => operation === pdfjs.OPS.paintImageXObject).length })
      }
      return pages
    } finally { await task.destroy() }
  }, Array.from(bytes))
  assert.equal(result.length, 3)
  for (const page of result) {
    assert.ok(page.items.some(item => item.str.includes('MASTER FOOTER')), 'Slide master content was lost')
    assert.ok(Math.abs((page.size[2] - page.size[0]) / (page.size[3] - page.size[1]) - 16 / 9) < 0.01)
  }
  for (const [index, title] of ['THIRD SLIDE', 'CENTERED TITLE', 'SECOND SLIDE'].entries()) {
    assert.ok(result[index].items.some(item => item.str.includes(title)), 'Presentation order was changed')
  }
  const title = result[1].items.find(item => item.str.includes('CENTERED TITLE'))
  assert.ok(Math.abs(title.transform[4] + title.width / 2 - (0.75 + 11.5 / 2) * 72) < 3, 'Centered title moved')
  const body = result[1].items.filter(item => item.transform[4] < 400 && item.transform[5] > 190 && item.transform[5] < 410)
  for (let index = 1; index < body.length; index++) {
    assert.ok(body[index - 1].transform[5] - body[index].transform[5] > 10, 'Wrapped paragraphs overlap')
  }
  assert.ok(body.map(item => item.str).join(' ').includes('Second paragraph'), 'Wrapped body text was lost')
  assert.ok(result[1].items.some(item => item.str.includes('Quarterly sales')), 'Chart was lost')
  assert.ok(result[2].images > 0, 'Slide image was lost')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PowerPoint checks passed: actual upload/download, slide order and size, master content, centered titles, wrapped paragraphs, chart, and image.')
} finally {
  await browser?.close()
  server.kill()
}
