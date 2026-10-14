import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { TOOLS } from '../src/data/tools.js'

const port = 4180
const baseUrl = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Production server did not start.')
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const runtimeErrors = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  for (const tool of TOOLS) {
    const response = await page.goto(`${baseUrl}${tool.route}`, { waitUntil: 'networkidle' })
    if (!response?.ok()) throw new Error(`${tool.route} returned ${response?.status()}`)
    const heading = await page.locator('.tool-page-title').first().textContent()
    if (!heading?.includes(tool.name)) throw new Error(`${tool.route} rendered unexpected heading: ${heading}`)
  }
  if (runtimeErrors.length) throw new Error(`Browser errors:\n${runtimeErrors.join('\n')}`)
  process.stdout.write(`Smoke-tested ${TOOLS.length} tool routes without browser errors.\n`)
} finally {
  await browser?.close()
  server.kill()
}
