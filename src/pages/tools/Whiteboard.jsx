import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Circle, Copy, Download, Eraser, FolderOpen, LogOut, Minus, PenTool, Plus, Redo2, Save, Square, Trash2, Type, Undo2, Users } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { FormGroup, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { getPref, setPref, getWhiteboard, getWhiteboards, saveWhiteboard } from '../../services/storage'
import { blankBoard, createWhiteboardSession, exportWhiteboard, normalizeBoard, paintWhiteboard, readSavedWhiteboard } from '../../services/whiteboard'
import { applyBoardOperation, assertBoardSize, normalizeBoardOperation, roomCode } from '../../../shared/whiteboard'
import './Whiteboard.css'

const uid = () => crypto.randomUUID()
const localConnection = () => ({ phase: 'local', room: '', count: 0, error: '' })
const tools = [{ key: 'pen', label: 'Pen', Icon: PenTool }, { key: 'eraser', label: 'Eraser', Icon: Eraser }, { key: 'rect', label: 'Rectangle', Icon: Square }, { key: 'ellipse', label: 'Ellipse', Icon: Circle }, { key: 'line', label: 'Line', Icon: Minus }, { key: 'text', label: 'Text', Icon: Type }]

export default function Whiteboard() {
  const { showToast } = useApp(), navigate = useNavigate()
  const canvasRef = useRef(null), viewportRef = useRef(null), textRef = useRef(null), roomInputRef = useRef(null)
  const canonical = useRef(blankBoard()), view = useRef(canonical.current), pending = useRef(new Map()), draft = useRef(null), pointer = useRef(null)
  const actor = useRef(uid()), session = useRef(null), generation = useRef(0), undoStack = useRef([]), redoStack = useRef([]), frame = useRef(0)
  const mounted = useRef(true), readyRef = useRef(false), actionLock = useRef(false), startRoomRef = useRef(null), lastSnapshot = useRef(null)
  const initialParams = useRef(new URLSearchParams(location.search))
  const [board, setBoard] = useState(canonical.current), [boardId, setBoardId] = useState(uid), [title, setTitle] = useState('Untitled board')
  const meta = useRef({ id: boardId, title }); meta.current = { id: boardId, title }
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(''), [saved, setSaved] = useState([]), [saveStatus, setSaveStatus] = useState('Opening saved boards…')
  const [tool, setTool] = useState('pen'), [color, setColor] = useState('#172b27'), [strokeWidth, setStrokeWidth] = useState(4), [fontSize, setFontSize] = useState(28), [text, setText] = useState('')
  const [joinInput, setJoinInput] = useState(''), [connection, setConnection] = useState(localConnection), connectionRef = useRef(connection)
  const [history, setHistory] = useState({ undo: false, redo: false }), [zoom, setZoom] = useState('fit'), [format, setFormat] = useState('pdf')
  const [viewport, setViewport] = useState({ width: 1000, height: 600, ratio: 1 })
  const changeConnection = next => { connectionRef.current = next; setConnection(next) }
  const updateUrl = (id, room = '') => navigate({ pathname: '/whiteboard', search: room ? `?room=${encodeURIComponent(room)}` : `?board=${encodeURIComponent(id)}` }, { replace: true })
  const updateHistory = () => setHistory({ undo: undoStack.current.length > 0, redo: redoStack.current.length > 0 })
  const paint = useCallback(() => {
    frame.current = 0
    const canvas = canvasRef.current, model = view.current, context = canvas?.getContext('2d')
    if (!context) return
    context.setTransform(canvas.width / model.width, 0, 0, canvas.height / model.height, 0, 0)
    paintWhiteboard(context, model, draft.current)
  }, [])
  const schedulePaint = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(paint) }, [paint])
  const refreshView = useCallback(() => {
    let model = canonical.current
    for (const operation of pending.current.values()) if (operation.kind !== 'add' || !model.actions.some(action => action.id === operation.action.id)) model = applyBoardOperation(model, operation)
    view.current = model; setBoard(model); schedulePaint()
  }, [schedulePaint])
  const cancelDrawing = () => { draft.current = null; pointer.current = null; schedulePaint() }
  const resetModel = model => { cancelDrawing(); canonical.current = model; pending.current.clear(); undoStack.current = []; redoStack.current = []; refreshView(); updateHistory() }
  const snapshot = () => ({ schemaVersion: 2, ...meta.current, title: meta.current.title.trim() || 'Untitled board', ...view.current, savedAt: Date.now(), room: connectionRef.current.room || '' })
  const persist = async record => {
    await saveWhiteboard(record); await setPref('whiteboard-last-board', record.id)
    if (!mounted.current) return
    setSaved(current => [{ id: record.id, title: record.title || 'Saved board', savedAt: record.savedAt }, ...current.filter(item => item.id !== record.id)].sort((a, b) => b.savedAt - a.savedAt))
    if (record.id === meta.current.id) setSaveStatus('Saved on this device')
  }

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    Promise.all([getWhiteboards(), getPref('whiteboard-last-board')]).then(async ([records, lastId]) => {
      if (cancelled) return
      setSaved(records.map(record => ({ id: record.id, title: record.title || `Board ${record.id}`, savedAt: record.savedAt || 0 })).sort((a, b) => b.savedAt - a.savedAt))
      const invited = initialParams.current.get('room'), requested = initialParams.current.get('board')
      const legacy = invited && records.find(record => record.id.toUpperCase() === invited.toUpperCase())
      const record = legacy || (!invited && records.find(item => item.id === (requested || lastId)))
      if (record) {
        const model = await readSavedWhiteboard(record)
        if (cancelled) return
        canonical.current = model; view.current = model; setBoard(model); setBoardId(record.id); setTitle(record.title || `Board ${record.id}`); schedulePaint()
      }
      readyRef.current = true; setReady(true); setSaveStatus('Saved on this device')
      if (invited && !legacy) startRoomRef.current?.('join', invited)
    }).catch(error => {
      if (!cancelled) { readyRef.current = true; setReady(true); setSaveStatus('Local saving is unavailable'); showToast(error.message || 'Saved boards could not be opened.', 'error') }
    })
    return () => {
      cancelled = true; mounted.current = false; generation.current++; session.current?.close(); cancelAnimationFrame(frame.current); frame.current = 0
      if (lastSnapshot.current) { const record = lastSnapshot.current; saveWhiteboard(record).then(() => setPref('whiteboard-last-board', record.id)).catch(() => {}) }
    }
  }, [schedulePaint, showToast])

  useEffect(() => {
    if (!ready) return
    const record = { schemaVersion: 2, id: boardId, title: title.trim() || 'Untitled board', ...board, savedAt: Date.now(), room: connection.room || '' }
    lastSnapshot.current = record; setSaveStatus('Saving…')
    const timer = setTimeout(() => persist(record).catch(() => { if (mounted.current) setSaveStatus('Could not save — download a copy before leaving') }), 700)
    return () => clearTimeout(timer)
  }, [ready, board, boardId, title, connection.room])
  useEffect(() => {
    const flush = () => { const record = lastSnapshot.current; if (record) saveWhiteboard(record).then(() => setPref('whiteboard-last-board', record.id)).catch(() => {}) }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])
  useEffect(() => {
    const element = viewportRef.current
    const measure = () => {
      const width = Math.round(element.clientWidth), height = Math.round(element.clientHeight), ratio = Math.min(window.devicePixelRatio || 1, 2)
      setViewport(current => current.width === width && current.height === height && current.ratio === ratio ? current : { width, height, ratio })
    }
    const observer = new ResizeObserver(measure); observer.observe(element); window.addEventListener('resize', measure); measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  const displayWidth = zoom === 'fit' ? Math.max(100, Math.min(viewport.width - 34, (viewport.height - 34) * board.width / board.height)) : board.width * Number(zoom) / 100
  const displayHeight = displayWidth * board.height / board.width
  useEffect(() => {
    const canvas = canvasRef.current
    const ratio = Math.min(viewport.ratio, 8192 / Math.max(displayWidth, displayHeight), Math.sqrt(16000000 / (displayWidth * displayHeight)))
    const width = Math.max(1, Math.round(displayWidth * ratio)), height = Math.max(1, Math.round(displayHeight * ratio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    schedulePaint()
  }, [displayWidth, displayHeight, viewport.ratio, schedulePaint])
  useEffect(() => { if (tool === 'text') textRef.current?.focus() }, [tool])

  const startRoom = async (kind, value = '') => {
    if (!readyRef.current || actionLock.current || connectionRef.current.phase === 'connecting') return
    let code = ''
    try { if (kind === 'join') code = roomCode(value) } catch (error) { showToast(error.message, 'warning'); return }
    const ticket = ++generation.current, previous = connectionRef.current
    cancelDrawing(); session.current?.close(); changeConnection({ ...previous, phase: 'connecting', error: '' })
    try {
      if (view.current.actions.length) await persist(snapshot())
      if (!mounted.current || ticket !== generation.current) return
      const client = createWhiteboardSession({
        onMessage(message) {
          if (!mounted.current || ticket !== generation.current) return
          if (message.type === 'ready') {
            const model = normalizeBoard(message.board)
            actor.current = message.peerId; resetModel(model)
            const id = uid(); setBoardId(id); setTitle(kind === 'create' ? meta.current.title : `Shared board ${message.room.slice(-6)}`)
            if (kind === 'create') { undoStack.current = model.actions.filter(action => !action.hidden && action.author === message.peerId).map(action => ({ ids: [action.id], before: false, after: true })); updateHistory() }
            changeConnection({ phase: 'shared', room: message.room, count: message.count, error: '' }); setJoinInput(''); updateUrl(id, message.room)
          } else if (message.type === 'members') changeConnection({ ...connectionRef.current, count: message.count })
          else if (message.type === 'state') {
            canonical.current = normalizeBoard(message.board)
            for (const [id, operation] of pending.current) if (operation.kind === 'add' && canonical.current.actions.some(action => action.id === operation.action.id)) pending.current.delete(id)
            refreshView()
          } else if (message.type === 'op') {
            pending.current.delete(message.operation.id)
            if (message.revision > canonical.current.revision + 1) { client.send({ type: 'state' }); return }
            if (message.revision > canonical.current.revision) canonical.current = applyBoardOperation(canonical.current, message.operation, message.revision)
            refreshView()
          } else if (message.type === 'error') {
            if (message.operationId) { pending.current.delete(message.operationId); refreshView() }
            showToast(message.message, 'error')
          }
        },
        onDisconnect(wasReady) {
          if (!mounted.current || ticket !== generation.current) return
          changeConnection({ ...connectionRef.current, phase: wasReady ? 'disconnected' : previous.room ? 'disconnected' : 'local', count: 0, error: wasReady ? 'Connection lost. Rejoin to sync, or continue locally.' : 'The room connection closed before joining.' })
        },
        onError(error) {
          if (!mounted.current || ticket !== generation.current) return
          changeConnection({ ...connectionRef.current, phase: connectionRef.current.room ? 'disconnected' : 'local', count: 0, error })
        },
      })
      session.current = client
      client.open(kind === 'create' ? { type: 'create', board: view.current } : { type: 'join', room: code })
    } catch (error) { if (mounted.current && ticket === generation.current) changeConnection({ ...previous, error: `Could not save the current board before switching: ${error.message}` }) }
  }
  startRoomRef.current = startRoom
  const leaveRoom = () => {
    generation.current++; session.current?.close(); session.current = null
    const model = view.current; actor.current = uid(); resetModel({ ...model, revision: 0 })
    const id = uid(); setBoardId(id); changeConnection(localConnection()); updateUrl(id)
  }
  const submit = operation => {
    if (!readyRef.current || busy || ['connecting', 'disconnected'].includes(connectionRef.current.phase)) return false
    try {
      const checked = normalizeBoardOperation(operation, view.current, actor.current), next = applyBoardOperation(view.current, checked)
      assertBoardSize(next)
      if (connectionRef.current.phase === 'shared') { session.current.send({ type: 'op', operation: checked }); pending.current.set(checked.id, checked) }
      else canonical.current = next
      refreshView(); return true
    } catch (error) { showToast(error.message, 'error'); return false }
  }
  const add = action => {
    if (submit({ id: uid(), kind: 'add', action })) { undoStack.current.push({ ids: [action.id], before: false, after: true }); redoStack.current = []; updateHistory() }
  }
  const undo = () => {
    const entry = undoStack.current.at(-1)
    if (entry && submit({ id: uid(), kind: 'visibility', ids: entry.ids, visible: entry.before })) { undoStack.current.pop(); redoStack.current.push(entry); updateHistory() }
  }
  const redo = () => {
    const entry = redoStack.current.at(-1)
    if (entry && submit({ id: uid(), kind: 'visibility', ids: entry.ids, visible: entry.after })) { redoStack.current.pop(); undoStack.current.push(entry); updateHistory() }
  }
  const historyHandlers = useRef({ undo, redo, cancelDrawing }); historyHandlers.current = { undo, redo, cancelDrawing }
  useEffect(() => {
    const handler = event => {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); historyHandlers.current[event.shiftKey ? 'redo' : 'undo']() }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); historyHandlers.current.redo() }
      else if (event.key === 'Escape') historyHandlers.current.cancelDrawing()
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])
  const disabled = !ready || !!busy || connection.phase === 'connecting', drawingDisabled = disabled || connection.phase === 'disconnected'
  const point = event => { const bounds = canvasRef.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(board.width, (event.clientX - bounds.left) / bounds.width * board.width)), y: Math.max(0, Math.min(board.height, (event.clientY - bounds.top) / bounds.height * board.height)) } }
  const begin = event => {
    if (drawingDisabled || event.button !== 0 || event.isPrimary === false || draft.current) return
    event.preventDefault(); const at = point(event)
    if (tool === 'text') {
      if (!text.trim()) { textRef.current?.focus(); showToast('Type text in the toolbar, then click the board to place it.', 'info'); return }
      add({ id: uid(), kind: 'text', text, at, fontSize, baseline: 'top', color, width: strokeWidth }); return
    }
    event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId
    const action = { id: uid(), color, width: tool === 'eraser' ? strokeWidth * 2 : strokeWidth, author: actor.current }
    draft.current = ['rect', 'ellipse', 'line'].includes(tool) ? { ...action, kind: tool, from: at, to: at } : { ...action, kind: tool === 'eraser' ? 'erase' : 'stroke', points: [at] }
    schedulePaint()
  }
  const move = event => {
    if (!draft.current || pointer.current !== event.pointerId) return
    const action = draft.current
    if (action.points) {
      const coalesced = event.nativeEvent.getCoalescedEvents?.()
      for (const entry of coalesced?.length ? coalesced : [event]) {
        const next = point(entry), last = action.points.at(-1)
        if (action.points.length < 12000 && Math.hypot(next.x - last.x, next.y - last.y) >= .8) action.points.push(next)
      }
    } else action.to = point(event)
    schedulePaint()
  }
  const finish = event => {
    if (!draft.current || pointer.current !== event.pointerId) return
    const action = draft.current
    if (!action.points) action.to = point(event)
    else if (action.points.length < 12000) { const end = point(event), last = action.points.at(-1); if (Math.hypot(end.x - last.x, end.y - last.y) > .1) action.points.push(end) }
    draft.current = null; pointer.current = null; add(action); schedulePaint()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const run = async (label, work) => {
    if (actionLock.current || !readyRef.current) return
    actionLock.current = true; setBusy(label)
    try { await work() } catch (error) { showToast(error.message, 'error') }
    finally { actionLock.current = false; if (mounted.current) setBusy('') }
  }
  const newBoard = () => run('New', async () => {
    await persist(snapshot()); if (!mounted.current) return
    generation.current++; session.current?.close(); session.current = null; actor.current = uid()
    resetModel(blankBoard()); const id = uid(); setBoardId(id); setTitle('Untitled board'); changeConnection(localConnection()); updateUrl(id)
  })
  const openSaved = id => run('Open', async () => {
    if (!id) return
    await persist(snapshot()); const record = await getWhiteboard(id)
    if (!record) throw new Error('This saved board is no longer available.')
    const model = await readSavedWhiteboard(record)
    if (!mounted.current) return
    generation.current++; session.current?.close(); session.current = null; actor.current = uid(); resetModel(model)
    setBoardId(record.id); setTitle(record.title || `Board ${record.id}`); changeConnection(localConnection()); updateUrl(record.id)
  })
  const copy = async value => {
    try { await navigator.clipboard.writeText(value); showToast('Copied.', 'success') }
    catch { roomInputRef.current?.focus(); roomInputRef.current?.select(); showToast('Clipboard is unavailable. Select and copy the room code shown here.', 'info') }
  }
  const link = connection.room ? `${location.origin}/whiteboard?room=${encodeURIComponent(connection.room)}` : ''
  const visibleCount = board.actions.filter(action => !action.hidden).length

  return <ToolPage toolId="whiteboard"><div className="wb-workspace">
    <section className="wb-room-card" aria-label="Whiteboard collaboration">
      <div className="wb-room-heading"><div><h2>{connection.room ? 'Shared room' : 'Start collaborating'}</h2><span className={`wb-status ${connection.phase}`} role="status">{connection.phase === 'connecting' ? 'Connecting…' : connection.phase === 'shared' ? `${connection.count} ${connection.count === 1 ? 'person — waiting for others' : 'people connected'}` : connection.phase === 'disconnected' ? 'Disconnected' : 'Working locally'}</span></div>{connection.phase === 'connecting' && <button className="btn btn-secondary btn-sm" onClick={() => { generation.current++; session.current?.close(); changeConnection({ ...connectionRef.current, phase: connectionRef.current.room ? 'disconnected' : 'local', error: '' }) }}>Cancel</button>}</div>
      {connection.room ? <div className="wb-active-room"><FormGroup label="Room code"><input ref={roomInputRef} className="form-input wb-room-code" readOnly value={connection.room} onClick={event => event.target.select()} /></FormGroup><button className="btn btn-secondary" disabled={disabled} onClick={() => copy(connection.room)}><Copy size={15} /> Copy code</button><button className="btn btn-secondary" disabled={disabled} onClick={() => copy(link)}><Copy size={15} /> Copy link</button>{connection.phase === 'disconnected' && <button className="btn btn-primary" disabled={disabled} onClick={() => startRoom('join', connection.room)}>Rejoin room</button>}<button className="btn btn-secondary" disabled={disabled} onClick={leaveRoom}><LogOut size={15} />{connection.phase === 'disconnected' ? 'Continue locally' : 'Leave room'}</button><p>Anyone with the code can join. Save a local copy to keep the board.</p></div> : <div className="wb-room-entry"><button className="btn btn-primary" disabled={disabled} onClick={() => startRoom('create')}><Users size={16} /> Create room</button><span className="wb-or">or</span><form onSubmit={event => { event.preventDefault(); startRoom('join', joinInput) }}><FormGroup label="Join an existing room"><input className="form-input" value={joinInput} onChange={event => setJoinInput(event.target.value)} placeholder="Room code or invitation link" aria-label="Room code or invitation link" autoComplete="off" spellCheck={false} disabled={disabled} /></FormGroup><button className="btn btn-secondary" disabled={disabled || !joinInput.trim()}>Join room</button></form></div>}
      {connection.error && <p className="wb-error" role="alert">{connection.error}</p>}
    </section>
    <div className="wb-document-bar"><input className="form-input wb-title" aria-label="Board title" value={title} maxLength={80} onChange={event => setTitle(event.target.value)} disabled={disabled} /><div className="wb-file-actions"><button className="btn btn-secondary btn-sm" disabled={disabled} onClick={newBoard}><Plus size={15} /> New board</button><label className="wb-saved-select"><FolderOpen size={15} /><select className="form-select" aria-label="Open saved board" value="" disabled={disabled || !saved.length} onChange={event => openSaved(event.target.value)}><option value="">Open saved</option>{saved.map(record => <option value={record.id} key={record.id}>{record.title} · {new Date(record.savedAt).toLocaleDateString()}</option>)}</select></label><button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => run('Save', async () => { await persist(snapshot()); showToast('Board saved on this device.', 'success') })}><Save size={15} />{busy === 'Save' ? 'Saving…' : 'Save'}</button></div></div>
    <div className="wb-toolbar" aria-label="Drawing tools"><div className="wb-tool-buttons" role="group" aria-label="Choose drawing tool">{tools.map(({ key, label, Icon }) => <button key={key} className={`wb-tool ${tool === key ? 'selected' : ''}`} aria-label={label} aria-pressed={tool === key} title={label} disabled={drawingDisabled} onClick={() => { cancelDrawing(); setTool(key) }}><Icon size={18} /><span>{label}</span></button>)}</div><div className="wb-ink"><label title="Ink color"><span className="wb-sr-only">Ink color</span><input type="color" aria-label="Ink color" value={color} disabled={drawingDisabled || tool === 'eraser'} onChange={event => setColor(event.target.value)} /></label>{tool === 'text' ? <label className="wb-font-size">Text size<input className="form-input" type="number" min="12" max="120" aria-label="Text size" value={fontSize} onChange={event => setFontSize(Math.max(12, Math.min(120, Number(event.target.value) || 12)))} disabled={drawingDisabled} /></label> : <label className="wb-width">{tool === 'eraser' ? 'Eraser' : 'Stroke'}<input type="range" min="1" max="30" value={strokeWidth} aria-label="Stroke width" onChange={event => setStrokeWidth(Number(event.target.value))} disabled={drawingDisabled} /><span>{tool === 'eraser' ? strokeWidth * 2 : strokeWidth}</span></label>}</div><div className="wb-history"><button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo your last action" disabled={drawingDisabled || !history.undo} onClick={undo}><Undo2 size={18} /></button><button className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo your last action" disabled={drawingDisabled || !history.redo} onClick={redo}><Redo2 size={18} /></button><button className="icon-btn" title="Clear board — undo restores it" aria-label="Clear board" disabled={drawingDisabled || !visibleCount} onClick={() => { const ids = view.current.actions.filter(action => !action.hidden).map(action => action.id); if (submit({ id: uid(), kind: 'visibility', ids, visible: false })) { undoStack.current.push({ ids, before: true, after: false }); redoStack.current = []; updateHistory() } }}><Trash2 size={17} /></button></div><div className="wb-export"><select className="form-select" aria-label="Export format" value={format} onChange={event => setFormat(event.target.value)} disabled={disabled}><option value="pdf">PDF</option><option value="png">PNG</option></select><button className="btn btn-primary btn-sm" disabled={disabled || !visibleCount} onClick={() => run('Export', async () => { const blob = await exportWhiteboard(view.current, format, title); downloadBlob(blob, `${(title.trim() || 'whiteboard').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100)}.${format}`) })}><Download size={15} />{busy === 'Export' ? 'Exporting…' : 'Export'}</button></div></div>
    {tool === 'text' && <div className="wb-text-entry"><label htmlFor="wb-text">Text</label><textarea ref={textRef} id="wb-text" className="form-textarea" value={text} maxLength={2000} onChange={event => setText(event.target.value)} disabled={drawingDisabled} placeholder="Type here, then click the board to place your text" rows={2} /><span>Click the board to place it.</span></div>}
    <div className="wb-stage" ref={viewportRef}><canvas ref={canvasRef} className={tool === 'text' ? 'text-tool' : ''} style={{ width: displayWidth, height: displayHeight, cursor: drawingDisabled ? 'not-allowed' : tool === 'text' ? 'text' : 'crosshair' }} aria-label="Whiteboard drawing canvas" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelDrawing} onLostPointerCapture={() => { if (draft.current) cancelDrawing() }} /></div>
    <div className="wb-footer"><span className={saveStatus.startsWith('Could not') || saveStatus.includes('unavailable') ? 'wb-error' : ''} role="status">{saveStatus}</span><span>{Math.round(board.width)} × {Math.round(board.height)}</span><label>Zoom<select className="form-select" aria-label="Board zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit board</option><option value="75">75%</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option></select></label></div>
  </div></ToolPage>
}
