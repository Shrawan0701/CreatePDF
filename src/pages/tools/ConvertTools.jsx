import { useState } from 'react';
import { FileText, Trash2, Download, Image, Archive } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, FormGroup, downloadBlob } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { pdfToAllJpegs, createZipFromBlobs, getPdfLib, loadPdfBytes, extractText } from '../../services/pdfEngine';

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
export function PdfToZip() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [scale, setScale] = useState(1.5);

  const handleConvert = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const items = await pdfToAllJpegs(files[0], scale, setProgress);
      const zip = await createZipFromBlobs(items);
      downloadBlob(zip, `${files[0].name.replace('.pdf', '')}-pages.zip`);
      showToast(`Packed ${items.length} pages into ZIP!`, 'success');
    });
  };

  return (
    <ToolPage toolId="pdf-to-zip">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><Archive size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to package as ZIP</div>
          <div className="drop-zone-sub">Each page exported as JPG image in a ZIP archive</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <FormGroup label="Image quality">
          <select className="form-select" value={scale} onChange={(e) => setScale(+e.target.value)} style={{ width: 200 }}>
            <option value={1}>Standard</option>
            <option value={1.5}>High</option>
            <option value={2}>Very High</option>
          </select>
        </FormGroup>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Creating ZIP…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleConvert} disabled={!files[0] || processing}><Download size={18} /> Package as ZIP</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

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
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [meta, setMeta] = useState({ title: '', author: '', subject: '', keywords: '', producer: '' });
  const [loaded, setLoaded] = useState(false);

  const handleFile = async (newFiles) => {
    const pdfs = newFiles.filter((x) => x.type === 'application/pdf').slice(0, 1);
    if (!pdfs.length) return;
    addFiles(pdfs);
      const { getPdfLib, loadPdfBytes } = await import('../../services/pdfEngine');
    const { PDFDocument } = await getPdfLib();
    const bytes = await loadPdfBytes(pdfs[0]);
    const doc = await PDFDocument.load(bytes);
    setMeta({
      title: doc.getTitle() || '',
      author: doc.getAuthor() || '',
      subject: doc.getSubject() || '',
      keywords: (doc.getKeywords() || []).join(', '),
      producer: doc.getProducer() || '',
    });
    setLoaded(true);
  };

  const handleSave = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const { PDFDocument } = await getPdfLib();
      const bytes = await loadPdfBytes(files[0]);
      const doc = await PDFDocument.load(bytes);
      doc.setTitle(meta.title);
      doc.setAuthor(meta.author);
      doc.setSubject(meta.subject);
      doc.setKeywords(meta.keywords.split(',').map((s) => s.trim()));
      doc.setProducer(meta.producer || 'CreatePDF.si');
      setProgress(80);
      const out = await doc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `metadata-${files[0].name}`);
      showToast('Metadata saved!', 'success');
    });
  };

  return (
    <ToolPage toolId="edit-metadata">
      <div className="tool-panel">
        <DropZone onFiles={handleFile} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to edit metadata</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => { reset(); setLoaded(false); setMeta({ title: '', author: '', subject: '', keywords: '', producer: '' }); }} /></div>}
      </div>
      {loaded && (
        <div className="tool-panel">
          <div className="tool-panel-title">Document Properties</div>
          {['title', 'author', 'subject', 'keywords', 'producer'].map((field) => (
            <FormGroup key={field} label={field.charAt(0).toUpperCase() + field.slice(1)}>
              <input className="form-input" value={meta[field]} onChange={(e) => setMeta((m) => ({ ...m, [field]: e.target.value }))} />
            </FormGroup>
          ))}
        </div>
      )}
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Saving…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={!files[0] || !loaded || processing}><Download size={18} /> Save Metadata</button>
        {files[0] && <button className="btn btn-secondary" onClick={() => { reset(); setLoaded(false); }}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}
