import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Camera, Download, FileImage, Plus, RotateCw, Undo2, Trash2 } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FormGroup, ProgressBar, downloadBlob, generateId } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { SCAN_DEFAULTS, createScannedPdf, renderScanImage, scanDimensions, scanLayout } from '../../services/scanDocument'
import './ScanDocument.css'

function PagePreview({ item, options, thumbnail = false }) {
  const ref = useRef(null)
  const [result, setResult] = useState({ key: null, error: '' })
  const dimensions = scanDimensions(item.width, item.height, item)
  const layout = scanLayout(dimensions.width, dimensions.height, options)
  const renderKey = [item.id, item.rotation, item.brightness, item.contrast, item.crop, options.paper, options.orientation, options.margin, options.fit, thumbnail].join(':')
  const rendering = result.key !== renderKey
  const error = rendering ? '' : result.error
  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      let image
      try {
        image = await renderScanImage(item, thumbnail ? 180 : 1400)
        if (!active || !ref.current) return
        const canvas = ref.current
        const scale = (thumbnail ? 150 : 1100) / Math.max(layout.pageWidth, layout.pageHeight)
        canvas.width = Math.max(1, Math.round(layout.pageWidth * scale))
        canvas.height = Math.max(1, Math.round(layout.pageHeight * scale))
        const ctx = canvas.getContext('2d')
        ctx.scale(canvas.width / layout.pageWidth, canvas.height / layout.pageHeight)
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, layout.pageWidth, layout.pageHeight)
        ctx.beginPath(); ctx.rect(layout.margin, layout.margin, layout.availableWidth, layout.availableHeight); ctx.clip()
        ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height)
        setResult({ key: renderKey, error: '' })
      } catch (failure) { if (active) setResult({ key: renderKey, error: failure.message }) }
      finally { if (image) image.width = image.height = 1 }
    }, thumbnail ? 0 : 80)
    return () => { active = false; clearTimeout(timer) }
  }, [item, thumbnail, renderKey, layout.pageWidth, layout.pageHeight, layout.margin, layout.availableWidth, layout.availableHeight, layout.x, layout.y, layout.width, layout.height])
  return <div className={`scan-paper-wrap ${rendering ? 'scan-rendering' : ''}`} aria-busy={rendering}>
    <canvas ref={ref} role="img" aria-label={thumbnail ? 'Page thumbnail' : 'PDF page preview'} style={{ aspectRatio: `${layout.pageWidth} / ${layout.pageHeight}` }} />
    {error && <span className="scan-preview-error" role="alert">{error}</span>}
  </div>
}

