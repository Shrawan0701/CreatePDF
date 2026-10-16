// Public language metadata shared by the browser and API. No credentials here.
export const DOCUMENT_LANGUAGES = [
  { name: 'English', ocr: 'eng' },
  { name: 'Hindi', ocr: 'hin' },
  { name: 'Marathi', ocr: 'mar' },
  { name: 'Spanish', ocr: 'spa' },
  { name: 'French', ocr: 'fra' },
  { name: 'German', ocr: 'deu' },
  { name: 'Portuguese', ocr: 'por' },
  { name: 'Italian', ocr: 'ita' },
];
export const LANGUAGE_NAMES = DOCUMENT_LANGUAGES.map(({ name }) => name);
export const OCR_LANGUAGES = Object.fromEntries([
  ...DOCUMENT_LANGUAGES.map(({ name, ocr }) => [name, ocr]),
  ...DOCUMENT_LANGUAGES.filter(({ name }) => name !== 'English').map(({ name, ocr }) => [`English + ${name}`, `eng+${ocr}`]),
  ['English + Hindi + Marathi', 'eng+hin+mar'],
]);
export const REPLY_LANGUAGES = ['Same as question', ...LANGUAGE_NAMES];
export const SUMMARY_LANGUAGES = ['Same as document', ...LANGUAGE_NAMES];
