import { useState } from 'react';
import { Minimize2, FileText, Trash2 } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, downloadBlob } from '../../components/ui';
import { compressPdf, formatFileSize } from '../../services/pdfEngine';
import { useApp } from '../../context/AppContext';

export default function CompressPdf() {
  const { files, addFiles, reset, processing, progress, error, done, run } = useToolState();
  const { showToast } = useApp();
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [mode, setMode] = useState('balanced');

  const handleFileAdd = (newFiles) => {
    const pdfs = newFiles.filter((f) => f.type === 'application/pdf').slice(0, 1);
    if (pdfs.length) { addFiles(pdfs); setOriginalSize(pdfs[0].size); }
  };

  const handleCompress = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      setProgress(30);
      const blob = await compressPdf(files[0], { mode, onProgress: setProgress });
      setCompressedSize(blob.size);
      setProgress(90);
      downloadBlob(blob, `compressed-${files[0].name}`);
      setProgress(100);
      const saved = originalSize - blob.size;
      const pct = ((saved / originalSize) * 100).toFixed(1);
      showToast(`Compressed! Saved ${formatFileSize(saved)} (${pct}%)`, 'success');
    });
  };

  const savings = originalSize && compressedSize
    ? ((1 - compressedSize / originalSize) * 100).toFixed(1)
    : null;

  return (
    <ToolPage toolId="compress-pdf">
      <div className="tool-panel">
        <DropZone onFiles={handleFileAdd} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to compress</div>
          <div className="drop-zone-sub">or click to browse</div>
        </DropZone>
        {files[0] && (
          <div style={{ marginTop: 12 }}>
            <FileItem file={files[0]} onRemove={() => { reset(); setOriginalSize(0); setCompressedSize(0); }} />
          </div>
        )}
      </div>

      <div className="tool-panel">
        <label className="form-label" htmlFor="compression-mode">Compression mode</label>
        <select id="compression-mode" className="form-select" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="lossless">Lossless — preserve selectable text</option>
          <option value="balanced">Balanced — rasterize only when output is smaller</option>
          <option value="strong">Strong — lower-resolution raster fallback</option>
        </select>
      </div>

      {savings !== null && done && (
        <div style={{ padding: '16px', background: 'var(--success-light)', border: '1px solid var(--success)', borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>Compression Complete</div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', display: 'flex', gap: 20 }}>
            <span>Original: <strong>{formatFileSize(originalSize)}</strong></span>
            <span>Compressed: <strong>{formatFileSize(compressedSize)}</strong></span>
            <span>Saved: <strong>{savings}%</strong></span>
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', padding: '10px 14px', background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>{error}</div>
      )}

      {processing && <ProgressBar value={progress} label="Compressing…" />}

      <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-surface-2)', borderRadius: 8, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
        <strong>Note:</strong> Balanced and Strong modes may rasterize pages, removing selectable text, links, forms and accessibility structure. The smaller of the optimized and rasterized outputs is downloaded.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleCompress} disabled={!files[0] || processing}>
          <Minimize2 size={18} /> {processing ? 'Compressing…' : 'Compress PDF'}
        </button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}