export default function ScanDocument() {
  const { showToast } = useApp()
  const [pages, setPages] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [options, setOptions] = useState({ paper: 'a4', orientation: 'auto', margin: 18, fit: 'fit' })
  const cameraRef = useRef(null)
  const mounted = useRef(true)
  const importingRef = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const selected = pages.find(page => page.id === selectedId) || pages[0]
  const locked = busy || importing
  const configure = updates => setOptions(current => ({ ...current, ...updates }))
  const addFiles = async files => {
    if (busy || importingRef.current) return
    importingRef.current = true; setImporting(true)
    const incoming = [], failures = []
    try {
      for (const file of files) {
        let image
        try {
          image = await createImageBitmap(file, { imageOrientation: 'from-image' })
          incoming.push({ id: generateId(), file, width: image.width, height: image.height, ...SCAN_DEFAULTS })
        } catch { failures.push(file.name) }
        finally { image?.close() }
      }
      if (!mounted.current) return
      setPages(current => [...current, ...incoming])
      setSelectedId(current => current || incoming[0]?.id || null)
      if (failures.length) showToast(`Could not read ${failures.length} file${failures.length === 1 ? '' : 's'} (${failures.slice(0, 2).join(', ')}). Use JPG, PNG or WebP images.`, 'error')
    } finally { importingRef.current = false; if (mounted.current) setImporting(false) }
  }
  const update = updates => setPages(current => current.map(page => page.id === selected.id ? { ...page, ...updates } : page))
  const move = (index, direction) => setPages(current => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next
  })
  const remove = page => {
    const index = pages.findIndex(item => item.id === page.id)
    if (selected?.id === page.id) setSelectedId(pages[index + 1]?.id || pages[index - 1]?.id || null)
    setPages(current => current.filter(item => item.id !== page.id))
  }
  const createPdf = async () => {
    if (locked || !pages.length) return
    setBusy(true); setProgress(0)
    try {
      downloadBlob(await createScannedPdf(pages, options, value => { if (mounted.current) setProgress(value) }), 'scanned-document.pdf')
      if (mounted.current) { setProgress(100); showToast('Scanned PDF created.', 'success') }
    } catch (error) { if (mounted.current) showToast(error.message, 'error') }
    finally { if (mounted.current) setBusy(false) }
  }

  return <ToolPage toolId="scan-document"><div className={`scan-workspace ${pages.length ? 'scan-has-pages' : ''}`}>
    <fieldset disabled={locked} className="scan-fieldset scan-import tool-panel">
      <DropZone accept={['image/*']} multiple onFiles={addFiles} className="scan-drop">
        <span className="scan-upload-icon"><FileImage size={28} /></span>
        <div className="drop-zone-title">{pages.length ? 'Add more document pages' : 'Turn your photos into a clean PDF'}</div>
        <div className="drop-zone-sub">Drop images here or click to browse. Each image becomes one page.</div>
        <span className="scan-browse"><Plus size={15} /> Choose images</span>
      </DropZone>
      <div className="scan-capture-row"><span>Photograph a paper document</span><button className="btn btn-secondary btn-sm" onClick={() => cameraRef.current?.click()}><Camera size={15} /> Use camera</button></div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={event => { addFiles(Array.from(event.target.files)); event.target.value = '' }} />
    </fieldset>
    {importing && <p className="scan-hint" role="status">Checking and adding images…</p>}
    {!!pages.length && <>
      <fieldset className="scan-fieldset tool-panel scan-output" disabled={locked}>
        <div className="scan-section-heading"><h2>PDF layout</h2><span>Applies to every page</span></div>
        <div className="scan-settings">
          <FormGroup label="Page size"><select className="form-select" value={options.paper} onChange={event => configure({ paper: event.target.value })}><option value="a4">A4</option><option value="letter">US Letter</option><option value="image">Match image · no borders</option></select></FormGroup>
          <FormGroup label="Orientation"><select className="form-select" disabled={options.paper === 'image'} value={options.orientation} onChange={event => configure({ orientation: event.target.value })}><option value="auto">Auto · match each image</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
          <FormGroup label="Margins"><select className="form-select" disabled={options.paper === 'image'} value={options.margin} onChange={event => configure({ margin: Number(event.target.value) })}><option value="0">None</option><option value="18">Small · ¼ inch</option><option value="36">Medium · ½ inch</option></select></FormGroup>
          <FormGroup label="Image fit"><select className="form-select" disabled={options.paper === 'image'} value={options.fit} onChange={event => configure({ fit: event.target.value })}><option value="fit">Fit entire image</option><option value="fill">Fill page · crop overflow</option></select></FormGroup>
        </div>
        <p className={`scan-hint ${options.fit === 'fill' && options.paper !== 'image' ? 'scan-warning' : ''}`}>{options.paper === 'image' ? 'Each page follows the image’s proportions, with no added margins.' : options.fit === 'fill' ? 'Fill crops the image edges to cover the page inside the margins. Check the preview before exporting.' : 'The whole image stays visible, centered and in proportion. Auto orientation gives wide images a landscape page.'}</p>
      </fieldset>
      <div className="scan-layout">
        <fieldset className="scan-fieldset tool-panel scan-pages" disabled={locked}>
          <div className="scan-section-heading"><h2>Pages <span className="scan-count">{pages.length}</span></h2></div>
          <div className="scan-page-list">{pages.map((page, index) => <div className={`scan-thumb ${selected?.id === page.id ? 'selected' : ''}`} key={page.id}>
            <button className="scan-page-select" aria-pressed={selected?.id === page.id} aria-label={`Edit page ${index + 1}`} onClick={() => setSelectedId(page.id)}><PagePreview item={page} options={options} thumbnail /><span><strong>Page {index + 1}</strong><small title={page.file.name}>{page.file.name}</small></span></button>
            <div className="scan-page-actions"><button className="icon-btn" aria-label={`Move page ${index + 1} up`} title="Move up" disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`Move page ${index + 1} down`} title="Move down" disabled={index === pages.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button><button className="icon-btn" aria-label={`Remove page ${index + 1}`} title="Remove page" onClick={() => remove(page)}><Trash2 size={14} /></button></div>
          </div>)}</div>
        </fieldset>
        {selected && <fieldset className="scan-fieldset tool-panel scan-editor" disabled={locked}>
          <div className="scan-section-heading"><h2>Page {pages.indexOf(selected) + 1} preview</h2><span>{options.paper === 'image' ? 'Image size' : options.paper === 'a4' ? 'A4' : 'US Letter'} · PDF layout</span></div>
          <div className="scan-preview"><PagePreview item={selected} options={options} /></div>
          <div className="scan-edit-toolbar"><button className="btn btn-secondary btn-sm" onClick={() => update({ rotation: (selected.rotation + 90) % 360 })}><RotateCw size={15} /> Rotate 90°</button><button className="btn btn-secondary btn-sm" onClick={() => update(SCAN_DEFAULTS)}><Undo2 size={15} /> Reset edits</button></div>
          <div className="scan-adjustments">{[{ key: 'crop', label: 'Crop edges', min: 0, max: 20 }, { key: 'brightness', label: 'Brightness', min: 60, max: 160 }, { key: 'contrast', label: 'Contrast', min: 60, max: 180 }].map(control => <FormGroup key={control.key} label={`${control.label} · ${selected[control.key]}%`}><input aria-label={control.label} type="range" min={control.min} max={control.max} value={selected[control.key]} onChange={event => update({ [control.key]: Number(event.target.value) })} /></FormGroup>)}</div>
        </fieldset>}
      </div>
    </>}
    {busy && <ProgressBar value={progress} label="Creating scanned PDF" />}
    <div className="scan-export"><button className="btn btn-primary btn-lg" disabled={!pages.length || locked} onClick={createPdf}><Download size={17} />{busy ? 'Creating PDF…' : 'Create scanned PDF'}</button><span>{pages.length ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} · Processed on your device` : 'Add images to get started'}</span></div>
  </div></ToolPage>
}
