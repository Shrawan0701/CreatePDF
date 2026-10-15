import { useState } from 'react';
import { Lock, Unlock, Eye, Zap, Fingerprint, Trash2, AlertTriangle } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, FormGroup, downloadBlob } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { findTextMatches, getPdfLib, getPdfjsLib, loadPdfBytes, extractText, rasterizePdfWithRedactions, renderPageToCanvas } from '../../services/pdfEngine';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';

// ===== ENCRYPT PDF =====
export function EncryptPdf() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleEncrypt = async () => {
    if (!files[0]) return;
    if (!password) { showToast('Enter a password', 'warning'); return; }
    if (password !== confirm) { showToast('Passwords do not match', 'warning'); return; }
    await run(async (setProgress) => {
      setProgress(20);
      const bytes = await loadPdfBytes(files[0]);
      const out = await encryptPDF(bytes, password, { ownerPassword: password, allowPrinting: true, allowFillingForms: true, allowModifying: false, allowCopying: false });
      setProgress(80);
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `protected-${files[0].name}`);
      showToast('PDF protected with standard 128-bit PDF encryption.', 'success');
    });
  };

  return (
    <ToolPage toolId="encrypt-pdf">
      <div style={{ padding: '12px 16px', background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 8, marginBottom: 16, fontSize: 'var(--font-size-sm)' }}><strong>Compatibility:</strong> Uses standard RC4 128-bit PDF encryption for broad reader support. Processing is local.</div>
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><Lock size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to protect</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <FormGroup label="Password"><input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" /></FormGroup>
        <FormGroup label="Confirm password"><input className="form-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" /></FormGroup>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Processing…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleEncrypt} disabled={!files[0] || processing}><Lock size={18} /> Protect PDF</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== REMOVE PASSWORD =====
export function RemovePassword({ toolId = 'remove-password' }) {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [password, setPassword] = useState('');

  const handleRemove = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const bytes = await loadPdfBytes(files[0]);
      try {
        const pdfjs = await getPdfjsLib();
        const source = await pdfjs.getDocument({ data: bytes, password }).promise;
        const { PDFDocument } = await getPdfLib();
        const output = await PDFDocument.create();
        for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) {
          const canvas = await renderPageToCanvas(source, pageNumber, 1.7);
          const png = await output.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer());
          const page = output.addPage([canvas.width / 1.7, canvas.height / 1.7]);
          page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
          setProgress(pageNumber / source.numPages * 90);
        }
        const out = await output.save();
        downloadBlob(new Blob([out], { type: 'application/pdf' }), `unlocked-${files[0].name}`);
        showToast('Password removed by rebuilding decrypted pages.', 'success');
      } catch (e) {
        throw new Error('Incorrect password or PDF uses unsupported encryption. ' + e.message);
      }
    });
  };

  return (
    <ToolPage toolId={toolId}>
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><Unlock size={28} /></div>
          <div className="drop-zone-title">Drop a password-protected PDF</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <FormGroup label="Current password">
          <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter PDF password" />
        </FormGroup>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Removing password…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleRemove} disabled={!files[0] || processing}><Unlock size={18} /> Remove Password</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

export function UnlockPdf() {
  return <RemovePassword toolId="unlock-pdf" />;
}

