import { useCallback, useEffect, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Download, Edit3, FileCheck2, Italic, Minus, MousePointer2, Plus, Redo2, Save, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, ProgressBar, downloadBlob } from '../../components/ui'
import { getPdfjsLib, getPdfLib, loadPdfBytes } from '../../services/pdfEngine'
import { useApp } from '../../context/AppContext'
import { getDocument as getSavedDocument, saveDocument } from '../../services/storage'
import { drawUnicodeText, embedUnicodeFonts, measureUnicodeText } from '../../services/unicodePdf'

const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`

function overlayTextLines(text, font, size, width, unicodeFonts) {
  const lines = []
  for (const paragraph of String(text || '').replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const character of paragraph) {
      if (line && measureUnicodeText(line + character, font, size, unicodeFonts) > width) {
        const separator = line.lastIndexOf(' ')
        if (separator > 0) { lines.push(line.slice(0, separator)); line = line.slice(separator + 1) + character }
        else { lines.push(line); line = character }
      } else line += character
    }
    lines.push(line)
  }
  return lines
}

export default function EditPdf() {
  const { showToast, recordRecentFile } = useApp()
  const [file, setFile] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [pageSize, setPageSize] = useState({ width: 1, height: 1, scale: 1 })
  const [workspaceWidth, setWorkspaceWidth] = useState(900)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [textItems, setTextItems] = useState([])
  const [overlays, setOverlays] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [activeTool, setActiveTool] = useState('select')
  const [config] = useState({ fontSize: 18, color: '#111827', fill: '#0d7865' })
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [processing, setProcessing] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [zoom, setZoom] = useState(1)
  const canvasRef = useRef(null)
  const workspaceRef = useRef(null)
  const scrollRef = useRef(null)
  const renderTaskRef = useRef(null)
  const renderSequenceRef = useRef(0)
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

  useEffect(() => {
    const documentId = new URLSearchParams(window.location.search).get('document')
    if (!documentId) return
    let active = true
    const openSaved = async () => {
      try {
        const saved = await getSavedDocument(documentId)
        if (!saved?.blob) throw new Error('This saved document is no longer available on this device.')
        const selected = new File([saved.blob], saved.name, { type: 'application/pdf' })
        const pdfjs = await getPdfjsLib()
        const pdf = await pdfjs.getDocument({ data: await loadPdfBytes(selected) }).promise
        if (active) { setFile(selected); setPdfDoc(pdf); setTotalPages(pdf.numPages); setCurrentPage(1) }
        else await pdf.loadingTask.destroy()
      } catch (error) { if (active) showToast(error.message, 'error') }
    }
    openSaved()
    return () => { active = false }
  }, [showToast])

  useEffect(() => () => { renderTaskRef.current?.cancel(); pdfDoc?.loadingTask.destroy().catch(() => {}) }, [pdfDoc])

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return
    const sequence = ++renderSequenceRef.current
    const previous = renderTaskRef.current
    previous?.cancel()
    if (previous) await previous.promise.catch(() => {})
    if (sequence !== renderSequenceRef.current) return
    setRendering(true)
    try {
      const page = await pdfDoc.getPage(currentPage)
      if (sequence !== renderSequenceRef.current) return
      const unscaled = page.getViewport({ scale: 1 })
      const targetWidth = Math.min(1100, Math.max(240, workspaceWidth)) * zoom
      const scale = targetWidth / unscaled.width
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      canvas.width = Math.round(viewport.width * devicePixelRatio)
      canvas.height = Math.round(viewport.height * devicePixelRatio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setPageSize({ width: viewport.width, height: viewport.height, scale })
      const context = canvas.getContext('2d')
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      const task = page.render({ canvasContext: context, viewport })
      renderTaskRef.current = task
      await task.promise
      if (sequence !== renderSequenceRef.current) return
      const pdfjs = await getPdfjsLib()
      const content = await page.getTextContent()
      if (sequence !== renderSequenceRef.current) return
      setTextItems(content.items.map((item, index) => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform)
        const itemHeight = Math.max(Math.hypot(transform[2], transform[3]), 4)
        const itemWidth = Math.max(item.width * scale, itemHeight * Math.max(item.str.length * .35, 1), 8)
        const descent = Math.abs(content.styles[item.fontName]?.descent ?? -.2) * itemHeight
        return { id: `${currentPage}-${index}`, text: Math.abs(transform[1]) < .1 ? item.str : '', x: transform[4], y: transform[5] - itemHeight, width: itemWidth, height: itemHeight, descent, fontSize: itemHeight / scale }
      }).filter((item) => item.text.trim()))
    } catch (error) { if (sequence === renderSequenceRef.current && error.name !== 'RenderingCancelledException') showToast(`Page rendering failed: ${error.message}`, 'error') }
    finally { if (sequence === renderSequenceRef.current) setRendering(false) }
  }, [pdfDoc, currentPage, zoom, workspaceWidth, showToast])

  useEffect(() => { renderPage(); return () => { renderSequenceRef.current++; renderTaskRef.current?.cancel() } }, [renderPage])
  useEffect(() => {
    if (!file || !scrollRef.current) return
    const element = scrollRef.current
    const resize = () => {
      const styles = getComputedStyle(element)
      setWorkspaceWidth(Math.max(240, element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [file])

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
      ? { id: makeId(), type: 'text', page: currentPage, x: Math.min(point.x, .78), y: Math.min(point.y, .966), width: .22, height: .034, text: '', fontSize: config.fontSize, fontFamily: 'Helvetica', color: config.color, bold: false, italic: false, align: 'left' }
      : { id: makeId(), type: 'rect', page: currentPage, x: Math.min(point.x, .82), y: Math.min(point.y, .9), width: .18, height: .1, color: config.fill, opacity: .25 }
    commit((items) => [...items, overlay]); setSelectedId(overlay.id); setEditingId(activeTool === 'text' ? overlay.id : null); setActiveTool('select')
  }

  const editOriginalText = (item) => {
    const sourceRegion = { x: Math.max(0, (item.x - 2) / pageSize.width), y: Math.max(0, (item.y - 2) / pageSize.height), width: Math.min(1, (item.width + 4) / pageSize.width), height: Math.min(1, (item.height + item.descent + 4) / pageSize.height) }
    const canvas = canvasRef.current
    const ratio = canvas.width / pageSize.width
    const pixel = canvas.getContext('2d').getImageData(Math.min(canvas.width - 1, Math.max(0, Math.floor((item.x - 2) * ratio))), Math.min(canvas.height - 1, Math.max(0, Math.floor((item.y - 2) * ratio))), 1, 1).data
    const backgroundColor = `#${[...pixel].slice(0, 3).map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    const overlay = { id: makeId(), type: 'replace', sourceId: item.id, page: currentPage, ...sourceRegion, sourceRegion, backgroundColor, text: item.text, original: item.text, fontSize: item.fontSize, fontFamily: 'Helvetica', color: config.color, bold: false, italic: false, align: 'left' }
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

  const updateSelected = (updates) => {
    if (editingId !== selectedId) return commit((items) => items.map((item) => item.id === selectedId ? { ...item, ...updates } : item))
    setOverlays((items) => {
      if (!editSnapshotRef.current) editSnapshotRef.current = items
      return items.map((item) => item.id === selectedId ? { ...item, ...updates } : item)
    })
  }
  const finishEditing = (overlay) => {
    if (editSnapshotRef.current) {
      setHistory((items) => [...items.slice(-49), editSnapshotRef.current])
      setFuture([])
      editSnapshotRef.current = null
    }
    if (!overlay.text.trim() && overlay.type === 'text') removeSelected()
    else setEditingId(null)
  }
  const undo = () => { if (!history.length) return; const previous = history.at(-1); setHistory(history.slice(0, -1)); setFuture((items) => [overlays, ...items]); setOverlays(previous); setSelectedId(null); setEditingId(null); editSnapshotRef.current = null }
  const redo = () => { if (!future.length) return; const next = future[0]; setFuture(future.slice(1)); setHistory((items) => [...items, overlays]); setOverlays(next); setSelectedId(null); setEditingId(null); editSnapshotRef.current = null }
  const removeSelected = () => { if (!selectedId) return; commit((items) => items.filter((item) => item.id !== selectedId)); setSelectedId(null); setEditingId(null) }

  const toolbarStyle = (overlay) => {
    const availableWidth = workspaceWidth
    const pageOffset = Math.max(0, (availableWidth - pageSize.width) / 2)
    const visibleStart = Math.max(0, scrollOffset - pageOffset)
    const visibleEnd = Math.min(pageSize.width, scrollOffset + availableWidth - pageOffset)
    const width = Math.min(500, visibleEnd - visibleStart - 12)
    const origin = overlay.x * pageSize.width
    return { width, maxWidth: width, left: Math.max(visibleStart + 6, Math.min(origin, visibleEnd - width - 6)) - origin, bottom: overlay.y < .1 ? 'auto' : undefined, top: overlay.y < .1 ? 'calc(100% + 14px)' : undefined }
  }

  useEffect(() => {
    const keyboard = (event) => {
      const typing = event.target.closest?.('input, textarea, [contenteditable="true"]')
      if (typing && (event.key === 'Delete' || event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'))) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && editingId !== selectedId) { event.preventDefault(); removeSelected() }
      if (event.key === 'Escape') { setEditingId(null); setSelectedId(null); setActiveTool('select') }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard)
  })

  const exportPdf = async (saveLocally = false) => {
    setProcessing(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
      const input = await loadPdfBytes(file)
      const original = await PDFDocument.load(input)
      const rasterizedPages = new Set(overlays.filter((overlay) => {
        const page = original.getPage(overlay.page - 1)
        const crop = page.getCropBox()
        const media = page.getMediaBox()
        return overlay.type === 'replace' || page.getRotation().angle % 360 !== 0 || crop.x !== media.x || crop.y !== media.y || crop.width !== media.width || crop.height !== media.height
      }).map((overlay) => overlay.page))
      const source = rasterizedPages.size ? await PDFDocument.create() : original
      if (rasterizedPages.size) {
        const pdfjs = await getPdfjsLib()
        const rendered = await pdfjs.getDocument({ data: input }).promise
        for (let pageNumber = 1; pageNumber <= original.getPageCount(); pageNumber++) {
          if (rasterizedPages.has(pageNumber)) {
            const page = await rendered.getPage(pageNumber)
            const viewport = page.getViewport({ scale: 2 })
            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            const context = canvas.getContext('2d')
            await page.render({ canvasContext: context, viewport }).promise
            for (const replacement of overlays.filter((overlay) => overlay.page === pageNumber && overlay.type === 'replace')) {
              const region = replacement.sourceRegion || replacement
              context.fillStyle = replacement.backgroundColor || '#ffffff'
              context.fillRect(Math.floor(region.x * canvas.width), Math.floor(region.y * canvas.height), Math.ceil(region.width * canvas.width) + 1, Math.ceil(region.height * canvas.height) + 1)
            }
            const image = await source.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
            const width = viewport.width / 2
            const height = viewport.height / 2
            source.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
            canvas.width = canvas.height = 0
          } else {
            const [copied] = await source.copyPages(original, [pageNumber - 1])
            source.addPage(copied)
          }
        }
        await rendered.loadingTask.destroy()
      }
      const families = {
        Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
        Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
        Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
      }
      const fonts = {}
      for (const [family, variants] of Object.entries(families)) fonts[family] = await Promise.all(variants.map((variant) => source.embedFont(variant)))
      const unicode = await embedUnicodeFonts(source)
      const pages = source.getPages()
      for (const overlay of overlays) {
        const page = pages[overlay.page - 1]; if (!page) continue
        const { width, height } = page.getSize(); const x = overlay.x * width; const boxHeight = overlay.height * height; const y = height - overlay.y * height - boxHeight
        const hex = overlay.color.replace('#', ''); const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
        if (overlay.type === 'text' || overlay.type === 'replace') {
          const font = fonts[overlay.fontFamily || 'Helvetica'][Number(overlay.bold) + Number(overlay.italic) * 2]
          const unicodeFonts = { ...unicode, baseBold: overlay.bold ? font : null }
          const boxWidth = overlay.width * width
          const lines = overlayTextLines(overlay.text, font, overlay.fontSize, boxWidth, unicodeFonts)
          lines.forEach((line, index) => {
            const textWidth = measureUnicodeText(line, font, overlay.fontSize, unicodeFonts)
            const alignedX = overlay.align === 'center' ? x + Math.max(0, (boxWidth - textWidth) / 2) : overlay.align === 'right' ? x + Math.max(0, boxWidth - textWidth) : x
            drawUnicodeText(page, line, { x: alignedX, y: y + Math.max(0, boxHeight - overlay.fontSize) - index * overlay.fontSize * 1.2, size: overlay.fontSize, font, color }, unicodeFonts)
          })
        }
        else page.drawRectangle({ x, y, width: overlay.width * width, height: boxHeight, color, opacity: overlay.opacity ?? .25, borderColor: color, borderWidth: 1 })
      }
      const name = `edited-${file.name}`
      const blob = new Blob([await source.save()], { type: 'application/pdf' })
      if (saveLocally) {
        const id = crypto.randomUUID()
        await saveDocument(id, name, blob)
        await recordRecentFile({ id, documentId: id, name, size: blob.size, type: 'application/pdf' })
        showToast('Edited PDF saved on this device.', 'success')
      } else { downloadBlob(blob, name); showToast('Edited PDF downloaded.', 'success') }
    } catch (error) { showToast(`Export failed: ${error.message}`, 'error') } finally { setProcessing(false) }
  }

  return <ToolPage toolId="edit-pdf">{!file ? <div className="tool-panel"><DropZone onFiles={loadFile} accept={['application/pdf']}><div className="drop-zone-icon"><Edit3 size={28} /></div><div className="drop-zone-title">Drop a PDF to edit</div><div className="drop-zone-sub">Add text, replace selectable text, and draw shapes</div></DropZone><div className="editor-note"><strong>Editing behavior:</strong> New text remains selectable. Replacing original text rebuilds that page as an image before adding your replacement, so the original text is removed from the downloaded page.</div></div> : <>
    <div className="editor-document-bar"><div className="editor-file"><FileCheck2 size={17} /><div><strong>{file.name}</strong><small>Original file · changes stay local until saved or downloaded</small></div></div><div className="editor-page-nav"><button className="icon-btn" disabled={currentPage === 1} onClick={() => { setCurrentPage((page) => page - 1); setSelectedId(null) }}>‹</button><span>{currentPage} / {totalPages}</span><button className="icon-btn" disabled={currentPage === totalPages} onClick={() => { setCurrentPage((page) => page + 1); setSelectedId(null) }}>›</button></div><div className="editor-doc-actions"><button className="icon-btn" disabled={!history.length} onClick={undo} title="Undo"><Undo2 size={17} /></button><button className="icon-btn" disabled={!future.length} onClick={redo} title="Redo"><Redo2 size={17} /></button><button className="btn btn-secondary" aria-label="Save locally" onClick={() => exportPdf(true)} disabled={processing}><Save size={16} /><span className="editor-save-label">Save locally</span></button><button className="btn editor-download" onClick={() => exportPdf(false)} disabled={processing}><Download size={16} /> Download</button></div></div>
    <div ref={scrollRef} className="pdf-editor-scroll" onScroll={(event) => setScrollOffset(event.currentTarget.scrollLeft)}><div ref={workspaceRef} className={`pdf-editor-workspace tool-${activeTool}`} style={{ width: pageSize.width, height: pageSize.height }} onPointerDown={(event) => { if (activeTool !== 'select' && !event.target.closest?.('.editor-overlay')) addOverlay(event); else if (activeTool === 'select' && event.target === workspaceRef.current) setSelectedId(null) }} onPointerMove={moveInteraction} onPointerUp={endInteraction}>
      <canvas ref={canvasRef} className="pdf-editor-canvas" />{textItems.map((item) => { const replaced = overlays.some((overlay) => overlay.sourceId === item.id); return <button key={item.id} className={`pdf-text-item ${replaced ? 'is-replaced' : ''}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, fontSize: item.fontSize }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); editOriginalText(item) }}>{item.text}</button> })}{rendering && <div className="editor-rendering"><div className="spinner" /></div>}
      {overlays.filter((overlay) => overlay.page === currentPage && overlay.type === 'replace').map((overlay) => { const region = overlay.sourceRegion || overlay; return <div className="editor-source-mask" key={`mask-${overlay.id}`} aria-hidden="true" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`, background: overlay.backgroundColor || '#ffffff' }} /> })}
      {overlays.filter((item) => item.page === currentPage).map((overlay) => <div key={overlay.id} className={`editor-overlay overlay-${overlay.type} ${selectedId === overlay.id ? 'selected' : ''}`} style={{ left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`, width: `${overlay.width * 100}%`, height: `${overlay.height * 100}%`, color: overlay.color, background: overlay.type === 'rect' ? `${overlay.color}40` : 'transparent', fontSize: overlay.fontSize * pageSize.scale, fontFamily: overlay.fontFamily === 'Times' ? 'Times New Roman, serif' : overlay.fontFamily === 'Courier' ? 'Courier New, monospace' : 'Arial, sans-serif', fontWeight: overlay.bold ? 700 : 400, fontStyle: overlay.italic ? 'italic' : 'normal', textAlign: overlay.align || 'left' }} onPointerDown={(event) => beginInteraction(event, overlay, 'move')} onDoubleClick={(event) => { event.stopPropagation(); if (overlay.type === 'text' || overlay.type === 'replace') { setSelectedId(overlay.id); setEditingId(overlay.id) } }}>
        {(overlay.type === 'text' || overlay.type === 'replace') && (editingId === overlay.id ? <textarea autoFocus placeholder="Type here" value={overlay.text} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSelected({ text: event.target.value, height: Math.max(overlay.height, Math.min(1 - overlay.y, event.target.scrollHeight / pageSize.height)) })} onBlur={() => finishEditing(overlay)} /> : <span>{overlay.text || 'Double-click to type'}</span>)}{selectedId === overlay.id && <button className="overlay-resize" aria-label="Resize" onPointerDown={(event) => beginInteraction(event, overlay, 'resize')} />}
        {selectedId === overlay.id && (overlay.type === 'text' || overlay.type === 'replace') && <div className={`editor-context-toolbar ${overlay.y < .1 ? 'toolbar-below' : ''}`} style={toolbarStyle(overlay)} onPointerDown={(event) => event.stopPropagation()}><span className="toolbar-grip">⠿</span><select value={overlay.fontFamily || 'Helvetica'} aria-label="Font" onChange={(event) => updateSelected({ fontFamily: event.target.value })}><option>Helvetica</option><option>Times</option><option>Courier</option></select><button aria-label="Decrease font size" onClick={() => updateSelected({ fontSize: Math.max(6, overlay.fontSize - 1) })}><Minus size={13} /></button><span>{Math.round(overlay.fontSize)}</span><button aria-label="Increase font size" onClick={() => updateSelected({ fontSize: Math.min(96, overlay.fontSize + 1) })}><Plus size={13} /></button><button aria-label="Bold" className={overlay.bold ? 'active' : ''} onClick={() => updateSelected({ bold: !overlay.bold })}><Bold size={14} /></button><button aria-label="Italic" className={overlay.italic ? 'active' : ''} onClick={() => updateSelected({ italic: !overlay.italic })}><Italic size={14} /></button><input aria-label="Text color" type="color" value={overlay.color} onChange={(event) => updateSelected({ color: event.target.value })} /><button aria-label="Align left" className={overlay.align === 'left' ? 'active' : ''} onClick={() => updateSelected({ align: 'left' })}><AlignLeft size={14} /></button><button aria-label="Align center" className={overlay.align === 'center' ? 'active' : ''} onClick={() => updateSelected({ align: 'center' })}><AlignCenter size={14} /></button><button aria-label="Align right" className={overlay.align === 'right' ? 'active' : ''} onClick={() => updateSelected({ align: 'right' })}><AlignRight size={14} /></button><button aria-label="Delete object" onClick={removeSelected}><Trash2 size={14} /></button></div>}
      </div>)}
    </div><div className="editor-bottom-dock"><button className={activeTool === 'select' ? 'active' : ''} onClick={() => setActiveTool('select')}><MousePointer2 size={20} /><span>Edit</span></button><button className={activeTool === 'text' ? 'active' : ''} onClick={() => setActiveTool('text')}><Type size={20} /><span>Text</span></button><button className={activeTool === 'rect' ? 'active' : ''} onClick={() => setActiveTool('rect')}><Square size={20} /><span>Insert</span></button></div><div className="editor-zoom"><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.6, value - .1))}><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + .1))}><ZoomIn size={16} /></button></div></div>

    {processing && <ProgressBar value={70} label="Exporting edited PDF" />}<div className="editor-footer-actions"><span>All edits stay in this browser.</span><button className="btn btn-secondary" onClick={() => { setFile(null); setPdfDoc(null); setOverlays([]) }}><Trash2 size={16} /> Close document</button></div>
  </>}</ToolPage>
}
