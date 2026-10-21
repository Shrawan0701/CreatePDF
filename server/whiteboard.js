import { randomBytes, randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { assertBoardSize, applyBoardOperation, normalizeBoard, normalizeBoardOperation, roomCode, MAX_BOARD_BYTES } from '../shared/whiteboard.js'

// Live room state is kept in memory. Personal saved boards remain in IndexedDB.
export function attachWhiteboardRelay(server) {
  const rooms = new Map(), sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BOARD_BYTES + 65536, perMessageDeflate: false })
  const send = (socket, message) => {
    if (socket.readyState !== 1) return
    if (socket.bufferedAmount > MAX_BOARD_BYTES * 3) { socket.close(1013, 'Connection is too slow'); return }
    socket.send(JSON.stringify(message))
  }
  const broadcast = (room, message) => room.peers.forEach(peer => send(peer, message))
  const members = room => broadcast(room, { type: 'members', count: room.peers.size })
  const detach = socket => {
    const room = rooms.get(socket.room)
    if (room) { room.peers.delete(socket); room.touched = Date.now(); members(room) }
    socket.room = null
  }
  sockets.on('connection', socket => {
    socket.peerId = randomUUID(); socket.alive = true
    const helloTimer = setTimeout(() => { if (!socket.room) socket.close(1008, 'Join a room first') }, 12000)
    socket.on('pong', () => { socket.alive = true })
    socket.on('message', raw => {
      let message
      try {
        message = JSON.parse(raw.toString())
        if (!message || typeof message !== 'object') throw new Error('Invalid room message.')
        if (message.type === 'create' || message.type === 'join') {
          if (socket.room) throw new Error('Leave the current room before joining another.')
          let code, room
          if (message.type === 'create') {
            if (rooms.size >= 30) throw new Error('The room service is busy. Try again shortly.')
            do { code = randomBytes(8).toString('hex').toUpperCase() } while (rooms.has(code))
            const board = normalizeBoard(message.board)
            board.actions = board.actions.map((action, index) => ({ ...action, author: socket.peerId, order: index + 1 })); board.revision = board.actions.length
            room = { board, peers: new Set(), touched: Date.now() }; rooms.set(code, room)
          } else {
            code = roomCode(message.room); room = rooms.get(code)
            if (!room) throw new Error('Room not found or expired. Check the code, or ask someone to create a new room.')
          }
          if (room.peers.size >= 12) throw new Error('This room already has 12 participants.')
          room.peers.add(socket); room.touched = Date.now(); socket.room = code; clearTimeout(helloTimer)
          send(socket, { type: 'ready', room: code, peerId: socket.peerId, board: room.board, count: room.peers.size }); members(room)
          return
        }
        const room = rooms.get(socket.room)
        if (!room) throw new Error('Join a room before editing.')
        if (message.type === 'state') { send(socket, { type: 'state', board: room.board }); return }
        if (message.type !== 'op') throw new Error('Unknown room message.')
        const operation = normalizeBoardOperation(message.operation, room.board, socket.peerId), next = applyBoardOperation(room.board, operation)
        assertBoardSize(next); room.board = next; room.touched = Date.now()
        broadcast(room, { type: 'op', operation, revision: next.revision })
      } catch (error) { send(socket, { type: 'error', operationId: typeof message?.operation?.id === 'string' ? message.operation.id : null, message: error.message || 'The room request failed.' }) }
    })
    socket.on('close', () => { clearTimeout(helloTimer); detach(socket) })
    socket.on('error', () => {})
  })
  const interval = setInterval(() => {
    sockets.clients.forEach(socket => { if (socket.readyState !== 1) return; if (!socket.alive) { socket.terminate(); return }; socket.alive = false; socket.ping() })
    for (const [code, room] of rooms) if (!room.peers.size && Date.now() - room.touched > 15 * 60 * 1000) rooms.delete(code)
  }, 30000)
  interval.unref?.()
  const upgrade = (request, socket, head) => {
    if (request.url?.split('?')[0] !== '/whiteboard-signal') return
    sockets.handleUpgrade(request, socket, head, peer => sockets.emit('connection', peer, request))
  }
  server.on('upgrade', upgrade)
  server.once('close', () => { clearInterval(interval); server.off('upgrade', upgrade); sockets.clients.forEach(socket => socket.terminate()); sockets.close(); rooms.clear() })
  return sockets
}
