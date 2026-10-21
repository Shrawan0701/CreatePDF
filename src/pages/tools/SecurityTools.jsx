import { useRef, useState } from 'react';
import { Lock, Unlock, Trash2 } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, FormGroup, downloadBlob } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { getPdfLib, getPdfjsLib, loadPdfBytes, renderPageToCanvas } from '../../services/pdfEngine';
import { encodePasswordLegacy, encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import { AutoRedactWorkspace } from '../../components/AutoRedactWorkspace';
import { PrivacyScannerWorkspace } from '../../components/PrivacyScannerWorkspace';
import { FingerprintWorkspace } from '../../components/FingerprintWorkspace';

// ===== ENCRYPT PDF =====
export function EncryptPdf() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [password, setPassword] = useState('');
  const encrypting = useRef(false);

  const choosePdf = (selected) => {
    if (encrypting.current) return;
    const file = selected[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { showToast('Choose a PDF file.', 'warning'); return; }
    if (!file.size) { showToast('This PDF is empty. Choose another file.', 'warning'); return; }
    // This tool processes one PDF: a new upload must replace the previous one.
    reset();
    addFiles([file]);
  };
  const resetEncrypt = () => {
    if (encrypting.current) return;
    reset();
    setPassword('');
  };

  const handleEncrypt = async () => {
    if (!files[0] || processing || encrypting.current) return;
    if (!password) { showToast('Enter a password', 'warning'); return; }
    try {
      if (encodePasswordLegacy(password).length > 32) { showToast('Use a password of up to 32 characters.', 'warning'); return; }
    } catch {
      showToast('This password contains characters the PDF encryption format does not support.', 'warning');
      return;
    }
    encrypting.current = true;
    try {
      await run(async (setProgress) => {
        setProgress(20);
        const bytes = await loadPdfBytes(files[0]);
        const out = await encryptPDF(bytes, password, { ownerPassword: password, allowPrinting: true, allowFillingForms: true, allowModifying: false, allowCopying: false });
        setProgress(95);
        downloadBlob(new Blob([out], { type: 'application/pdf' }), `protected-${files[0].name}`);
        showToast('PDF protected with standard 128-bit PDF encryption.', 'success');
      });
    } finally {
      encrypting.current = false;
    }
  };

  return (
    <ToolPage toolId="encrypt-pdf">
      <div style={{ padding: '12px 16px', background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 8, marginBottom: 16, fontSize: 'var(--font-size-sm)' }}><strong>Compatibility:</strong> Uses standard RC4 128-bit PDF encryption for broad reader support. Processing is local.</div>
      <div className="tool-panel">
        <DropZone onFiles={choosePdf} accept={['application/pdf', '.pdf']}>
          <div className="drop-zone-icon"><Lock size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to protect</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={processing ? undefined : resetEncrypt} /></div>}
      </div>
      <div className="tool-panel">
        <FormGroup label="Password"><input className="form-input" type="password" name="pdf-protection-password" autoComplete="new-password" disabled={processing} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" /></FormGroup>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Processing…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleEncrypt} disabled={!files[0] || !password || processing}><Lock size={18} /> Protect PDF</button>
        {files[0] && <button className="btn btn-secondary" onClick={resetEncrypt} disabled={processing}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== REMOVE PASSWORD =====
export function RemovePassword({ toolId = 'remove-password' }) {
  const isUnlock = toolId === 'unlock-pdf';
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [password, setPassword] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const removing = useRef(false);

  const resetRemove = () => {
    if (removing.current) return;
    reset();
    setPassword('');
    setPasswordFocused(false);
  };

  const choosePdf = (selected) => {
    if (removing.current) return;
    const file = selected[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { showToast('Choose a PDF file.', 'warning'); return; }
    if (!file.size) { showToast('This PDF is empty. Choose another file.', 'warning'); return; }
    resetRemove();
    addFiles([file]);
  };

  const handleRemove = async () => {
    if (!files[0] || processing || removing.current) return;
    removing.current = true;
    try {
      await run(async (setProgress) => {
        const bytes = await loadPdfBytes(files[0]);
        let loadingTask;
        try {
          const pdfjs = await getPdfjsLib();
          loadingTask = pdfjs.getDocument({ data: bytes, password });
          const source = await loadingTask.promise;
          const { PDFDocument } = await getPdfLib();
          const output = await PDFDocument.create();
          for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) {
            const canvas = await renderPageToCanvas(source, pageNumber, 1.7);
            try {
              const png = await output.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer());
              const page = output.addPage([canvas.width / 1.7, canvas.height / 1.7]);
              page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
            } finally {
              canvas.width = canvas.height = 0;
            }
            setProgress(pageNumber / source.numPages * 90);
          }
          const out = await output.save();
          downloadBlob(new Blob([out], { type: 'application/pdf' }), `unlocked-${files[0].name}`);
          showToast(isUnlock ? 'Unlocked copy downloaded.' : 'Password removed by rebuilding decrypted pages.', 'success');
        } catch (e) {
          if (e.name === 'PasswordException') {
            throw new Error(password ? 'Incorrect PDF password. Try again.' : 'Enter the PDF password.');
          }
          throw e;
        } finally {
          if (loadingTask) await loadingTask.destroy().catch(() => {});
        }
      });
    } finally {
      removing.current = false;
    }
  };

  return (
    <ToolPage toolId={toolId}>
      <div className="tool-panel">
        <DropZone onFiles={choosePdf} accept={['application/pdf', '.pdf']}>
          <div className="drop-zone-icon"><Unlock size={28} /></div>
          <div className="drop-zone-title">{isUnlock ? 'Drop a PDF to unlock' : 'Drop a password-protected PDF'}</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={processing ? undefined : resetRemove} /></div>}
      </div>
      <div className="tool-panel">
        <FormGroup label={isUnlock ? 'Opening password (if required)' : 'Current password'}>
          <input
            className="form-input" type="password" name={isUnlock ? 'pdf-unlock-password' : 'pdf-remove-password'}
            autoComplete="new-password" data-lpignore="true" data-1p-ignore="true"
            readOnly={!passwordFocused} onFocus={() => setPasswordFocused(true)}
            disabled={processing} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={isUnlock ? 'Leave blank if the PDF opens without a password' : 'Enter PDF password'}
          />
        </FormGroup>
        {isUnlock && <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Exports page images. Selectable text, links and form fields are not retained.</p>}
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label={isUnlock ? 'Unlocking PDF…' : 'Removing password…'} />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleRemove} disabled={!files[0] || processing}><Unlock size={18} /> {isUnlock ? 'Unlock & Download PDF' : 'Remove Password'}</button>
        {files[0] && <button className="btn btn-secondary" onClick={resetRemove} disabled={processing}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

export function UnlockPdf() {
  return <RemovePassword toolId="unlock-pdf" />;
}

// ===== PRIVACY SCANNER =====
export function PrivacyScanner() {
  return <PrivacyScannerWorkspace />;
}

// ===== FINGERPRINT GENERATOR =====
export function FingerprintGenerator() {
  return <FingerprintWorkspace />;
}

// ===== AUTO-REDACT PII =====
export function AutoRedact() {
  return <AutoRedactWorkspace />;
}
