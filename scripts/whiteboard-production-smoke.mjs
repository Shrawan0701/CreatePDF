import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import express from 'express'
import { WebSocket } from 'ws'
import { chromium } from 'playwright-core'
import { PDFDocument } from 'pdf-lib'
import functionServer from '../api/whiteboard-signal.js'
import { blankBoard } from '../shared/whiteboard.js'

const app = express(), gateway = createServer(app), peers = []
const paths = ['/api/whiteboard-signal', '/whiteboard-signal']
const upgrades = []
let browser
app.all(paths, (request, response) => functionServer.emit('request', request, response))
app.use(express.static(resolve('dist'), { redirect: false }))
app.get('/whiteboard', (_request, response) => response.sendFile(resolve('dist/whiteboard/index.html')))
gateway.on('upgrade', (request, socket, head) => {
  upgrades.push(request.url.split('?')[0])
  if (paths.includes(request.url.split('?')[0])) functionServer.emit('upgrade', request, socket, head)
  else socket.destroy()
})
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${gateway.address().port}`
function connect(path = '/api/whiteboard-signal') {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path), messages = [], waiters = []
  peers.push(socket)
  socket.on('message', bytes => { const message = JSON.parse(bytes.toString()); messages.push(message); for (const waiter of [...waiters]) if (waiter.test(message)) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message) } })
  const wait = test => new Promise((resolve, reject) => {
    const existing = messages.find(test)
    if (existing) { resolve(existing); return }
    const entry = { test, resolve, timer: setTimeout(() => reject(new Error('Room message timed out')), 5000) }; waiters.push(entry)
  })
  return { socket, messages, opened: new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) }), wait, send: message => socket.send(JSON.stringify(message)) }
}

try {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'))
  assert.equal(config.fluid, true)
  assert.equal(config.functions['api/whiteboard-signal.js'].maxDuration, 300)
  assert.ok(config.rewrites.some(route => route.source === '/whiteboard-signal' && route.destination === '/api/whiteboard-signal'))
  const health = await fetch(`${origin}/api/whiteboard-signal`)
  assert.equal(health.status, 200); assert.match(health.headers.get('cache-control'), /no-store/)
  assert.deepEqual(await health.json(), { ok: true, service: 'whiteboard', transport: 'websocket', storage: 'memory' })
  assert.equal((await fetch(`${origin}/api/whiteboard-signal`, { method: 'POST' })).status, 405)
  const host = connect(); await host.opened; host.send({ type: 'create', board: blankBoard() })
  const room = await host.wait(message => message.type === 'ready')
  const guest = connect('/whiteboard-signal'); await guest.opened; guest.send({ type: 'join', room: room.room })
  const joined = await guest.wait(message => message.type === 'ready')
  assert.equal(joined.count, 2)
  const operation = { id: 'operation-1', kind: 'add', action: { id: 'stroke-1', kind: 'stroke', points: [{ x: 50, y: 70 }, { x: 300, y: 140 }], width: 4, color: '#0d7865' } }
  host.send({ type: 'op', operation })
  const received = await guest.wait(message => message.type === 'op')
  assert.equal(received.revision, 1)
  assert.equal(received.operation.action.author, room.peerId)
  host.send({ type: 'op', operation })
  assert.match((await host.wait(message => message.type === 'error')).message, /already exists/)
  const missing = connect(); await missing.opened; missing.send({ type: 'join', room: '0000000000000000' })
  assert.match((await missing.wait(message => message.type === 'error')).message, /not found or expired/)

  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const contexts = await Promise.all([browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 1000 }, serviceWorkers: 'block' }), browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 1000 }, serviceWorkers: 'block' })])
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  const [first, second] = pages, errors = []
  for (const page of pages) page.on('pageerror', error => errors.push(error.message))
  await first.goto(`${origin}/whiteboard`, { waitUntil: 'networkidle' })
  await first.getByRole('button', { name: 'Create room', exact: true }).click()
  await first.locator('.wb-status.shared').waitFor()
  const code = await first.locator('.wb-room-code').inputValue()
  await second.goto(`${origin}/whiteboard?room=${code}`, { waitUntil: 'networkidle' })
  await second.locator('.wb-status.shared').waitFor()
  await first.getByRole('status').filter({ hasText: '2 people connected' }).waitFor()
  assert.ok(upgrades.filter(path => path === '/api/whiteboard-signal').length >= 4, 'Production client used the wrong WebSocket URL')
  const draw = async (page, tool, start, end) => {
    await page.getByRole('button', { name: tool, exact: true }).click()
    const canvas = page.locator('.wb-stage canvas'); await canvas.scrollIntoViewIfNeeded()
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + bounds.width * start[0], bounds.y + bounds.height * start[1]); await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * end[0], bounds.y + bounds.height * end[1], { steps: 8 }); await page.mouse.up()
  }
  const waitBoard = async (page, visible) => {
    await page.waitForFunction(async ({ code, visible }) => {
      const records = await new Promise((resolve, reject) => {
        const opening = indexedDB.open('createpdf-db')
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => { const db = opening.result, request = db.transaction('whiteboards').objectStore('whiteboards').getAll(); request.onsuccess = () => { db.close(); resolve(request.result) }; request.onerror = () => { db.close(); reject(request.error) } }
      })
      return records.some(record => record.room === code && record.actions.filter(action => !action.hidden).length === visible)
    }, { code, visible })
  }
  await draw(first, 'Pen', [.15, .2], [.45, .35]); await waitBoard(second, 1)
  await draw(second, 'Rectangle', [.5, .4], [.75, .65]); await waitBoard(first, 2)
  await first.getByRole('button', { name: 'Undo your last action', exact: true }).click(); await waitBoard(second, 1)
  await first.getByRole('button', { name: 'Redo your last action', exact: true }).click(); await waitBoard(second, 2)
  await second.getByRole('button', { name: 'Clear board', exact: true }).click(); await waitBoard(first, 0)
  await second.getByRole('button', { name: 'Undo your last action', exact: true }).click(); await waitBoard(first, 2)
  await second.reload({ waitUntil: 'networkidle' }); await second.locator('.wb-status.shared').waitFor(); await waitBoard(second, 2)
  const pending = second.waitForEvent('download')
  await second.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await pending, pdf = await PDFDocument.load(await readFile(await download.path()))
  assert.equal(pdf.getPageCount(), 1)
  await mkdir('artifacts', { recursive: true })
  await second.locator('.wb-room-card').scrollIntoViewIfNeeded()
  await second.locator('.toast-close').evaluateAll(buttons => buttons.forEach(button => button.click()))
  await second.screenshot({ path: 'artifacts/whiteboard-production-connected.png', fullPage: true, animations: 'disabled' })
  await second.setViewportSize({ width: 440, height: 956 })
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await second.screenshot({ path: 'artifacts/whiteboard-production-mobile.png', fullPage: true, animations: 'disabled' })
  await second.getByRole('button', { name: 'Leave room', exact: true }).click()
  await second.locator('.wb-status.local').waitFor(); await first.getByRole('status').filter({ hasText: '1 person' }).waitFor()
  await draw(second, 'Line', [.2, .5], [.4, .7])
  assert.deepEqual(errors, [])
  console.log('Production whiteboard verified: real exported function server, HTTP health/methods, native WebSocket upgrades at both URLs, create/join/state/broadcast/errors, two isolated production browser contexts, exact production endpoint, drawing both directions, undo/redo/clear, refresh/rejoin, PDF export, leave/local recovery and mobile fitting. This checks one server instance; cross-instance persistence is deliberately not claimed.')
} finally {
  await browser?.close()
  peers.forEach(socket => socket.terminate())
  functionServer.emit('close')
  gateway.closeAllConnections()
  await new Promise(resolve => gateway.close(resolve))
}
