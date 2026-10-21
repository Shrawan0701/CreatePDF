import { createServer } from 'node:http'
import { attachWhiteboardRelay } from '../server/whiteboard.js'

// Export the HTTP server so Vercel can forward upgrade events to it. Attaching
// a relay to server.mjs alone does not deploy it in a Vite/static project.
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.statusCode = 405; response.setHeader('Allow', 'GET, HEAD')
    response.end(JSON.stringify({ error: 'Use a WebSocket connection to create or join a room.' })); return
  }
  response.end(JSON.stringify({ ok: true, service: 'whiteboard', transport: 'websocket', storage: 'memory' }))
})

// Vercel can pass the original or rewritten URL. This function owns the
// endpoint, so accept its upgrade regardless of that internal path.
attachWhiteboardRelay(server, { paths: null })

export default server
