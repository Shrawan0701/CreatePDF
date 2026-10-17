import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { chromium as playwright } from 'playwright-core'

const maxBytes = 4 * 1024 * 1024
const documentUrl = 'https://uploaded-document.invalid/'
const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]]) blocked.addSubnet(address, prefix, 'ipv6')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')

export function isPublicAssetAddress(address) {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

// Pin each connection to a validated DNS result; uploaded HTML must not cause
// the rendering server to fetch local files or services on private networks.
function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true }, (error, records = []) => {
    const allowed = records.filter(record => isPublicAssetAddress(record.address) && (!options.family || record.family === options.family))
    if (error || !allowed.length) return callback(error || new Error('Asset address is unavailable.'))
    if (options.all) callback(null, allowed)
    else callback(null, allowed[0].address, allowed[0].family)
  })
}

export async function fetchHtmlAsset(address, { signal, budget }, redirects = 0) {
  const url = new URL(address)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hostname === 'uploaded-document.invalid') throw new Error('Unsupported asset URL.')
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal) && !isPublicAssetAddress(literal)) throw new Error('Unsupported asset address.')
  if (++budget.requests > 100) throw new Error('Too many assets.')
  const result = await new Promise((resolve, reject) => {
    const request = httpsRequest(url, { lookup: publicLookup, signal, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/144.0.0.0 Safari/537.36', 'Accept-Encoding': 'identity' } }, response => {
      const parts = []
      let length = 0
      response.on('data', part => {
        length += part.length
        budget.bytes += part.length
        if (length > 8 * 1024 * 1024 || budget.bytes > 32 * 1024 * 1024) response.destroy(new Error('Asset is too large.'))
        else parts.push(part)
      })
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode, location: response.headers.location, contentType: response.headers['content-type'] || 'application/octet-stream', body: Buffer.concat(parts) }))
    })
    request.setTimeout(7000, () => request.destroy(new Error('Asset loading timed out.')))
    request.on('error', reject)
    request.end()
  })
  if (result.status >= 300 && result.status < 400 && result.location && redirects < 3) return fetchHtmlAsset(new URL(result.location, url).href, { signal, budget }, redirects + 1)
  if (result.status !== 200) throw new Error('Asset could not be loaded.')
  return result
}

let browserPromise
async function getBrowser() {
  if (!browserPromise) browserPromise = (async () => {
    let launch = { headless: true }
    if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
    else if (process.platform === 'win32' || process.platform === 'darwin') launch.channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome')
    else {
      const { default: chromium } = await import('@sparticuz/chromium')
      launch = { ...launch, executablePath: await chromium.executablePath(), args: chromium.args }
    }
    const browser = await playwright.launch(launch)
    browser.on('disconnected', () => { browserPromise = null })
    return browser
  })().catch(error => { browserPromise = null; throw error })
  return browserPromise
}

export async function closeHtmlBrowser() {
  if (browserPromise) await (await browserPromise).close()
}

const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback
function runningText(value) {
  const text = escapeHtml(String(value || '').slice(0, 300)).replaceAll('{page}', '<span class="pageNumber"></span>').replaceAll('{total}', '<span class="totalPages"></span>')
  return `<div style="font:9px Arial;width:100%;padding:0 10mm;color:#666">${text}</div>`
}

