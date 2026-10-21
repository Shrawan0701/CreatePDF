export function whiteboardEndpoint(value, baseUrl) {
  const url = new URL(String(value || '').trim() || '/whiteboard-signal', baseUrl)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('The room relay address is invalid.')
  if (new URL(baseUrl).protocol === 'https:' && url.protocol !== 'wss:') throw new Error('The room relay needs a secure HTTPS or WSS address.')
  if (url.pathname === '/' || /\/signal\/?$/.test(url.pathname)) url.pathname = url.pathname === '/' ? '/whiteboard-signal' : url.pathname.replace(/\/signal\/?$/, '/whiteboard-signal')
  return url.href
}

export function createRoomSession({ onMessage, onDisconnect, onError, configured, development = false, baseUrl = location.href, WebSocketImpl = WebSocket }) {
  let socket, closed = false, ready = false, timer
  const close = () => { closed = true; clearTimeout(timer); socket?.close() }
  const fail = message => { if (!closed) { onError(message); close() } }
  const send = payload => {
    if (closed || socket?.readyState !== 1) throw new Error('The room connection is closed. Rejoin or continue locally.')
    socket.send(JSON.stringify(payload))
  }
  return {
    open(initial) {
      if (closed || socket) return
      try {
        const endpoint = configured?.trim() || (development ? '/whiteboard-signal' : '/api/whiteboard-signal')
        socket = new WebSocketImpl(whiteboardEndpoint(endpoint, baseUrl))
        timer = setTimeout(() => { if (!ready) fail('The room server did not respond. Please try again shortly.') }, 10000)
        socket.onopen = () => { if (!closed) { try { send(initial) } catch (error) { fail(error.message) } } }
        socket.onmessage = event => {
          if (closed) return
          try {
            const message = JSON.parse(event.data)
            if (message.type === 'ready') { ready = true; clearTimeout(timer) }
            if (message.type === 'error' && !ready) { fail(message.message); return }
            onMessage(message)
          } catch (error) { fail(error.message || 'Room data could not be read.') }
        }
        socket.onerror = () => fail('The room server is unavailable. Your board is kept on this device. Try again after the deployment finishes.')
        socket.onclose = () => { clearTimeout(timer); if (!closed) { closed = true; onDisconnect(ready) } }
      } catch (error) { fail(error.message || 'This browser could not open a room.') }
    },
    send,
    close,
  }
}
