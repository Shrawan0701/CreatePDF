const digitStarts = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];

function normalizeDigits(value) {
  return value.replace(/\p{Nd}/gu, digit => {
    const code = digit.codePointAt(0);
    const start = digitStarts.find(start => code >= start && code <= start + 9);
    return start === undefined ? digit : String(code - start);
  });
}

function numericValue(value) {
  const normalized = normalizeDigits(value);
  const separator = Math.max(normalized.lastIndexOf('.'), normalized.lastIndexOf(','));
  const fraction = separator < 0 ? '' : normalized.slice(separator + 1);
  const grouped = normalized.includes(',') && !normalized.includes('.') && fraction.length === 3
    || /^\d{1,3}(?:\.\d{3}){2,}$/.test(normalized);
  const decimal = separator >= 0 && !grouped;
  const integer = (decimal ? normalized.slice(0, separator) : normalized).replace(/[.,]/g, '').replace(/^0+(?=\d)/, '');
  const digits = decimal ? fraction.replace(/0+$/, '') : '';
  return `${integer}${digits ? `.${digits}` : ''}`;
}

function figures(value) {
  return [...value.replace(/\[(?:Page\s+|p\.\s*)\p{Nd}+\]/giu, '').replace(/^\s*\p{Nd}+[.)]\s+/gmu, '').matchAll(/\p{Nd}+(?:[.,]\p{Nd}+)*/gu)].map(match => match[0]);
}

export function unsupportedFigures(summary, source) {
  const supported = new Set(figures(source).map(numericValue));
  return [...new Set(figures(summary).filter(value => !supported.has(numericValue(value))))];
}
