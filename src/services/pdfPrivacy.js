import { findPiiPatterns, joinPdfText } from './pdfPii';

const check = signal => { if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError'); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const entries = value => value instanceof Map ? [...value.entries()] : value && typeof value[Symbol.iterator] === 'function' && typeof value !== 'string' ? [...value] : value && typeof value === 'object' ? Object.entries(value) : [];
const get = (value, key) => value instanceof Map ? value.get(key) : value?.[key];
const string = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(string).filter(Boolean).join(', ') : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
const short = value => string(value).slice(0, 2000);

export async function scanPdfPrivacy(pdf, { signal, onProgress } = {}) {
  const findings = new Map(), checks = new Map(), links = new Set(), attachments = new Set(), widgetIds = new Map();
  const fieldNames = new Set(), filledFields = new Set();
  const noTextPages = [], textFailures = [];
  let truncated = false, annotationCount = 0, textPages = 0;
  const add = (category, severity, title, value, location, page, action) => {
    const detail = short(value);
    const key = JSON.stringify([category, title, detail]);
    let item = findings.get(key);
    if (!item) {
      if (findings.size >= 5000) { truncated = true; return; }
      item = { id: `finding-${findings.size}`, category, severity, title, value: detail, locations: new Set(), pages: new Set(), action };
      findings.set(key, item);
    }
    if (location) item.locations.add(location);
    if (page) item.pages.add(page);
  };
  const pii = (text, location, page, action = 'auto-redact') => {
    for (const match of findPiiPatterns(text)) add('Personal information', match.type === 'Phone' ? 'medium' : 'high', `${match.type} pattern`, match.value, location, page, action);
  };
  const inspect = async (label, fn, page) => {
    check(signal);
    if (!checks.has(label)) checks.set(label, { label, completed: 0, failed: 0, failedPages: [] });
    const record = checks.get(label);
    try {
      const value = await fn(); check(signal); record.completed++;
      return value;
    } catch {
      check(signal); record.failed++;
      if (page) record.failedPages.push(page);
      return undefined;
    }
  };
  const inspectActions = (actions, location, page) => {
    for (const [event, scripts] of entries(actions)) {
      if (scripts == null || Array.isArray(scripts) && !scripts.length) continue;
      // Report the trigger; never execute or expose the script body.
      add('Active content', 'high', 'Embedded JavaScript', `Trigger: ${event}`, location, page);
    }
  };
  const inspectLink = (value, location, page) => {
    if (typeof value !== 'string' || !value) return;
    links.add(value);
    let severity = 'info';
    try {
      const url = new URL(value);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) severity = 'high';
      else if (url.username || url.password || url.search || url.protocol === 'mailto:' || url.protocol === 'tel:') severity = 'medium';
    } catch { severity = 'medium'; }
    add('Links', severity, 'External reference', value, location, page);
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* Keep the original URL. */ }
    pii(decoded, location, page, 'redact-pdf');
  };

  onProgress?.(3, 'Inspecting document properties…');
  const [metadata, documentActions, fieldObjects, namedAttachments, openAction, outline, layers] = await Promise.all([
    inspect('Document metadata', () => pdf.getMetadata()),
    inspect('Document scripts', () => pdf.getJSActions()),
    inspect('Form fields', () => pdf.getFieldObjects()),
    inspect('Embedded attachments', () => pdf.getAttachments()),
    inspect('Open action', () => pdf.getOpenAction()),
    inspect('Bookmarks and links', () => pdf.getOutline()),
    inspect('Optional layers', () => pdf.getOptionalContentConfig()),
  ]);
  check(signal);
  const info = metadata?.info || {};
  const metadataRows = [];
  const propertyEntries = Object.entries(info).flatMap(([name, value]) => name === 'Custom' && value && typeof value === 'object' ? entries(value).map(([key, detail]) => [`Custom: ${key}`, detail]) : [[name, value]]);
  for (const [name, value] of propertyEntries) {
    const text = string(value);
    if (!text) continue;
    metadataRows.push({ name, value: short(text), kind: 'Document' });
    if (['Author', 'Title', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'].includes(name) || name.startsWith('Custom: ')) {
      add('Metadata', name === 'Author' ? 'medium' : 'info', `Metadata: ${name}`, text, 'Document properties', null, 'edit-metadata');
    }
    pii(text, `Metadata: ${name}`, null, 'edit-metadata');
  }
  if (metadata?.metadata) {
    add('Metadata', 'info', 'Embedded XMP metadata', 'Additional document properties are embedded in this PDF.', 'Document properties', null, 'edit-metadata');
    for (const [name, value] of entries(metadata.metadata)) {
      const text = string(value);
      if (!text) continue;
      metadataRows.push({ name: String(name), value: short(text), kind: 'XMP' });
      pii(text, `XMP: ${name}`, null, 'edit-metadata');
    }
  }
  inspectActions(documentActions, 'Document');
  // Opening a particular page is ordinary navigation, not an active-content risk.
  if (get(openAction, 'action')) add('Active content', 'info', 'Action on opening', get(openAction, 'action'), 'Document');
  for (const [name, attachment] of entries(namedAttachments)) {
    const filename = attachment?.filename || String(name);
    attachments.add(attachment?.id || filename);
    add('Attachments', 'medium', 'Embedded file', filename, 'Document');
  }
  const queue = [...(outline || [])], seen = new Set();
  while (queue.length) {
    check(signal);
    const node = queue.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    inspectLink(node.url || node.unsafeUrl, 'Bookmark');
    if (node.title) pii(node.title, 'Bookmark title', null, 'redact-pdf');
    if (Array.isArray(node.items)) queue.push(...node.items);
  }
  for (const [, group] of entries(layers)) {
    add('Layers', group.visible === false ? 'medium' : 'info', group.visible === false ? 'Hidden optional layer' : 'Optional layer', group.name || 'Unnamed layer', 'Document', null, 'redact-pdf');
  }

  for (let number = 1; number <= pdf.numPages; number++) {
    check(signal); await tick();
    onProgress?.(10 + (number - 1) / pdf.numPages * 85, `Scanning page ${number} of ${pdf.numPages}…`);
    const page = await inspect('Page access', () => pdf.getPage(number), number);
    if (!page) { textFailures.push(number); continue; }
    const [content, annotations, actions] = await Promise.all([
      inspect('Page text', () => page.getTextContent(), number),
      inspect('Annotations and page links', () => page.getAnnotations(), number),
      inspect('Page scripts', () => page.getJSActions(), number),
    ]);
    if (content) {
      const text = joinPdfText(content).text;
      if (text.trim()) textPages++; else noTextPages.push(number);
      pii(text, 'Page text', number);
    } else textFailures.push(number);
    inspectActions(actions, `Page ${number}`, number);
    for (const annotation of annotations || []) {
      check(signal); annotationCount++;
      if (annotation.id) widgetIds.set(annotation.id, number);
      inspectLink(annotation.url || annotation.unsafeUrl, 'Page link', number);
      inspectActions(annotation.actions, 'Annotation or field', number);
      if (annotation.file) {
        const filename = annotation.file.filename || annotation.file.description || 'Unnamed attachment';
        attachments.add(annotation.file.id || filename);
        add('Attachments', 'medium', 'Embedded file', filename, 'Page attachment', number);
      }
      const author = annotation.titleObj?.str || annotation.title;
      const contents = annotation.contentsObj?.str || annotation.contents;
      if (author) { add('Comments', 'medium', 'Annotation author', author, 'Annotation', number, 'redact-pdf'); pii(author, 'Annotation author', number, 'redact-pdf'); }
      if (contents) { add('Comments', 'medium', 'Annotation text', contents, 'Annotation', number, 'redact-pdf'); pii(contents, 'Annotation text', number, 'redact-pdf'); }
      // Some fields are absent from the catalog's field list. Visible widgets
      // provide a second source for entered values and their page references.
      if (annotation.subtype === 'Widget') {
        const fieldName = annotation.fieldName || annotation.id || `widget-${number}-${annotationCount}`;
        fieldNames.add(fieldName);
        const value = string(annotation.fieldValue);
        if (value && annotation.fieldType !== 'Sig' && value !== 'Off') {
          filledFields.add(fieldName);
          add('Forms', 'medium', 'Stored form value', value, `Field: ${annotation.fieldName || 'unnamed'}`, number, 'redact-pdf');
          pii(value, 'Form field', number);
        }
      }
    }
  }
  // Include non-visible/orphan fields and field scripts as well as widgets.
  for (const [name, fieldList] of entries(fieldObjects)) {
    fieldNames.add(name);
    for (const field of Array.isArray(fieldList) ? fieldList : [fieldList]) {
      if (!field) continue;
      const page = widgetIds.get(field.id);
      inspectActions(field.actions, `Field: ${name}`, page);
      const value = string(field.value);
      if (!value || field.type === 'signature' || value === 'Off') continue;
      filledFields.add(name);
      add('Forms', 'medium', 'Stored form value', value, `Field: ${name}`, page, 'redact-pdf');
      pii(value, 'Form field', page);
    }
  }
  check(signal);
  const result = [...findings.values()].map(item => ({ ...item, locations: [...item.locations], pages: [...item.pages].sort((a, b) => a - b) }));
  const priority = { high: 0, medium: 1, info: 2 };
  result.sort((a, b) => priority[a.severity] - priority[b.severity] || (a.pages[0] || 0) - (b.pages[0] || 0) || a.title.localeCompare(b.title));
  const checksList = [...checks.values()];
  onProgress?.(100, 'Scan complete');
  return {
    generatedAt: new Date().toISOString(),
    pageCount: pdf.numPages, textPages, noTextPages, textFailures, annotationCount,
    fieldCount: fieldNames.size, fieldsWithValues: filledFields.size, attachmentCount: attachments.size, linkCount: links.size,
    findings: result, metadata: metadataRows, checks: checksList,
    incomplete: checksList.some(item => item.failed > 0), truncated,
    limitations: 'Pattern checks can miss personal information or flag harmless text. Images are not OCR-scanned. Hidden content and unsupported PDF structures may require manual review. This scan does not modify the PDF or certify it safe.',
  };
}
