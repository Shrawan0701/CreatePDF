import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import JSZip from 'jszip'

const port = 4183
const baseUrl = `http://127.0.0.1:${port}`
const temporary = await mkdtemp(join(tmpdir(), 'createpdf-editor-'))
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
let browser

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) { ready = true; break } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Editor smoke server did not start.')
  const original = await PDFDocument.create()
  const font = await original.embedFont(StandardFonts.Helvetica)
  const sourcePage = original.addPage([595, 842])
  sourcePage.drawRectangle({ x: 50, y: 675, width: 400, height: 65, color: rgb(.9, .9, .9) })
  sourcePage.drawText('OriginalName', { x: 70, y: 700, size: 20, font })
  sourcePage.drawText('Keep this content', { x: 70, y: 600, size: 12, font })
  const normalBytes = Buffer.from(await original.save())
  sourcePage.setRotation(degrees(90))
  const rotatedBytes = Buffer.from(await original.save())
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const open = async (target, bytes) => {
    await target.goto(`${baseUrl}/edit-pdf`, { waitUntil: 'networkidle' })
    await target.locator('input[type="file"]').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: bytes })
    await target.waitForFunction(() => document.querySelector('.pdf-editor-canvas')?.style.width && !document.querySelector('.editor-rendering'))
  }
  const download = async (target, selector, name) => {
    const pending = target.waitForEvent('download')
    const failed = target.locator('.toast-error .toast-message').first().textContent({ timeout: 30000 }).then((message) => { throw new Error(message) })
    await selector.click()
    const output = await Promise.race([pending, failed])
    const path = join(temporary, name)
    await output.saveAs(path)
    return readFile(path)
  }

  await open(page, normalBytes)
  await page.getByRole('button', { name: 'OriginalName', exact: true }).click()
  await page.locator('.editor-overlay textarea').fill('Replacement\nSecond line')
  await page.locator('.editor-document-bar').click({ position: { x: 5, y: 5 } })
  const geometry = await page.locator('.editor-overlay').evaluate((overlay) => {
    const workspace = document.querySelector('.pdf-editor-workspace')
    const mask = document.querySelector('.editor-source-mask')
    return { fontSize: parseFloat(getComputedStyle(overlay).fontSize), width: workspace.getBoundingClientRect().width, mask: { x: parseFloat(mask.style.left) / 100, y: parseFloat(mask.style.top) / 100, width: parseFloat(mask.style.width) / 100, height: parseFloat(mask.style.height) / 100 }, background: getComputedStyle(mask).backgroundColor }
  })
  if (Math.abs(geometry.fontSize / (geometry.width / 595) - 20) > .1 || geometry.background !== 'rgb(230, 230, 230)') throw new Error('Original-text preview lost PDF size or table background')
  const overlayBounds = await page.locator('.editor-overlay').boundingBox()
  await page.mouse.move(overlayBounds.x + overlayBounds.width / 2, overlayBounds.y + overlayBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(overlayBounds.x + overlayBounds.width / 2 + 60, overlayBounds.y + overlayBounds.height / 2 + 70, { steps: 6 })
  await page.mouse.up()
  const replacedBytes = await download(page, page.locator('.editor-download'), 'replaced.pdf')
  const replaced = await getDocument({ data: new Uint8Array(replacedBytes), useSystemFonts: true }).promise
  const replacementItems = (await (await replaced.getPage(1)).getTextContent()).items
  if (!replacementItems.some((item) => item.str === 'Replacement' && Math.abs(item.transform[0] - 20) < .1) || !replacementItems.some((item) => item.str === 'Second line') || replacementItems.some((item) => item.str.includes('OriginalName'))) throw new Error('Replacement export changed size, lost multiline text, or retained original text')
  await replaced.loadingTask.destroy()

  await page.goto(`${baseUrl}/extract-images`, { waitUntil: 'networkidle' })
  await page.locator('input[type="file"]').setInputFiles({ name: 'replaced.pdf', mimeType: 'application/pdf', buffer: replacedBytes })
  const extracted = await JSZip.loadAsync(await download(page, page.getByRole('button', { name: 'Download images ZIP' }), 'images.zip'))
  const backgroundImage = Object.values(extracted.files).find((entry) => entry.name.endsWith('.png'))
  if (!backgroundImage) throw new Error('Edited page background could not be inspected')
  const darkPixels = await page.evaluate(async ({ imageData, region }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${imageData}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(Math.ceil(region.x * image.width) + 2, Math.ceil(region.y * image.height) + 2, Math.max(1, Math.floor(region.width * image.width) - 4), Math.max(1, Math.floor(region.height * image.height) - 4)).data
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 180 || pixels[index + 1] < 180 || pixels[index + 2] < 180) dark++
    return dark
  }, { imageData: await backgroundImage.async('base64'), region: geometry.mask })
  if (darkPixels !== 0) throw new Error('Original text pixels remain recoverable from the edited page image')

  const mobile = await browser.newPage({ acceptDownloads: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  mobile.on('pageerror', (error) => errors.push(error.message))
  for (const route of ['/', '/create-pdf', '/pos-billing', '/gst-invoice', '/pdf-to-excel', '/resume-builder']) {
    await mobile.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
    if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error(`${route} overflows the mobile viewport`)
    if (await mobile.locator('.topbar').evaluate((header) => header.scrollHeight > header.clientHeight + 2) || (await mobile.getByRole('button', { name: 'Open navigation' }).boundingBox()).width < 30) throw new Error(`${route} has a crowded or inaccessible mobile header`)
  }
  await open(mobile, normalBytes)
  await mobile.locator('.editor-bottom-dock').getByRole('button', { name: 'Text', exact: true }).click()
  const mobileWorkspace = await mobile.locator('.pdf-editor-workspace').boundingBox()
  await mobile.mouse.click(mobileWorkspace.x + mobileWorkspace.width * .15, mobileWorkspace.y + mobileWorkspace.height * .25)
  await mobile.locator('.editor-overlay textarea').fill('Mobile note')
  const toolbar = await mobile.locator('.editor-context-toolbar').boundingBox()
  if (!toolbar || toolbar.x < 0 || toolbar.x + toolbar.width > 392 || await mobile.locator('.editor-text-panel').count()) throw new Error('Mobile text toolbar is clipped or a duplicate text field is present')
  const mobileFont = await mobile.locator('.editor-overlay').evaluate((overlay) => parseFloat(getComputedStyle(overlay).fontSize))
  if (Math.abs(mobileFont / (mobileWorkspace.width / 595) - 18) > .1) throw new Error('Mobile preview does not use PDF point sizes')
  const mobileBytes = await download(mobile, mobile.locator('.editor-download'), 'mobile.pdf')
  const mobilePdf = await getDocument({ data: new Uint8Array(mobileBytes), useSystemFonts: true }).promise
  if (!(await (await mobilePdf.getPage(1)).getTextContent()).items.some((item) => item.str === 'Mobile note' && Math.abs(item.transform[0] - 18) < .1)) throw new Error('Mobile text export lost its content or size')
  await mobilePdf.loadingTask.destroy()
  await mobile.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await mobile.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await mobile.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await mobile.waitForFunction(() => !document.querySelector('.editor-rendering'))
  const zoomedToolbar = await mobile.locator('.editor-context-toolbar').boundingBox()
  if (zoomedToolbar.x < 0 || zoomedToolbar.x + zoomedToolbar.width > 392) throw new Error('Zoom clips the mobile formatting toolbar')
  if (process.env.UI_SCREENSHOT_DIR) {
    for (const close of await mobile.locator('.toast-close').all()) await close.click()
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true })
    await mobile.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, 'editor-mobile.png'), fullPage: true })
  }

  await open(page, rotatedBytes)
  await page.locator('.editor-bottom-dock').getByRole('button', { name: 'Text', exact: true }).click()
  const rotatedWorkspace = await page.locator('.pdf-editor-workspace').boundingBox()
  await page.mouse.click(rotatedWorkspace.x + rotatedWorkspace.width * .2, rotatedWorkspace.y + rotatedWorkspace.height * .2)
  await page.locator('.editor-overlay textarea').fill('Rotated note')
  const rotated = await getDocument({ data: new Uint8Array(await download(page, page.locator('.editor-download'), 'rotated.pdf')), useSystemFonts: true }).promise
  const rotatedPage = await rotated.getPage(1)
  if (rotatedPage.view[2] !== 842 || rotatedPage.view[3] !== 595 || !(await rotatedPage.getTextContent()).items.some((item) => item.str === 'Rotated note')) throw new Error('Rotated PDF edit changed page proportions or overlay coordinates')
  await rotated.loadingTask.destroy()
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
  process.stdout.write('Editor PDF sizes, multiline export, original-pixel removal, mobile layout, zoom, and rotated-page editing validated.\n')
} finally {
  await browser?.close()
  server.kill()
  await rm(temporary, { recursive: true, force: true })
}
