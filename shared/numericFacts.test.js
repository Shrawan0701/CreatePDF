import { describe, expect, it } from 'vitest';
import { unsupportedFigures } from './numericFacts';

describe('summary numeric grounding', () => {
  const source = '[Page 1] Biryani quantity 1 ₹1.00; paneer quantity 2 ₹398.00. Grand total ₹399.00. GSTIN 393949333. Date 13/10/2026, 7:00:52 PM.';
  it('detects extra currency digits and changed identifiers without treating citations as figures', () => {
    expect(unsupportedFigures('Biryani ₹31.00; paneer ₹7398.00; total ₹3399.00. GSTIN 393949334. [p. 1]', source)).toEqual(['31.00', '7398.00', '3399.00', '393949334']);
  });
  it('allows native numerals, unchanged dates and numbered lists', () => {
    expect(unsupportedFigures('1. एकूण ₹३९९.००. [p. 1]\n2. तारीख 13/10/2026, 7:00:52 PM. [p. 1]', source)).toEqual([]);
  });
  it('preserves the value across Indian and European grouping and decimal notation', () => {
    expect(unsupportedFigures('₹1,23,456.00; €1.234,56; 399', '123456.00; 1234.56; 399.00')).toEqual([]);
    expect(unsupportedFigures('₹3,399.00; 1.125', '₹399.00; 1125')).toEqual(['3,399.00', '1.125']);
  });
  it('ignores physical page labels but not quantities in the body', () => {
    expect(unsupportedFigures('Quantity 9. [p. 99]', '[Page 99] Quantity 2.')).toEqual(['9']);
  });
});
