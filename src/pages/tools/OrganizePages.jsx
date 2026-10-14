import { useState } from 'react';
import { Trash2, RotateCcw, RotateCw, Grid3x3, Eye, Copy } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { DropZone, ProgressBar, downloadBlob } from '../../components/ui';
import { getPdfjsLib, getPdfLib, loadPdfBytes, renderPageToDataURL } from '../../services/pdfEngine';
import { useApp } from '../../context/AppContext';

export default function OrganizePages() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]); // [{num, rotation, dataUrl, deleted}]
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [draggedId, setDraggedId] = useState(null);
  const { showToast } = useApp();

  const handleFile = async (files) => {
    const f = files.find((x) => x.type === 'application/pdf');
    if (!f) return;
    setFile(f); setLoading(true);
    try {
      const pdfjsLib = await getPdfjsLib();
      const bytes = await loadPdfBytes(f);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const arr = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const dataUrl = await renderPageToDataURL(pdf, i, 0.4);
        arr.push({ num: i, rotation: 0, dataUrl, deleted: false, id: i });
      }
      setPages(arr);
    } catch (e) {
      showToast('Error loading PDF: ' + e.message, 'error');
    }
    setLoading(false);
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const rotateSelected = (deg) => {
    setPages((prev) => prev.map((p) => selected.has(p.id) ? { ...p, rotation: (p.rotation + deg + 360) % 360 } : p));
  };

  const deleteSelected = () => {
    setPages((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
  };

  const duplicateSelected = () => {
    setPages((current) => current.flatMap((page) => selected.has(page.id)
      ? [page, { ...page, id: crypto.randomUUID?.() || `${page.id}-${Date.now()}-${Math.random()}` }]
      : [page]));
    setSelected(new Set());
  };

  const reorderPage = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    setPages((current) => {
      const next = [...current];
      const from = next.findIndex((page) => page.id === draggedId);
      const to = next.findIndex((page) => page.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedId(null);
  };

  const moveSelected = (dir) => {
    setPages((prev) => {
      const arr = [...prev];
      const ids = [...selected];
      if (dir < 0) {
        for (let i = 0; i < arr.length; i++) {
          if (ids.includes(arr[i].id) && i > 0 && !ids.includes(arr[i - 1].id)) {
            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
          }
        }
      } else {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (ids.includes(arr[i].id) && i < arr.length - 1 && !ids.includes(arr[i + 1].id)) {
            [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
          }
        }
      }
      return arr;
    });
  };

  const handleExport = async () => {
    if (!file || !pages.length) return;
    setProcessing(true); setProgress(0);
    try {
      const { PDFDocument, degrees } = await getPdfLib();
      const bytes = await loadPdfBytes(file);
      const srcDoc = await PDFDocument.load(bytes);
      const dest = await PDFDocument.create();
      for (const pg of pages) {
        const [copied] = await dest.copyPages(srcDoc, [pg.num - 1]);
        copied.setRotation(degrees(pg.rotation));
        dest.addPage(copied);
        setProgress(Math.round((pages.indexOf(pg) + 1) / pages.length * 90));
      }
      const out = await dest.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), 'organized.pdf');
      setProgress(100);
      showToast('PDF organized and downloaded!', 'success');
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
    setProcessing(false);
  };

  return (
    <ToolPage toolId="organize-pages">
      {!file ? (
        <div className="tool-panel">
          <DropZone onFiles={handleFile} accept={['application/pdf']}>
            <div className="drop-zone-icon"><Grid3x3 size={28} /></div>
            <div className="drop-zone-title">Drop a PDF to organize</div>
            <div className="drop-zone-sub">Drag pages to reorder, rotate or delete</div>
          </DropZone>
        </div>
      ) : (
        <>
          <div className="tool-panel">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} selected` : `${pages.length} pages`}
              </span>
              {selected.size > 0 && (
                <>
                  <button className="btn btn-sm btn-secondary" onClick={() => rotateSelected(-90)}>
                    <RotateCcw size={13} /> Rotate Left
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => rotateSelected(90)}>
                    <RotateCw size={13} /> Rotate Right
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => moveSelected(-1)}>↑ Move Up</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => moveSelected(1)}>↓ Move Down</button>
                  <button className="btn btn-sm btn-secondary" onClick={duplicateSelected}><Copy size={13} /> Duplicate</button>
                  <button className="btn btn-sm btn-danger" onClick={deleteSelected}><Trash2 size={13} /> Delete</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setSelected(new Set())}>Deselect All</button>
                </>
              )}
              {selected.size === 0 && (
                <button className="btn btn-sm btn-secondary" onClick={() => setSelected(new Set(pages.map((p) => p.id)))}>Select All</button>
              )}
            </div>

            {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading pages…</div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
              {pages.map((page) => (
                <div
                  key={page.id}
                  className={`page-thumbnail ${selected.has(page.id) ? 'selected' : ''}`}
                  draggable
                  onDragStart={() => setDraggedId(page.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderPage(page.id)}
                  onClick={() => toggleSelect(page.id)}
                  style={{ cursor: 'grab', opacity: draggedId === page.id ? .55 : 1 }}
                >
                  <img
                    src={page.dataUrl}
                    alt={`Page ${page.num}`}
                    style={{
                      width: '100%',
                      display: 'block',
                      transform: `rotate(${page.rotation}deg)`,
                      transition: 'transform 0.2s ease',
                    }}
                  />
                  <div className="page-thumbnail-num">p.{pages.indexOf(page) + 1}</div>
                </div>
              ))}
            </div>
          </div>

          {processing && <ProgressBar value={progress} label="Saving…" />}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={handleExport} disabled={processing || !pages.length}>
              <Eye size={18} /> {processing ? 'Saving…' : 'Download Organized PDF'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setFile(null); setPages([]); setSelected(new Set()); }}>
              <Trash2 size={16} /> Start Over
            </button>
          </div>
        </>
      )}
    </ToolPage>
  );
}
