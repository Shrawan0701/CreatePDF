// Shared PDF engine using pdf-lib and pdfjs-dist
import { readJpegOrientation } from './jpegOrientation';

export async function loadPdfBytes(file) {
  if (file?.arrayBuffer) return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function getPdfLib() {
  const { PDFDocument, PDFString, StandardFonts, rgb, degrees, grayscale } = await import('pdf-lib');
  return { PDFDocument, PDFString, StandardFonts, rgb, degrees, grayscale };
}

export async function getPdfjsLib() {
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }
  return pdfjsLib;
}

export async function withPdfDocument(file, process, options = {}) {
  const pdfjs = await getPdfjsLib();
  const loadingTask = pdfjs.getDocument({ ...options, data: await loadPdfBytes(file) });
  try {
    const pdf = await loadingTask.promise;
    return await process(pdf, pdfjs);
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderPageToCanvas(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function renderPageToDataURL(pdfDoc, pageNum, scale = 1.5) {
  const canvas = await renderPageToCanvas(pdfDoc, pageNum, scale);
  return canvas.toDataURL('image/jpeg', 0.92);
}

export async function mergePdfs(fileList, onProgress) {
  const { PDFDocument } = await getPdfLib();
  const merged = await PDFDocument.create();
  for (let i = 0; i < fileList.length; i++) {
    const bytes = await loadPdfBytes(fileList[i]);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
    if (onProgress) onProgress(Math.round(((i + 1) / fileList.length) * 100));
  }
  const out = await merged.save();
  return new Blob([out], { type: 'application/pdf' });
}

export async function splitPdfByRanges(file, ranges) {
  const { PDFDocument } = await getPdfLib();
  const bytes = await loadPdfBytes(file);
  const src = await PDFDocument.load(bytes);
  const results = [];
  for (const range of ranges) {
    const dest = await PDFDocument.create();
    const indices = range.map((n) => n - 1).filter((i) => i >= 0 && i < src.getPageCount());
    const pages = await dest.copyPages(src, indices);
    pages.forEach((p) => dest.addPage(p));
    const out = await dest.save();
    results.push(new Blob([out], { type: 'application/pdf' }));
  }
  return results;
}

export async function rotatePdfPages(file, rotations) {
  // rotations: {[pageIndex]: degrees}
  const { PDFDocument, degrees } = await getPdfLib();
  const bytes = await loadPdfBytes(file);
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();
  for (const [idx, deg] of Object.entries(rotations)) {
    const page = pages[parseInt(idx)];
    if (page) page.setRotation(degrees((page.getRotation().angle + deg) % 360));
  }
  const out = await pdfDoc.save();
  return new Blob([out], { type: 'application/pdf' });
}

export async function compressPdf(file, options = {}) {
  const { mode = 'balanced', onProgress } = options;
  const { PDFDocument } = await getPdfLib();
  const bytes = await loadPdfBytes(file);
  const pdfDoc = await PDFDocument.load(bytes);
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('CreatePDF.si');
  pdfDoc.setCreator('CreatePDF.si');
  const optimized = await pdfDoc.save({ useObjectStreams: true });
  if (mode === 'lossless') return new Blob([optimized], { type: 'application/pdf' });

  const pdfjsLib = await getPdfjsLib();
  const source = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const output = await PDFDocument.create();
  const settings = mode === 'strong' ? { scale: 1.05, quality: .55 } : { scale: 1.35, quality: .72 };
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) {
    const sourcePage = await source.getPage(pageNumber);
    const originalViewport = sourcePage.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(source, pageNumber, settings.scale);
    const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', settings.quality));
    const image = await output.embedJpg(await imageBlob.arrayBuffer());
    const page = output.addPage([originalViewport.width, originalViewport.height]);
    page.drawImage(image, { x: 0, y: 0, width: originalViewport.width, height: originalViewport.height });
    if (onProgress) onProgress(Math.round((pageNumber / source.numPages) * 90));
  }
  const rasterized = await output.save({ useObjectStreams: true });
  const smallest = rasterized.byteLength < optimized.byteLength ? rasterized : optimized;
  return new Blob([smallest], { type: 'application/pdf' });
}

export async function findTextMatches(file, detectors, onProgress) {
  const pdfjsLib = await getPdfjsLib();
  const pdf = await pdfjsLib.getDocument({ data: await loadPdfBytes(file) }).promise;
  const matches = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    content.items.forEach((item, itemIndex) => {
      if (!item.str?.trim()) return;
      const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const height = Math.max(Math.abs(transform[3]), 8);
      const width = Math.max(item.width || height, height);
      detectors.forEach((detector) => {
        const regex = new RegExp(detector.pattern.source, detector.pattern.flags.includes('g') ? detector.pattern.flags : `${detector.pattern.flags}g`);
        for (const result of item.str.matchAll(regex)) {
          const startRatio = result.index / Math.max(item.str.length, 1);
          const widthRatio = result[0].length / Math.max(item.str.length, 1);
          matches.push({ id: `${pageNumber}-${itemIndex}-${detector.type}-${result.index}`, type: detector.type, value: result[0], page: pageNumber, x: (transform[4] + width * startRatio) / viewport.width, y: (transform[5] - height) / viewport.height, width: Math.max(width * widthRatio / viewport.width, .01), height: height / viewport.height, selected: true });
        }
      });
    });
    if (onProgress) onProgress(Math.round((pageNumber / pdf.numPages) * 55));
  }
  return matches;
}

export async function rasterizePdfWithRedactions(file, regions, onProgress) {
  const pdfjsLib = await getPdfjsLib();
  const source = await pdfjsLib.getDocument({ data: await loadPdfBytes(file) }).promise;
  const { PDFDocument } = await getPdfLib();
  const output = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) {
    const sourcePage = await source.getPage(pageNumber);
    const viewport = sourcePage.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(source, pageNumber, 2);
    const context = canvas.getContext('2d');
    regions.filter((region) => region.selected !== false && Number(region.page) === pageNumber).forEach((region) => {
      context.fillStyle = '#000';
      context.fillRect(region.x * canvas.width - 2, region.y * canvas.height - 2, region.width * canvas.width + 4, region.height * canvas.height + 4);
    });
    const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const image = await output.embedPng(await imageBlob.arrayBuffer());
    const page = output.addPage([viewport.width, viewport.height]);
    page.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    if (onProgress) onProgress(55 + Math.round((pageNumber / source.numPages) * 40));
  }
  return new Blob([await output.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

export async function extractText(file, onProgress) {
  return withPdfDocument(file, async (pdf, pdfjsLib) => {
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => item.str?.trim()).map((item) => {
      const transform = pdfjsLib.Util.transform(page.getViewport({ scale: 1 }).transform, item.transform);
      return { text: item.str.trim(), x: transform[4], y: transform[5], size: Math.max(Math.abs(transform[3]), 6) };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const item of items) {
      const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(3, item.size * .35));
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    }
    lines.forEach((line) => line.items.sort((a, b) => a.x - b.x));
    const pageText = lines.map((line) => line.items.map((item) => item.text).join('    ')).join('\n');
    text += `\n--- Page ${i} ---\n${pageText}\n`;
    if (onProgress) onProgress(Math.round((i / pdf.numPages) * 100));
  }
  return text;
  });
}

export async function extractLayout(file, onProgress) {
  return withPdfDocument(file, async (pdf, pdfjsLib) => {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter((item) => item.str?.trim()).map((item) => {
      const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
      return { text: item.str.trim(), x: transform[4], y: transform[5], fontSize: Math.max(Math.abs(transform[3]), 6) };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const item of items) {
      const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(3, item.fontSize * .35));
      if (line) { line.items.push(item); line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length; }
      else lines.push({ y: item.y, items: [item] });
    }
    lines.forEach((line) => line.items.sort((a, b) => a.x - b.x));
    pages.push({ width: viewport.width, height: viewport.height, lines });
    if (onProgress) onProgress(Math.round((pageNumber / pdf.numPages) * 100));
  }
  return pages;
  });
}

