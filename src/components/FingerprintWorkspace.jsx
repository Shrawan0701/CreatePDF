import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileText, Fingerprint, Upload, X } from 'lucide-react';
import { ToolPage } from './ToolPage';
import { DropZone, ProgressBar, downloadBlob, formatBytes } from './ui';
import { useApp } from '../context/AppContext';
import { createFileFingerprint, fingerprintReport, parseFingerprint } from '../services/fileFingerprint';
import './FingerprintWorkspace.css';

function HashRow({ label, value, onCopy, copied, primary = false }) {
  return <div className={`fingerprint-hash-row${primary ? ' primary' : ''}`}>
    <div className="fingerprint-hash-heading"><h2>{label}</h2><button className="btn btn-secondary btn-sm" onClick={() => onCopy(label, value)} aria-label={`Copy ${label} checksum`}>{copied === label ? <Check size={14} /> : <Copy size={14} />}{copied === label ? 'Copied' : 'Copy'}</button></div>
    <textarea className="fingerprint-hash-value" aria-label={`${label} checksum`} readOnly spellCheck={false} rows={label === 'SHA-512' ? 4 : 2} value={value} onFocus={event => event.target.select()} />
  </div>;
}

export function FingerprintWorkspace() {
  const { showToast } = useApp();
  const [file, setFile] = useState(null), [hashes, setHashes] = useState(null), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0), [processed, setProcessed] = useState(0), [error, setError] = useState(''), [cancelled, setCancelled] = useState(false);
  const [expected, setExpected] = useState(''), [copied, setCopied] = useState('');
  const input = useRef(null), operation = useRef(null), copyTimer = useRef(null), copyVersion = useRef(0);
  useEffect(() => () => { operation.current?.abort(); operation.current = null; copyVersion.current++; clearTimeout(copyTimer.current); }, []);
  const calculate = async files => {
    if (operation.current) return;
    const selected = files[0];
    if (!selected) return;
    const controller = new AbortController(); operation.current = controller;
    clearTimeout(copyTimer.current); copyVersion.current++;
    setFile(selected); setHashes(null); setError(''); setBusy(true); setProgress(0); setProcessed(0); setCopied(''); setCancelled(false);
    try {
      const result = await createFileFingerprint(selected, { signal: controller.signal, onProgress: (value, bytes) => {
        if (operation.current === controller) { setProgress(value); setProcessed(bytes); }
      } });
      if (operation.current !== controller || controller.signal.aborted) return;
      setHashes(result); setProgress(100);
    } catch (failure) {
      if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not hash this file.');
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  };
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setCancelled(true); };
  const close = () => {
    if (operation.current) return;
    clearTimeout(copyTimer.current); copyVersion.current++; setFile(null); setHashes(null); setError(''); setExpected(''); setCopied(''); setCancelled(false);
  };
  const copy = async (label, text) => {
    const version = ++copyVersion.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (copyVersion.current !== version) return;
      clearTimeout(copyTimer.current); setCopied(label);
      copyTimer.current = setTimeout(() => setCopied(''), 1800);
    } catch { if (copyVersion.current === version) showToast('Copy unavailable. Select the checksum and copy it manually.', 'warning'); }
  };
  const parsed = parseFingerprint(expected);
  const comparison = parsed.status === 'valid' && hashes ? hashes[parsed.algorithm.key] === parsed.hex : null;

  return <ToolPage toolId="fingerprint"><div className="fingerprint-workspace">
    <input ref={input} hidden type="file" disabled={busy} onChange={event => { calculate(Array.from(event.target.files)); event.target.value = ''; }} />
    {!file ? <div className="tool-panel fingerprint-upload"><DropZone onFiles={calculate}><Fingerprint size={32} /><div className="drop-zone-title">Choose any file to fingerprint</div><div className="drop-zone-sub">SHA-256, SHA-512 and SHA-1 · Calculated locally</div></DropZone></div> : <>
      <div className="fingerprint-filebar"><FileText size={21} /><div><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)} · {file.size.toLocaleString()} bytes{hashes ? ' · Hashes ready' : ''}</span></div><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> Change file</button><button className="icon-btn" disabled={busy} onClick={close} aria-label="Close file"><X size={17} /></button></div>
      {busy && <div className="tool-panel fingerprint-progress"><ProgressBar value={progress || null} label={processed ? `Hashing ${formatBytes(processed)} of ${formatBytes(file.size)}` : 'Preparing file hashes…'} /><button className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button></div>}
      {error && <div className="fingerprint-error" role="alert">{error}<button className="btn btn-secondary btn-sm" onClick={() => calculate([file])}>Try again</button></div>}
      {cancelled && !busy && <div className="fingerprint-cancelled" role="status">Calculation cancelled.<button className="btn btn-secondary btn-sm" onClick={() => calculate([file])}>Calculate hashes</button></div>}
      <div className="fingerprint-grid"><section className="tool-panel fingerprint-results" aria-label="File checksums">
        {hashes ? <><HashRow label="SHA-256" value={hashes.sha256} copied={copied} onCopy={copy} primary /><HashRow label="SHA-512" value={hashes.sha512} copied={copied} onCopy={copy} /><details className="fingerprint-legacy"><summary>SHA-1 · Legacy checksum</summary><HashRow label="SHA-1" value={hashes.sha1} copied={copied} onCopy={copy} /></details><div className="fingerprint-export"><button className="btn btn-primary" onClick={() => downloadBlob(new Blob([fingerprintReport(file, hashes)], { type: 'text/plain;charset=utf-8' }), `fingerprint-${file.name}.txt`)}><Download size={16} /> Download hashes</button><button className="btn btn-secondary" onClick={() => copy('all', fingerprintReport(file, hashes))}>{copied === 'all' ? <Check size={16} /> : <Copy size={16} />}{copied === 'all' ? 'Copied' : 'Copy all'}</button></div></> : <p className="fingerprint-empty">{busy ? 'Checksums will appear here.' : 'Calculate the file hashes to view them.'}</p>}
      </section><aside className="tool-panel fingerprint-compare"><h2>Compare checksum</h2><label htmlFor="fingerprint-expected">Expected checksum</label><textarea id="fingerprint-expected" className="form-input" value={expected} rows={4} spellCheck={false} autoComplete="off" placeholder="Paste a SHA-256, SHA-512 or SHA-1 checksum" onChange={event => setExpected(event.target.value)} />
        {parsed.status === 'invalid' && <p className="fingerprint-compare-message" role="status">{parsed.message}</p>}
        {parsed.status === 'valid' && comparison === null && <p className="fingerprint-compare-message" role="status">{parsed.algorithm.label} detected. {busy ? 'Waiting for calculation…' : 'Calculate the file hashes to compare.'}</p>}
        {comparison !== null && <div className={`fingerprint-comparison ${comparison ? 'match' : 'mismatch'}`} role="status">{comparison ? <Check size={19} /> : <X size={19} />}<div><strong>{comparison ? 'Checksum matches' : 'Checksum does not match'}</strong><span>{parsed.algorithm.label}{parsed.algorithm.key === 'sha1' ? ' · Legacy checksum' : ''}</span></div></div>}
        <p className="fingerprint-note">A checksum compares file contents; it does not verify the author or make the file trustworthy.</p>
      </aside></div>
    </>}
  </div></ToolPage>;
}
