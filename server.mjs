import express from 'express'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { WebSocketServer } from 'ws'

const app = express()
const server = createServer(app)
const sockets = new WebSocketServer({ server, path: '/signal' })
const port = Number(process.env.PORT || 4173)
const dist = resolve('dist')

app.disable('x-powered-by')
app.use(express.static(dist, { maxAge: '1h', etag: true }))
app.get('/health', (_request, response) => response.json({ ok: true }))
app.get('*path', (_request, response) => response.sendFile(resolve(dist, 'index.html')))

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

server.listen(port, () => process.stdout.write(`CreatePDF.si listening on http://localhost:${port}\n`))
