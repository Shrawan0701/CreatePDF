// Generic stub tool for tools that share a common upload-process-download pattern
import { useState } from 'react';
import { FileText, Trash2, Download } from 'lucide-react';
import { ToolPage, useToolState } from '../../components/ToolPage';
import { DropZone, FileItem, ProgressBar, FormGroup, downloadBlob } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { addWatermarkToPdf, addPageNumbers, flattenPdf, getPdfLib, loadPdfBytes, parsePageRanges } from '../../services/pdfEngine';

// ===== ADD WATERMARK =====
export function AddWatermark() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [text, setText] = useState('CONFIDENTIAL');
  const [opacity, setOpacity] = useState(0.15);
  const [fontSize, setFontSize] = useState(48);
  const [rotation, setRotation] = useState(45);
  const [color, setColor] = useState('#808080');

  const handleApply = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      setProgress(30);
      const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return { r, g, b };
      };
      const blob = await addWatermarkToPdf(files[0], text, { opacity, fontSize, rotation, color: hexToRgb(color) });
      setProgress(90);
      downloadBlob(blob, `watermarked-${files[0].name}`);
      showToast('Watermark applied!', 'success');
    });
  };

  return (
    <ToolPage toolId="add-watermark">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF</div>
          <div className="drop-zone-sub">or click to browse</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <div className="tool-panel-title">Watermark Settings</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
          <FormGroup label="Watermark text"><input className="form-input" value={text} onChange={(e) => setText(e.target.value)} /></FormGroup>
          <FormGroup label="Font size"><input className="form-input" type="number" min={10} max={120} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} /></FormGroup>
          <FormGroup label="Opacity (0–1)"><input className="form-input" type="number" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></FormGroup>
          <FormGroup label="Rotation (degrees)"><input className="form-input" type="number" value={rotation} onChange={(e) => setRotation(+e.target.value)} /></FormGroup>
          <FormGroup label="Color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 36, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }} /></FormGroup>
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: '10px', background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Applying watermark…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleApply} disabled={!files[0] || processing}><Download size={18} /> Apply Watermark</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== PAGE NUMBERS =====
export function PageNumbers() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [position, setPosition] = useState('bottom-center');
  const [startAt, setStartAt] = useState(1);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [fontSize, setFontSize] = useState(10);

  const handleApply = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      setProgress(30);
      const blob = await addPageNumbers(files[0], { position, startAt, prefix, suffix, fontSize });
      setProgress(90);
      downloadBlob(blob, `numbered-${files[0].name}`);
      showToast('Page numbers added!', 'success');
    });
  };

  return (
    <ToolPage toolId="page-numbers">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF</div>
          <div className="drop-zone-sub">or click to browse</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <div className="tool-panel-title">Page Number Settings</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
          <FormGroup label="Position">
            <select className="form-select" value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="bottom-center">Bottom Center</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
              <option value="top-center">Top Center</option>
            </select>
          </FormGroup>
          <FormGroup label="Start from"><input className="form-input" type="number" min={0} value={startAt} onChange={(e) => setStartAt(+e.target.value)} /></FormGroup>
          <FormGroup label="Prefix"><input className="form-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Page " /></FormGroup>
          <FormGroup label="Suffix"><input className="form-input" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder=" of N" /></FormGroup>
          <FormGroup label="Font size"><input className="form-input" type="number" min={6} max={24} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} /></FormGroup>
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Adding page numbers…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleApply} disabled={!files[0] || processing}><Download size={18} /> Add Page Numbers</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== ROTATE PDF =====
export function RotatePdf() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [rotationDeg, setRotationDeg] = useState(90);
  const [pagesMode, setPagesMode] = useState('all'); // 'all'|'odd'|'even'|'range'
  const [pageRange, setPageRange] = useState('');

  const handleRotate = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const { PDFDocument, degrees } = await getPdfLib();
      const bytes = await loadPdfBytes(files[0]);
      const pdfDoc = await PDFDocument.load(bytes);
      const pages = pdfDoc.getPages();
      const selectedPages = pagesMode === 'range' ? new Set(parsePageRanges(pageRange, pages.length)) : null;
      setProgress(30);
      pages.forEach((page, i) => {
        const num = i + 1;
        const shouldRotate =
          pagesMode === 'all' ||
          (pagesMode === 'odd' && num % 2 !== 0) ||
          (pagesMode === 'even' && num % 2 === 0) ||
          (pagesMode === 'range' && selectedPages.has(num));
        if (shouldRotate) page.setRotation(degrees((page.getRotation().angle + rotationDeg) % 360));
      });
      setProgress(80);
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `rotated-${files[0].name}`);
      showToast(`Pages rotated ${rotationDeg}°!`, 'success');
    });
  };

  return (
    <ToolPage toolId="rotate-pdf">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to rotate</div>
          <div className="drop-zone-sub">or click to browse</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <FormGroup label="Rotation">
            {[90, 180, 270, -90].map((d) => (
              <button key={d} className={`btn btn-sm ${rotationDeg === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRotationDeg(d)} style={{ marginRight: 6 }}>{d > 0 ? '+' : ''}{d}°</button>
            ))}
          </FormGroup>
          <FormGroup label="Apply to">
            {['all', 'odd', 'even', 'range'].map((m) => (
              <button key={m} className={`btn btn-sm ${pagesMode === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPagesMode(m)} style={{ marginRight: 6, textTransform: 'capitalize' }}>{m}</button>
            ))}
          </FormGroup>
          {pagesMode === 'range' && <FormGroup label="Page range"><input className="form-input" value={pageRange} onChange={(event) => setPageRange(event.target.value)} placeholder="1-3, 7, 10-12" /></FormGroup>}
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Rotating…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleRotate} disabled={!files[0] || processing}><Download size={18} /> Rotate PDF</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== FLATTEN PDF =====
export function FlattenPdf() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();

  const handleFlatten = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      setProgress(30);
      const blob = await flattenPdf(files[0]);
      setProgress(90);
      downloadBlob(blob, `flattened-${files[0].name}`);
      showToast('PDF flattened!', 'success');
    });
  };

  return (
    <ToolPage toolId="flatten-pdf">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF to flatten</div>
          <div className="drop-zone-sub">Merges annotations and form fields into static content</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div style={{ padding: '12px 16px', background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 8, marginBottom: 16, fontSize: 'var(--font-size-sm)', color: 'var(--warning)' }}>
        <strong>Note:</strong> Flattening is irreversible. Interactive form fields and annotations will be permanently merged into the page. Save a backup first.
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Flattening…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleFlatten} disabled={!files[0] || processing}><Download size={18} /> Flatten PDF</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== BATES NUMBERING =====
export function BatesNumbering() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [prefix, setPrefix] = useState('DOC-');
  const [startNum, setStartNum] = useState(1);
  const [padLength, setPadLength] = useState(6);
  const [position, setPosition] = useState('bottom-right');
  const [fontSize, setFontSize] = useState(9);

  const handleApply = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const { PDFDocument, StandardFonts, rgb } = await getPdfLib();
      const bytes = await loadPdfBytes(files[0]);
      const pdfDoc = await PDFDocument.load(bytes);
      const font = await pdfDoc.embedFont(StandardFonts.Courier);
      const pages = pdfDoc.getPages();
      setProgress(30);
      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const num = String(startNum + i).padStart(padLength, '0');
        const label = `${prefix}${num}`;
        let x = width - 80, y = 15;
        if (position === 'bottom-left') { x = 15; y = 15; }
        if (position === 'top-right') { x = width - 80; y = height - 20; }
        if (position === 'top-left') { x = 15; y = height - 20; }
        page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
      });
      setProgress(80);
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `bates-${files[0].name}`);
      showToast('Bates numbering applied!', 'success');
    });
  };

  return (
    <ToolPage toolId="bates-numbering">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <div className="tool-panel-title">Bates Stamp Settings</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
          <FormGroup label="Prefix"><input className="form-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></FormGroup>
          <FormGroup label="Start number"><input className="form-input" type="number" value={startNum} onChange={(e) => setStartNum(+e.target.value)} /></FormGroup>
          <FormGroup label="Digit padding"><input className="form-input" type="number" min={1} max={12} value={padLength} onChange={(e) => setPadLength(+e.target.value)} /></FormGroup>
          <FormGroup label="Position">
            <select className="form-select" value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
            </select>
          </FormGroup>
          <FormGroup label="Font size"><input className="form-input" type="number" min={6} max={18} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} /></FormGroup>
        </div>
        <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-surface-2)', borderRadius: 6, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          Preview: <strong>{prefix}{String(startNum).padStart(padLength, '0')}</strong>
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Applying Bates numbering…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleApply} disabled={!files[0] || processing}><Download size={18} /> Apply Bates Stamp</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}

