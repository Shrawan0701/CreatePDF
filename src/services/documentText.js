import { withPdfDocument, renderPageToCanvas } from './pdfEngine';
import { ALL_OCR_LANGUAGES, hasReadableText, scanLanguages } from './ocrLanguages';
import { currencyCandidates, verifyCurrencySymbols } from './ocrCurrency';

export { OCR_LANGUAGES } from '../../shared/languages';

export function isBlankPage(canvas) {
  const context = canvas.getContext?.('2d');
  if (!context?.getImageData) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  const threshold = Math.max(12, canvas.width * canvas.height * .00001);
  for (let offset = 0; offset < data.length; offset += 16) {
    if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 235 && ++ink > threshold) return false;
  }
  return true;
}

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

export async function readDocument(file, { ocr = true, forceOcr = false, language = 'auto', sourceLanguage, onStatus = () => {}, onProgress = () => {}, signal } = {}) {
  let worker, detector, currencyWorker, workerLanguage;
  let completedPages = 0, totalPages = 1;
  const recognize = async (image, hintText = '') => {
    signal?.throwIfAborted();
    const { createWorker } = await import('tesseract.js');
    let selected = scanLanguages({ sourceLanguage, language, text: hintText });
    if (selected === ALL_OCR_LANGUAGES) {
      onStatus('Detecting document language…');
      try {
        if (!detector) {
          detector = await createWorker('osd', 0, { legacyCore: true, legacyLang: true, errorHandler: () => {} });
          await detector.setParameters({ min_characters_to_try: '20' });
        }
        const detected = await detector.detect(image);
        if (detected.data.script_confidence >= 1) selected = scanLanguages({ script: detected.data.script });
      } catch (error) { if (error?.name === 'AbortError') throw error; }
    }
    signal?.throwIfAborted();
    const recognizeWith = async languages => {
      signal?.throwIfAborted();
      if (!worker || workerLanguage !== languages) {
        if (worker) { await worker.terminate(); worker = undefined; }
        onStatus('Loading local OCR engine and language data…');
        worker = await createWorker(languages, 1, { errorHandler: () => {}, logger: (event) => { if (event.status === 'recognizing text') { onStatus(`Recognizing scanned text: ${Math.round(event.progress * 100)}%`); onProgress((completedPages + event.progress * .95) / totalPages * 100); } } });
        workerLanguage = languages;
      }
      return worker.recognize(image, {}, { blocks: true });
    };
    let result = await recognizeWith(selected);
    const automatic = language === 'auto' && (!sourceLanguage || sourceLanguage === 'Auto-detect');
    if (automatic && (result.data.confidence < 75 || !hasReadableText(result.data.text))) {
      onStatus('Checking scan language…');
      try {
        const broad = selected === ALL_OCR_LANGUAGES ? result : await recognizeWith(ALL_OCR_LANGUAGES);
        if (broad.data.confidence > result.data.confidence) result = broad;
        const refinedLanguages = scanLanguages({ text: broad.data.text });
        if (refinedLanguages !== ALL_OCR_LANGUAGES) {
          const refined = await recognizeWith(refinedLanguages);
          if (refined.data.confidence > result.data.confidence) result = refined;
        }
      } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; }
    }
    signal?.throwIfAborted();
    if (currencyCandidates(result.data).length) {
      onStatus('Checking scanned amounts…');
      try {
        await verifyCurrencySymbols(image, result.data, { signal, recognize: async (crop, mode) => {
          if (!currencyWorker) currencyWorker = await createWorker('hin', 1, { errorHandler: () => {} });
          await currencyWorker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '₹0123456789.,' });
          return currencyWorker.recognize(crop, {}, { blocks: true });
        } });
      } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; }
    }
    return { text: result.data.text, confidence: result.data.confidence, blocks: result.data.blocks };
  };
  try {
    if (file.type.startsWith('image/')) {
      if (!ocr) throw new Error('Enable OCR to read text from bill images.');
      const { text, confidence } = await recognize(file);
      if (!text.trim()) throw new Error('No readable text was found in this image. Try a sharper, upright image.');
      onProgress(100);
      return [{ page: 1, text, ocr: true, confidence, blocks: text.split(/\n\s*\n/).filter((s) => s.trim()).map((text) => ({ type: 'paragraph', text })) }];
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF or a supported image.');
    return await withPdfDocument(file, async (pdf, pdfjs) => {
      const pages = [];
      totalPages = pdf.numPages;
      for (let number = 1; number <= pdf.numPages; number++) {
        signal?.throwIfAborted();
        onStatus(`Reading page ${number} of ${pdf.numPages}…`);
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        let items = content.items.filter((item) => item.str?.trim()).map((item) => {
          const matrix = pdfjs.Util.transform(viewport.transform, item.transform);
          const size = Math.max(Math.hypot(matrix[2], matrix[3]), 1);
          const style = content.styles[item.fontName] || {};
          return { text: item.str, x: matrix[4], y: matrix[5], size, width: item.width, height: size, top: matrix[5] - size * (style.ascent ?? .8), angle: Math.atan2(matrix[1], matrix[0]), fontFamily: style.fontFamily || '' };
        });
        let blocks = layoutBlocks(items);
        let text = layoutLines(items).map((line) => line.items.map((item) => item.text).join('    ')).join('\n');
        let usedOcr = false, confidence, blank = false, readingFailed = false;
        if ((forceOcr || !hasReadableText(text)) && ocr) {
          onStatus(`OCR for page ${number} of ${pdf.numPages}…`);
          let canvas;
          try {
            canvas = await renderPageToCanvas(pdf, number, Math.min(3.5, 4200 / Math.max(viewport.width, viewport.height)));
            blank = !hasReadableText(text) && isBlankPage(canvas);
            const hint = text || pages.filter(entry => !entry.ocr).map(entry => entry.text).join('\n').slice(0, 3000);
            const scanned = blank ? null : await recognize(canvas, hint);
            if (scanned && hasReadableText(scanned.text) && (forceOcr || !hasReadableText(text))) {
              confidence = scanned.confidence;
              text = scanned.text; blocks = text.split(/\n\s*\n/).filter((s) => s.trim()).map((text) => ({ type: 'paragraph', text })); usedOcr = true;
              const scaleX = viewport.width / canvas.width, scaleY = viewport.height / canvas.height;
              items = (scanned.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words.filter(word => word.text.trim()).map(word => {
                const { x0, y0, x1, y1 } = word.bbox;
                const height = (y1 - y0) * scaleY;
                const baseline = line.baseline?.y0 ?? line.bbox.y1;
                return { text: word.text, x: x0 * scaleX, y: baseline * scaleY, top: y0 * scaleY, width: (x1 - x0) * scaleX, height, size: height / .8, angle: 0, fontFamily: word.font_name || '' };
              }))));
            }
          } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; readingFailed = true; }
          finally { if (canvas) canvas.width = canvas.height = 0; }
        }
        const readIssue = blank ? null : !hasReadableText(text) ? 'unreadable' : readingFailed || (usedOcr && confidence < 65) ? 'uncertain' : null;
        pages.push({ page: number, text, blocks, items, width: viewport.width, height: viewport.height, ocr: usedOcr, confidence, blank, readIssue });
        completedPages = number;
        onProgress(completedPages / totalPages * 100);
        page.cleanup();
      }
      if (!pages.some((page) => page.text.trim())) throw new Error('No readable text found. Enable OCR for scanned PDFs or choose a clearer document.');
      return pages;
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`OCR could not read this document: ${String(error)}. Check your connection for the engine/language download and try again.`);
  } finally { await Promise.allSettled([worker?.terminate(), detector?.terminate(), currencyWorker?.terminate()]); }
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
