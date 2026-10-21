import { useEffect, useRef, useState } from 'react';

export function AutoRedactPreview({ source, page, matches, focused, onFocus, disabled }) {
  const scroller = useRef(null), canvas = useRef(null);
  const [bounds, setBounds] = useState({ width: 600, height: 650 });
  const [zoom, setZoom] = useState('fit-page'), [masked, setMasked] = useState(false);
  const [view, setView] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const ready = view?.source === source && view.page === page && view.zoom === zoom && view.bounds === bounds;
  const focusRegion = matches.find(match => match.id === focused && match.page === page)?.regions[0];
  useEffect(() => {
    if (!ready || !focusRegion) return;
    const element = scroller.current;
    element.scrollTop = Math.max(0, (focusRegion.y + focusRegion.height / 2) * view.height + 18 - element.clientHeight / 2);
    element.scrollLeft = Math.max(0, (focusRegion.x + focusRegion.width / 2) * view.width + 18 - element.clientWidth / 2);
  }, [ready, view, focusRegion]);
  useEffect(() => {
    const element = scroller.current;
    const observer = new ResizeObserver(() => {
      const next = { width: Math.floor(element.clientWidth), height: Math.floor(element.clientHeight) };
      if (next.width && next.height) setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false, task;
    const buffer = document.createElement('canvas');
    setError('');
    (async () => {
      const pdfPage = await source.pdf.getPage(page);
      if (cancelled) return;
      const native = pdfPage.getViewport({ scale: 1 });
      const fitWidth = Math.max(80, bounds.width - 36) / native.width;
      const scale = zoom === 'fit-page' ? Math.min(fitWidth, Math.max(80, bounds.height - 36) / native.height) : zoom === 'fit-width' ? fitWidth : Number(zoom);
      const viewport = pdfPage.getViewport({ scale });
      const density = Math.min(window.devicePixelRatio || 1, 2, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      buffer.width = Math.max(1, Math.ceil(viewport.width * density));
      buffer.height = Math.max(1, Math.ceil(viewport.height * density));
      task = pdfPage.render({ canvasContext: buffer.getContext('2d'), viewport, transform: [density, 0, 0, density, 0, 0], background: '#ffffff' });
      await task.promise;
      if (cancelled || !canvas.current) return;
      canvas.current.width = buffer.width; canvas.current.height = buffer.height;
      canvas.current.getContext('2d').drawImage(buffer, 0, 0);
      setView({ source, page, zoom, bounds, width: viewport.width, height: viewport.height });
    })().catch(failure => { if (!cancelled) setError(failure.message || 'Could not render this page.'); }).finally(() => { buffer.width = buffer.height = 0; });
    return () => { cancelled = true; task?.cancel(); };
  }, [source, page, zoom, bounds, retry]);

  return <div className="pii-page-preview">
    <div className="pii-page-tools"><label><input type="checkbox" checked={masked} onChange={event => setMasked(event.target.checked)} /> Show masks</label><select className="form-select" aria-label="Match preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></div>
    <div ref={scroller} className="pii-page-scroll" aria-busy={!ready}>
      <div className="pii-page-sheet" style={{ width: view?.width || 400, height: view?.height || 560, visibility: ready ? 'visible' : 'hidden' }}>
        <canvas ref={canvas} role="img" aria-label={`PDF page ${page} with detected matches`} />
        {ready && matches.filter(match => match.page === page).flatMap(match => match.regions.map((region, index) => <button key={`${match.id}-${index}`} className={`pii-match-box${match.selected ? ' included' : ''}${focused === match.id ? ' focused' : ''}${masked && match.selected ? ' masked' : ''}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} disabled={disabled} title={`${match.type}: ${match.value}`} aria-label={`${match.type}: ${match.value}, ${match.selected ? 'included' : 'excluded'}`} onClick={() => onFocus(match.id)} />))}
      </div>
      {!ready && <div className="pii-page-message" role="status">{error ? <>{error}<button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Retry page</button></> : 'Loading page…'}</div>}
    </div>
  </div>;
}
