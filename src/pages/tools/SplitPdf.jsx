import { useState } from 'react';
import { Scissors, FileText, Trash2 } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, FormGroup, downloadBlob } from '../../components/ui';
import { splitPdfByRanges, getPageCount, parsePageRanges, createZipFromBlobs } from '../../services/pdfEngine';
import { useApp } from '../../context/AppContext';

export default function SplitPdf() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [mode, setMode] = useState('ranges'); // 'ranges' | 'every' | 'individual'
  const [rangeInput, setRangeInput] = useState('');
  const [everyN, setEveryN] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const handleFileAdd = async (newFiles) => {
    const pdfs = newFiles.filter((f) => f.type === 'application/pdf');
    if (pdfs.length) {
      addFiles(pdfs.slice(0, 1));
      const count = await getPageCount(pdfs[0]);
      setTotalPages(count);
    }
  };

  const handleSplit = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const file = files[0];
      let ranges = [];

      if (mode === 'individual') {
        ranges = Array.from({ length: totalPages }, (_, i) => [i + 1]);
      } else if (mode === 'every') {
        for (let i = 1; i <= totalPages; i += everyN) {
          ranges.push(Array.from({ length: Math.min(everyN, totalPages - i + 1) }, (_, j) => i + j));
        }
      } else {
        const parts = rangeInput.split(';').map((s) => s.trim()).filter(Boolean);
        ranges = parts.map((p) => parsePageRanges(p, totalPages));
        if (!ranges.length) throw new Error('Enter valid page ranges separated by semicolons');
      }

      const blobs = await splitPdfByRanges(file, ranges);
      setProgress(80);

      if (blobs.length === 1) {
        downloadBlob(blobs[0], 'split-1.pdf');
      } else {
        const items = blobs.map((b, i) => ({ blob: b, name: `split-${i + 1}.pdf` }));
        const zip = await createZipFromBlobs(items);
        downloadBlob(zip, 'split-pdfs.zip');
      }
      setProgress(100);
      showToast(`Split into ${blobs.length} file${blobs.length > 1 ? 's' : ''}`, 'success');
    });
  };

  return (
    <ToolPage toolId="split-pdf">
      <div className="tool-panel">
        <DropZone onFiles={handleFileAdd} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to split</div>
          <div className="drop-zone-sub">or click to browse</div>
        </DropZone>
        {files[0] && (
          <div style={{ marginTop: 12 }}>
            <FileItem file={files[0]} onRemove={() => { reset(); setTotalPages(0); }} meta={totalPages ? `${totalPages} pages` : ''} />
          </div>
        )}
      </div>

      {files[0] && (
        <div className="tool-panel">
          <div className="tool-panel-title">Split Options</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { key: 'ranges', label: 'Custom Ranges' },
              { key: 'every', label: 'Every N Pages' },
              { key: 'individual', label: 'Individual Pages' },
            ].map((m) => (
              <button
                key={m.key}
                className={`btn ${mode === m.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'ranges' && (
            <FormGroup label="Page ranges (semicolon-separated)" hint="Example: 1-3; 4-6; 7">
              <input
                className="form-input"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder="1-3; 4-6; 7"
              />
            </FormGroup>
          )}

          {mode === 'every' && (
            <FormGroup label={`Split every N pages (total: ${totalPages})`}>
              <input
                className="form-input"
                type="number"
                min={1}
                max={totalPages}
                value={everyN}
                onChange={(e) => setEveryN(parseInt(e.target.value) || 1)}
                style={{ width: 120 }}
              />
            </FormGroup>
          )}

          {mode === 'individual' && (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
              Each page will be saved as a separate PDF and downloaded in a ZIP archive.
            </p>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', padding: '10px 14px', background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>{error}</div>
      )}

      {processing && <ProgressBar value={progress} label="Splitting PDF…" />}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSplit} disabled={!files[0] || processing}>
          <Scissors size={18} /> {processing ? 'Splitting…' : 'Split PDF'}
        </button>
        {files[0] && <button className="btn btn-secondary" onClick={() => { reset(); setTotalPages(0); }}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}