export async function getPageCount(file) {
  return withPdfDocument(file, (pdf) => pdf.numPages);
}

export async function getPdfMetadata(file) {
  return withPdfDocument(file, async (pdf) => {
    const meta = await pdf.getMetadata();
    return { numPages: pdf.numPages, info: meta.info, metadata: meta.metadata };
  });
}

export async function addWatermarkToPdf(file, text, options = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await getPdfLib();
  const {
    opacity = 0.15,
    fontSize = 48,
    rotation = 45,
    color = { r: 0.5, g: 0.5, b: 0.5 },
    pageRange = '',
  } = options;

  const bytes = await loadPdfBytes(file);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  const selected = pageRange ? new Set(parsePageRanges(pageRange, pages.length)) : null;
  for (let index = 0; index < pages.length; index++) {
    if (selected && !selected.has(index + 1)) continue;
    const page = pages[index];
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - (text.length * fontSize * 0.3),
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
      opacity,
      rotate: degrees(rotation),
    });
  }
  const out = await pdfDoc.save();
  return new Blob([out], { type: 'application/pdf' });
}

export async function addPageNumbers(file, options = {}) {
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib();
  const { position = 'bottom-center', startAt = 1, fontSize = 10, prefix = '', suffix = '', pageRange = '' } = options;

  const bytes = await loadPdfBytes(file);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const selected = pageRange ? new Set(parsePageRanges(pageRange, pages.length)) : null;
  let sequence = 0;
  for (let i = 0; i < pages.length; i++) {
    if (selected && !selected.has(i + 1)) continue;
    const page = pages[i];
    const { width, height } = page.getSize();
    const number = startAt + sequence;
    const num = `${prefix}${number}${suffix}`.replaceAll('{page}', String(number)).replaceAll('{total}', String(selected?.size || pages.length));
    sequence += 1;
    let x = width / 2 - 20;
    let y = 20;
    if (position === 'top-center') y = height - 30;
    if (position === 'bottom-right') { x = width - 50; y = 20; }
    if (position === 'bottom-left') { x = 20; y = 20; }
    page.drawText(num, { x, y, size: fontSize, font, color: rgb(0.2, 0.2, 0.2) });
  }
  const out = await pdfDoc.save();
  return new Blob([out], { type: 'application/pdf' });
}

