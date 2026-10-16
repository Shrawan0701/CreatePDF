import { describe, expect, it } from 'vitest';
import { documentSections, layoutBlocks, retrieveSections, splitText } from './documentText';
import { extractInvoiceLocally, invoiceCsv, invoiceIssues, normalizeInvoice } from './invoiceExtraction';
import { MM_TO_PT, passportLayout, photoCrop } from './passportSheet';

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
