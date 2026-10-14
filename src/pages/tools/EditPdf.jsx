import { useCallback, useEffect, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Download, Edit3, FileCheck2, Italic, Minus, MousePointer2, Plus, Redo2, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, ProgressBar, downloadBlob } from '../../components/ui'
import { getPdfjsLib, getPdfLib, loadPdfBytes } from '../../services/pdfEngine'
import { useApp } from '../../context/AppContext'

const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`

export default function EditPdf() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 })
  const [textItems, setTextItems] = useState([])
  const [overlays, setOverlays] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [activeTool, setActiveTool] = useState('select')
  const [config] = useState({ fontSize: 18, color: '#111827', fill: '#6c63ff' })
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [processing, setProcessing] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [zoom, setZoom] = useState(1)
  const canvasRef = useRef(null)
  const workspaceRef = useRef(null)
  const interactionRef = useRef(null)
  const editSnapshotRef = useRef(null)

  const commit = useCallback((updater) => {
    setOverlays((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      setHistory((items) => [...items.slice(-49), current])
      setFuture([])
      return next
    })
  }, [])

  const loadFile = async (files) => {
    const selected = files.find((item) => item.type === 'application/pdf')
    if (!selected) return showToast('Choose a valid PDF file.', 'warning')
    try {
      const pdfjs = await getPdfjsLib()
      const pdf = await pdfjs.getDocument({ data: await loadPdfBytes(selected) }).promise
      setFile(selected); setPdfDoc(pdf); setTotalPages(pdf.numPages); setCurrentPage(1)
      setOverlays([]); setHistory([]); setFuture([]); setSelectedId(null); setEditingId(null)
    } catch (error) { showToast(`Unable to open PDF: ${error.message}`, 'error') }
  }

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return
    setRendering(true)
    try {
      const page = await pdfDoc.getPage(currentPage)
      const unscaled = page.getViewport({ scale: 1 })
      const targetWidth = Math.min(1100, Math.max(680, workspaceRef.current?.parentElement?.clientWidth - 42 || 900)) * zoom
      const scale = targetWidth / unscaled.width
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      canvas.width = Math.round(viewport.width * devicePixelRatio)
      canvas.height = Math.round(viewport.height * devicePixelRatio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setPageSize({ width: viewport.width, height: viewport.height })
      const context = canvas.getContext('2d')
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      await page.render({ canvasContext: context, viewport }).promise
      const pdfjs = await getPdfjsLib()
      const content = await page.getTextContent()
      setTextItems(content.items.map((item, index) => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform)
        const itemHeight = Math.max(Math.abs(transform[3]), 10)
        const itemWidth = Math.max(item.width * scale, itemHeight * Math.max(item.str.length * .35, 1), 8)
        return { id: `${currentPage}-${index}`, text: item.str, x: transform[4], y: transform[5] - itemHeight, width: itemWidth, height: itemHeight, fontSize: itemHeight * .82 }
      }).filter((item) => item.text.trim()))
    } finally { setRendering(false) }
  }, [pdfDoc, currentPage, zoom])

  useEffect(() => { renderPage() }, [renderPage])

  const pointFromEvent = (event) => {
    const rect = workspaceRef.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }

  const addOverlay = (event) => {
    if (activeTool === 'select') return
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    const overlay = activeTool === 'text'
      ? { id: makeId(), type: 'text', page: currentPage, x: point.x, y: point.y, width: .22, height: .034, text: '', fontSize: config.fontSize, color: config.color, bold: false, italic: false, align: 'left' }
      : { id: makeId(), type: 'rect', page: currentPage, x: point.x, y: point.y, width: .18, height: .1, color: config.fill, opacity: .25 }
    commit((items) => [...items, overlay]); setSelectedId(overlay.id); setEditingId(activeTool === 'text' ? overlay.id : null); setActiveTool('select')
  }

  const editOriginalText = (item) => {
    const overlay = { id: makeId(), type: 'replace', sourceId: item.id, page: currentPage, x: Math.max(0, (item.x - 2) / pageSize.width), y: Math.max(0, (item.y - 2) / pageSize.height), width: Math.min(1, (item.width + 4) / pageSize.width), height: Math.min(1, (item.height + 4) / pageSize.height), text: item.text, original: item.text, fontSize: item.fontSize, color: config.color, bold: false, italic: false, align: 'left' }
    editSnapshotRef.current = null
    commit((items) => [...items.filter((entry) => entry.sourceId !== item.id), overlay]); setSelectedId(overlay.id); setEditingId(overlay.id)
  }

  const beginInteraction = (event, overlay, mode) => {
    if (activeTool !== 'select') return
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId)
    setSelectedId(overlay.id); setEditingId(null)
    interactionRef.current = { id: overlay.id, mode, start: pointFromEvent(event), original: { ...overlay }, snapshot: overlays }
  }

  const moveInteraction = (event) => {
    const interaction = interactionRef.current
    if (!interaction) return
    const point = pointFromEvent(event); const dx = point.x - interaction.start.x; const dy = point.y - interaction.start.y
    setOverlays((items) => items.map((item) => {
      if (item.id !== interaction.id) return item
      if (interaction.mode === 'move') return { ...item, x: Math.max(0, Math.min(1 - item.width, interaction.original.x + dx)), y: Math.max(0, Math.min(1 - item.height, interaction.original.y + dy)) }
      return { ...item, width: Math.max(.035, Math.min(1 - item.x, interaction.original.width + dx)), height: Math.max(.025, Math.min(1 - item.y, interaction.original.height + dy)) }
    }))
  }

  const endInteraction = () => {
    const interaction = interactionRef.current
    if (!interaction) return
    setHistory((items) => [...items.slice(-49), interaction.snapshot]); setFuture([]); interactionRef.current = null
  }

  const updateSelected = (updates) => setOverlays((items) => {
    if (editingId === selectedId && !editSnapshotRef.current) editSnapshotRef.current = items
    return items.map((item) => item.id === selectedId ? { ...item, ...updates } : item)
  })
  const finishEditing = (overlay) => {
    if (editSnapshotRef.current) {
      setHistory((items) => [...items.slice(-49), editSnapshotRef.current])
      setFuture([])
      editSnapshotRef.current = null
    }
    if (!overlay.text.trim() && overlay.type === 'text') removeSelected()
    else setEditingId(null)
  }
  const selected = overlays.find((item) => item.id === selectedId)
  const undo = () => { if (!history.length) return; const previous = history.at(-1); setHistory(history.slice(0, -1)); setFuture((items) => [overlays, ...items]); setOverlays(previous); setSelectedId(null) }
  const redo = () => { if (!future.length) return; const next = future[0]; setFuture(future.slice(1)); setHistory((items) => [...items, overlays]); setOverlays(next); setSelectedId(null) }
  const removeSelected = () => { if (!selectedId) return; commit((items) => items.filter((item) => item.id !== selectedId)); setSelectedId(null); setEditingId(null) }

  useEffect(() => {
    const keyboard = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && editingId !== selectedId) { event.preventDefault(); removeSelected() }
      if (event.key === 'Escape') { setEditingId(null); setSelectedId(null); setActiveTool('select') }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard)
  })

  const exportPdf = async () => {
    setProcessing(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await getPdfLib(); const source = await PDFDocument.load(await loadPdfBytes(file)); const fonts = { regular: await source.embedFont(StandardFonts.Helvetica), bold: await source.embedFont(StandardFonts.HelveticaBold), italic: await source.embedFont(StandardFonts.HelveticaOblique), boldItalic: await source.embedFont(StandardFonts.HelveticaBoldOblique) }; const pages = source.getPages()
      for (const overlay of overlays) {
        const page = pages[overlay.page - 1]; if (!page) continue
        const { width, height } = page.getSize(); const x = overlay.x * width; const boxHeight = overlay.height * height; const y = height - overlay.y * height - boxHeight
        const hex = overlay.color.replace('#', ''); const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
        if (overlay.type === 'replace') page.drawRectangle({ x, y, width: overlay.width * width, height: boxHeight, color: rgb(1, 1, 1), opacity: 1 })
        if (overlay.type === 'text' || overlay.type === 'replace') { const font = overlay.bold && overlay.italic ? fonts.boldItalic : overlay.bold ? fonts.bold : overlay.italic ? fonts.italic : fonts.regular; const textWidth = font.widthOfTextAtSize(overlay.text || ' ', overlay.fontSize); const boxWidth = overlay.width * width; const alignedX = overlay.align === 'center' ? x + Math.max(0, (boxWidth - textWidth) / 2) : overlay.align === 'right' ? x + Math.max(0, boxWidth - textWidth) : x; page.drawText(overlay.text || ' ', { x: alignedX, y: y + Math.max(0, boxHeight - overlay.fontSize), size: overlay.fontSize, font, color, maxWidth: boxWidth, lineHeight: overlay.fontSize * 1.2 }) }
        else page.drawRectangle({ x, y, width: overlay.width * width, height: boxHeight, color, opacity: overlay.opacity ?? .25, borderColor: color, borderWidth: 1 })
      }
      downloadBlob(new Blob([await source.save()], { type: 'application/pdf' }), `edited-${file.name}`); showToast('Edited PDF downloaded.', 'success')
    } catch (error) { showToast(`Export failed: ${error.message}`, 'error') } finally { setProcessing(false) }
  }

  return <ToolPage toolId="edit-pdf">{!file ? <div className="tool-panel"><DropZone onFiles={loadFile} accept={['application/pdf']}><div className="drop-zone-icon"><Edit3 size={28} /></div><div className="drop-zone-title">Drop a PDF to edit</div><div className="drop-zone-sub">Add movable text and shape overlays</div></DropZone><div className="editor-note"><strong>Overlay editor:</strong> Adds new content without altering original embedded text.</div></div> : <>
    <div className="editor-document-bar"><div className="editor-file"><FileCheck2 size={17} /><div><strong>{file.name}</strong><small>Original file · changes stay local until Download</small></div></div><div className="editor-page-nav"><button className="icon-btn" disabled={currentPage === 1} onClick={() => { setCurrentPage((page) => page - 1); setSelectedId(null) }}>‹</button><span>{currentPage} / {totalPages}</span><button className="icon-btn" disabled={currentPage === totalPages} onClick={() => { setCurrentPage((page) => page + 1); setSelectedId(null) }}>›</button></div><div className="editor-doc-actions"><button className="icon-btn" disabled={!history.length} onClick={undo} title="Undo"><Undo2 size={17} /></button><button className="icon-btn" disabled={!future.length} onClick={redo} title="Redo"><Redo2 size={17} /></button><button className="btn editor-download" onClick={exportPdf} disabled={processing}><Download size={16} /> Download</button></div></div>
    <div className="pdf-editor-scroll"><div ref={workspaceRef} className={`pdf-editor-workspace tool-${activeTool}`} style={{ width: pageSize.width, height: pageSize.height }} onPointerDown={(event) => { if (activeTool !== 'select' && !event.target.closest?.('.editor-overlay')) addOverlay(event); else if (activeTool === 'select' && event.target === workspaceRef.current) setSelectedId(null) }} onPointerMove={moveInteraction} onPointerUp={endInteraction}>
      <canvas ref={canvasRef} className="pdf-editor-canvas" />{textItems.map((item) => { const replaced = overlays.some((overlay) => overlay.sourceId === item.id); return <button key={item.id} className={`pdf-text-item ${replaced ? 'is-replaced' : ''}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, fontSize: item.fontSize }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); editOriginalText(item) }}>{item.text}</button> })}{rendering && <div className="editor-rendering"><div className="spinner" /></div>}
      {overlays.filter((item) => item.page === currentPage).map((overlay) => <div key={overlay.id} className={`editor-overlay overlay-${overlay.type} ${selectedId === overlay.id ? 'selected' : ''}`} style={{ left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`, width: `${overlay.width * 100}%`, height: `${overlay.height * 100}%`, color: overlay.color, background: overlay.type === 'rect' ? `${overlay.color}40` : overlay.type === 'replace' ? '#fff' : 'transparent', fontSize: overlay.fontSize * zoom, fontWeight: overlay.bold ? 700 : 400, fontStyle: overlay.italic ? 'italic' : 'normal', textAlign: overlay.align || 'left' }} onPointerDown={(event) => beginInteraction(event, overlay, 'move')} onDoubleClick={(event) => { event.stopPropagation(); if (overlay.type === 'text' || overlay.type === 'replace') { setSelectedId(overlay.id); setEditingId(overlay.id) } }}>
        {(overlay.type === 'text' || overlay.type === 'replace') && (editingId === overlay.id ? <textarea autoFocus placeholder="Type here" value={overlay.text} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSelected({ text: event.target.value })} onBlur={() => finishEditing(overlay)} /> : <span>{overlay.text || 'Double-click to type'}</span>)}{selectedId === overlay.id && <button className="overlay-resize" aria-label="Resize" onPointerDown={(event) => beginInteraction(event, overlay, 'resize')} />}
        {selectedId === overlay.id && (overlay.type === 'text' || overlay.type === 'replace') && <div className="editor-context-toolbar" onPointerDown={(event) => event.stopPropagation()}><span className="toolbar-grip">⠿</span><select value="Helvetica" aria-label="Font"><option>Helvetica</option></select><button onClick={() => updateSelected({ fontSize: Math.max(6, overlay.fontSize - 1) })}><Minus size={13} /></button><span>{Math.round(overlay.fontSize)}</span><button onClick={() => updateSelected({ fontSize: Math.min(96, overlay.fontSize + 1) })}><Plus size={13} /></button><button className={overlay.bold ? 'active' : ''} onClick={() => updateSelected({ bold: !overlay.bold })}><Bold size={14} /></button><button className={overlay.italic ? 'active' : ''} onClick={() => updateSelected({ italic: !overlay.italic })}><Italic size={14} /></button><input type="color" value={overlay.color} onChange={(event) => updateSelected({ color: event.target.value })} /><button className={overlay.align === 'left' ? 'active' : ''} onClick={() => updateSelected({ align: 'left' })}><AlignLeft size={14} /></button><button className={overlay.align === 'center' ? 'active' : ''} onClick={() => updateSelected({ align: 'center' })}><AlignCenter size={14} /></button><button className={overlay.align === 'right' ? 'active' : ''} onClick={() => updateSelected({ align: 'right' })}><AlignRight size={14} /></button><button onClick={removeSelected}><Trash2 size={14} /></button></div>}
      </div>)}
    </div><div className="editor-bottom-dock"><button className={activeTool === 'select' ? 'active' : ''} onClick={() => setActiveTool('select')}><MousePointer2 size={20} /><span>Edit</span></button><button className={activeTool === 'text' ? 'active' : ''} onClick={() => setActiveTool('text')}><Type size={20} /><span>Text</span></button><button className={activeTool === 'rect' ? 'active' : ''} onClick={() => setActiveTool('rect')}><Square size={20} /><span>Insert</span></button></div><div className="editor-zoom"><button onClick={() => setZoom((value) => Math.max(.6, value - .1))}><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2, value + .1))}><ZoomIn size={16} /></button></div></div>
    {selected?.type === 'text' && <div className="editor-text-panel"><label>Text<input className="form-input" value={selected.text} onChange={(event) => updateSelected({ text: event.target.value })} onFocus={() => setEditingId(selected.id)} /></label></div>}
    {processing && <ProgressBar value={70} label="Exporting edited PDF" />}<div className="editor-footer-actions"><span>All edits stay in this browser.</span><button className="btn btn-secondary" onClick={() => { setFile(null); setPdfDoc(null); setOverlays([]) }}><Trash2 size={16} /> Close document</button></div>
  </>}</ToolPage>
}