// ===== HEADERS & FOOTERS =====
export function HeadersFooters() {
  const { files, addFiles, reset, processing, progress, error, run } = useToolState();
  const { showToast } = useApp();
  const [headerLeft, setHeaderLeft] = useState('');
  const [headerCenter, setHeaderCenter] = useState('');
  const [headerRight, setHeaderRight] = useState('');
  const [footerLeft, setFooterLeft] = useState('');
  const [footerCenter, setFooterCenter] = useState('');
  const [footerRight, setFooterRight] = useState('');
  const [fontSize, setFontSize] = useState(9);
  const [margin, setMargin] = useState(20);

  const handleApply = async () => {
    if (!files[0]) return;
    await run(async (setProgress) => {
      const { PDFDocument, StandardFonts, rgb } = await getPdfLib();
      const bytes = await loadPdfBytes(files[0]);
      const pdfDoc = await PDFDocument.load(bytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      setProgress(30);
      pages.forEach((page) => {
        const { width, height } = page.getSize();
        const draw = (text, x, y) => {
          if (!text) return;
          page.drawText(text, { x, y, size: fontSize, font, color: rgb(0.3, 0.3, 0.3) });
        };
        // Header row
        draw(headerLeft, margin, height - margin);
        draw(headerCenter, width / 2 - 40, height - margin);
        draw(headerRight, width - margin - 60, height - margin);
        // Footer row
        draw(footerLeft, margin, margin);
        draw(footerCenter, width / 2 - 40, margin);
        draw(footerRight, width - margin - 60, margin);
      });
      setProgress(80);
      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `headerfooter-${files[0].name}`);
      showToast('Headers & footers applied!', 'success');
    });
  };

  return (
    <ToolPage toolId="headers-footers">
      <div className="tool-panel">
        <DropZone onFiles={(f) => addFiles(f.filter((x) => x.type === 'application/pdf').slice(0, 1))} accept={['application/pdf']}>
          <div className="drop-zone-icon"><FileText size={28} /></div>
          <div className="drop-zone-title">Drop a PDF</div>
        </DropZone>
        {files[0] && <div style={{ marginTop: 10 }}><FileItem file={files[0]} onRemove={() => reset()} /></div>}
      </div>
      <div className="tool-panel">
        <div className="tool-panel-title">Header Text</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FormGroup label="Left"><input className="form-input" value={headerLeft} onChange={(e) => setHeaderLeft(e.target.value)} /></FormGroup>
          <FormGroup label="Center"><input className="form-input" value={headerCenter} onChange={(e) => setHeaderCenter(e.target.value)} /></FormGroup>
          <FormGroup label="Right"><input className="form-input" value={headerRight} onChange={(e) => setHeaderRight(e.target.value)} /></FormGroup>
        </div>
        <div className="tool-panel-title">Footer Text</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <FormGroup label="Left"><input className="form-input" value={footerLeft} onChange={(e) => setFooterLeft(e.target.value)} /></FormGroup>
          <FormGroup label="Center"><input className="form-input" value={footerCenter} onChange={(e) => setFooterCenter(e.target.value)} /></FormGroup>
          <FormGroup label="Right"><input className="form-input" value={footerRight} onChange={(e) => setFooterRight(e.target.value)} /></FormGroup>
        </div>
        <div className="form-grid" style={{ marginTop: 16 }}><FormGroup label="Font size"><input className="form-input" type="number" min="6" max="24" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></FormGroup><FormGroup label="Page margin"><input className="form-input" type="number" min="8" max="100" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></FormGroup></div>
      </div>
      {error && <div style={{ color: 'var(--danger)', padding: 10, background: 'var(--danger-light)', borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {processing && <ProgressBar value={progress} label="Applying…" />}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleApply} disabled={!files[0] || processing}><Download size={18} /> Apply Headers & Footers</button>
        {files[0] && <button className="btn btn-secondary" onClick={reset}><Trash2 size={16} /> Reset</button>}
      </div>
    </ToolPage>
  );
}
