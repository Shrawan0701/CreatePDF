// Archive original files; do not render, unlock, or rewrite their PDF contents.
function safeBaseName(value, fallback) {
  const name = String(value || '').split(/[\\/]/).pop()
    .normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/[. ]+$/g, '').trim();
  if (!name || /^\.+$/.test(name)) return fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

export function pdfZipDownloadName(value) {
  return `${safeBaseName(value, 'pdf-documents').replace(/(?:\.zip)+$/i, '') || 'pdf-documents'}.zip`;
}

export function planPdfArchive(files) {
  const used = new Set();
  return files.map(file => {
    const stem = safeBaseName(file.name, 'document.pdf').replace(/\.pdf$/i, '') || 'document';
    let name = `${stem}.pdf`;
    let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${stem} (${suffix++}).pdf`;
    used.add(name.toLowerCase());
    return { file, name };
  });
}

function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException('ZIP creation cancelled.', 'AbortError');
}

export async function createPdfArchive(entries, { signal, onProgress } = {}) {
  if (!entries.length) throw new Error('Add at least one PDF.');
  // JSZip writes classic ZIP records, whose size and entry counts have limits.
  const encoder = new TextEncoder();
  const estimatedSize = entries.reduce((total, { file, name }) => total + file.size + encoder.encode(name).length * 4 + 200, 22);
  if (entries.length >= 65535 || estimatedSize >= 0xffffffff) {
    throw new Error('This archive is too large. Download the PDFs in smaller batches.');
  }
  checkCancelled(signal);
  onProgress?.(0);
  const { default: JSZip } = await import('jszip');
  checkCancelled(signal);
  const zip = new JSZip();
  for (const { file, name } of entries) {
    checkCancelled(signal);
    if (!file.size) throw new Error(`${file.name} is empty. Remove it and try again.`);
    const timestamp = Number.isFinite(file.lastModified) ? file.lastModified : Date.now();
    const date = new Date(Math.max(Date.UTC(1980, 0, 1), Math.min(Date.UTC(2107, 11, 31), timestamp)));
    zip.file(name, file, { binary: true, date });
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    // PDFs already compress their streams. STORE is fast and keeps original bytes.
    compression: 'STORE',
    streamFiles: true,
  }, metadata => {
    checkCancelled(signal);
    onProgress?.(Math.min(99, Math.floor(metadata.percent)));
  });
  checkCancelled(signal);
  onProgress?.(100);
  return blob;
}