export async function imagesToPdf(imageFiles, options = {}) {
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath } = await import('pdf-lib');
  const { pageSize = 'image', fitMode = 'fit', margin = 0 } = options;
  const pdfDoc = await PDFDocument.create();

  for (const file of imageFiles) {
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let img;
    let orientation = 1;
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
      orientation = readJpegOrientation(bytes);
      img = await pdfDoc.embedJpg(bytes);
    } else if (file.type === 'image/png') {
      img = await pdfDoc.embedPng(bytes);
    } else {
      // Preserve transparency in WebP/GIF and other browser-supported formats.
      const url = URL.createObjectURL(file);
      const canvas = document.createElement('canvas');
      const imgEl = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      canvas.width = imgEl.width;
      canvas.height = imgEl.height;
      canvas.getContext('2d').drawImage(imgEl, 0, 0);
      URL.revokeObjectURL(url);
      const pngBytes = canvas.toDataURL('image/png')
        .split(',')[1];
      const binaryStr = atob(pngBytes);
      const bArr = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bArr[i] = binaryStr.charCodeAt(i);
      img = await pdfDoc.embedPng(bArr);
    }

    // JPEG pixels are embedded unchanged. Apply EXIF once in PDF coordinates
    // (bottom-left origin), including mirrored selfies and quarter turns.
    const transforms = [
      null,
      [1, 0, 0, 1, 0, 0],
      [-1, 0, 0, 1, 1, 0],
      [-1, 0, 0, -1, 1, 1],
      [1, 0, 0, -1, 0, 1],
      [0, -1, -1, 0, 1, 1],
      [0, -1, 1, 0, 0, 1],
      [0, 1, 1, 0, 0, 0],
      [0, 1, -1, 0, 1, 0],
    ];
    const imageWidth = orientation >= 5 ? img.height : img.width;
    const imageHeight = orientation >= 5 ? img.width : img.height;
    const drawImage = (page, { x, y, width, height }) => {
      const [a, b, c, d, e, f] = transforms[orientation];
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(
        a * width, b * height, c * width, d * height, x + e * width, y + f * height,
      ));
      page.drawImage(img, { x: 0, y: 0, width: 1, height: 1 });
      page.pushOperators(popGraphicsState());
    };

    if (pageSize === 'image') {
      const scale = Math.min(1, 14400 / Math.max(imageWidth, imageHeight));
      const width = imageWidth * scale;
      const height = imageHeight * scale;
      const page = pdfDoc.addPage([width, height]);
      drawImage(page, { x: 0, y: 0, width, height });
      continue;
    }
    const page = pdfDoc.addPage(pageSize);
    const { width, height } = page.getSize();
    const maxW = width - margin * 2;
    const maxH = height - margin * 2;
    const scale = fitMode === 'fill' ? Math.max(maxW / imageWidth, maxH / imageHeight) : Math.min(maxW / imageWidth, maxH / imageHeight);
    const imgW = imageWidth * scale;
    const imgH = imageHeight * scale;
    const x = margin + (maxW - imgW) / 2;
    const y = margin + (maxH - imgH) / 2;
    page.pushOperators(pushGraphicsState(), rectangle(margin, margin, maxW, maxH), clip(), endPath());
    drawImage(page, { x, y, width: imgW, height: imgH });
    page.pushOperators(popGraphicsState());
  }

  const out = await pdfDoc.save();
  return new Blob([out], { type: 'application/pdf' });
}

