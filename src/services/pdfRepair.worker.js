import { createQpdfImageStreams } from '@lipoe/browser-qpdf';
import wasmUrl from '@lipoe/browser-qpdf/qpdf-image-stream.wasm?url';

const progress = (value, label) => self.postMessage({ type: 'progress', value, label });
function requireResult(result) {
  if (result.ok) return result.value;
  if (result.code === 'PASSWORD_REQUIRED' || result.code === 'INVALID_PASSWORD') {
    throw new Error('Remove the PDF’s opening password before repairing it.');
  }
  throw new Error('The PDF structure could not be recovered. Try Rebuild pages to recover visible content.');
}

self.onmessage = async ({ data: { file } }) => {
  let source, verified;
  try {
    progress(3, 'Loading repair engine…');
    let qpdf;
    try {
      qpdf = await createQpdfImageStreams({ locateFile: name => name.endsWith('.wasm') ? wasmUrl : name });
    } catch {
      throw new Error('The repair engine could not load. Reload and try again.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    progress(12, 'Recovering PDF objects…');
    // qpdf's reader attempts damaged xref/trailer recovery. Its writer emits a
    // new object table and trailer, retaining the original readable object graph.
    source = requireResult(qpdf.loadPdf(bytes));
    const pageCount = requireResult(source.getPageCount());
    const encrypted = requireResult(source.isEncrypted());
    if (!pageCount) throw new Error('No recoverable pages were found.');
    progress(27, 'Rewriting PDF structure…');
    const output = requireResult(source.writePdf({ preserveEncryption: true }));
    source.close(); source = null;
    progress(43, 'Checking rewritten structure…');
    verified = requireResult(qpdf.loadPdf(output));
    if (requireResult(verified.getPageCount()) !== pageCount || requireResult(verified.isEncrypted()) !== encrypted) {
      throw new Error('The repaired copy failed verification. Try Rebuild pages instead.');
    }
    verified.close(); verified = null;
    self.postMessage({ type: 'result', bytes: output, pageCount, encrypted }, [output.buffer]);
  } catch (failure) {
    self.postMessage({ type: 'error', message: failure.message || 'Could not repair this PDF.' });
  } finally {
    source?.close(); verified?.close();
  }
};
