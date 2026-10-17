import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkerConverter } from '@matbee/libreoffice-converter/server'

export function createWasmExporter() {
  let converter
  let jobs = 0
  let pending = Promise.resolve()
  const dispose = async () => {
    const old = converter
    converter = null
    jobs = 0
    if (!old) return
    // Termination also works when a failed/timed-out engine cannot answer a
    // graceful shutdown message. Clear the library's outstanding timers.
    if (old.worker) {
      await old.worker.terminate()
      old.worker = null
    }
    await old.destroy()
  }
  const run = async (bytes, progress, filename) => {
    let timer
    try {
      return await Promise.race([
        (async () => {
          // Bound memory growth, but keep the engine warm between documents.
          // LibreOffice destroys each document and unlinks its input/output files.
          if (jobs >= 8) await dispose()
          if (!converter) {
            progress('Starting conversion engine')
            const root = dirname(createRequire(import.meta.url).resolve('@matbee/libreoffice-converter/package.json'))
            converter = new WorkerConverter({ wasmPath: join(root, 'wasm'), workerPath: fileURLToPath(new URL('./wordWasm.worker.mjs', import.meta.url)) })
            await converter.initialize()
            converter.worker?.unref()
          }
          progress('Converting document')
          const result = await converter.convert(bytes, { outputFormat: 'pdf' }, filename)
          const pdf = Buffer.from(result.data)
          if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('LibreOffice returned an invalid PDF.')
          jobs++
          return pdf
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Conversion took too long. Try a smaller document.'), { status: 504 })), 110000)
        }),
      ])
    } catch (error) {
      await dispose()
      throw error
    } finally { clearTimeout(timer) }
  }
  const exportPdf = (bytes, progress = () => {}, filename = 'document.docx') => {
    const job = pending.then(() => run(bytes, progress, filename))
    pending = job.catch(() => {})
    return job
  }
  exportPdf.destroy = () => pending.then(dispose)
  return exportPdf
}

export const exportWasmPdf = createWasmExporter()
