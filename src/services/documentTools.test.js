import { describe, expect, it } from 'vitest';
import { documentSections, layoutBlocks, retrieveSections, splitText } from './documentText';
import { extractInvoiceLocally, invoiceCsv, invoiceIssues, normalizeInvoice } from './invoiceExtraction';
import { MM_TO_PT, fillPhotoCopies, passportCutGuides, passportLayout, photoCrop } from './passportSheet';

describe('document extraction and retrieval', () => {
  it('chunks all long and multilingual content without losing characters', () => {
    const text = 'मराठी हिंदी 😀 headings\n'.repeat(1500);
    expect(splitText(text).join('')).toBe(text);
    expect(splitText(text).every((chunk) => chunk.length <= 6000)).toBe(true);
    expect(documentSections([{ page: 8, text }]).every((section) => section.page === 8)).toBe(true);
  });
  it('retrieves matching source pages and resolves follow-up terms', () => {
    const pages = [{ page: 1, text: 'The company makes stationery.' }, { page: 2, text: 'Annual revenue was 420 million. Revenue grew by 20 percent.' }, { page: 3, text: 'The factory is in Pune.' }];
    expect(retrieveSections(pages, 'What is the revenue?')[0].page).toBe(2);
    expect(retrieveSections(pages, 'How much did it grow?', [{ role: 'user', content: 'revenue' }])[0].page).toBe(2);
    expect(retrieveSections(pages, 'Explain page 3')[0].page).toBe(3);
  });
  it('retains headings, paragraph grouping, lists and table cells', () => {
    const item = (text, x, y, size = 11, width = 60) => ({ text, x, y, size, width });
    const blocks = layoutBlocks([item('Title', 10, 10, 22), item('First line', 10, 40), item('second line', 10, 54), item('• point', 10, 80), item('Item', 10, 110), item('Price', 200, 110), item('Book', 10, 125), item('100', 200, 125)]);
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
    expect(blocks[1].text).toBe('First line second line');
    expect(blocks[3].rows).toEqual([['Item', 'Price'], ['Book', '100']]);
  });
});

describe('invoice extraction and validation', () => {
  const source = 'Supplier: Acme Papers\nSupplier Address: Pune\nInvoice No: INV-45\nDate: 16/10/2026\nGSTIN: 27ABCDE1234F1Z5\nCurrency: INR\nDescription    Qty    Price    Amount\nPaper    2    100.00    200.00\nSubtotal: 200.00\nDiscount: 0\nCGST 9%: 18.00\nSGST 9%: 18.00\nIGST: 0\nGrand Total: 236.00';
  it('extracts fields, taxes and line items without an AI request', () => {
    const invoice = extractInvoiceLocally(source);
    expect(invoice.supplierName).toBe('Acme Papers');
    expect(invoice.invoiceNumber).toBe('INV-45');
    expect(invoice.items[0]).toMatchObject({ description: 'Paper', quantity: 2, price: 100, amount: 200 });
    expect(invoice.grandTotal).toBe(236);
    expect(invoiceIssues(invoice)).toEqual([]);
  });
  it('flags missing amounts and discrepancies instead of making up totals', () => {
    const invoice = extractInvoiceLocally(source.replace('Grand Total: 236.00', 'Grand Total: 999.00'));
    expect(invoiceIssues(invoice).some((issue) => issue.includes('236.00'))).toBe(true);
    expect(extractInvoiceLocally('CGST 9%').cgst).toBeNull();
    expect(invoiceIssues(normalizeInvoice({}))).toContain('Missing grand total.');
  });
  it('quotes CSV safely and neutralizes spreadsheet formulas', () => {
    const csv = invoiceCsv(normalizeInvoice({ supplierName: '=HYPERLINK("bad")', items: [{ description: 'A, B', amount: 20 }] }));
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"A, B"');
  });
});

describe('passport sheet physical layout', () => {
  it('supports landscape and photo paper without changing physical photo dimensions', () => {
    const landscape = passportLayout({ width: 35, height: 45, orientation: 'landscape' }, [{ copies: 4 }]);
    expect([landscape.pageWidth, landscape.pageHeight]).toEqual([297, 210]);
    expect(landscape.capacity).toBe(21);
    const small = passportLayout({ width: 35, height: 45, paper: '4x6' }, [{ copies: 8 }]);
    expect([small.pageWidth, small.pageHeight]).toEqual([101.6, 152.4]);
    expect(small.capacity).toBe(4); expect(small.pageCount).toBe(2);
    expect(small.placements.every(photo => photo.width === 35 && photo.height === 45)).toBe(true);
  });
  it('fills only the unused cells on the last sheet and preserves other photos', () => {
    const photos = [{ copies: 4 }, { copies: 4 }];
    const layout = passportLayout({ width: 35, height: 45 }, photos);
    expect(fillPhotoCopies(layout, photos, 0)).toBe(16);
    expect(photos).toEqual([{ copies: 4 }, { copies: 4 }]);
    expect(fillPhotoCopies(layout, [{ copies: 20 }], 0)).toBe(20);
  });
  it('centers each sheet independently and keeps cut guides inside paper', () => {
    const layout = passportLayout({ width: 35, height: 45, centered: true }, [{ copies: 21 }]);
    const last = layout.placements.at(-1);
    expect(last.x).toBeCloseTo((210 - 35) / 2);
    expect(last.y).toBeCloseTo((297 - 45) / 2);
    expect(last.width).toBe(35);
    const guides = passportCutGuides({ x: 0, y: 0, width: 210, height: 297 }, layout, 5);
    expect(guides.every(([x1, y1, x2, y2]) => x1 >= 0 && x2 <= 210 && y1 >= 0 && y2 <= 297)).toBe(true);
  });
  it('uses exact physical dimensions and paginates all requested copies', () => {
    const result = passportLayout({ width: 35, height: 45, paper: 'A4', margin: 10, spacing: 5 }, [{ copies: 30 }]);
    expect(result.columns).toBe(4); expect(result.rows).toBe(5); expect(result.pageCount).toBe(2);
    expect(result.placements).toHaveLength(30);
    expect(result.placements.every((p) => p.x >= 10 && p.x + p.width <= 200 && p.y + p.height <= 287)).toBe(true);
    expect(50.8 * MM_TO_PT).toBeCloseTo(144, 8);
  });
  it('rejects impossible dimensions and fractional copies', () => {
    expect(() => passportLayout({ width: 250, height: 350 }, [{ copies: 1 }])).toThrow('does not fit');
    expect(() => passportLayout({ width: 35, height: 45 }, [{ copies: 1.5 }])).toThrow('copies');
  });
  it('crops without stretching and keeps repositioned crop inside source', () => {
    const crop = photoCrop(1000, 700, 35 / 45, 2, 100, 0);
    expect(crop.width / crop.height).toBeCloseTo(35 / 45);
    expect(crop.x + crop.width).toBeCloseTo(1000); expect(crop.y).toBe(0);
  });
});