export async function renderHtmlPdf(html, options = {}, { signal, fetchAsset = fetchHtmlAsset } = {}) {
  signal?.throwIfAborted()
  const browser = await getBrowser()
  const paper = options.pageSize === 'Letter' ? [612, 792] : [595.28, 841.89]
  if (options.orientation === 'landscape') paper.reverse()
  const margin = number(options.margin, 46, 0, 100)
  const viewportWidth = options.webLayout === 'paper' ? Math.round((paper[0] - margin * 2) * 4 / 3) : 1280
  const scale = Math.max(0.1, Math.min(1, (paper[0] - margin * 2) * 4 / 3 / viewportWidth))
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: viewportWidth, height: 900 } })
  const abort = () => { context.close().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 45000)
  const budget = { requests: 0, bytes: 0 }
  try {
    signal?.throwIfAborted()
    const page = await context.newPage()
    await context.route('**/*', async route => {
      const request = route.request()
      try {
        if (request.url() === documentUrl && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          return await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html, headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } })
        }
        if (!['stylesheet', 'image', 'font'].includes(request.resourceType())) return await route.abort()
        const asset = await fetchAsset(request.url(), { signal, budget })
        await route.fulfill({ contentType: asset.contentType, body: asset.body, headers: { 'Access-Control-Allow-Origin': '*' } })
      } catch { await route.abort().catch(() => {}) }
    })
    await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
    await page.goto(documentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
    await page.evaluate(({ fontSize, lineHeight, serif }) => {
      const defaults = document.createElement('style')
      defaults.textContent = `body { font-family: ${serif ? 'Georgia, serif' : 'Arial, sans-serif'}; font-size: ${fontSize}pt; line-height: ${lineHeight}; }`
      document.head.prepend(defaults)
      for (const element of document.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv="refresh"]')) element.remove()
      for (const image of document.images) { image.loading = 'eager'; image.removeAttribute('onerror') }
      // Reveal common scroll-animation content without running uploaded scripts.
      const printStyles = document.createElement('style')
      printStyles.textContent = `*, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; animation: none !important; transition: none !important; }
        [data-aos], .fade-up, .reveal, .wow { opacity: 1 !important; visibility: visible !important; transform: none !important; }
        [data-page-break="before"] { break-before: page; }
        h1,h2,h3,h4,h5,h6 { break-after: avoid; }
        img,tr,article,[class*="card"] { break-inside: avoid; }
        @page { size: auto; }`
      document.head.append(printStyles)
    }, { fontSize: number(options.fontSize, 12, 8, 32), lineHeight: number(options.lineHeight, 1.35, 1.1, 2), serif: options.fontFamily === 'serif' })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 5000))]))
    const pdf = await page.pdf({ width: `${paper[0] / 72}in`, height: `${paper[1] / 72}in`, scale, printBackground: true, preferCSSPageSize: false,
      margin: { top: `${margin / 72}in`, right: `${margin / 72}in`, bottom: `${margin / 72}in`, left: `${margin / 72}in` },
      displayHeaderFooter: Boolean(options.header || options.footer), headerTemplate: runningText(options.header), footerTemplate: runningText(options.footer), tagged: true,
    })
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Browser did not return a PDF.')
    return pdf
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    await context.close().catch(() => {})
  }
}

let pending = Promise.resolve()
export function createHtmlPdfHandler({ convert = renderHtmlPdf } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const controller = new AbortController()
    const disconnect = () => { if (!response.writableEnded) controller.abort() }
    response.on?.('close', disconnect)
    try {
      if (request.method !== 'POST') throw Object.assign(new Error('Use POST to convert HTML.'), { status: 405 })
      if (Number(request.headers['content-length']) > maxBytes) throw Object.assign(new Error('Choose HTML up to 4 MB, including embedded images.'), { status: 413 })
      let bytes
      if (Buffer.isBuffer(request.body)) bytes = request.body
      else {
        const chunks = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > maxBytes) throw Object.assign(new Error('Choose HTML up to 4 MB, including embedded images.'), { status: 413 })
          chunks.push(chunk)
        }
        bytes = Buffer.concat(chunks)
      }
      if (bytes.length > maxBytes) throw Object.assign(new Error('Choose HTML up to 4 MB, including embedded images.'), { status: 413 })
      let payload
      try { payload = JSON.parse(bytes.toString('utf8')) } catch { throw Object.assign(new Error('Invalid HTML conversion request.'), { status: 400 }) }
      if (typeof payload?.html !== 'string' || !payload.html.trim()) throw Object.assign(new Error('Add some HTML content first.'), { status: 400 })
      const job = pending.then(() => { controller.signal.throwIfAborted(); return convert(payload.html, payload.options || {}, { signal: controller.signal }) })
      pending = job.catch(() => {})
      const pdf = await job
      if (response.destroyed) return
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/pdf')
      response.setHeader('Content-Disposition', 'attachment; filename="document.pdf"')
      response.end(pdf)
    } catch (error) {
      if (response.destroyed) return
      if (!error.status && !controller.signal.aborted) console.error('HTML PDF rendering failed:', error.message)
      response.statusCode = error.status || 503
      if (error.status === 405) response.setHeader('Allow', 'POST')
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: error.status ? error.message : 'HTML rendering could not finish. Try again or reduce large embedded images.' }))
    } finally { response.off?.('close', disconnect) }
  }
}
