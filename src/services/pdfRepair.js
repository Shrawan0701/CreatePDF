import { PDFDocument } from 'pdf-lib';
import { getPdfjsLib, loadPdfBytes } from './pdfEngine';
import { recoverReadableText } from './pdfTextRecovery';

const check = signal => { if (signal?.aborted) throw new DOMException('Repair cancelled.', 'AbortError'); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const dispose = async task => { try { await task?.destroy(); } catch { /* Already cancelled. */ } };

function rewriteStructure(file, signal, onProgress) {
  check(signal);
  let worker;
  try { worker = new Worker(new URL('./pdfRepair.worker.js', import.meta.url), { type: 'module' }); }
  catch { throw new Error('The PDF repair worker could not start. Reload and try again.'); }
  return new Promise((resolve, reject) => {
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Repair cancelled.', 'AbortError')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress?.(data.value, data.label); return; }
      cleanup();
      data.type === 'error' ? reject(new Error(data.message)) : resolve(data);
    };
    worker.onerror = () => { cleanup(); reject(new Error('The repair engine stopped unexpectedly. Try again or use Rebuild pages.')); };
    worker.onmessageerror = worker.onerror;
    signal?.addEventListener('abort', abort, { once: true });
    try { check(signal); worker.postMessage({ file }); }
    catch (failure) { cleanup(); reject(failure); }
  });
}

async function withPdf(file, signal, process) {
  const pdfjs = await getPdfjsLib();
  check(signal);
  const bytes = await loadPdfBytes(file);
  check(signal);
  const task = pdfjs.getDocument({ data: bytes, stopAtErrors: true, isEvalSupported: false });
  const abort = () => { dispose(task); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    check(signal);
    return await process(await task.promise);
  } catch (failure) {
    check(signal);
    if (failure.name === 'PasswordException') throw new Error('Remove the PDF’s opening password before repairing it.');
    throw failure;
  } finally {
    signal?.removeEventListener('abort', abort);
    await dispose(task);
  }
}

async function verifyCopy(blob, expectedPages, signal, onProgress) {
  return withPdf(blob, signal, async pdf => {
    if (pdf.numPages !== expectedPages) throw new Error('The output page count failed verification. No file was downloaded.');
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal); await tick();
      onProgress?.(58 + (number - 1) / pdf.numPages * 39, `Checking page ${number} of ${pdf.numPages}…`);
      try {
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid page dimensions.');
        await page.getOperatorList();
        check(signal);
        page.cleanup();
      } catch {
        check(signal);
        throw new Error(`Page ${number} is still unreadable. Try Rebuild pages to recover the readable pages.`);
      }
    }
    let signatureCount = 0;
    try { signatureCount = (await pdf.getSignatures())?.length || 0; } catch { /* Signature validation is outside repair verification. */ }
    return { signatureCount };
  });
}

async function rebuildVisiblePages(file, { dpi, signal, onProgress }) {
  onProgress?.(5, 'Opening readable pages…');
  return withPdf(file, signal, async pdf => {
    if (!pdf.numPages) throw new Error('No recoverable pages were found.');
    let sourceSignatureCount = 0;
    try { sourceSignatureCount = (await pdf.getSignatures())?.length || 0; } catch { /* A damaged signature may itself be unreadable. */ }
    const output = await PDFDocument.create();
    output.setTitle('Recovered document'); output.setCreator('CreatePDF.tech');
    const recoveredPages = [], skippedPages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal); await tick();
      onProgress?.(10 + (number - 1) / pdf.numPages * 42, `Recovering page ${number} of ${pdf.numPages}…`);
      const canvas = document.createElement('canvas');
      let renderTask, page;
      const abort = () => renderTask?.cancel();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        page = await pdf.getPage(number);
        const native = page.getViewport({ scale: 1 });
        if (![native.width, native.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid page dimensions.');
        const scale = Math.min(dpi / 72, 8192 / Math.max(native.width, native.height), Math.sqrt(16_000_000 / (native.width * native.height)));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
        check(signal);
        renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' });
        await renderTask.promise;
        check(signal);
        const image = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the page.')), 'image/png'));
        const embedded = await output.embedPng(await image.arrayBuffer());
        check(signal);
        const target = output.addPage([native.width, native.height]);
        target.drawImage(embedded, { x: 0, y: 0, width: native.width, height: native.height });
        recoveredPages.push(number);
      } catch (failure) {
        check(signal);
        skippedPages.push({ page: number, reason: failure.message || 'Page could not be recovered.' });
      } finally {
        signal?.removeEventListener('abort', abort);
        canvas.width = canvas.height = 0;
        page?.cleanup();
      }
    }
    if (!recoveredPages.length) throw new Error('No readable pages could be recovered. Missing PDF content cannot be recreated.');
    check(signal); onProgress?.(55, 'Creating recovered PDF…');
    const bytes = await output.save({ useObjectStreams: true });
    check(signal);
    return { blob: new Blob([bytes], { type: 'application/pdf' }), sourcePages: pdf.numPages, outputPages: recoveredPages.length, recoveredPages, skippedPages, sourceSignatureCount };
  });
}

export async function repairPdf(file, { mode = 'structure', dpi = 200, textOrder = 'content', signal, onProgress } = {}) {
  check(signal);
  if (!file?.size) throw new Error('This file is empty. There is no PDF content to recover.');
  if (file.size > 256 * 1024 * 1024) throw new Error('Choose a PDF up to 256 MB for repair.');
  if (!['structure', 'rebuild', 'text'].includes(mode)) throw new Error('Choose a supported repair method.');
  if (!['content', 'position'].includes(textOrder)) throw new Error('Choose a supported text order.');
  if (![150, 200, 300].includes(dpi)) throw new Error('Choose a supported page quality.');
  let result;
  if (mode === 'structure') {
    const native = await rewriteStructure(file, signal, onProgress);
    result = { blob: new Blob([native.bytes], { type: 'application/pdf' }), sourcePages: native.pageCount, outputPages: native.pageCount, recoveredPages: [], skippedPages: [] };
  } else if (mode === 'text') result = await withPdf(file, signal, pdf => recoverReadableText(pdf, { signal, onProgress, textOrder }));
  else result = await rebuildVisiblePages(file, { dpi, signal, onProgress });
  check(signal);
  const verified = await verifyCopy(result.blob, result.outputPages, signal, onProgress);
  check(signal); onProgress?.(100, 'PDF ready');
  return { ...result, ...verified, signatureCount: Math.max(result.sourceSignatureCount || 0, verified.signatureCount), mode };
}
