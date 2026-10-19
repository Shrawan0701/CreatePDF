import { useRef, useState } from 'react';
import { FileText, Trash2, Download, Image } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, FormGroup, downloadBlob } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { pdfToAllJpegs, createZipFromBlobs, loadPdfBytes, extractText } from '../../services/pdfEngine';
import { emptyPdfMetadata, readPdfMetadata, updatePdfMetadata } from '../../services/pdfMetadata';
import { PdfZipWorkspace } from '../../components/PdfZipWorkspace';

// ===== PDF TO JPG =====
export function PdfToJpg() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [scale, setScale] = useState(1.5);
  const [format, setFormat] = useState('jpg');

  const handleConvert = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const items = await pdfToAllJpegs(files[0], scale, setProgress, format);
      if (items.length === 1) {
        downloadBlob(items[0].blob, items[0].name);
      } else {
        const zip = await createZipFromBlobs(items);
        downloadBlob(zip, `${files[0].name.replace('.pdf', '')}-pages.zip`);
      }
      showToast(`Converted ${items.length} page${items.length > 1 ? 's' : ''}!`, 'success');
    });
  };

  return (
    <ToolPage toolId="pdf-to-jpg">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><Image size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to convert</div>
          <div className="drop-zone-sub">Each page exported as JPG or PNG</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <FormGroup label="Resolution scale">
            <select className="form-select" value={scale} onChange={(e) => setScale(+e.target.value)} style={{ width: 160 }}>
              <option value={1}>Screen (72 dpi)</option>
              <option value={1.5}>Medium (108 dpi)</option>
              <option value={2}>High (144 dpi)</option>
              <option value={3}>Very High (216 dpi)</option>
            </select>
          </FormGroup>
          <FormGroup label="Image format"><select className="form-select" value={format} onChange={(event) => setFormat(event.target.value)}><option value="jpeg">JPG</option><option value="png">PNG</option></select></FormGroup>
        </div>
        <div style={{ marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          Multiple pages will be packed in a ZIP archive.
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Rendering pages…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleConvert} disabled={!files[0] || processing}><Download size={18} /> Convert to {format === 'png' ? 'PNG' : 'JPG'}</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== PDF TO ZIP =====
export const PdfToZip = PdfZipWorkspace;

// ===== EXTRACT TEXT =====
export function ExtractText() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [text, setText] = useState('');

  const handleExtract = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const extracted = await extractText(files[0], setProgress);
      setText(extracted);
      showToast('Text extracted!', 'success');
    });
  };

  return (
    <ToolPage toolId="extract-text">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to extract text</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => { reset(); setText(''); }} /></div>}
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Extracting text…" />}
      {text && (
        <div className="tool-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Extracted Text ({text.length.toLocaleString()} chars)</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success'))}>Copy</button>
              <button className="btn btn-sm btn-primary" onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), 'extracted.txt')}><Download size={13} /> Download TXT</button>
            </div>
          </div>
          <textarea className="form-textarea" value={text} readOnly style={{ minHeight: 300, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleExtract} disabled={!files[0] || processing}><FileText size={18} /> Extract Text</button>
        {files[0] && <button className="btn btn-secondary" onClick={() => { reset(); setText(''); }}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== EDIT PDF METADATA =====
export function EditMetadata() {
  const { showToast } = useApp();
  const requestRef = useRef(0);
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(emptyPdfMetadata);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    if (processing) return;
    ++requestRef.current;
    setFile(null); setMeta(emptyPdfMetadata()); setLoaded(false); setLoading(false); setError('');
  };

  const handleFile = async (newFiles) => {
    if (processing) return;
    const source = newFiles.find(item => item.type === 'application/pdf' || /\.pdf$/i.test(item.name));
    if (!source) { setError('Choose a PDF file to edit its metadata.'); return; }
    const request = ++requestRef.current;
    setFile(source); setLoaded(false); setMeta(emptyPdfMetadata()); setLoading(true); setError('');
    try {
      const metadata = await readPdfMetadata(await loadPdfBytes(source));
      if (request !== requestRef.current) return;
      setMeta(metadata); setLoaded(true);
    } catch (error) {
      if (request !== requestRef.current) return;
      const message = /encrypted|password/i.test(error.message) ? 'This PDF is password-protected. Unlock it before editing metadata.' : 'Could not read this PDF. Check that it is a valid, readable PDF file.';
      setError(message); showToast(message, 'error');
    } finally { if (request === requestRef.current) setLoading(false); }
  };

  const handleSave = async () => {
    if (!file || !loaded || loading || processing) return;
    setProcessing(true); setError('');
    try {
      const output = await updatePdfMetadata(await loadPdfBytes(file), meta);
      downloadBlob(output, `metadata-${file.name}`);
      showToast('Metadata saved!', 'success');
    } catch (error) {
      setError(error.message || 'Could not save the PDF metadata.');
      showToast(error.message || 'Could not save the PDF metadata.', 'error');
    } finally { setProcessing(false); }
  };

  return (
    <ToolPage toolId="edit-metadata">
      <div className="tool-panel">
        <DropZone onFiles={handleFile} accept={['application/pdf', '.pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to edit metadata</div>
        </DropZone>
        {file && <div style={{ marginTop: 10 }}><FileItem file={file} onRemove={processing ? undefined : reset} /></div>}
      </div>
      {loaded && (
        <div className="tool-panel">
          <div className="tool-panel-title">Document Properties</div>
          {['title', 'author', 'subject', 'keywords', 'producer'].map((field) => (
            <FormGroup key={field} label={field.charAt(0).toUpperCase() + field.slice(1)}>
              <input className="form-input" disabled={processing} value={meta[field]} onChange={(e) => setMeta((m) => ({ ...m, [field]: e.target.value }))} />
            </FormGroup>
          ))}
        </div>
      )}
      {error && <div role="alert" style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {(loading || processing) && <ProgressBar value={null} label={loading ? 'Reading metadata…' : 'Saving…'} />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={!file || !loaded || loading || processing}><Download size={18} /> Save Metadata</button>
        {file && <button className="btn btn-secondary" disabled={processing} onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}