// ===== PRIVACY SCANNER =====
export function PrivacyScanner() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [report, setReport] = useState(null);

  const handleScan = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const pdfjsLib = await getPdfjsLib();
      const bytes = await loadPdfBytes(files[0]);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const [meta, attachments, actions, fields, openAction] = await Promise.all([
        pdf.getMetadata(), pdf.getAttachments(), pdf.getJSActions(), pdf.getFieldObjects(), pdf.getOpenAction(),
      ]);
      setProgress(25);
      const text = await extractText(files[0], null);
      const links = new Set();
      let annotationCount = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        for (const annotation of await page.getAnnotations()) {
          annotationCount += 1;
          if (annotation.url || annotation.unsafeUrl) links.add(annotation.url || annotation.unsafeUrl);
        }
        setProgress(25 + Math.round(pageNumber / pdf.numPages * 60));
      }

      const emailRegex = /[\w.-]+@[\w.-]+\.\w{2,}/g;
      const phoneRegex = /(\+?\d[\d\s\-().]{7,}\d)/g;
      const emails = [...new Set((text.match(emailRegex) || []))].slice(0, 20);
      const phones = [...new Set((text.match(phoneRegex) || []).map((s) => s.trim()).filter((s) => s.length <= 20))].slice(0, 20);

      const risks = [];
      if (meta.info?.Author) risks.push({ level: 'medium', label: 'Author name in metadata', value: meta.info.Author });
      if (meta.info?.Creator) risks.push({ level: 'low', label: 'Creator software in metadata', value: meta.info.Creator });
      if (meta.metadata) risks.push({ level: 'low', label: 'Embedded XMP metadata', value: 'Additional metadata may contain personal information.' });
      if (emails.length) risks.push({ level: 'high', label: `${emails.length} email address${emails.length > 1 ? 'es' : ''} found`, value: emails.slice(0, 5).join(', ') });
      if (phones.length) risks.push({ level: 'medium', label: `${phones.length} possible phone number${phones.length > 1 ? 's' : ''} found`, value: phones.slice(0, 5).join(', ') });
      if (attachments?.size) risks.push({ level: 'high', label: `${attachments.size} embedded attachment${attachments.size === 1 ? '' : 's'}`, value: [...attachments.keys()].slice(0, 5).join(', ') });
      if (actions?.size) risks.push({ level: 'high', label: 'Embedded JavaScript actions', value: `${actions.size} action group${actions.size === 1 ? '' : 's'}` });
      if (openAction?.size) risks.push({ level: 'medium', label: 'Document open action', value: 'The PDF may trigger an action when opened.' });
      if (fields?.size) risks.push({ level: 'medium', label: `${fields.size} form field${fields.size === 1 ? '' : 's'}`, value: 'Fields may retain entered values.' });
      if (links.size) risks.push({ level: 'medium', label: `${links.size} external link${links.size === 1 ? '' : 's'}`, value: [...links].slice(0, 5).join(', ') });

      setReport({ meta: meta.info, risks, numPages: pdf.numPages, textLength: text.length, annotationCount });
      setProgress(100);
      showToast('Scan complete!', 'success');
    });
  };

  const levelColor = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--success)' };

  return (
    <ToolPage toolId="privacy-scanner">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><Eye size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to scan for privacy risks</div>
          <div className="drop-zone-sub">File stays on your device — no uploads</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => { reset(); setReport(null); }} /></div>}
      </div>

      {report && (
        <div className="tool-panel">
          <div className="tool-panel-title"><Eye size={16} /> Privacy Risk Report</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Pages', value: report.numPages },
              { label: 'Text chars', value: report.textLength.toLocaleString() },
              { label: 'Annotations', value: report.annotationCount },
              { label: 'Risks found', value: report.risks.length },
            ].map((s) => (
              <div key={s.label} style={{ background: 'var(--bg-surface-2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
          {report.risks.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--success)', padding: '20px', fontWeight: 600 }}>No risks detected by these checks. Scanned images and hidden content still require manual review.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {report.risks.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'var(--bg-surface-2)', borderRadius: 8, borderLeft: `3px solid ${levelColor[r.level]}` }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: levelColor[r.level] }}>{r.level.toUpperCase()}</div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', marginTop: 2 }}>{r.label}</div>
                    {r.value && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{r.value}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {report.meta && Object.keys(report.meta).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 'var(--font-size-sm)' }}>Embedded Metadata</div>
              <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
                <tbody>
                  {Object.entries(report.meta).filter(([, v]) => v).map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)', width: 140 }}>{k}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Scanning…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleScan} disabled={!files[0] || processing}><Zap size={18} /> Scan PDF</button>
        {files[0] && <button className="btn btn-secondary" onClick={() => { reset(); setReport(null); }}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== FINGERPRINT GENERATOR =====
export function FingerprintGenerator() {
  const [file, setFile] = useState(null);
  const [hashes, setHashes] = useState(null);
  const [processing, setProcessing] = useState(false);
  const { showToast } = useApp();

  const handleFile = async (files) => {
    const f = files[0];
    if (!f) return;
    setFile(f); setHashes(null); setProcessing(true);
    try {
      const buf = await f.arrayBuffer();
      const sha256 = await crypto.subtle.digest('SHA-256', buf);
      const sha1 = await crypto.subtle.digest('SHA-1', buf);
      const toHex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
      setHashes({ sha256: toHex(sha256), sha1: toHex(sha1), size: f.size, name: f.name });
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
    setProcessing(false);
  };

  const copy = (text) => navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success'));

  return (
    <ToolPage toolId="fingerprint">
      <div className="tool-panel">
        <DropZone onFiles={handleFile} accept={['*/*']} multiple={false}>
          <div className="drop-zone-icon"><Fingerprint size={28} /></div>
          <div className="drop-zone-title">Drop any file to generate hash</div>
          <div className="drop-zone-sub">SHA-256 and SHA-1 computed locally</div>
        </DropZone>
        {file && !hashes && processing && <div style={{ marginTop: 12, textAlign: 'center', color: 'var(--text-muted)' }}>Computing hash…</div>}
      </div>
      {hashes && (
        <div className="tool-panel">
          <div className="tool-panel-title">File Fingerprints</div>
          <div style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            <strong>{hashes.name}</strong> ({(hashes.size / 1024).toFixed(1)} KB)
          </div>
          {[['SHA-256', hashes.sha256], ['SHA-1', hashes.sha1]].map(([algo, hash]) => (
            <div key={algo} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{algo}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <code style={{ flex: 1, background: 'var(--bg-input)', padding: '8px 12px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{hash}</code>
                <button className="btn btn-sm btn-secondary" onClick={() => copy(hash)}>Copy</button>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 6 }} />
            A hash verifies file integrity but does not prove document authenticity by itself.
          </div>
        </div>
      )}
    </ToolPage>
  );
}

// ===== AUTO-REDACT PII =====
export function AutoRedact() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [found, setFound] = useState([]);
  const [scanned, setScanned] = useState(false);

  const handleScan = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const matches = await findTextMatches(files[0], [
        { type: 'Email', pattern: /[\w.-]+@[\w.-]+\.\w{2,}/gi },
        { type: 'Phone', pattern: /\+?\d[\d\s\-().]{7,}\d/g },
        { type: 'PAN', pattern: /[A-Z]{5}[0-9]{4}[A-Z]/g },
      ], setProgress);
      setFound(matches);
      setScanned(true);
    });
  };

  const handleRedact = async () => {
    if (!files[0] || !found.some((item) => item.selected)) return;
    await run(async (setProgress) => {
      const blob = await rasterizePdfWithRedactions(files[0], found, setProgress);
      downloadBlob(blob, `redacted-${files[0].name}`);
      showToast('Permanently redacted PDF downloaded.', 'success');
    });
  };

  return (
    <ToolPage toolId="auto-redact">
      <div style={{ padding: '10px 16px', background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 8, marginBottom: 16, fontSize: 'var(--font-size-sm)', color: 'var(--danger)' }}>
        <strong>Important:</strong> Pattern matching can miss personal information. Review every match. Exported pages are rasterized after masking so selected text is not retained in the output content stream.
      </div>
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><Eye size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to scan for PII</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => { reset(); setFound([]); setScanned(false); }} /></div>}
      </div>
      {scanned && (
        <div className="tool-panel">
          {found.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--success)', padding: 20, fontWeight: 600 }}>No PII patterns detected.</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>{found.length} patterns found — select to redact:</div>
              {found.map((item, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', background: 'var(--bg-surface-2)', borderRadius: 6, marginBottom: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={item.selected} onChange={() => setFound((prev) => prev.map((f, j) => j === i ? { ...f, selected: !f.selected } : f))} />
                  <span className="badge badge-warning">{item.type}</span>
                  <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{item.value}</code>
                </label>
              ))}
            </>
          )}
        </div>
      )}
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Scanning…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleScan} disabled={!files[0] || processing}><Eye size={18} /> Scan for PII</button>
        {scanned && found.some((f) => f.selected) && (
          <button className="btn btn-danger btn-lg" onClick={handleRedact} disabled={processing}><Trash2 size={18} /> Redact Selected</button>
        )}
        {files[0] && <button className="btn btn-secondary" onClick={() => { reset(); setFound([]); setScanned(false); }}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}
