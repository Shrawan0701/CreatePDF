// Public language metadata shared by the browser and API. No credentials here.
export const DOCUMENT_LANGUAGES = [
  { name: 'English', ocr: 'eng' },
  { name: 'Hindi', ocr: 'hin' },
  { name: 'Marathi', ocr: 'mar' },
  { name: 'Bengali', ocr: 'ben' },
  { name: 'Tamil', ocr: 'tam' },
  { name: 'Telugu', ocr: 'tel' },
  { name: 'Kannada', ocr: 'kan' },
  { name: 'Gujarati', ocr: 'guj' },
  { name: 'Spanish', ocr: 'spa' },
  { name: 'French', ocr: 'fra' },
  { name: 'German', ocr: 'deu' },
  { name: 'Portuguese', ocr: 'por' },
  { name: 'Italian', ocr: 'ita' },
];
export const LANGUAGE_NAMES = DOCUMENT_LANGUAGES.map(({ name }) => name);
export const LANGUAGE_SCRIPTS = {
  Hindi: /[\u0900-\u097F]/,
  Marathi: /[\u0900-\u097F]/,
  Bengali: /[\u0980-\u09FF]/,
  Tamil: /[\u0B80-\u0BFF]/,
  Telugu: /[\u0C00-\u0C7F]/,
  Kannada: /[\u0C80-\u0CFF]/,
  Gujarati: /[\u0A80-\u0AFF]/,
};
export const OCR_LANGUAGES = Object.fromEntries([
  ['Automatic (recommended)', 'auto'],
  ...DOCUMENT_LANGUAGES.map(({ name, ocr }) => [name, ocr]),
  ...DOCUMENT_LANGUAGES.filter(({ name }) => name !== 'English').map(({ name, ocr }) => [`English + ${name}`, `eng+${ocr}`]),
  ['English + Hindi + Marathi', 'eng+hin+mar'],
]);
export const REPLY_LANGUAGES = ['Same as question', ...LANGUAGE_NAMES];
export const SUMMARY_LANGUAGES = ['Same as document', ...LANGUAGE_NAMES];
