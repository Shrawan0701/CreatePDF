import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle, Download, Plus, Trash2, X } from 'lucide-react';
import { ToolPage } from './ToolPage';
import { DropZone, FileItem, ProgressBar, downloadBlob, formatBytes } from './ui';
import { useApp } from '../context/AppContext';
import { createPdfArchive, pdfZipDownloadName, planPdfArchive } from '../services/pdfZip';
import './PdfZipWorkspace.css';

export function PdfZipWorkspace() {
  const { showToast } = useApp();
  const nameId = useId();
  const [files, setFiles] = useState([]);
  const [archiveName, setArchiveName] = useState('pdf-documents');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const operation = useRef(null);
  const cached = useRef(null);
  const entries = useMemo(() => planPdfArchive(files), [files]);
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const countLabel = `${files.length} ${files.length === 1 ? 'PDF' : 'PDFs'}`;

  useEffect(() => () => { operation.current?.abort(); }, []);

  const invalidate = () => {
    cached.current = null;
    setResult(null);
    setError('');
    setProgress(0);
  };

  const addFiles = incoming => {
    if (operation.current || !incoming.length) return;
    const accepted = incoming.filter(file => file.size > 0 && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
    const rejected = incoming.length - accepted.length;
    invalidate();
    if (accepted.length) setFiles(previous => [...previous, ...accepted]);
    if (rejected) setError(`${rejected} ${rejected === 1 ? 'file was' : 'files were'} skipped. Choose non-empty PDF files.`);
  };

  const removeFile = index => {
    if (operation.current) return;
    invalidate();
    setFiles(previous => previous.filter((_, position) => position !== index));
  };

  const clearFiles = () => {
    if (operation.current) return;
    invalidate();
    setFiles([]);
  };

  const cancel = () => {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setProgress(0);
  };

  const download = async () => {
    if (!entries.length || operation.current) return;
    const filename = pdfZipDownloadName(archiveName);
    if (cached.current?.entries === entries) {
      downloadBlob(cached.current.blob, filename);
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const blob = await createPdfArchive(entries, {
        signal: controller.signal,
        onProgress: value => { if (operation.current === controller) setProgress(value); },
      });
      if (controller.signal.aborted || operation.current !== controller) return;
      cached.current = { blob, entries };
      setResult({ size: blob.size });
      downloadBlob(blob, filename);
      showToast(`${countLabel} packaged in ZIP.`, 'success');
    } catch (failure) {
      if (operation.current === controller && failure.name !== 'AbortError') setError(failure.message || 'Could not create the ZIP. Try a smaller batch.');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  };

  return <ToolPage toolId="pdf-to-zip">
    <div className="pdf-zip-workspace tool-panel" aria-busy={busy}>
      <fieldset className="pdf-zip-picker" disabled={busy}>
        <DropZone onFiles={addFiles} accept={['application/pdf', '.pdf']} multiple className={files.length ? 'pdf-zip-drop compact' : 'pdf-zip-drop'}>
          <span className="pdf-zip-drop-icon">{files.length ? <Plus size={23} /> : <Archive size={28} />}</span>
          <div><div className="drop-zone-title">{files.length ? 'Add more PDFs' : 'Choose PDFs to ZIP'}</div>
            <div className="drop-zone-sub">{files.length ? 'Drop files here or click to browse' : 'Select multiple files or drop them here'}</div></div>
        </DropZone>
      </fieldset>

      {files.length > 0 && <section className="pdf-zip-files" aria-label="PDFs in archive">
        <div className="pdf-zip-list-header"><strong>{countLabel}</strong><span>{formatBytes(totalSize)}</span>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={clearFiles}><Trash2 size={14} /> Clear all</button></div>
        <div className="pdf-zip-file-list">{entries.map(({ file, name }, index) => <FileItem
          key={`${index}-${name}`} file={file} onRemove={busy ? undefined : () => removeFile(index)}
          meta={name !== file.name ? `In ZIP: ${name}` : undefined}
        />)}</div>
      </section>}

      <div className="pdf-zip-actions">
        <div className="form-group"><label className="form-label" htmlFor={nameId}>ZIP filename</label><div className="pdf-zip-name"><input id={nameId} className="form-input" autoComplete="off" value={archiveName} disabled={busy} placeholder="pdf-documents" onChange={event => setArchiveName(event.target.value)} onBlur={() => setArchiveName(pdfZipDownloadName(archiveName).slice(0, -4))} /><span>.zip</span></div></div>
        <button className="btn btn-primary btn-lg" disabled={!files.length || busy} onClick={download}><Download size={18} />{busy ? 'Creating ZIP…' : 'Download ZIP'}</button>
      </div>
      {busy && <div className="pdf-zip-progress"><ProgressBar value={progress} label="Creating ZIP…" /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
      {error && <p className="pdf-zip-error" role="alert">{error}</p>}
      {result && <p className="pdf-zip-result" role="status"><CheckCircle size={16} />{countLabel} · ZIP ready · {formatBytes(result.size)}</p>}
      <p className="pdf-zip-note">Original PDFs, including their images and links. Files stay in your browser.</p>
    </div>
  </ToolPage>;
}
