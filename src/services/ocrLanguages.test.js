import { describe, expect, it } from 'vitest';
import { DOCUMENT_LANGUAGES } from '../../shared/languages';
import { ALL_OCR_LANGUAGES, hasReadableText, scanLanguages } from './ocrLanguages';

describe('automatic scan language selection', () => {
  it.each(DOCUMENT_LANGUAGES)('uses the declared $name source even when an old scan setting says English', ({ name, ocr }) => {
    expect(scanLanguages({ sourceLanguage: name, language: 'eng' })).toBe(ocr === 'eng' ? 'eng' : `eng+${ocr}`);
  });
  it.each([
    ['Devanagari', 'eng+hin+mar'], ['Bengali', 'eng+ben'], ['Tamil', 'eng+tam'],
    ['Telugu', 'eng+tel'], ['Kannada', 'eng+kan'], ['Gujarati', 'eng+guj'],
    ['Latin', 'eng+spa+fra+deu+por+ita'],
  ])('maps detected %s to supported scan languages', (script, languages) => {
    expect(scanLanguages({ script })).toBe(languages);
  });
  it('uses every supported model when script detection is inconclusive', () => {
    expect(scanLanguages()).toBe(ALL_OCR_LANGUAGES);
    expect(ALL_OCR_LANGUAGES.split('+')).toHaveLength(13);
    expect(scanLanguages({ text: 'कुल आय மற்றும் தமிழ்' })).toBe('eng+hin+mar+tam');
  });
  it('keeps short, readable native text and scans numeric-only or corrupt text', () => {
    expect(hasReadableText('आय')).toBe(true);
    expect(hasReadableText('Total')).toBe(true);
    expect(hasReadableText('399.00')).toBe(false);
    expect(hasReadableText('Invalid \uFFFD text')).toBe(false);
  });
});