export async function pdfPageToJpeg(file, pageNum, scale = 2) {
  const pdfjsLib = await getPdfjsLib();
  const bytes = await loadPdfBytes(file);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const canvas = await renderPageToCanvas(pdf, pageNum, scale);
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
}

export async function pdfToAllJpegs(file, scale = 1.5, onProgress, format = 'jpeg') {
  const pdfjsLib = await getPdfjsLib();
  const bytes = await loadPdfBytes(file);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const blobs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const canvas = await renderPageToCanvas(pdf, i, scale);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const extension = format === 'png' ? 'png' : 'jpg';
    const blob = await new Promise((res) => canvas.toBlob(res, mime, format === 'png' ? undefined : 0.92));
    blobs.push({ blob, name: `page-${i}.${extension}` });
    if (onProgress) onProgress(Math.round((i / pdf.numPages) * 100));
  }
  return blobs;
}

function pdfImageToCanvas(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    context.drawImage(image, 0, 0);
    return canvas;
  }
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0, image.width, image.height);
    return canvas;
  }
  const source = image.data;
  if (!source) throw new Error('Unsupported embedded image format.');
  const pixels = new Uint8ClampedArray(image.width * image.height * 4);
  const channels = source.length / (image.width * image.height);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const sourceOffset = pixel * channels;
    const targetOffset = pixel * 4;
    if (channels >= 3) {
      pixels[targetOffset] = source[sourceOffset];
      pixels[targetOffset + 1] = source[sourceOffset + 1];
      pixels[targetOffset + 2] = source[sourceOffset + 2];
      pixels[targetOffset + 3] = channels >= 4 ? source[sourceOffset + 3] : 255;
    } else {
      pixels[targetOffset] = pixels[targetOffset + 1] = pixels[targetOffset + 2] = source[sourceOffset];
      pixels[targetOffset + 3] = 255;
    }
  }
  context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  return canvas;
}

export async function extractEmbeddedImages(file, onProgress) {
  const pdfjs = await getPdfjsLib();
  const source = await pdfjs.getDocument({ data: await loadPdfBytes(file) }).promise;
  const results = [];
  const seen = new Set();
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) {
    const page = await source.getPage(pageNumber);
    const operators = await page.getOperatorList();
    for (let index = 0; index < operators.fnArray.length; index++) {
      const operation = operators.fnArray[index];
      let image;
      let key;
      if (operation === pdfjs.OPS.paintInlineImageXObject) {
        image = operators.argsArray[index][0];
        key = `inline-${pageNumber}-${index}`;
      } else if (operation === pdfjs.OPS.paintImageXObject || operation === pdfjs.OPS.paintJpegXObject) {
        const objectName = operators.argsArray[index][0];
        key = `${pageNumber}-${objectName}`;
        image = await new Promise((resolve) => page.objs.get(objectName, resolve));
      }
      if (!image || seen.has(key)) continue;
      seen.add(key);
      try {
        const canvas = pdfImageToCanvas(image);
        const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image encoding failed.')), 'image/png'));
        results.push({ blob, name: `page-${pageNumber}-image-${results.length + 1}.png`, width: image.width, height: image.height });
      } catch {
        // Unsupported masks and color spaces are skipped; callers can offer rendered-page fallback.
      }
    }
    if (onProgress) onProgress(Math.round(pageNumber / source.numPages * 100));
  }
  return results;
}

export async function createZipFromBlobs(items) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const { blob, name } of items) {
    zip.file(name, blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function flattenPdf(file) {
  const { PDFDocument } = await getPdfLib();
  const bytes = await loadPdfBytes(file);
  const pdfDoc = await PDFDocument.load(bytes);
  // Flatten by removing annotations and form fields
  pdfDoc.getForm().flatten();
  const out = await pdfDoc.save();
  return new Blob([out], { type: 'application/pdf' });
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function parsePageRanges(input, totalPages) {
  const parts = input.split(',').map((s) => s.trim());
  const pages = new Set();
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((s) => parseInt(s.trim()));
      for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) pages.add(i);
    } else {
      const n = parseInt(part);
      if (n >= 1 && n <= totalPages) pages.add(n);
    }
  }
  return [...pages].sort((a, b) => a - b);
}
