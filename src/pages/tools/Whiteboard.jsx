import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Download, Eraser, PenTool, Redo2, Save, Square, Trash2, Type, Undo2 } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { downloadBlob, generateId } from '../../components/ui'
import { getWhiteboards, saveWhiteboard } from '../../services/storage'

const BOARD_HEIGHT = 600

export default function Whiteboard() {
  const canvasRef = useRef(null)
  const channelRef = useRef(null)
  const socketRef = useRef(null)
  const actionsRef = useRef([])
  const redoRef = useRef([])
  const draftRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#111827')
  const [width, setWidth] = useState(4)
  const [room, setRoom] = useState(new URLSearchParams(location.search).get('room') || generateId().slice(0, 8))
  const [status, setStatus] = useState('Connecting')
  const [historyState, setHistoryState] = useState({ undo: false, redo: false })

  const renderActions = useCallback((draft) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.clientWidth, BOARD_HEIGHT)
    const render = (action) => {
      context.save()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = action.width || 4
      context.strokeStyle = action.color || '#111827'
      context.fillStyle = action.color || '#111827'
      if (action.kind === 'erase') context.globalCompositeOperation = 'destination-out'
      if (action.kind === 'stroke' || action.kind === 'erase') {
        context.beginPath()
        action.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y))
        context.stroke()
      } else if (action.kind === 'rect') {
        context.strokeRect(action.from.x, action.from.y, action.to.x - action.from.x, action.to.y - action.from.y)
      } else if (action.kind === 'text') {
        context.font = `${Math.max(14, action.width * 5)}px sans-serif`
        context.fillText(action.text, action.at.x, action.at.y)
      }
      context.restore()
    }
    actionsRef.current.forEach(render)
    if (draft) render(draft)
  }, [])

  const publish = useCallback((payload) => {
    channelRef.current?.postMessage(payload)
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ room, payload }))
  }, [room])

  const replaceActions = useCallback((actions, broadcast = false) => {
    actionsRef.current = actions
    redoRef.current = []
    renderActions()
    setHistoryState({ undo: actions.length > 0, redo: false })
    if (broadcast) publish({ type: 'replace', actions })
  }, [publish, renderActions])

  const applyRemote = useCallback((message) => {
    if (message.type === 'action') replaceActions([...actionsRef.current, message.action])
    if (message.type === 'replace') replaceActions(message.actions || [])
    if (message.type === 'request-state') publish({ type: 'replace', actions: actionsRef.current })
  }, [publish, replaceActions])

  useEffect(() => {
    const canvas = canvasRef.current
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
    canvas.height = BOARD_HEIGHT * devicePixelRatio
    canvas.getContext('2d').scale(devicePixelRatio, devicePixelRatio)
    getWhiteboards().then((boards) => {
      const board = boards.find((item) => item.id === room)
      if (board?.actions) replaceActions(board.actions)
    })
    channelRef.current = new BroadcastChannel(`createpdf-board-${room}`)
    channelRef.current.onmessage = (event) => applyRemote(event.data)
    const endpoint = import.meta.env.VITE_SIGNALING_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`
    try {
      const socket = new WebSocket(endpoint)
      socketRef.current = socket
      socket.onopen = () => { setStatus('Remote connected'); socket.send(JSON.stringify({ room, payload: { type: 'request-state' } })) }
      socket.onmessage = (event) => applyRemote(JSON.parse(event.data))
      socket.onerror = () => setStatus('Local only')
      socket.onclose = () => setStatus('Local only')
    } catch { setStatus('Local only') }
    return () => { channelRef.current?.close(); socketRef.current?.close() }
  }, [applyRemote, replaceActions, room])

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const begin = (event) => {
    const start = point(event)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (tool === 'text') {
      const text = window.prompt('Text to add')
      if (!text) return
      const action = { kind: 'text', at: start, text, color, width }
      replaceActions([...actionsRef.current, action])
      publish({ type: 'action', action })
      return
    }
    draftRef.current = tool === 'rect' ? { kind: 'rect', from: start, to: start, color, width } : { kind: tool === 'eraser' ? 'erase' : 'stroke', points: [start], color, width }
  }

  const move = (event) => {
    const draft = draftRef.current
    if (!draft) return
    const next = point(event)
    if (draft.kind === 'rect') draft.to = next
    else draft.points.push(next)
    renderActions(draft)
  }

  const finish = () => {
    const action = draftRef.current
    if (!action) return
    draftRef.current = null
    replaceActions([...actionsRef.current, action])
    publish({ type: 'action', action })
  }

  const undo = () => {
    if (!actionsRef.current.length) return
    redoRef.current.push(actionsRef.current.at(-1))
    actionsRef.current = actionsRef.current.slice(0, -1)
    renderActions(); setHistoryState({ undo: actionsRef.current.length > 0, redo: true }); publish({ type: 'replace', actions: actionsRef.current })
  }
  const redo = () => {
    const action = redoRef.current.pop()
    if (!action) return
    actionsRef.current = [...actionsRef.current, action]
    renderActions(); setHistoryState({ undo: true, redo: redoRef.current.length > 0 }); publish({ type: 'replace', actions: actionsRef.current })
  }
  const clear = () => replaceActions([], true)
  const save = async () => saveWhiteboard({ id: room, actions: actionsRef.current, image: canvasRef.current.toDataURL(), savedAt: Date.now() })
  const download = () => canvasRef.current.toBlob((blob) => blob && downloadBlob(blob, `whiteboard-${room}.png`), 'image/png')

  return <ToolPage toolId="whiteboard"><div className="canvas-toolbar"><span className="status-pill">{status}</span>{[{ key: 'pen', icon: PenTool }, { key: 'eraser', icon: Eraser }, { key: 'rect', icon: Square }, { key: 'text', icon: Type }].map(({ key, icon: Icon }) => <button key={key} className={`icon-btn ${tool === key ? 'active' : ''}`} title={key} onClick={() => setTool(key)}><Icon size={17} /></button>)}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={tool === 'eraser'} /><input type="range" min="1" max="30" value={width} onChange={(event) => setWidth(Number(event.target.value))} /><button className="icon-btn" onClick={undo} disabled={!historyState.undo}><Undo2 size={17} /></button><button className="icon-btn" onClick={redo} disabled={!historyState.redo}><Redo2 size={17} /></button><input className="form-input room-input" value={room} onChange={(event) => setRoom(event.target.value.trim())} /><button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${room}`)}><Copy size={14} /> Share</button><button className="btn btn-secondary" onClick={clear}><Trash2 size={14} /> Clear</button><button className="btn btn-secondary" onClick={save}><Save size={14} /> Save</button><button className="btn btn-primary" onClick={download}><Download size={14} /> PNG</button></div><div className="whiteboard-wrap"><canvas ref={canvasRef} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} /></div><p className="form-hint">Actions synchronize by room through the optional signaling server and are saved locally on demand.</p></ToolPage>
}
