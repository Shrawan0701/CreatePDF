import { DOCUMENT_LANGUAGES, LANGUAGE_SCRIPTS } from '../../shared/languages';

export const ALL_OCR_LANGUAGES = DOCUMENT_LANGUAGES.map(language => language.ocr).join('+');

export function scanLanguages({ sourceLanguage, language = 'auto', text = '', script } = {}) {
  const selected = DOCUMENT_LANGUAGES.find(entry => entry.name === sourceLanguage);
  if (selected) return selected.ocr === 'eng' ? 'eng' : `eng+${selected.ocr}`;
  if (language !== 'auto') return language;
  const detected = Object.entries(LANGUAGE_SCRIPTS).filter(([, pattern]) => pattern.test(text));
  if (detected.length) return [...new Set(['eng', ...detected.map(([name]) => DOCUMENT_LANGUAGES.find(entry => entry.name === name).ocr)])].join('+');
  if ((text.match(/\p{Script=Latin}/gu) || []).length >= 12) return 'eng+spa+fra+deu+por+ita';
  const scripts = { Devanagari: 'eng+hin+mar', Bengali: 'eng+ben', Tamil: 'eng+tam', Telugu: 'eng+tel', Kannada: 'eng+kan', Gujarati: 'eng+guj', Latin: 'eng+spa+fra+deu+por+ita' };
  return scripts[script] || ALL_OCR_LANGUAGES;
}

export function hasReadableText(text) {
  return (text.match(/\p{L}/gu) || []).length >= 2 && !text.includes('\uFFFD') && ![...text].some(character => character.codePointAt(0) < 9);
}
