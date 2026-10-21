import { createSHA1, createSHA256, createSHA512 } from 'hash-wasm';

const CHUNK_SIZE = 4 * 1024 * 1024;

self.onmessage = async ({ data: { file } }) => {
  try {
    const hashers = await Promise.all([createSHA256(), createSHA512(), createSHA1()]);
    hashers.forEach(hasher => hasher.init());
    let lastUpdate = 0;
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const end = Math.min(file.size, offset + CHUNK_SIZE);
      const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      if (chunk.byteLength !== end - offset) throw new Error('The file could not be read completely. Choose it again.');
      hashers.forEach(hasher => hasher.update(chunk));
      const now = performance.now();
      if (now - lastUpdate > 80 || end === file.size) {
        self.postMessage({ type: 'progress', progress: end / file.size * 99, processed: end });
        lastUpdate = now;
      }
    }
    // No special empty-file rejection: hashing zero bytes is valid and yields
    // the standard empty-input digests for each algorithm.
    const [sha256, sha512, sha1] = hashers.map(hasher => hasher.digest('hex'));
    self.postMessage({ type: 'result', hashes: { sha256, sha512, sha1 } });
  } catch (failure) {
    const message = failure.name === 'NotReadableError' ? 'This file could not be read. Choose it again.' : 'Could not calculate this file’s hashes. Try again.';
    self.postMessage({ type: 'error', message });
  }
};
