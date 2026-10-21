import { redactionTargetPages } from './pdfRedaction';

export const PII_TYPES = ['Email', 'Phone', 'PAN'];
const check = signal => { if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError'); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function findPiiPatterns(text) {
  const detectors = [
    ['Email', /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/gi],
    ['Phone', /(?<![a-z0-9])\+?\d[\d(). -]*\d(?![a-z0-9])/gi],
    ['PAN', /(?<![a-z0-9])[a-z]{5}\d{4}[a-z](?![a-z0-9])/gi],
  ];
  return detectors.flatMap(([type, regex]) => [...text.matchAll(regex)].flatMap(match => {
    const value = match[0];
    if (type === 'Phone') {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return [];
    }
    return [{ type, value, start: match.index, end: match.index + value.length }];
  }));
}

// Join adjacent text runs while retaining offsets into the original items.
// Shared by the privacy scanner and Auto-Redact so their pattern checks agree.
export function joinPdfText(content) {
  const items = content.items.filter(item => typeof item.str === 'string');
  const spans = [], pieces = [];
  let offset = 0;
  items.forEach((item, index) => {
    const previous = items[index - 1];
    if (previous) {
      const a = previous.transform, b = item.transform;
      const height = Math.max(Math.hypot(a[2], a[3]), Math.hypot(b[2], b[3]), 1);
      const length = Math.hypot(a[0], a[1]) || 1, ux = a[0] / length, uy = a[1] / length;
      const dx = b[4] - a[4], dy = b[5] - a[5];
      const gap = dx * ux + dy * uy - previous.width;
      const lineBreak = previous.hasEOL || Math.abs(-dx * uy + dy * ux) > height * .4 || gap > height * 2 || gap < -height;
      const separator = lineBreak ? '\n' : gap > height * .12 && !/\s$/.test(previous.str) && !/^\s/.test(item.str) ? ' ' : '';
      pieces.push(separator); offset += separator.length;
    }
    spans.push({ item, index, start: offset, end: offset + item.str.length });
    pieces.push(item.str); offset += item.str.length;
  });
  return { text: pieces.join(''), spans };
}

function normaliseRect(points, viewport, padding = 1.5) {
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = clamp(Math.min(...xs) - padding, 0, viewport.width);
  const top = clamp(Math.min(...ys) - padding, 0, viewport.height);
  const right = clamp(Math.max(...xs) + padding, 0, viewport.width);
  const bottom = clamp(Math.max(...ys) + padding, 0, viewport.height);
  if (right <= left || bottom <= top) return null;
  return { x: left / viewport.width, y: top / viewport.height, width: (right - left) / viewport.width, height: (bottom - top) / viewport.height, color: '#000000' };
}

// PDF.js lays out the actual text runs, including their measured horizontal
// scaling. DOM ranges locate matched characters without assuming equal glyph
// widths. Measure an unrotated layer, then map all four corners into the same
// rotated/cropped page coordinates used by the preview and export.
async function textMatches(page, content, pdfjs, signal) {
  const plain = page.getViewport({ scale: 1, rotation: 0 });
  const viewport = page.getViewport({ scale: 1 });
  const container = document.createElement('div');
  container.className = 'pii-measure-layer';
  container.setAttribute('aria-hidden', 'true');
  container.style.setProperty('--total-scale-factor', plain.width / plain.rawDims.pageWidth);
  document.body.append(container);
  let layer;
  const abort = () => layer?.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    check(signal);
    layer = new pdfjs.TextLayer({ textContentSource: content, container, viewport: plain });
    // Explicit pixel dimensions also work in browsers without CSS round().
    container.style.width = `${plain.width}px`;
    container.style.height = `${plain.height}px`;
    await layer.render();
    check(signal);
    const { text, spans: offsets } = joinPdfText(content);
    const spans = offsets.map(span => ({ ...span, element: layer.textDivs[span.index] }));
    const origin = container.getBoundingClientRect();
    const found = [];
    for (const match of findPiiPatterns(text)) {
      check(signal);
      if (found.length >= 5000) throw new Error('More than 5,000 matches found. Scan a smaller page range.');
      const regions = [];
      for (const span of spans) {
        if (span.end <= match.start || span.start >= match.end) continue;
        const node = span.element?.firstChild;
        if (!node) throw new Error('Could not locate matched text safely. Try marking it with Redact PDF.');
        const range = document.createRange();
        range.setStart(node, Math.max(0, match.start - span.start));
        range.setEnd(node, Math.min(span.item.str.length, match.end - span.start));
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const points = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]].map(([x, y]) => {
            const pdfPoint = plain.convertToPdfPoint(x - origin.left, y - origin.top);
            return viewport.convertToViewportPoint(...pdfPoint);
          });
          const region = normaliseRect(points, viewport);
          if (region) regions.push(region);
        }
      }
      if (!regions.length) throw new Error('A detected match could not be positioned safely. Use Redact PDF to mark it manually.');
      found.push({ ...match, regions });
    }
    return { found, hasText: !!text.trim() };
  } finally {
    signal?.removeEventListener('abort', abort);
    layer?.cancel();
    container.remove();
  }
}

export async function scanPdfPii(source, pdfjs, { pages = '', signal, onProgress } = {}) {
  const targets = redactionTargetPages(pages, source.pdf.numPages);
  if (!targets.length) throw new Error('This page range contains no pages.');
  const matches = [], imagePages = [];
  for (let index = 0; index < targets.length; index++) {
    check(signal);
    const number = targets[index];
    onProgress?.(index / targets.length * 100, `Scanning page ${number} of ${source.pdf.numPages}…`);
    await tick();
    const page = await source.pdf.getPage(number);
    const content = await page.getTextContent();
    check(signal);
    const { found, hasText } = await textMatches(page, content, pdfjs, signal);
    let hasFieldText = false;
    const viewport = page.getViewport({ scale: 1 });
    // Widget values are not always present in getTextContent(). Redact the
    // complete visible widget when a supported form value contains a match.
    for (const annotation of await page.getAnnotations()) {
      check(signal);
      if (annotation.subtype !== 'Widget' || !['Tx', 'Ch'].includes(annotation.fieldType) || !annotation.rect) continue;
      const text = Array.isArray(annotation.fieldValue) ? annotation.fieldValue.join(' ') : annotation.fieldValue;
      if (typeof text !== 'string') continue;
      hasFieldText ||= !!text.trim();
      const [x1, y1, x2, y2] = annotation.rect;
      const region = normaliseRect([[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(point => viewport.convertToViewportPoint(...point)), viewport);
      if (region) findPiiPatterns(text).forEach(match => {
        // A widget's appearance can also be exposed as normal page text.
        // Keep one checkbox for the same visible occurrence, covering both.
        const existing = found.find(item => item.type === match.type && item.value === match.value && item.regions.some(box => box.x < region.x + region.width && box.x + box.width > region.x && box.y < region.y + region.height && box.y + box.height > region.y));
        if (existing) existing.regions.push(region);
        else found.push({ ...match, regions: [region] });
      });
    }
    if (!hasText && !hasFieldText) imagePages.push(number);
    found.forEach(match => matches.push({ id: `pii-${number}-${matches.length}`, type: match.type, value: match.value, page: number, regions: match.regions.map(region => ({ ...region, page: number })), selected: true }));
    if (matches.length > 5000) throw new Error('More than 5,000 matches found. Scan a smaller page range.');
  }
  check(signal);
  onProgress?.(100, 'Scan complete');
  return { matches, imagePages, pagesScanned: targets.length };
}
