import express from 'express'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { createHandler } from './server/ai.js'
import { createWordPdfHandler, createPowerpointPdfHandler } from './server/wordPdf.js'
import { createHtmlPdfHandler } from './server/htmlPdf.js'
import { APP_PATHS } from './src/seo/metadata.js'
import { attachWhiteboardRelay } from './server/whiteboard.js'

try { process.loadEnvFile('.env.local') } catch (error) { if (error.code !== 'ENOENT') throw error }

const app = express()
const server = createServer(app)
const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  if (request.url?.split('?')[0] === '/signal') sockets.handleUpgrade(request, socket, head, peer => sockets.emit('connection', peer, request))
})
attachWhiteboardRelay(server)
const port = Number(process.env.PORT || 4173)
const dist = resolve('dist')

app.disable('x-powered-by')
app.all('/api/word-to-pdf', createWordPdfHandler())
app.all('/api/powerpoint-to-pdf', createPowerpointPdfHandler())
app.all('/api/html-to-pdf', createHtmlPdfHandler())
for (const task of ['translate', 'chat', 'summarize', 'invoice']) app.all(`/api/${task}`, createHandler(task))
app.use('/api', (_request, response) => response.status(404).json({ error: 'Unknown API endpoint.' }))
app.get('/index.html', (_request, response) => response.redirect(308, '/'))
app.get('/:tool/index.html', (request, response, next) => APP_PATHS.includes(`/${request.params.tool}`) ? response.redirect(308, `/${request.params.tool}`) : next())
app.use(express.static(dist, { maxAge: '1h', etag: true, redirect: false }))
app.get('/health', (_request, response) => response.json({ ok: true }))
for (const path of APP_PATHS.filter((path) => path !== '/')) app.get(path, (_request, response) => response.sendFile(resolve(dist, `.${path}/index.html`)))
app.get('*path', (_request, response) => response.status(404).sendFile(resolve(dist, '404.html')))

sockets.on('connection', (socket) => {
  socket.on('message', (raw) => {
    if (raw.length > 1_000_000) return socket.close(1009, 'Message too large')
    let message
    try { message = JSON.parse(raw.toString()) } catch { return }
    if (!message.room || !message.payload) return
    for (const peer of sockets.clients) {
      if (peer !== socket && peer.readyState === 1 && peer.room === message.room) peer.send(JSON.stringify(message.payload))
    }
    socket.room = message.room
  })
})

server.listen(port, () => process.stdout.write(`CreatePDF.tech listening on http://localhost:${port}\n`))
