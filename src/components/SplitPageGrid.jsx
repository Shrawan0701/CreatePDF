import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Eye, FileText, LoaderCircle } from 'lucide-react'
import { Modal } from './ui'
import { getPdfjsLib } from '../services/pdfEngine'

function PageCanvas({ pdf, number, large = false }) {
  const canvasRef = useRef(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    if (!pdf) return
    let disposed = false, task
    setState('loading')
    const draw = async () => {
      const page = await pdf.getPage(number)
      if (disposed) return
      const native = page.getViewport({ scale: 1 })
      const scale = Math.min((large ? 580 : 150) / native.width, (large ? 750 : 190) / native.height)
      const density = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * density })
      const canvas = canvasRef.current
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      canvas.style.width = `${native.width * scale}px`; canvas.style.height = `${native.height * scale}px`
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      await task.promise
      if (!disposed) setState('ready')
    }
    draw().catch(() => { if (!disposed) setState('error') })
    return () => { disposed = true; task?.cancel() }
  }, [pdf, number, large])
  return <div className={`split-page-canvas${large ? ' large' : ''}`}>
    <canvas ref={canvasRef} role="img" aria-label={`PDF page ${number}`} hidden={state !== 'ready'} />
    {state !== 'ready' && <div className="split-thumb-placeholder">{state === 'error' ? <><FileText size={23} /><span>Preview unavailable</span></> : <LoaderCircle size={19} className="split-spin" />}</div>}
  </div>
}

export function SplitPageGrid({ source, selected, onToggle, onSelect, selectable, disabled }) {
  const [loaded, setLoaded] = useState(null)
  const [failure, setFailure] = useState(null)
  const [sheet, setSheet] = useState(0)
  const [focus, setFocus] = useState(null)
  const pdf = loaded?.source === source ? loaded.pdf : null
  const error = failure?.source === source ? failure.message : ''
  const sheetCount = Math.ceil(source.pageCount / 12)
  const currentSheet = Math.min(sheet, sheetCount - 1)
  const numbers = Array.from({ length: Math.min(12, source.pageCount - currentSheet * 12) }, (_, index) => currentSheet * 12 + index + 1)
  useEffect(() => {
    let disposed = false, task
    setSheet(0); setFocus(null)
    const open = async () => {
      const pdfjs = await getPdfjsLib()
      if (disposed) return
      task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false })
      const pdf = await task.promise
      if (!disposed) setLoaded({ source, pdf })
    }
    open().catch(error => { if (!disposed) setFailure({ source, message: error.message }) })
    return () => { disposed = true; task?.destroy().catch(() => {}) }
  }, [source])

  return <>
    <div className="split-grid-toolbar"><div><strong>{source.pageCount} pages</strong><span>{selectable ? `${selected.size} selected · click pages to choose` : `${selected.size} included in your split plan`}</span></div>
      {selectable && <div className="split-selection-actions">{[['all', 'All'], ['odd', 'Odd'], ['even', 'Even'], ['invert', 'Invert'], ['none', 'Clear']].map(([key, label]) => <button key={key} className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onSelect(key)}>{label}</button>)}</div>}
    </div>
    {error ? <p className="split-warning" role="status">Page thumbnails could not load. You can still split this PDF using the page numbers. {error}</p> : !pdf ? <p className="split-loading"><LoaderCircle size={16} className="split-spin" /> Loading page thumbnails…</p> : null}
    <div className="split-thumbnail-grid">{numbers.map(number => <div key={number} className={`split-page-card${selected.has(number) ? ' selected' : ''}`}>
      <button className="split-thumb-toggle" aria-label={selectable ? `${selected.has(number) ? 'Deselect' : 'Select'} page ${number}` : `View page ${number}`} aria-pressed={selectable ? selected.has(number) : undefined} disabled={disabled && selectable} onClick={event => selectable ? onToggle(number, event.shiftKey) : setFocus(number)}>
        {pdf && !error ? <PageCanvas pdf={pdf} number={number} /> : <div className="split-thumb-placeholder"><FileText size={26} /><span>Page {number}</span></div>}
        <span className="split-page-check" aria-hidden="true">{selected.has(number) && <Check size={12} />}</span>
      </button>
      <div className="split-page-footer"><span>Page {number}</span><button className="icon-btn" title={`View page ${number}`} aria-label={`Preview source page ${number}`} disabled={!pdf} onClick={() => setFocus(number)}><Eye size={14} /></button></div>
    </div>)}</div>
    <div className="split-grid-pagination"><button className="btn btn-secondary btn-icon btn-sm" aria-label="Previous source pages" disabled={currentSheet === 0} onClick={() => setSheet(currentSheet - 1)}><ChevronLeft size={16} /></button><span>{numbers[0]}–{numbers.at(-1)} of {source.pageCount}</span><button className="btn btn-secondary btn-icon btn-sm" aria-label="Next source pages" disabled={currentSheet + 1 >= sheetCount} onClick={() => setSheet(currentSheet + 1)}><ChevronRight size={16} /></button></div>
    <Modal open={focus !== null} onClose={() => setFocus(null)} title={`Source page ${focus} of ${source.pageCount}`} maxWidth={680} footer={<div className="split-modal-navigation"><button className="btn btn-secondary" disabled={!focus || focus <= 1} onClick={() => setFocus(focus - 1)}><ChevronLeft size={15} /> Previous</button>{selectable && <button className={`btn ${selected.has(focus) ? 'btn-primary' : 'btn-secondary'}`} disabled={disabled} onClick={() => onToggle(focus, false)}>{selected.has(focus) ? <Check size={15} /> : null}{selected.has(focus) ? 'Selected' : 'Select page'}</button>}<button className="btn btn-secondary" disabled={!focus || focus >= source.pageCount} onClick={() => setFocus(focus + 1)}>Next <ChevronRight size={15} /></button></div>}>
      {focus !== null && pdf && <PageCanvas pdf={pdf} number={focus} large />}
    </Modal>
  </>
}
