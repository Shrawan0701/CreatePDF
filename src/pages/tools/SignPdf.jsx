import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileSignature, Image, Trash2 } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, Tabs, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { getPdfLib, getPdfjsLib, loadPdfBytes, renderPageToCanvas } from '../../services/pdfEngine'
import { useApp } from '../../context/AppContext'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function SignPdf() {
  const { showToast } = useApp()
  const [file, setFile] = useState(null)
  const [pdfJs, setPdfJs] = useState(null)
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [sigType, setSigType] = useState('draw')
  const [sigText, setSigText] = useState('')
  const [sigFont, setSigFont] = useState('cursive')
  const [sigImageData, setSigImageData] = useState(null)
  const [drawnSig, setDrawnSig] = useState(null)
  const [placement, setPlacement] = useState({ page: 1, x: .66, y: .78, width: .25, height: .09 })
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [pdfRendered, setPdfRendered] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const drawRef = useRef(null)
  const previewRef = useRef(null)
  const interactionRef = useRef(null)

  const renderPdfPage = async (pdf, pageNumber) => {
    const canvas = await renderPageToCanvas(pdf, pageNumber, 1.35)
    setPdfRendered(canvas.toDataURL('image/png'))
  }

  const handleFile = async (files) => {
    const selected = files.find((item) => item.type === 'application/pdf')
    if (!selected) return
    try {
      const pdfjs = await getPdfjsLib()
      const pdf = await pdfjs.getDocument({ data: await loadPdfBytes(selected) }).promise
      setFile(selected)
      setPdfJs(pdf)
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      setPlacement((current) => ({ ...current, page: 1 }))
      await renderPdfPage(pdf, 1)
    } catch (error) {
      showToast(`Unable to open PDF: ${error.message}`, 'error')
    }
  }

  const goToPage = async (pageNumber) => {
    const next = clamp(pageNumber, 1, totalPages)
    setCurrentPage(next)
    setPlacement((current) => ({ ...current, page: next }))
    await renderPdfPage(pdfJs, next)
  }

  const point = (event) => {
    const rect = previewRef.current.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const startPlacementInteraction = (event, mode) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    interactionRef.current = { mode, start: point(event), original: { ...placement } }
  }

  const movePlacement = (event) => {
    const interaction = interactionRef.current
    if (!interaction) return
    const current = point(event)
    const dx = current.x - interaction.start.x
    const dy = current.y - interaction.start.y
    setPlacement((value) => interaction.mode === 'move'
      ? { ...value, x: clamp(interaction.original.x + dx, 0, 1 - value.width), y: clamp(interaction.original.y + dy, 0, 1 - value.height) }
      : { ...value, width: clamp(interaction.original.width + dx, .08, 1 - value.x), height: clamp(interaction.original.height + dy, .035, 1 - value.y) })
  }

  const startDraw = (event) => {
    setDrawing(true)
    const canvas = drawRef.current
    const rect = canvas.getBoundingClientRect()
    const context = canvas.getContext('2d')
    context.beginPath()
    context.moveTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const draw = (event) => {
    if (!drawing) return
    const canvas = drawRef.current
    const rect = canvas.getBoundingClientRect()
    const context = canvas.getContext('2d')
    context.lineWidth = 3
    context.lineCap = 'round'
    context.strokeStyle = '#111827'
    context.lineTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height)
    context.stroke()
  }

  const endDraw = () => {
    if (!drawing) return
    setDrawing(false)
    setDrawnSig(drawRef.current.toDataURL('image/png'))
  }

  const clearDraw = () => {
    const canvas = drawRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setDrawnSig(null)
  }

  const signatureData = () => {
    if (sigType === 'draw') return drawnSig
    if (sigType === 'image') return sigImageData
    if (!sigText.trim()) return null
    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 260
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.font = `160px ${sigFont}`
    context.fillStyle = '#111827'
    context.textBaseline = 'middle'
    context.fillText(sigText.trim(), 24, canvas.height / 2, canvas.width - 48)
    return canvas.toDataURL('image/png')
  }

  const applySignature = async () => {
    const dataUrl = signatureData()
    if (!file || !dataUrl) return showToast('Choose a PDF and create a signature first.', 'warning')
    setProcessing(true)
    setProgress(20)
    try {
      const { PDFDocument } = await getPdfLib()
      const document = await PDFDocument.load(await loadPdfBytes(file))
      const page = document.getPage(placement.page - 1)
      const image = await document.embedPng(Uint8Array.from(atob(dataUrl.split(',')[1]), (character) => character.charCodeAt(0)))
      const { width, height } = page.getSize()
      page.drawImage(image, { x: placement.x * width, y: height - (placement.y + placement.height) * height, width: placement.width * width, height: placement.height * height })
      setProgress(85)
      downloadBlob(new Blob([await document.save()], { type: 'application/pdf' }), `signed-${file.name}`)
      setProgress(100)
      showToast('Signed PDF downloaded.', 'success')
    } catch (error) {
      showToast(`Signing failed: ${error.message}`, 'error')
    } finally {
      setProcessing(false)
    }
  }

  const previewSignature = signatureData()

  return <ToolPage toolId="sign-pdf">
    <div className="tool-panel"><DropZone onFiles={handleFile} accept={['application/pdf']}><div className="drop-zone-icon"><FileSignature size={28} /></div><div className="drop-zone-title">{file ? file.name : 'Drop PDF to sign'}</div><div className="drop-zone-sub">Create a signature, then drag and resize it on the page.</div></DropZone></div>
    <div className="tool-panel"><div className="tool-panel-title">Create signature</div><Tabs tabs={[{ key: 'draw', label: 'Draw' }, { key: 'type', label: 'Type' }, { key: 'image', label: 'Image' }]} active={sigType} onChange={setSigType} />
      {sigType === 'draw' && <div><div className="sig-pad-container"><canvas ref={drawRef} width={1000} height={260} onPointerDown={startDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerCancel={endDraw} /></div><button className="btn btn-sm btn-secondary" onClick={clearDraw}><Trash2 size={13} /> Clear</button></div>}
      {sigType === 'type' && <div className="signature-type-grid"><FormGroup label="Your name"><input className="form-input" value={sigText} onChange={(event) => setSigText(event.target.value)} placeholder="Type your signature" /></FormGroup><FormGroup label="Style"><select className="form-select" value={sigFont} onChange={(event) => setSigFont(event.target.value)}><option value="cursive">Script</option><option value="'Segoe Print', cursive">Printed</option><option value="Georgia, serif">Formal</option></select></FormGroup></div>}
      {sigType === 'image' && <DropZone accept={['image/*']} onFiles={([imageFile]) => { if (!imageFile) return; const reader = new FileReader(); reader.onload = () => setSigImageData(reader.result); reader.readAsDataURL(imageFile) }}><Image size={25} /><div className="drop-zone-title">Choose a signature image</div><div className="drop-zone-sub">PNG with a transparent background works best.</div></DropZone>}
    </div>
    {file && pdfRendered && <div className="tool-panel"><div className="signature-pagebar"><button className="icon-btn" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}><ChevronLeft size={17} /></button><span>Page {currentPage} of {totalPages}</span><button className="icon-btn" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)}><ChevronRight size={17} /></button></div><div ref={previewRef} className="signature-preview" onPointerMove={movePlacement} onPointerUp={() => { interactionRef.current = null }} onPointerCancel={() => { interactionRef.current = null }}><img src={pdfRendered} alt={`PDF page ${currentPage}`} />{previewSignature && <div className="signature-placement" style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.width * 100}%`, height: `${placement.height * 100}%` }} onPointerDown={(event) => startPlacementInteraction(event, 'move')}><img src={previewSignature} alt="Signature placement" /><button className="signature-resize" aria-label="Resize signature" onPointerDown={(event) => startPlacementInteraction(event, 'resize')} /></div>}</div><p className="form-hint">Drag the signature to position it. Drag the corner handle to resize.</p></div>}
    {processing && <ProgressBar value={progress} label="Applying signature" />}
    <button className="btn btn-primary btn-lg" onClick={applySignature} disabled={!file || !previewSignature || processing}><Download size={18} /> Sign & Download PDF</button>
  </ToolPage>
}
