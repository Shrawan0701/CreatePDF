import { withPdfDocument, renderPageToCanvas } from './pdfEngine';

export { OCR_LANGUAGES } from '../../shared/languages';

function layoutLines(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= Math.max(3, item.size * .35));
    if (line) line.items.push(item); else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }));
}

export function layoutBlocks(items) {
  const lines = layoutLines(items);
  const sizes = items.map((item) => item.size).sort((a, b) => a - b);
  const normal = sizes[Math.floor(sizes.length / 2)] || 11;
  const blocks = [];
  let previousY = -Infinity;
  for (const line of lines) {
    const sorted = line.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const item of sorted) {
      const last = cells.at(-1);
      if (last && item.x - last.end < Math.max(12, normal * 1.8)) { last.text += ` ${item.text}`; last.end = item.x + item.width; }
      else cells.push({ text: item.text, end: item.x + item.width });
    }
    const value = cells.map((cell) => cell.text).join('    ');
    const isList = /^\s*(?:[•●▪*-]|\d+[.)])\s/.test(value);
    const heading = Math.max(...sorted.map((item) => item.size)) > normal * 1.2;
    const last = blocks.at(-1);
    if (cells.length >= 2) {
      if (last?.type === 'table' && line.y - previousY < normal * 2.5) last.rows.push(cells.map((cell) => cell.text));
      else blocks.push({ type: 'table', rows: [cells.map((cell) => cell.text)] });
    } else if (!isList && !heading && last?.type === 'paragraph' && line.y - previousY < normal * 1.7) last.text += ` ${value}`;
    else blocks.push({ type: heading ? 'heading' : isList ? 'list' : 'paragraph', text: value });
    previousY = line.y;
  }
  return blocks;
}

export async function readDocument(file, { ocr = true, forceOcr = false, language = 'eng', onStatus = () => {}, signal } = {}) {
  let worker;
  const recognize = async (image) => {
    signal?.throwIfAborted();
    if (!worker) {
      onStatus('Loading local OCR engine and language data…');
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker(language, 1, { errorHandler: () => {}, logger: (event) => { if (event.status === 'recognizing text') onStatus(`Recognizing scanned text: ${Math.round(event.progress * 100)}%`); } });
    }
    const result = await worker.recognize(image);
    signal?.throwIfAborted();
    return { text: result.data.text, confidence: result.data.confidence };
  };
  try {
    if (file.type.startsWith('image/')) {
      if (!ocr) throw new Error('Enable OCR to read text from bill images.');
      const { text, confidence } = await recognize(file);
      if (!text.trim()) throw new Error('No readable text was found in this image. Try a sharper, upright image.');
      return [{ page: 1, text, ocr: true, confidence, blocks: text.split(/\n\s*\n/).filter((s) => s.trim()).map((text) => ({ type: 'paragraph', text })) }];
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF or a supported image.');
    return await withPdfDocument(file, async (pdf, pdfjs) => {
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        signal?.throwIfAborted();
        onStatus(`Reading page ${number} of ${pdf.numPages}…`);
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items.filter((item) => item.str?.trim()).map((item) => {
          const matrix = pdfjs.Util.transform(viewport.transform, item.transform);
          return { text: item.str, x: matrix[4], y: matrix[5], size: Math.max(Math.abs(matrix[3]), 6), width: item.width };
        });
        let blocks = layoutBlocks(items);
        let text = layoutLines(items).map((line) => line.items.map((item) => item.text).join('    ')).join('\n');
        let usedOcr = false, confidence;
        if ((forceOcr || text.replace(/\s/g, '').length < 24 || /\uFFFD/.test(text)) && ocr) {
          onStatus(`OCR for page ${number} of ${pdf.numPages}…`);
          const canvas = await renderPageToCanvas(pdf, number, Math.min(2, 2400 / Math.max(viewport.width, viewport.height)));
          try { const scanned = await recognize(canvas); confidence = scanned.confidence; if (forceOcr || scanned.text.trim().length > text.trim().length) { text = scanned.text; blocks = text.split(/\n\s*\n/).filter((s) => s.trim()).map((text) => ({ type: 'paragraph', text })); usedOcr = true; } }
          finally { canvas.width = canvas.height = 0; }
        }
        pages.push({ page: number, text, blocks, ocr: usedOcr, confidence });
        page.cleanup();
      }
      if (!pages.some((page) => page.text.trim())) throw new Error('No readable text found. Enable OCR for scanned PDFs or choose a clearer document.');
      return pages;
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`OCR could not read this document: ${String(error)}. Check your connection for the engine/language download and try again.`);
  } finally { if (worker) await worker.terminate(); }
}

export function blockText(block) { return block.type === 'table' ? block.rows.map((row) => row.join(' | ')).join('\n') : block.text; }

// Split by Unicode code point so Hindi/Marathi chunks never break surrogate pairs.
export function splitText(text, max = 6000) {
  const output = [];
  let remaining = text;
  while (remaining.length > max) {
    let end = Math.max(remaining.lastIndexOf('\n', max), remaining.lastIndexOf(' ', max));
    if (end < max / 2) end = max;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    output.push(remaining.slice(0, end)); remaining = remaining.slice(end);
  }
  if (remaining.length) output.push(remaining);
  return output;
}

export function documentSections(pages, max = 6000) {
  return pages.flatMap((page) => splitText(page.text, max).map((text, index) => ({ page: page.page, id: `${page.page}-${index}`, text })).filter((section) => section.text.trim()));
}

export function retrieveSections(pages, question, history = [], limit = 10) {
  const sections = documentSections(pages, 2600);
  const stopwords = new Set('a an the is are was were be been being in on at to of for from with and or but this that these those it its what which who when where why how much did does do has have had about please tell me you your can could would should i we they their them as by into than then so if also not'.split(' '));
  const tokens = (value) => (value.toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || []).filter((word) => !stopwords.has(word));
  const terms = [...new Set(tokens(question))];
  const previous = [...new Set(tokens(history.filter((entry) => entry.role === 'user').slice(-2).map((entry) => entry.content).join(' ')))];
  const requested = [...question.matchAll(/\b(?:page|p\.)\s*(\d+)/gi)].map((match) => Number(match[1]));
  const tokenized = sections.map((section) => tokens(section.text));
  const frequency = new Map();
  tokenized.forEach((words) => new Set(words).forEach((word) => frequency.set(word, (frequency.get(word) || 0) + 1)));
  return sections.map((section, i) => {
    const words = tokenized[i];
    const scoreTerms = (values) => values.reduce((score, term) => { const count = words.filter((word) => word === term).length; return score + (count / (count + 1.2)) * Math.log(1 + sections.length / (frequency.get(term) || 1)); }, 0);
    return { ...section, score: scoreTerms(terms) + .3 * scoreTerms(previous) + (requested.includes(section.page) ? 100 : 0) };
  }).sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limit);
}
