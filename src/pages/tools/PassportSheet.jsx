import { useEffect, useRef, useState } from 'react';
import { Camera, Download, Trash2 } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { DropZone, downloadBlob, generateId } from '../../components/ui';
import { buildPassportSheet, passportLayout, paintPhoto, photoCrop, fillPhotoCopies } from '../../services/passportSheet';
import './DocumentTools.css';
import { PassportSheetPreview } from './PassportSheetPreview';

export default function PassportSheet() {
  const [photos, setPhotos] = useState([]), [selectedId, setSelectedId] = useState(null);
  const [preset, setPreset] = useState('35x45');
  const [options, setOptions] = useState({ width: 35, height: 45, paper: 'A4', orientation: 'portrait', centered: false, margin: 10, spacing: 5, guides: true });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [result, setResult] = useState(null), [previewUrl, setPreviewUrl] = useState('');
  const selected = photos.find((photo) => photo.id === selectedId) || photos[0];
  const canvas = useRef(null), drag = useRef(null), photoRef = useRef([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; photoRef.current.forEach((photo) => { photo.bitmap.close(); URL.revokeObjectURL(photo.url); }); }; }, []);
  useEffect(() => { if (!result) { setPreviewUrl(''); return; } const url = URL.createObjectURL(result.blob); setPreviewUrl(url); return () => URL.revokeObjectURL(url); }, [result]);
  useEffect(() => { if (selected && canvas.current && options.width >= 5 && options.height >= 5 && options.width <= 250 && options.height <= 350) paintPhoto(canvas.current, selected, options.width, options.height, { width: 400, height: Math.min(28000, Math.max(1, Math.round(400 * options.height / options.width))) }); }, [selected, options.width, options.height]);
  const savePhotos = (next) => { photoRef.current = next; setPhotos(next); setResult(null); };
  const changeOptions = (update) => { setOptions((previous) => ({ ...previous, ...update })); setResult(null); };
  const update = (patch) => savePhotos(photos.map((photo) => photo.id === selected.id ? { ...photo, ...patch } : photo));
  const add = async (files) => {
    if (busy) return;
    setBusy(true); setError('');
    const incoming = [];
    try {
      if (photos.length + files.length > 30) throw new Error('Choose up to 30 photographs at a time.');
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('Choose image files only.');
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        incoming.push({ id: generateId(), bitmap, url: URL.createObjectURL(file), name: file.name, zoom: 1, x: 50, y: 50, copies: 4 });
      }
      if (!mounted.current) throw new Error('Tool closed.');
      savePhotos([...photos, ...incoming]); setSelectedId((previous) => previous || incoming[0]?.id);
    } catch (error) { incoming.forEach((photo) => { photo.bitmap.close(); URL.revokeObjectURL(photo.url); }); if (mounted.current) setError(error.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const remove = () => { selected.bitmap.close(); URL.revokeObjectURL(selected.url); savePhotos(photos.filter((photo) => photo.id !== selected.id)); setSelectedId(null); };
  const choosePreset = (value) => { setPreset(value); if (value === '35x45') changeOptions({ width: 35, height: 45 }); else if (value === '2x2') changeOptions({ width: 50.8, height: 50.8 }); };
  let layout, layoutError;
  try { if (photos.length) layout = passportLayout(options, photos); } catch (error) { layoutError = error.message; }
  const crop = selected && options.width > 0 && options.height > 0 ? photoCrop(selected.bitmap.width, selected.bitmap.height, options.width / options.height, selected.zoom, selected.x, selected.y) : null;
  const lowResolution = crop && (crop.width < options.width / 25.4 * 300 || crop.height < options.height / 25.4 * 300);
  const generate = async () => {
    setBusy(true); setError('');
    try { setResult(await buildPassportSheet(options, photos, setStatus)); setStatus(''); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  const move = (event) => {
    if (!drag.current || !selected || !crop) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const freeX = selected.bitmap.width - crop.width, freeY = selected.bitmap.height - crop.height;
    const nextX = freeX > 0 ? drag.current.x - (event.clientX - drag.current.pointerX) / rect.width * crop.width / freeX * 100 : 50;
    const nextY = freeY > 0 ? drag.current.y - (event.clientY - drag.current.pointerY) / rect.height * crop.height / freeY * 100 : 50;
    update({ x: Math.max(0, Math.min(100, nextX)), y: Math.max(0, Math.min(100, nextY)) });
  };
  return <ToolPage toolId="photo-to-passport"><div className="tool-panel"><fieldset className="document-fieldset" disabled={busy}><DropZone accept={['image/*']} multiple onFiles={add}><Camera size={30} /><div className="drop-zone-title">Choose one or more photographs</div><p>JPG, PNG, WebP and other browser-supported images</p></DropZone><div className="passport-photo-list">{photos.map((photo) => <button type="button" aria-pressed={selected?.id === photo.id} key={photo.id} onClick={() => setSelectedId(photo.id)}><img src={photo.url} alt="" /><span>{photo.name}</span></button>)}</div>{selected && <div className="passport-workspace"><div><div className="passport-crop" style={{ aspectRatio: `${options.width || 1} / ${options.height || 1}` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerX: event.clientX, pointerY: event.clientY, x: selected.x, y: selected.y }; }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><canvas ref={canvas} /></div><p className="document-hint">Drag to reposition. Zoom to crop closer. These controls apply to the selected photo.</p><label className="form-group">Zoom · {selected.zoom.toFixed(2)}×<input aria-label="Photo zoom" type="range" min="1" max="4" step=".01" value={selected.zoom} onChange={(e) => update({ zoom: Number(e.target.value) })} /></label><label className="form-group">Horizontal position<input aria-label="Horizontal position" type="range" min="0" max="100" value={selected.x} onChange={(e) => update({ x: Number(e.target.value) })} /></label><label className="form-group">Vertical position<input aria-label="Vertical position" type="range" min="0" max="100" value={selected.y} onChange={(e) => update({ y: Number(e.target.value) })} /></label><label className="form-group">Copies of selected photo<input className="form-input" type="number" min="1" max="100" value={selected.copies} onChange={(e) => update({ copies: Number(e.target.value) })} /></label><div className="document-actions"><button type="button" className="btn btn-secondary" onClick={() => update({ zoom: 1, x: 50, y: 50 })}>Reset crop</button><button className="btn btn-secondary" onClick={remove}><Trash2 size={16} /> Remove photo</button></div>{crop && <p className="document-hint">Print detail: {Math.floor(Math.min(crop.width / (options.width / 25.4), crop.height / (options.height / 25.4)))} DPI ? 300 DPI recommended.</p>}{lowResolution && <p className="document-warnings">This crop has less than 300 DPI of source detail. A higher-resolution original will print more sharply.</p>}</div><div><label className="form-group">Photo size<select className="form-select" value={preset} onChange={(e) => choosePreset(e.target.value)}><option value="35x45">35 × 45 mm</option><option value="2x2">2 × 2 inches (50.8 × 50.8 mm)</option><option value="custom">Custom dimensions</option></select></label><div className="document-options"><label className="form-group">Width (mm)<input className="form-input" type="number" min="5" max="250" step=".1" disabled={preset !== 'custom'} value={options.width || ''} onChange={(e) => changeOptions({ width: Number(e.target.value) })} /></label><label className="form-group">Height (mm)<input className="form-input" type="number" min="5" max="350" step=".1" disabled={preset !== 'custom'} value={options.height || ''} onChange={(e) => changeOptions({ height: Number(e.target.value) })} /></label></div><label className="form-group">Paper<select aria-label="Paper" className="form-select" value={options.paper} onChange={(e) => changeOptions({ paper: e.target.value })}><option>A4</option><option>Letter</option><option value="4x6">4 ? 6 inch photo paper</option></select></label><label className="form-group">Paper orientation<select aria-label="Paper orientation" className="form-select" value={options.orientation} onChange={(e) => changeOptions({ orientation: e.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label className="form-group">Margins (mm)<input className="form-input" type="number" min="0" max="100" step=".5" value={options.margin} onChange={(e) => changeOptions({ margin: Number(e.target.value) })} /></label><label className="form-group">Spacing (mm)<input className="form-input" type="number" min="0" max="50" step=".5" value={options.spacing} onChange={(e) => changeOptions({ spacing: Number(e.target.value) })} /></label><label className="document-check"><input type="checkbox" checked={options.centered} onChange={(e) => changeOptions({ centered: e.target.checked })} /> Center photos on each sheet</label><label className="document-check"><input type="checkbox" checked={options.guides} onChange={(e) => changeOptions({ guides: e.target.checked })} /> Add cut guides</label>{layout && <><button type="button" className="btn btn-secondary" disabled={fillPhotoCopies(layout, photos, photos.indexOf(selected)) <= selected.copies} onClick={() => update({ copies: fillPhotoCopies(layout, photos, photos.indexOf(selected)) })}>Fill remaining sheet with selected photo</button><p className="document-status">{layout.placements.length} copies across {layout.pageCount} sheet(s). {layout.columns} columns × {layout.rows} rows per sheet. Capacity: {layout.capacity} photos.</p><PassportSheetPreview layout={layout} photos={photos} guides={options.guides} spacing={options.spacing} /></>}{layoutError && <p role="alert" className="document-error">{layoutError}</p>}<p className="document-hint">Print at <strong>100% / Actual size</strong> with the matching paper size. Turn off “Fit to page”. Use your issuing authority’s requirements for background, face size and composition.</p><button className="btn btn-primary" disabled={!layout || busy} onClick={generate}>Generate print-ready PDF</button></div></div>}</fieldset>{busy && <p role="status" className="document-status">{status || 'Loading photographs…'}</p>}{error && <p role="alert" className="document-error">{error}</p>}</div>{result && <div className="tool-panel"><div className="document-actions"><h2>Print preview</h2><button className="btn btn-primary" onClick={() => downloadBlob(result.blob, 'passport-photo-sheet.pdf')}><Download size={16} /> Download passport sheet</button></div>{previewUrl && <iframe className="document-pdf-preview" title="Passport sheet PDF preview" src={previewUrl} />}</div>}</ToolPage>;
}
