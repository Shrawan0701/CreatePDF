import { useState } from 'react';
import { FileImage, Trash2, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { DropZone, FormGroup, ProgressBar, downloadBlob } from '../../components/ui';
import { imagesToPdf } from '../../services/pdfEngine';
import { useApp } from '../../context/AppContext';

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  A3: [841.89, 1190.55],
  Legal: [612, 1008],
};

export default function ImagesToPdf() {
  const [images, setImages] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [pageSize, setPageSize] = useState('A4');
  const [orientation, setOrientation] = useState('portrait');
  const [margin, setMargin] = useState(20);
  const { showToast } = useApp();

  const handleFiles = (files) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const withPrev = imageFiles.map((f) => ({
      file: f,
      id: Date.now() + Math.random(),
      preview: URL.createObjectURL(f),
    }));
    setImages((prev) => [...prev, ...withPrev]);
  };

  const move = (idx, dir) => {
    setImages((prev) => {
      const arr = [...prev];
      const to = idx + dir;
      if (to < 0 || to >= arr.length) return arr;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      return arr;
    });
  };

  const remove = (id) => setImages((prev) => prev.filter((img) => img.id !== id));

  const handleConvert = async () => {
    if (!images.length) return;
    setProcessing(true); setError(null); setProgress(0);
    try {
      let size = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
      if (orientation === 'landscape') size = [size[1], size[0]];
      setProgress(30);
      const blob = await imagesToPdf(images.map((i) => i.file), { pageSize: size, margin: parseInt(margin) });
      setProgress(90);
      downloadBlob(blob, 'images.pdf');
      setProgress(100);
      showToast('PDF created successfully!', 'success');
    } catch (e) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ToolPage toolId="images-to-pdf">
      <div className="tool-panel">
        <DropZone onFiles={handleFiles} accept={['image/*']} multiple>
          <div className="drop-zone-icon"><FileImage size={28} /></div>
          <div className="drop-zone-title">Drop images here</div>
          <div className="drop-zone-sub">JPG, PNG, GIF, WebP and more</div>
        </DropZone>

        {images.length > 0 && (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10 }}>
            {images.map((img, i) => (
              <div key={img.id} style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-surface-2)' }}>
                <img src={img.preview} alt="" style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '4px', background: 'var(--bg-surface-2)' }}>
                  <button className="btn btn-sm btn-secondary btn-icon" style={{ padding: '3px 6px' }} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={12} /></button>
                  <button className="btn btn-sm btn-danger btn-icon" style={{ padding: '3px 6px' }} onClick={() => remove(img.id)}><Trash2 size={12} /></button>
                  <button className="btn btn-sm btn-secondary btn-icon" style={{ padding: '3px 6px' }} onClick={() => move(i, 1)} disabled={i === images.length - 1}><ArrowDown size={12} /></button>
                </div>
                <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', padding: '2px 0 4px' }}>p.{i + 1}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="tool-panel">
          <div className="tool-panel-title">Page Settings</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
            <FormGroup label="Page Size">
              <select className="form-select" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                {Object.keys(PAGE_SIZES).map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Orientation">
              <select className="form-select" value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </FormGroup>
            <FormGroup label="Margin (pt)">
              <input className="form-input" type="number" min={0} max={100} value={margin} onChange={(e) => setMargin(e.target.value)} />
            </FormGroup>
          </div>
        </div>
      )}

      {error && <div style={{ color: 'var(--danger)', padding: '10px 14px', background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Creating PDF…" />}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleConvert} disabled={!images.length || processing}>
          <Download size={18} /> {processing ? 'Creating…' : `Convert ${images.length} Image${images.length !== 1 ? 's' : ''} to PDF`}
        </button>
        {images.length > 0 && <button className="btn btn-secondary" onClick={() => setImages([])}><Trash2 size={16} /> Clear</button>}
      </div>
    </ToolPage>
  );
}
