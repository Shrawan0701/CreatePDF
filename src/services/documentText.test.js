import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDocument } from './documentText';
import { ALL_OCR_LANGUAGES } from './ocrLanguages';

const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), withPdfDocument: vi.fn(), renderPageToCanvas: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }));
vi.mock('./pdfEngine', () => ({ withPdfDocument: mocks.withPdfDocument, renderPageToCanvas: mocks.renderPageToCanvas }));

describe('document reading with automatic scan languages', () => {
  const file = { name: 'document.pdf', type: 'application/pdf' };
  let detector, worker;
  const source = (text = '') => {
    const texts = Array.isArray(text) ? text : [text];
    const pages = texts.map(value => ({
      getViewport: () => ({ width: 100, height: 100, transform: [] }),
      getTextContent: async () => ({ items: value ? [{ str: value, transform: [12, 0, 0, 12, 10, 40], width: 50, fontName: 'regular' }] : [], styles: {} }),
      cleanup: vi.fn(),
    }));
    mocks.withPdfDocument.mockImplementation((_, callback) => callback({ numPages: pages.length, getPage: async number => pages[number - 1] }, { Util: { transform: (_, matrix) => matrix } }));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    detector = { detect: vi.fn(async () => ({ data: { script: 'Devanagari', script_confidence: 5 } })), setParameters: vi.fn(), terminate: vi.fn() };
    worker = { recognize: vi.fn(async () => ({ data: { text: 'कुल आय 420', confidence: 95, blocks: [{ paragraphs: [{ lines: [{ baseline: { y0: 80 }, bbox: { y1: 80 }, words: [{ text: 'कुल आय', bbox: { x0: 20, y0: 50, x1: 100, y1: 80 } }] }] }] }] } })), terminate: vi.fn() };
    mocks.createWorker.mockImplementation(async language => language === 'osd' ? detector : worker);
    mocks.renderPageToCanvas.mockImplementation(async () => ({ width: 200, height: 200 }));
    source();
  });
  it('does not replace readable Hindi with English recognition, even for a short heading', async () => {
    source('आय');
    const [page] = await readDocument(file, { language: 'eng' });
    expect(page.text).toBe('आय');
    expect(page.ocr).toBe(false);
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });
  it('skips truly blank pages without loading recognition or marking them as unreadable', async () => {
    source(['Readable document content.', '']);
    mocks.renderPageToCanvas.mockResolvedValue({ width: 200, height: 200, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(200 * 200 * 4).fill(255) }) }) });
    const pages = await readDocument(file);
    expect(pages[1]).toMatchObject({ blank: true, readIssue: null, text: '' });
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });
  it('keeps readable pages when a separate image page cannot be recognized', async () => {
    source(['Readable document content.', '']);
    worker.recognize.mockRejectedValue(new Error('Recognition temporarily unavailable'));
    const pages = await readDocument(file);
    expect(pages[0].text).toBe('Readable document content.');
    expect(pages[1]).toMatchObject({ readIssue: 'unreadable', blank: false });
    expect(worker.terminate).toHaveBeenCalled();
  });
  it('detects a scanned script and retains word positions for translation', async () => {
    const [page] = await readDocument(file);
    expect(mocks.createWorker.mock.calls.map(call => call[0])).toEqual(['osd', 'eng+hin+mar']);
    expect(page).toMatchObject({ ocr: true, text: 'कुल आय 420' });
    expect(page.items[0]).toMatchObject({ x: 10, top: 25, width: 40 });
    expect(worker.terminate).toHaveBeenCalled();
    expect(detector.terminate).toHaveBeenCalled();
  });
  it('uses the source-language selection instead of a conflicting manual scan setting', async () => {
    await readDocument(file, { sourceLanguage: 'Hindi', language: 'eng' });
    expect(mocks.createWorker.mock.calls.map(call => call[0])).toEqual(['eng+hin']);
  });
  it('uses readable script hints when rescanning rather than guessing English', async () => {
    source('कुल आय');
    await readDocument(file, { forceOcr: true });
    expect(mocks.createWorker.mock.calls.map(call => call[0])).toEqual(['eng+hin+mar']);
  });
  it('falls back to supported multilingual recognition if detection fails', async () => {
    detector.detect.mockRejectedValue(new Error('Too few characters'));
    await readDocument(file);
    expect(mocks.createWorker.mock.calls.map(call => call[0])).toEqual(['osd', ALL_OCR_LANGUAGES]);
  });
  it('recovers when script detection incorrectly identifies an Indic scan as Latin', async () => {
    detector.detect.mockResolvedValue({ data: { script: 'Latin', script_confidence: 5 } });
    const nativeResult = { data: { text: 'કુલ આવક 420 હતી.', confidence: 90, blocks: [] } };
    const wrongWorker = { recognize: vi.fn(async () => ({ data: { text: 'sa YIAS 420 Sd.', confidence: 50, blocks: [] } })), terminate: vi.fn() };
    const correctWorker = { recognize: vi.fn(async () => nativeResult), terminate: vi.fn() };
    mocks.createWorker.mockImplementation(async language => language === 'osd' ? detector : language === 'eng+spa+fra+deu+por+ita' ? wrongWorker : correctWorker);
    const [page] = await readDocument(file);
    expect(page.text).toBe(nativeResult.data.text);
    expect(mocks.createWorker.mock.calls.map(call => call[0])).toEqual(['osd', 'eng+spa+fra+deu+por+ita', ALL_OCR_LANGUAGES, 'eng+guj']);
    expect(wrongWorker.terminate).toHaveBeenCalled();
  });
});
