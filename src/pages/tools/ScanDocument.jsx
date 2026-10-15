import { useState } from 'react'
import { ArrowDown, ArrowUp, Camera, Contrast, Download, RotateCw, Sun, Trash2 } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FormGroup, ProgressBar, downloadBlob, generateId } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { imagesToPdf } from '../../services/pdfEngine'

function createPage(file) {
  return { id: generateId(), file, url: URL.createObjectURL(file), rotation: 0, brightness: 100, contrast: 110, crop: 0 }
}

async function processPage(item) {
  const image = await createImageBitmap(item.file)
  const cropX = Math.round(image.width * item.crop / 100)
  const cropY = Math.round(image.height * item.crop / 100)
  const sourceWidth = Math.max(1, image.width - cropX * 2)
  const sourceHeight = Math.max(1, image.height - cropY * 2)
  const sideways = Math.abs(item.rotation % 180) === 90
  const canvas = document.createElement('canvas')
  canvas.width = sideways ? sourceHeight : sourceWidth
  canvas.height = sideways ? sourceWidth : sourceHeight
  const context = canvas.getContext('2d')
  context.filter = `brightness(${item.brightness}%) contrast(${item.contrast}%)`
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(item.rotation * Math.PI / 180)
  context.drawImage(image, cropX, cropY, sourceWidth, sourceHeight, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight)
  image.close()
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode scanned page.')), 'image/jpeg', .92))
  return new File([blob], `scan-${item.id}.jpg`, { type: 'image/jpeg' })
}

export default function ScanDocument() {
  const { showToast } = useApp()
  const [pages, setPages] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const selected = pages.find((page) => page.id === selectedId) || pages[0]

  const addFiles = (files) => {
    const incoming = files.filter((file) => file.type.startsWith('image/')).map(createPage)
    if (!incoming.length) return
    setPages((current) => [...current, ...incoming])
    setSelectedId((current) => current || incoming[0].id)
  }
  const update = (updates) => setPages((current) => current.map((page) => page.id === selected.id ? { ...page, ...updates } : page))
  const move = (index, direction) => setPages((current) => { const target = index + direction; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  const remove = (page) => { URL.revokeObjectURL(page.url); setPages((current) => current.filter((item) => item.id !== page.id)); if (selectedId === page.id) setSelectedId(null) }
  const createPdf = async () => {
    setBusy(true); setProgress(0)
    try {
      const output = []
      for (let index = 0; index < pages.length; index++) { output.push(await processPage(pages[index])); setProgress(Math.round((index + 1) / pages.length * 80)) }
      downloadBlob(await imagesToPdf(output, { pageSize: [595, 842], margin: 18 }), 'scanned-document.pdf')
      setProgress(100); showToast('Scanned PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }

  return <ToolPage toolId="scan-document"><div className="tool-panel"><DropZone accept={['image/*']} capture="environment" multiple onFiles={addFiles}><Camera size={30} /><div className="drop-zone-title">Capture or import document pages</div><div className="drop-zone-sub">Camera access is requested only after you choose capture.</div></DropZone></div>{pages.length > 0 && <div className="scanner-layout"><div className="tool-panel scanner-pages">{pages.map((page, index) => <div key={page.id} className={`scanner-thumb ${selected?.id === page.id ? 'selected' : ''}`} onClick={() => setSelectedId(page.id)}><img src={page.url} alt={`Scan ${index + 1}`} style={{ transform: `rotate(${page.rotation}deg)`, filter: `brightness(${page.brightness}%) contrast(${page.contrast}%)` }} /><span>Page {index + 1}</span><div><button className="icon-btn" disabled={!index} onClick={(event) => { event.stopPropagation(); move(index, -1) }}><ArrowUp size={13} /></button><button className="icon-btn" disabled={index === pages.length - 1} onClick={(event) => { event.stopPropagation(); move(index, 1) }}><ArrowDown size={13} /></button><button className="icon-btn" onClick={(event) => { event.stopPropagation(); remove(page) }}><Trash2 size={13} /></button></div></div>)}</div>{selected && <div className="tool-panel scanner-editor"><div className="scanner-preview"><img src={selected.url} alt="Selected scan" style={{ transform: `rotate(${selected.rotation}deg) scale(${1 - selected.crop / 55})`, filter: `brightness(${selected.brightness}%) contrast(${selected.contrast}%)` }} /></div><div className="form-grid"><FormGroup label="Rotation"><button className="btn btn-secondary" onClick={() => update({ rotation: (selected.rotation + 90) % 360 })}><RotateCw size={15} /> Rotate 90°</button></FormGroup><FormGroup label="Crop edges"><input type="range" min="0" max="20" value={selected.crop} onChange={(event) => update({ crop: Number(event.target.value) })} /></FormGroup><FormGroup label="Brightness"><Sun size={15} /><input type="range" min="60" max="160" value={selected.brightness} onChange={(event) => update({ brightness: Number(event.target.value) })} /></FormGroup><FormGroup label="Contrast"><Contrast size={15} /><input type="range" min="60" max="180" value={selected.contrast} onChange={(event) => update({ contrast: Number(event.target.value) })} /></FormGroup></div></div>}</div>}{busy && <ProgressBar value={progress} label="Enhancing scanned pages" />}<button className="btn btn-primary btn-lg" disabled={!pages.length || busy} onClick={createPdf}><Download size={17} /> Create scanned PDF</button></ToolPage>
}
