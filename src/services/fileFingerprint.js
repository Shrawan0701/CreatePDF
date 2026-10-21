export const FINGERPRINT_ALGORITHMS = [
  { key: 'sha256', label: 'SHA-256', length: 64 },
  { key: 'sha512', label: 'SHA-512', length: 128 },
  { key: 'sha1', label: 'SHA-1', length: 40 },
];

export function parseFingerprint(input) {
  let value = input.trim();
  if (!value) return { status: 'empty' };
  let declared;
  // Accept a raw hash, a labelled hash, or one standard checksum-file line.
  const labelled = value.match(/^SHA-?(256|512|1)\s*(?:\([^\r\n]*\))?\s*[:=]\s*([a-f0-9\s]+)$/i);
  if (labelled) {
    declared = `sha${labelled[1]}`;
    value = labelled[2];
  } else {
    const checksumLine = value.match(/^([a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128})[ \t]+[^\r\n]+$/i);
    const compact = value.replace(/\s+/g, '');
    const plainHash = /^[a-f0-9]+$/i.test(compact) && FINGERPRINT_ALGORITHMS.some(item => item.length === compact.length);
    if (checksumLine && !plainHash) value = checksumLine[1];
  }
  const hex = value.replace(/\s+/g, '').toLowerCase();
  const algorithm = FINGERPRINT_ALGORITHMS.find(item => item.length === hex.length);
  if (!algorithm || !/^[a-f0-9]+$/.test(hex)) {
    return { status: 'invalid', message: 'Enter one complete SHA-256, SHA-512 or SHA-1 checksum.' };
  }
  if (declared && declared !== algorithm.key) return { status: 'invalid', message: 'The checksum length does not match its algorithm.' };
  return { status: 'valid', algorithm, hex };
}

export function fingerprintReport(file, hashes) {
  return [
    `File: ${JSON.stringify(file.name)}`,
    `Size: ${file.size} bytes`,
    ...FINGERPRINT_ALGORITHMS.map(algorithm => `${algorithm.label}: ${hashes[algorithm.key]}`),
    '',
  ].join('\n');
}

export function createFileFingerprint(file, { signal, onProgress } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Calculation cancelled.', 'AbortError'));
  let worker;
  try { worker = new Worker(new URL('./fileFingerprint.worker.js', import.meta.url), { type: 'module' }); }
  catch { return Promise.reject(new Error('Could not start file hashing. Reload and try again.')); }
  return new Promise((resolve, reject) => {
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Calculation cancelled.', 'AbortError')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress?.(data.progress, data.processed); return; }
      cleanup();
      if (data.type === 'error') reject(new Error(data.message));
      else resolve(data.hashes);
    };
    worker.onerror = () => { cleanup(); reject(new Error('File hashing stopped unexpectedly. Try again or choose another file.')); };
    worker.onmessageerror = worker.onerror;
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) { abort(); return; }
      // Clone the Blob handle, not the complete file contents. Reading stays in
      // the worker and uses bounded chunks rather than a file-sized buffer.
      worker.postMessage({ file });
    } catch (failure) { cleanup(); reject(failure); }
  });
}
