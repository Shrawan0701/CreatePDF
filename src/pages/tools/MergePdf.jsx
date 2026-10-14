import { Layers, Upload, Trash2, FileText, ArrowDown } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, downloadBlob } from '../../components/ui';
import { mergePdfs } from '../../services/pdfEngine';
import { useApp } from '../../context/AppContext';

export default function MergePdf() {
  const { files, addFiles, removeFile, reset, processing, progress, error, done, run } = useToolState();
  const { showToast } = useApp();

  const handleMerge = async () => {
    if (files.length < 2) {
      showToast('Please add at least 2 PDF files', 'warning');
      return;
    }
    await run(async (setProgress) => {
      const blob = await mergePdfs(files, setProgress);
      downloadBlob(blob, 'merged.pdf');
      showToast('PDFs merged successfully!', 'success');
    });
  };

  return (
    <ToolPage toolId="merge-pdf">
      <div className="tool-panel">
        <div className="tool-panel-title"><Upload size={16} /> Add PDF Files</div>
        <DropZone
          onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf'))}
          accept={['application/pdf']}
          multiple
        >
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop PDF files here</div>
          <div className="drop-zone-sub">or click to browse</div>
          <div className="drop-zone-formats">PDF files only</div>
        </DropZone>

        {files.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="file-list">
              {files.map((f, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {i > 0 && (
                    <div style={{ textAlign: 'center', padding: '4px 0', color: 'var(--text-muted)' }}>
                      <ArrowDown size={14} />
                    </div>
                  )}
                  <FileItem file={f} onRemove={() => removeFile(i)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', padding: '10px 14px', background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>
          {error}
        </div>
      )}

      {processing && <ProgressBar value={progress} label="Merging PDFs…" />}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleMerge}
          disabled={processing || files.length < 2}
        >
          <Layers size={18} />
          {processing ? 'Merging…' : `Merge ${files.length} PDF${files.length !== 1 ? 's' : ''}`}
        </button>
        {files.length > 0 && (
          <button className="btn btn-secondary" onClick={reset}>
            <Trash2 size={16} /> Reset
          </button>
        )}
      </div>

      {done && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--success-light)', border: '1px solid var(--success)', borderRadius: 8, color: 'var(--success)', fontSize: 'var(--font-size-sm)' }}>
          ✓ Merge complete! Your file was downloaded automatically.
        </div>
      )}
    </ToolPage>
  );
}
