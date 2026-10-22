import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const origin = 'http://127.0.0.1:4219'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4219', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt > 100) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'networkidle' })
  const install = () => page.getByRole('button', { name: 'Install CreatePDF.tech', exact: true })
  for (const width of [1440, 1280, 1150, 1024, 960, 901, 900, 850, 768, 640, 440, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await install().isVisible(), `Install hidden at ${width}px`)
    const fits = await page.locator('.header-inner').evaluate(element => [...element.querySelectorAll('a.brand, .header-actions > button, .header-actions > a')].filter(item => getComputedStyle(item).display !== 'none').every(item => { const r = item.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 }))
    assert.ok(fits, `Header actions leave the screen at ${width}px`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${width}px`)
  }
  await install().click()
  await page.getByRole('dialog', { name: 'Install CreatePDF.tech' }).waitFor()
  assert.equal(await page.locator('.install-app-steps li').count(), 3)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.ok(await install().evaluate(button => button === document.activeElement), 'Focus did not return to the install button')
  const nativePrompt = async (outcome, throws = false) => page.evaluate(({ outcome, throws }) => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = async () => { window.installPromptCalls = (window.installPromptCalls || 0) + 1; if (throws) throw new Error('Prompt unavailable') }
    event.userChoice = Promise.resolve({ outcome, platform: 'web' })
    window.dispatchEvent(event)
  }, { outcome, throws })
  await nativePrompt('dismissed'); await install().click()
  await page.waitForFunction(() => window.installPromptCalls === 1)
  assert.equal(await page.getByRole('dialog').count(), 0, 'Dismissal should respect the user choice')
  await install().click(); await page.getByRole('dialog').waitFor()
  assert.equal(await page.evaluate(() => window.installPromptCalls), 1, 'A consumed install event was reused')
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await nativePrompt('accepted', true); await install().click(); await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await nativePrompt('accepted'); await install().click()
  assert.equal(await page.getByText('App installed successfully!', { exact: true }).count(), 0, 'Acceptance alone must not claim completed installation')
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await install().waitFor({ state: 'hidden' })
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' })
  const iphone = await ios.newPage(); iphone.on('pageerror', error => errors.push(error.message))
  await iphone.goto(origin, { waitUntil: 'networkidle' })
  await iphone.getByRole('button', { name: 'Install CreatePDF.tech', exact: true }).click()
  await iphone.getByRole('dialog').waitFor()
  assert.match(await iphone.locator('.install-app-dialog').innerText(), /iPhone & iPad/)
  assert.match(await iphone.locator('.install-app-steps').innerText(), /Add to Home Screen/)
  assert.match(await iphone.locator('.install-app-steps').innerText(), /Open as Web App/)
  assert.equal(await iphone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await mkdir('artifacts', { recursive: true })
  await iphone.screenshot({ path: 'artifacts/pwa-install-iphone.png', animations: 'disabled' })
  await iphone.getByRole('button', { name: 'Close install instructions' }).click()
  await iphone.getByRole('button', { name: 'Toggle navigation' }).click()
  assert.ok(await iphone.getByRole('navigation', { name: 'Main navigation' }).isVisible())
  await iphone.getByRole('link', { name: 'Workflows', exact: true }).click()
  await iphone.waitForURL('**/pdf-workflow')
  assert.ok(await iphone.getByRole('button', { name: 'Install CreatePDF.tech', exact: true }).isVisible())
  const androidContext = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' })
  const android = await androidContext.newPage()
  await android.goto(origin, { waitUntil: 'networkidle' })
  await android.getByRole('button', { name: 'Install CreatePDF.tech', exact: true }).click()
  await android.getByRole('dialog').waitFor()
  assert.match(await android.locator('.install-app-dialog').innerText(), /Android/)
  assert.match(await android.locator('.install-app-steps').innerText(), /Install app or Add to Home screen/)
  await android.screenshot({ path: 'artifacts/pwa-install-android.png', animations: 'disabled' })
  const standalone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await standalone.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = query => { const result = original(query); if (query.includes('display-mode')) Object.defineProperty(result, 'matches', { value: true }); return result }
  })
  const installedPage = await standalone.newPage(); await installedPage.goto(origin, { waitUntil: 'networkidle' })
  assert.equal(await installedPage.getByRole('button', { name: 'Install CreatePDF.tech', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PWA install verified: visible header action from 320px to desktop without overflow, native prompt consumption/dismissal/errors, actual-install event handling, iPhone and Android fallback instructions, dialog keyboard/focus behavior, mobile navigation and hidden action in standalone mode. Native OS installation itself is not automated.')
} finally { await browser?.close(); server.kill() }
