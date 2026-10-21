import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoomSession, whiteboardEndpoint } from './whiteboardTransport'

class Socket {
  static instances = []
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; Socket.instances.push(this) }
  send(value) { this.sent.push(JSON.parse(value)) }
  close() { this.readyState = 3 }
  connected() { this.readyState = 1; this.onopen() }
  message(value) { this.onmessage({ data: JSON.stringify(value) }) }
}
const sessions = []
function client(options = {}) {
  const callbacks = { onMessage: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() }
  const session = createRoomSession({ ...callbacks, baseUrl: 'https://createpdf.example/whiteboard', WebSocketImpl: Socket, ...options })
  sessions.push(session)
  return { session, ...callbacks }
}
afterEach(() => { sessions.splice(0).forEach(session => session.close()); Socket.instances = []; vi.useRealTimers() })

describe('whiteboard deployment endpoint', () => {
  it('uses the deployed function in production and the local relay in development', () => {
    client().session.open({ type: 'create', board: { actions: [] } })
    expect(Socket.instances[0].url).toBe('wss://createpdf.example/api/whiteboard-signal')
    client({ development: true, baseUrl: 'http://localhost:5173/whiteboard' }).session.open({ type: 'join', room: 'ABCDEF' })
    expect(Socket.instances[1].url).toBe('ws://localhost:5173/whiteboard-signal')
  })
  it('accepts HTTPS relay URLs and maps legacy signaling paths', () => {
    expect(whiteboardEndpoint('https://relay.example', 'https://site.example')).toBe('wss://relay.example/whiteboard-signal')
    expect(whiteboardEndpoint('https://relay.example/base/signal/', 'https://site.example')).toBe('wss://relay.example/base/whiteboard-signal')
    expect(whiteboardEndpoint('/api/whiteboard-signal', 'https://site.example')).toBe('wss://site.example/api/whiteboard-signal')
    expect(() => whiteboardEndpoint('ws://relay.example', 'https://site.example')).toThrow('secure')
    expect(() => whiteboardEndpoint('file:///relay', 'https://site.example')).toThrow('invalid')
  })
})

describe('whiteboard connection lifecycle', () => {
  it('sends the initial request once, then delivers ready and operation messages', () => {
    const { session, onMessage, onError } = client()
    session.open({ type: 'join', room: 'ABCDEF' }); session.open({ type: 'join', room: 'ABCDEF' })
    expect(Socket.instances).toHaveLength(1)
    const socket = Socket.instances[0]; socket.connected()
    expect(socket.sent).toEqual([{ type: 'join', room: 'ABCDEF' }])
    socket.message({ type: 'ready', room: 'ABCDEF' })
    session.send({ type: 'state' })
    socket.message({ type: 'state', board: { revision: 2 } })
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(socket.sent.at(-1)).toEqual({ type: 'state' })
    expect(onError).not.toHaveBeenCalled()
  })
  it('fails an invalid join cleanly without also reporting a disconnect', () => {
    const { session, onError, onDisconnect } = client()
    session.open({ type: 'join', room: 'ABCDEF' })
    const socket = Socket.instances[0]; socket.connected()
    socket.message({ type: 'error', message: 'Room not found or expired.' }); socket.onclose()
    expect(onError).toHaveBeenCalledExactlyOnceWith('Room not found or expired.')
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(() => session.send({ type: 'state' })).toThrow('closed')
  })
  it('reports established disconnections and stops processing after an explicit close', () => {
    const first = client(); first.session.open({ type: 'create' })
    const socket = Socket.instances[0]; socket.connected(); socket.message({ type: 'ready' }); socket.onclose()
    expect(first.onDisconnect).toHaveBeenCalledExactlyOnceWith(true)
    const second = client(); second.session.open({ type: 'create' }); second.session.close()
    Socket.instances[1].message({ type: 'ready' })
    expect(second.onMessage).not.toHaveBeenCalled()
  })
  it('times out an unresponsive server and cancels the timeout when ready', () => {
    vi.useFakeTimers()
    const first = client(); first.session.open({ type: 'create' }); vi.advanceTimersByTime(10001)
    expect(first.onError).toHaveBeenCalledOnce()
    const second = client(); second.session.open({ type: 'create' }); Socket.instances[1].message({ type: 'ready' }); vi.advanceTimersByTime(20000)
    expect(second.onError).not.toHaveBeenCalled()
  })
})
