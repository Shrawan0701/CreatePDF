import { useState } from 'react'
import { FormGroup } from './ui'

export function CreateImageControls({ image, onChange, onMove, onRemove, onClose, onError }) {
  const [width, setWidth] = useState(image.width)
  const [cropping, setCropping] = useState(false)
  const [crop, setCrop] = useState({ top: 0, right: 0, bottom: 0, left: 0 })
  const [busy, setBusy] = useState(false)
  const applyCrop = async () => {
    setBusy(true)
    try {
      const source = new Image()
      source.src = image.src
      await source.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(source.naturalWidth * (100 - crop.left - crop.right) / 100))
      canvas.height = Math.max(1, Math.round(source.naturalHeight * (100 - crop.top - crop.bottom) / 100))
      canvas.getContext('2d').drawImage(source, source.naturalWidth * crop.left / 100, source.naturalHeight * crop.top / 100, source.naturalWidth * (100 - crop.left - crop.right) / 100, source.naturalHeight * (100 - crop.top - crop.bottom) / 100, 0, 0, canvas.width, canvas.height)
      onChange({ src: canvas.toDataURL('image/png') })
      setCropping(false)
    } catch { onError('Could not crop this image. Try a smaller PNG or JPG.') } finally { setBusy(false) }
  }
  return <div className="create-image-controls" role="region" aria-label="Image options">
    <div className="create-image-heading"><strong>Image options</strong><button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Done</button></div>
    <p className="form-hint">Resize without stretching. Use Undo to reverse any image edit.</p>
    <div className="create-image-size">
      <FormGroup label="Image width (%)"><input className="form-input" type="number" min="10" max="100" value={width} onChange={event => setWidth(event.target.value)} /></FormGroup>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange({ width: Math.max(10, Math.min(100, Number(width) || 100)) })}>Apply size</button>
      <FormGroup label="Image alignment"><select className="form-select" value={image.align} onChange={event => onChange({ align: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></FormGroup>
    </div>
    <div className="action-row">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMove(-1)}>Move image up</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMove(1)}>Move image down</button>
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={cropping} onClick={() => setCropping(!cropping)}>Crop image</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onRemove}>Remove image</button>
    </div>
    {cropping && <div className="create-crop-panel">
      <p className="form-hint">Adjust the edges. The outlined area will be kept.</p>
      <div className="create-crop-preview"><img src={image.src} alt="Image before cropping" /><div className="create-crop-area" style={{ inset: `${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%` }} /></div>
      <div className="form-grid">{Object.keys(crop).map(edge => <FormGroup key={edge} label={`Crop ${edge} (%)`} hint={`${crop[edge]}%`}><input type="range" min="0" max="45" value={crop[edge]} onChange={event => setCrop(current => ({ ...current, [edge]: Number(event.target.value) }))} /></FormGroup>)}</div>
      <div className="action-row"><button type="button" className="btn btn-primary btn-sm" disabled={busy || !Object.values(crop).some(Boolean)} onClick={applyCrop}>{busy ? 'Cropping…' : 'Apply crop'}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCropping(false); setCrop({ top: 0, right: 0, bottom: 0, left: 0 }) }}>Cancel crop</button></div>
    </div>}
  </div>
}
