import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { chromium } from 'playwright-core'
import ExcelJS from 'exceljs'
import { parseCsv } from '../src/services/csv.js'

const origin = 'http://127.0.0.1:4187'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4187', '--strictPort'], { stdio: 'ignore' })
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
  await page.goto(`${origin}/excel-to-pdf`, { waitUntil: 'networkidle' })

  const upload = async (name, buffer) => {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: /\.csv$/i.test(name) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
    await page.getByRole('button', { name: 'Convert and download' }).waitFor()
    await page.locator('.spreadsheet-preview-scroll').first().waitFor()
  }
  const checkPreview = async (name, rowCount, columnCount) => {
    const preview = page.getByRole('region', { name: `${name} worksheet preview`, exact: true })
    assert.equal(await preview.locator('tr').count(), rowCount, `${name}: missing preview rows`)
    assert.equal(await preview.locator('tr').last().locator('th,td').count(), columnCount, `${name}: missing preview columns`)
    assert.equal(await preview.locator('th').first().evaluate(cell => getComputedStyle(cell).position), 'sticky')
  }
  const downloadPdf = async () => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Convert and download' }).click()
    const downloaded = await pending
    const bytes = await readFile(await downloaded.path())
    return page.evaluate(async bytes => {
      const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
      const pdfjs = await getPdfjsLib()
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
      try {
        const pdf = await task.promise
        const text = []
        for (let index = 1; index <= pdf.numPages; index++) {
          text.push(...(await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str))
        }
        return text.filter(Boolean)
      } finally { await task.destroy() }
    }, Array.from(bytes))
  }

  const rows = [Array.from({ length: 12 }, (_, column) => `Header${column + 1}`)]
  for (let row = 1; row <= 24; row++) rows.push(Array.from({ length: 12 }, (_, column) => `R${row}C${column + 1}`))
  await upload('report.csv', Buffer.from(rows.map(row => row.join(',')).join('\n')))
  await checkPreview('CSV', 25, 12)
  assert.equal(await page.getByRole('cell', { name: 'R24C12', exact: true }).count(), 1)
  let text = await downloadPdf()
  assert.ok(!text.includes('CSV'), 'CSV exports must not add a sheet heading')
  for (const value of ['Header1', 'R1C1', 'R24C12']) assert.ok(text.includes(value), `CSV PDF lost ${value}`)

  const workbook = new ExcelJS.Workbook()
  for (const name of ['Sales', 'CSV', 'Hidden']) {
    const sheet = workbook.addWorksheet(name, { state: name === 'Hidden' ? 'hidden' : 'visible' })
    rows.forEach(row => sheet.addRow(row))
  }
  await upload('report.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()))
  await checkPreview('Sales', 25, 12)
  await checkPreview('CSV', 25, 12)
  assert.equal(await page.getByRole('region', { name: 'Hidden worksheet preview', exact: true }).count(), 0)
  text = await downloadPdf()
  assert.ok(text.includes('Sales') && text.includes('CSV'), 'XLSX sheet headings must remain, including a real sheet named CSV')
  assert.equal(text.filter(value => value === 'R24C12').length, 2)

  await page.getByRole('checkbox', { name: 'Sales', exact: true }).uncheck()
  await page.getByRole('region', { name: 'Sales worksheet preview', exact: true }).waitFor({ state: 'detached' })
  text = await downloadPdf()
  assert.ok(!text.includes('Sales') && text.includes('CSV'), 'Only selected sheets should be exported')
  await page.getByRole('checkbox', { name: 'Hidden (hidden)', exact: true }).check()
  await checkPreview('Hidden', 25, 12)

  await page.setViewportSize({ width: 390, height: 844 })
  const viewport = await page.getByRole('region', { name: 'CSV worksheet preview', exact: true }).evaluate(element => ({
    scrollsHorizontally: element.scrollWidth > element.clientWidth,
    scrollsVertically: element.scrollHeight > element.clientHeight,
    overflowsPage: document.documentElement.scrollWidth > window.innerWidth,
  }))
  assert.deepEqual(viewport, { scrollsHorizontally: true, scrollsVertically: true, overflowsPage: false })

  for (const path of process.argv.slice(2)) {
    const name = basename(path)
    const buffer = await readFile(path)
    await upload(name, buffer)
    if (/\.csv$/i.test(name)) {
      const source = parseCsv(buffer.toString('utf8'))
      await checkPreview('CSV', source.length, Math.max(...source.map(row => row.length)))
      text = await downloadPdf()
      assert.ok(!text.includes('CSV'), 'Sample CSV export added a sheet heading')
    } else {
      const source = new ExcelJS.Workbook()
      await source.xlsx.load(buffer)
      for (const sheet of source.worksheets.filter(sheet => !['hidden', 'veryHidden'].includes(sheet.state))) {
        await checkPreview(sheet.name, sheet.rowCount, sheet.columnCount)
      }
      text = await downloadPdf()
      assert.ok(text.includes(source.worksheets.find(sheet => !['hidden', 'veryHidden'].includes(sheet.state)).name))
    }
    console.log(`Verified sample ${/\.csv$/i.test(name) ? 'CSV' : 'XLSX'}: complete preview and PDF download.`)
  }
  assert.deepEqual(errors, [])
  console.log('Spreadsheet checks passed: full rows/columns, CSV heading removal, XLSX headings, sheet selection, and mobile scrolling.')
} finally {
  await browser?.close()
  server.kill()
}
