import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { WorkerConverter } from '@matbee/libreoffice-converter/server'

// Ship the real LibreOffice layout engine with the function. No system Office
// executable, external conversion service, or browser WASM download is needed.
export async function exportWasmPdf(bytes) {
  const root = dirname(createRequire(import.meta.url).resolve('@matbee/libreoffice-converter/package.json'))
  const converter = new WorkerConverter({
    wasmPath: join(root, 'wasm'),
    workerPath: join(root, 'dist', 'node.worker.cjs'),
  })
  let timer
  let timedOut = false
  try {
    return await Promise.race([
      (async () => {
        await converter.initialize()
        const result = await converter.convert(bytes, { outputFormat: 'pdf' }, 'document.docx')
        const pdf = Buffer.from(result.data)
        if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('LibreOffice returned an invalid PDF.')
        return pdf
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(Object.assign(new Error('Conversion took too long. Try a smaller document.'), { status: 504 }))
        }, 110000)
      }),
    ])
  } finally {
    clearTimeout(timer)
    // A stalled worker cannot acknowledge the library's graceful shutdown.
    if (timedOut && converter.worker) {
      await converter.worker.terminate()
      converter.worker = null
    }
    // Release the document and the engine's memory after every job, including
    // failures and timeouts; do not retain uploaded documents in a warm function.
    await converter.destroy()
  }
}
