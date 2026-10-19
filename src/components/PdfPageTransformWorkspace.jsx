import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, Eye, FileText, FlipHorizontal, FlipVertical, LoaderCircle, Redo2, RotateCcw, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { PdfPageThumbnail } from './PdfPageThumbnail'
import { DropZone, Modal, ProgressBar, downloadBlob } from './ui'
import { getPdfjsLib, getPdfLib, loadPdfBytes } from '../services/pdfEngine'
import { wordPageSelection } from '../services/pdfWordLayout'
import { useApp } from '../context/AppContext'
import './RotatePdfWorkspace.css'

const emptyHistory = () => ({ past: [], present: [], future: [] })
const normalize = degrees => (degrees % 360 + 360) % 360
const angleLabel = degrees => `${degrees > 180 ? degrees - 360 : degrees}°`

export function PdfPageTransformWorkspace({ kind = 'rotate' }) {
  const mirror = kind === 'mirror'
  const UploadIcon = mirror ? FlipHorizontal : RotateCw
  const actions = mirror ? [
    { value: 'flipX', label: 'Flip horizontal', icon: FlipHorizontal },
    { value: 'flipY', label: 'Flip vertical', icon: FlipVertical },
    { value: 'both', label: 'Flip both', icon: RotateCw },
  ] : [
    { value: -90, label: 'Left 90°', icon: RotateCcw },
    { value: 90, label: 'Right 90°', icon: RotateCw },
    { value: 180, label: '180°', icon: RotateCw },
  ]
  const changed = page => mirror ? page.flipX || page.flipY : page.rotation !== 0
  const badge = page => mirror ? page.flipX && page.flipY ? 'H + V' : page.flipX ? 'H' : 'V' : angleLabel(page.rotation)
  const { showToast } = useApp()
  const [file, setFile] = useState(null), [pdf, setPdf] = useState(null)
  const [history, setHistory] = useState(emptyHistory), [mode, setMode] = useState('all')
  const [manual, setManual] = useState(new Set()), [range, setRange] = useState(''), [previewNumber, setPreviewNumber] = useState(null)
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState('')
  const session = useRef(null), input = useRef(null), anchor = useRef(null)
  const pages = history.present, locked = loading || saving
  const changedCount = pages.filter(changed).length
  const preview = pages.find(page => page.num === previewNumber)
  const { selected, rangeError } = useMemo(() => {
    let numbers
    if (mode === 'range') {
      if (!range.trim() || !pages.length) return { selected: new Set(), rangeError: '' }
      try { numbers = wordPageSelection(range, pages.length) }
      catch (failure) { return { selected: new Set(), rangeError: failure.message } }
    } else numbers = pages.filter(page => mode === 'all' || mode === 'odd' && page.num % 2 === 1 || mode === 'even' && page.num % 2 === 0 || mode === 'manual' && manual.has(page.num)).map(page => page.num)
    return { selected: new Set(numbers), rangeError: '' }
  }, [mode, manual, range, pages])
  const pressed = value => {
    if (!mirror || !selected.size) return undefined
    const targets = pages.filter(page => selected.has(page.num))
    const matches = targets.filter(page => value === 'both' ? page.flipX && page.flipY : page[value]).length
    return matches === targets.length ? true : matches ? 'mixed' : false
  }
  useEffect(() => () => { session.current?.controller.abort(); session.current?.task?.destroy().catch(() => {}); session.current = null }, [])
  useEffect(() => {
    if (!previewNumber) return
    const escape = event => { if (event.key === 'Escape') setPreviewNumber(null) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [previewNumber])
  const reset = () => {
    session.current?.controller.abort(); session.current?.task?.destroy().catch(() => {}); session.current = null
    setFile(null); setPdf(null); setHistory(emptyHistory()); setMode('all'); setManual(new Set()); setRange(''); setPreviewNumber(null); setLoading(false); setSaving(false); setProgress(0); setError(''); anchor.current = null
  }
  const choose = async incoming => {
    const next = incoming[0]
    if (!next) return
    if (next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) { setError('Choose a PDF file.'); return }
    reset()
    const current = { task: null, bytes: null, controller: new AbortController() }; session.current = current
    setFile(next); setLoading(true)
    try {
      const [pdfjs, bytes] = await Promise.all([getPdfjsLib(), loadPdfBytes(next)])
      if (session.current !== current) return
      current.bytes = bytes
      current.task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false })
      const document = await current.task.promise
      if (session.current !== current) return
      if (!document.numPages) throw new Error('No pages')
      setPdf(document)
      setHistory({ past: [], present: Array.from({ length: document.numPages }, (_, index) => ({ num: index + 1, rotation: 0, flipX: false, flipY: false })), future: [] })
    } catch (failure) {
      if (session.current === current) {
        setError(/password|encrypt/i.test(failure.message || '') ? 'Unlock this PDF with Remove Password, then add it here.' : 'Could not open this PDF. Choose a valid, undamaged file.')
        current.task?.destroy().catch(() => {})
      }
    } finally { if (session.current === current) setLoading(false) }
  }
  const commit = transform => {
    if (locked) return
    setHistory(current => {
      const next = transform(current.present)
      if (next.every((page, index) => page.rotation === current.present[index].rotation && page.flipX === current.present[index].flipX && page.flipY === current.present[index].flipY)) return current
      return { past: [...current.past.slice(-39), current.present], present: next, future: [] }
    })
  }
  const apply = (value, targets = selected) => {
    if (!targets.size) return
    commit(current => current.map(page => {
      if (!targets.has(page.num)) return page
      if (!mirror) return { ...page, rotation: normalize(page.rotation + value) }
      return { ...page, flipX: value === 'flipX' || value === 'both' ? !page.flipX : page.flipX, flipY: value === 'flipY' || value === 'both' ? !page.flipY : page.flipY }
    }))
  }
  const restorePage = number => commit(current => current.map(page => page.num === number ? { ...page, rotation: 0, flipX: false, flipY: false } : page))
  const restoreAll = () => commit(current => current.map(page => ({ ...page, rotation: 0, flipX: false, flipY: false })))
  const undo = () => {
    if (locked || !history.past.length) return
    setHistory(current => current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1), future: [current.present, ...current.future] } : current)
  }
  const redo = () => {
    if (locked || !history.future.length) return
    setHistory(current => current.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current)
  }
  const toggle = (number, shift) => {
    if (locked) return
    const next = new Set(selected)
    if (shift && anchor.current) {
      for (let page = Math.min(anchor.current, number); page <= Math.max(anchor.current, number); page++) next.add(page)
    } else if (next.has(number)) next.delete(number)
    else next.add(number)
    anchor.current = number; setManual(next); setMode('manual')
  }
  const download = async () => {
    const current = session.current
    if (!current?.bytes || !pages.length || locked) return
    setSaving(true); setProgress(0); setError('')
    try {
      let blob = file
      if (changedCount && mirror) {
        const { mirrorPdf } = await import('../services/pdfMirror')
        if (session.current !== current) return
        blob = await mirrorPdf(current.bytes, pages, { signal: current.controller.signal, onProgress: value => { if (session.current === current) setProgress(value) } })
      } else if (changedCount) {
        const { PDFDocument, degrees } = await getPdfLib()
        if (session.current !== current) return
        // Change only page rotation in the original document. Copying pages
        // into a new PDF would lose document-level forms, outlines and links.
        const document = await PDFDocument.load(current.bytes, { updateMetadata: false, ignoreEncryption: false })
        const originals = document.getPages()
        for (const [index, page] of pages.entries()) {
          if (session.current !== current) return
          if (page.rotation) originals[index].setRotation(degrees(normalize(originals[index].getRotation().angle + page.rotation)))
          if (index % 100 === 0) { setProgress(Math.round((index + 1) / pages.length * 80)); await new Promise(resolve => setTimeout(resolve, 0)) }
        }
        setProgress(85)
        const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false, objectsPerTick: 30 })
        blob = new Blob([bytes], { type: 'application/pdf' })
      }
      if (session.current !== current) return
      downloadBlob(blob, `${file.name.replace(/\.pdf$/i, '')}-${mirror ? 'mirrored' : 'rotated'}.pdf`)
      setProgress(100); showToast('PDF downloaded.', 'success')
    } catch (failure) {
      if (session.current === current) setError(/encrypt|password/i.test(failure.message || '') ? 'Unlock this PDF with Remove Password before saving changes.' : failure.message || 'Could not save this PDF.')
    } finally { if (session.current === current) setSaving(false) }
  }

  return <ToolPage toolId={mirror ? 'flip-mirror' : 'rotate-pdf'}><div className="rotate-workspace" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
  }}>
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={event => { choose(Array.from(event.target.files)); event.target.value = '' }} />
    {!file ? <div className="tool-panel rotate-upload"><DropZone onFiles={choose} accept={['application/pdf', '.pdf']}><div className="drop-zone-icon"><UploadIcon size={28} /></div><div className="drop-zone-title">Choose a PDF to {mirror ? 'flip' : 'rotate'}</div><div className="drop-zone-sub">Drop it here or click to browse</div></DropZone></div> : <>
      <div className="rotate-file-bar"><FileText size={18} /><strong title={file.name}>{file.name}</strong><span>{pdf ? `${pages.length} pages` : loading ? 'Opening…' : 'Could not open'}</span><button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => input.current?.click()}><Upload size={14} /> Change PDF</button><button className="icon-btn" disabled={saving} onClick={reset} title="Start over" aria-label="Start over"><X size={16} /></button></div>
      <div className="rotate-toolbar">
        <div className="rotate-selection-row"><div className="rotate-presets" role="group" aria-label="Select pages">{[['all', 'All'], ['odd', 'Odd'], ['even', 'Even'], ['range', 'Range']].map(([value, label]) => <button key={value} aria-pressed={mode === value} disabled={locked || !pages.length} onClick={() => setMode(value)}>{label}</button>)}</div><span className="rotate-selection-count" role="status">{selected.size} selected</span><button className="rotate-clear" disabled={locked || !selected.size} onClick={() => { setManual(new Set()); setMode('manual') }}>Clear</button>
          <div className="rotate-history"><button className="icon-btn" disabled={locked || !history.past.length} title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo}><Undo2 size={17} /></button><button className="icon-btn" disabled={locked || !history.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={redo}><Redo2 size={17} /></button><button className="btn btn-secondary btn-sm" disabled={locked || !changedCount} onClick={restoreAll}>Reset {mirror ? 'flips' : 'rotations'}</button></div>
        </div>
        {mode === 'range' && <div className="rotate-range-row"><label htmlFor="rotate-page-range">Pages</label><input id="rotate-page-range" className="form-input" inputMode="text" autoComplete="off" value={range} disabled={locked} aria-invalid={!!rangeError} aria-describedby={rangeError ? 'rotate-range-error' : undefined} placeholder="1-3, 5" onChange={event => setRange(event.target.value)} />{rangeError && <span id="rotate-range-error" role="alert">{rangeError}</span>}</div>}
        <div className="rotate-action-row" role="group" aria-label={`${mirror ? 'Flip' : 'Rotate'} selected pages`}>{actions.map(({ value, label, icon: Icon }) => <button key={value} className="btn btn-secondary" disabled={locked || !selected.size} aria-pressed={pressed(value)} onClick={() => apply(value)}><Icon size={17} />{label}</button>)}<span className="rotate-changes" role="status">{changedCount ? `${changedCount} ${changedCount === 1 ? 'page' : 'pages'} changed` : ''}</span><button className="btn btn-primary rotate-download" disabled={locked || !pages.length} onClick={download}>{saving ? <LoaderCircle size={17} className="rotate-spin" /> : <Download size={17} />}{saving ? 'Saving…' : 'Download PDF'}</button></div>
      </div>
      {saving && <div className="rotate-progress"><ProgressBar value={progress} label="Saving PDF" /></div>}
      {loading ? <div className="tool-panel rotate-loading" role="status"><LoaderCircle size={23} className="rotate-spin" /> Opening PDF…</div> : pdf && <div className="tool-panel rotate-board"><div className="rotate-grid">{pages.map(page => {
        const chosen = selected.has(page.num), one = new Set([page.num])
        return <article className={`rotate-page-card${chosen ? ' is-selected' : ''}`} key={page.num}>
          <div className="rotate-card-header"><label className="rotate-checkbox"><input type="checkbox" disabled={locked} checked={chosen} onChange={event => toggle(page.num, event.nativeEvent.shiftKey)} aria-label={`Select page ${page.num}`} /><span aria-hidden="true">{chosen && <Check size={12} />}</span></label><span>Page {page.num}</span>{changed(page) && <span className="rotate-angle" title={mirror ? `${page.flipX ? 'Horizontal flip' : ''}${page.flipX && page.flipY ? ' + ' : ''}${page.flipY ? 'Vertical flip' : ''}` : `Rotation changed by ${angleLabel(page.rotation)}`}>{badge(page)}</span>}</div>
          <button className="rotate-page-select" disabled={locked} aria-label={`${chosen ? 'Deselect' : 'Select'} page ${page.num}`} aria-pressed={chosen} onClick={event => toggle(page.num, event.shiftKey)}><PdfPageThumbnail pdf={pdf} page={page} /></button>
          <div className="rotate-page-actions" role="group" aria-label={`Actions for page ${page.num}`}>{actions.slice(0, 2).map(({ value, label, icon: Icon }) => <button key={value} className="icon-btn" disabled={locked} title={label} aria-label={`${label}, page ${page.num}`} aria-pressed={mirror ? !!page[value] : undefined} onClick={() => apply(value, one)}><Icon size={16} /></button>)}<button className="icon-btn" disabled={locked || !changed(page)} title="Reset page" aria-label={`Reset changes to page ${page.num}`} onClick={() => restorePage(page.num)}><Undo2 size={16} /></button><button className="icon-btn" disabled={locked} title="Preview page" aria-label={`Preview page ${page.num}`} onClick={() => setPreviewNumber(page.num)}><Eye size={16} /></button></div>
        </article>
      })}</div></div>}
    </>}
    {error && <p className="rotate-error" role="alert">{error}</p>}
    <Modal open={!!preview} onClose={() => setPreviewNumber(null)} title={`Page ${previewNumber} of ${pages.length}`} maxWidth={800} footer={<div className="rotate-preview-controls"><button className="btn btn-secondary btn-sm" disabled={!previewNumber || previewNumber <= 1} onClick={() => setPreviewNumber(number => number - 1)}><ArrowLeft size={14} /> Previous</button><div>{actions.slice(0, 2).map(({ value, label, icon: Icon }) => <button key={value} className="btn btn-secondary btn-sm" disabled={locked} aria-label={`${label}, preview page`} aria-pressed={mirror ? !!preview?.[value] : undefined} title={label} onClick={() => apply(value, new Set([previewNumber]))}><Icon size={16} /></button>)}</div><button className="btn btn-secondary btn-sm" disabled={!previewNumber || previewNumber >= pages.length} onClick={() => setPreviewNumber(number => number + 1)}>Next <ArrowRight size={14} /></button></div>}>{preview && pdf && <PdfPageThumbnail pdf={pdf} page={preview} large />}</Modal>
  </div></ToolPage>
}
